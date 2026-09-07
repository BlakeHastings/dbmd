# 0049. The answer before a delete says what the delete does

## Context

`dbmd refs` and `on delete:` landed hours apart on 2026-09-07 and nothing wired
them together.

ADR 0042 is explicit about why the command exists: "The question is asked
immediately before a delete." ADR 0046 gave a `ref:` two sibling keys, `on
delete:` and `on update:`, from a closed vocabulary of five, and put them on
`Ref` in `src/model/types.ts` where the reader fills them in. So by the end of
that day the model held the answer to "and what happens to those rows", and the
one command whose whole purpose is to be asked that question could not say it:

```
$ dbmd refs orders examples/shop
  order_items.order_id -> orders.id  tables/order_items.md  key
  shipments.order_id   -> orders.id  tables/shipments.md    required

$ grep -A1 'ref: orders.id' examples/shop/tables/order_items.md
    ref: orders.id
    on delete: cascade
```

`--json` was the same. An incoming ref carried `from`, `to`, `path`,
`inPrimaryKey` and `nullable`, and nothing about either action.

Neither feature was broken. This is the join nobody owned, and it is worth a
record rather than a commit message because the argument for filling it is ADR
0042's own argument continued, and because the shape of the fix has one real
choice in it.

**The argument is ADR 0042's, one step further.** That record already decided
that "three referrers" is not actionable and that the two marks it prints, `key`
and `required`, earn their space because they are "the difference between
retargeting a ref and deleting a row". A referential action is the same
distinction moved one notch: `restrict` means the delete is refused until
somebody deals with the children, and `cascade` means the children go without
being mentioned. Somebody reading "two refs point at orders" and deleting an
order on that basis has been told the true thing and not the useful one.

## Decision

**Both clauses are printed beside the row that carries them, spelled as the file
spells them, and carried in `--json` as values on the ref. Both directions, and
nothing new is required of the model or the validator.**

### The prose says what the file says, and nothing where the file said nothing

A row grows `on delete: cascade` or `on update: cascade` after `key` and
`required`, quoted from the file:

```
2 refs point at orders in examples/shop:

  order_items.order_id -> orders.id  tables/order_items.md  key  on delete: cascade
  shipments.order_id   -> orders.id  tables/shipments.md    required  on delete: restrict
