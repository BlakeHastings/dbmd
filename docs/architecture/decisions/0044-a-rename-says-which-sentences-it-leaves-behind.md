# 0044. A rename says which sentences it leaves behind

## Context

Append this to `examples/shop/_model.md`:

```
The `subscriptions` table is joined to `nonexistent_table` for billing.
```

Then:

```
shop: 8 tables, 2 notes, 1 group, no problems.     exit 0
--strict                                           exit 0
```

Both halves pass. `nonexistent_table` has never existed, and nothing says so.

**That is ADR 0003 working exactly as designed**, and it is not a defect to fix.
The fourth requirement in that record is "the prose survives", and the way it
survives is that a body is opaque: never parsed, never reflowed, never
round-tripped through a markdown AST. The prose is the part of this format that
a schema dump cannot hold, and it is carried rather than read.

It is also, after a rename, a false sentence with a green tick over it. The
studio's rename edits every file that **refs** the old table and leaves every
sentence that **mentions** it, so the most careful operation in the product
produces a model that is correct and reads wrong. Renaming `subscriptions` in
`examples/shop` leaves `_model.md` saying

> `subscriptions` has no `product_id`, and why "late" is not something you can
> compute from `placed_at` alone.

about a table that is no longer there, and `dbmd check --strict` still exits 0.

**The claim is table-specific, and that is the whole argument.** Renaming
`addresses` in the same directory leaves nothing at all, because nothing in
`examples/shop` names `addresses` in backticks. A general rule over every body
would have been a rule that fires mostly where there is nothing to fix.

dbmd-x82 laid out three shapes: do nothing and say so, a narrow check at rename
time, or a general check over every body. **Only the second is decided here.**
The third is a question about what the format promises rather than an
implementation choice, and it stays the owner's.

## Decision

**After a rename is asked for and before it is agreed to, the confirmation names
every body that mentions the old table in backticks. It is a warning, it is
never an error, and the rename still happens.**

`renamePlan` in `src/studio/client/model.ts` already computes what a rename is
about to touch and returns the sentences the panel reads out. It gains one
paragraph, last, after the sentence about the files that change:

```
3 mentions of `subscriptions` in backticks stay as they are, in _model.md,
tables/plans.md, groups/warehouse.md. A rename moves refs and never prose, and
no check reads a body, so nothing else will tell you.
```

Five decisions inside that.

**Backticks are the only thing read, and ADR 0036 is the precedent.** `orders`
in a sentence is an English word and `` `orders` `` is a claim about a table.
That record's reasoning holds one word along: the signal was already in the
tree before the check was, because every real reference is already in backticks
and it costs a writer nothing they were not already paying. A span counts when
it *is* the name or when it is the name followed by a dot, so `` `orders` `` and
`` `orders.status` `` are both claims and `` `subscriptions_due_idx` `` is not.
Substring matching was refused: it would make every rename of `order` a warning
about `order_items`, and an index is not renamed by a table rename anyway.

**A span never crosses a line.** That is what a code span is, and it is also
what stops a fenced block from being read as one enormous span containing
everything between its fences.

**It is at rename time and nowhere else, and this is not a check over the
model.** The narrow version does not read prose in general; it looks for one
string at one moment, and the moment is the one where the mistake is being made.
Nothing here is reachable from `dbmd check`, there is no flag that turns it into
a general rule, and there is deliberately no helper whose only purpose is that
it would be easy to turn on.

**It goes before the button rather than after.** The rest of the confirmation is
a list of what a rename does to the directory, read while it can still be
declined, and prose that is about to start lying belongs on that list. Three
things settle it. A rename is undone with `git checkout` and nothing else, so
the moment to learn is the moment before. The panel's own line already names
files, and the new paragraph is the same question about the files that do
**not** change, so the two read as one thought. And the alternative, a to-do
list posted into the status line afterwards, would be one sentence competing
with the sentence that says whether the rename finished, on a line that the next
heartbeat is entitled to redraw.

**It never blocks.** Prose that has gone stale is not a broken model, and a tool
that refuses to write until the paragraphs agree is a tool people stop writing
paragraphs for. The `refused` shape of a `RenamePlan` is reserved for a decision
that was never available, such as a name the model already holds. This one is
available.

**The renamed table's own body is named by its new path.** That body is copied
into the new file byte for byte, so a mention inside `tables/subscriptions.md`
is a sentence to fix in `tables/plans.md`. Naming the old path would send
somebody to the file the line above has just said is being deleted, which is the
same mistake the ref count already had to be corrected for once.

**Every kind of body is searched:** `_model.md`, every table, every note, every
group. A group's body is prose too, and a plan built from the tables alone would
be quietly right about the files it edits and quietly wrong about the files it
leaves saying the old name.

## Consequences

- **`renamePlan` now takes more of the model.** Its parameter was
  `Pick<WireModel, 'tables'>` and is now `RenameSubject`, which adds `body`,
  `notes` and `groups`. The widening is deliberate rather than convenient: a
  caller that could pass only tables would silently miss two thirds of the
  prose.
- **It is proved without a browser**, which is why it lives in `model.ts` and
  not in the panel. ADR 0016 put the rename's wording here for that reason, and
  the cases that decide whether the backtick rule is honest are unit tests in
  `test/studio/inspector.test.ts`: a bare word, an index name, a qualified
  column, a fence.
- **A mention this rule does not see passes silently.** A name written without
  backticks, split across a line, or spelled in a heading is prose, and this
  reads none of it. The rule is a floor and not a proof, and the prose sweep in
  the rename recipe is what it reduces rather than what it replaces.
- **A false positive is possible and is cheap.** A sentence deliberately about
  the old name, "this used to be called `subscriptions`", is counted. It costs a
  reader one paragraph they disagree with before pressing a button they were
  going to press anyway, which is the right way round for a warning that cannot
  refuse anything.
- **Nothing about `dbmd check` changed.** Both halves of the reproduction at the
  top of this record still exit 0, on purpose. A model whose prose has gone
  stale is still a model with no problems.

## Revisit when

- **Somebody renames a table outside the studio and wants the same sentence.**
  The rename is a client-side sequence of three requests (ADR 0013) and the
  server has no rename, so there is nowhere else this could live today. A
  server-side or CLI rename is the thing that would move it.
- **The warning is observed firing on renames where there is nothing to fix.**
  That is the failure mode that gets a warning read past, and the fix is a
  narrower rule rather than a louder one.
- **The owner answers whether dbmd reads prose at all.** A yes makes the general
  check possible, and then this record is the special case of it rather than the
  whole of it. A no makes this the furthest the tool ever goes, and that is
  worth writing down here when it happens.