```

The clause is printed with its keyword rather than as a bare `cascade`, for two
reasons. `cascade` alone does not say which of the two clauses it is, and this
list can carry both. And the string printed is the string in the file, so
somebody who wants to go and change it can search for what they were shown.

A ref the file wrote nothing about gets nothing. **Absent is not `no action`**,
ADR 0046 decided that on disk, and a prose form that printed `no action` for an
unwritten clause would invent a fact about somebody's database.

### `no action` is printed when the file writes it, and this was the live choice

The alternative was tempting and is refused. `no action` is what a silent ref
does anyway, so a reader skimming for danger arguably wants only the actions
that take rows: `cascade`, `set null`, `set default`. And there is a real cost
to not doing that, named in ADR 0046's own consequences: a clean import writes
`on delete: no action` and `on update: no action` on nearly every referencing
column, because both catalogues report `NO ACTION` for a constraint whose DDL
never mentioned an action. So `dbmd refs` on an imported model prints two marks
per row that say nothing happened.

It is refused because ADR 0046 already decided where that cost gets paid. Its
"Revisit when" names this exact outcome, "the `no action` lines an import writes
are observed to be read as noise, by somebody skipping a real `cascade` because
it sat in a wall of `no action`", and names the answer: **"an import option
rather than a rule about which facts are worth writing."** A reader that hides
`no action` is that rule, wearing a rendering's clothes. It also makes silence
mean two things at once, which is the thing this format keeps refusing to do,
and it would leave a `restrict` printed beside a hidden `no action` even though
both leave the referring row exactly where it is.

So there is one rule and it fits in a sentence: **the marks say what the file
says.** If the wall of `no action` is ever observed to hurt somebody, the fix
is upstream at import and this record does not have to move.

### `--json` carries a value on the ref, not a flag beside it

```json
{
  "from": { "table": "order_items", "column": "order_id" },
  "to": { "table": "orders", "column": "id" },
  "path": "tables/order_items.md",
  "inPrimaryKey": true,
  "onDelete": "cascade"
}
```

`onDelete` and `onUpdate` are siblings of `path` and `inPrimaryKey`, omitted
when the file said nothing, spelled with SQL's words rather than the
introspection contract's `noAction` and `setNull`, which is ADR 0022's asymmetry
and ADR 0046's spelling.

Three things about that shape were choices.

- **A value and not a boolean.** ADR 0014 makes a structured field's shape part
  of the contract, and the vocabulary here is closed at five. A `cascades: true`
  would answer one of the five questions and lose the other four, and there is
  no version of it that grows into `set default` without breaking.
- **Beside `from` and `to`, not inside `to`.** `Ref` in the model holds the
  actions, and `RefEdge.to` is that `Ref` verbatim, so nesting them there would
  have been the shorter diff. It reads wrong: `to` is where the ref points, and
  an action is a fact about this constraint rather than about the table it points
  at. Under `to` it would look like a property of `orders.id` that every ref into
  `orders` shared, which is exactly what it is not.
- **Omitted rather than null.** The same rule `inPrimaryKey` and `nullable`
  already follow (ADR 0042, ADR 0008), and here it is what preserves ADR 0046's
  distinction through the machine form: a consumer reading `onDelete ===
  undefined` is reading a file that did not say, and one reading
  `"no action"` is reading a file that did.

### Nothing added needs the validator

The clause is read off `RefEdge.to`, which the reader built. `dbmd refs` still
answers a model with errors in it, which is the gap ADR 0042 built it for, and
the action still shows on every ref the reader could see. That is asserted
against the real `dbmd export` refusal rather than described.

## Consequences

- **The marks are two spaces apart rather than one.** A mark used to be one
  word. `key on delete: cascade` reads as a phrase; `key  on delete: cascade`
  reads as two facts, which is what it is. That changes the one existing case
  where a row carries both `key` and `required`.
- **The legend gains one sentence for both clauses, not one each.** It is worded
  from the arrow rather than from a direction, "the row on the left" and "the row
  on the right", so the incoming and outgoing sections share it. A list that used
  neither clause still explains neither, which is the rule ADR 0042 set for `key`
  and `required`.
- **A row in an imported model can carry four marks.** That is the cost accepted
  above, arriving. It is one line per ref and every mark on it is a fact somebody
  can act on, and the anticipated fix is at import.
- **`dbmd refs` is now the whole of what the delete recipe needs.** The skill's
  "Delete a table" step said "read the marks" and meant two of them. It means
  four now, and the one that changes what somebody does is `on delete: cascade`.
- **Nothing in `src/model/` changed, again.** ADR 0042 said that about
  `referencesTo` and it stays true: `Ref` has held both clauses since ADR 0046
  and this command reads them.

## Revisit when

- **Somebody asks for a filter.** "Show me only the refs that cascade" is the
  next thing to want on a big model, and it is a flag over this data rather than
  a change to it. ADR 0042's revisit list already anticipates the sibling case,
  asking about a column rather than a table, and the two are the same kind of
  narrowing.
- **The `no action` wall is observed rather than predicted.** Then ADR 0046's
  revisit condition has fired, and the answer it names is an import option. If
  somebody proposes fixing it here instead, this section is the argument they
  have to beat.
- **A referential action stops being a value the file writes.** If dbmd ever
  computes or defaults one, the printing rule above becomes a lie, because the
  mark's whole claim is that it is quoting.
- **`dbmd refs` grows a mark that is not a fact from a file.** Every mark it
  prints today is quoted or read directly off one key. The first one that is a
  judgement is a different kind of output and wants its own argument, for the
  reason ADR 0046 refused to warn about `on delete: set null` on a
  `nullable: false` column: deciding whether a schema is a good idea is a
  question about somebody's database, and dbmd does not answer those.
