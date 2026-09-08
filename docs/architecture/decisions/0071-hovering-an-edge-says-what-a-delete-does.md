# 0071. Hovering an edge says what a delete does, and says it whenever the file does

## Context

ADR 0046 gave a `ref:` two sibling keys, `on delete:` and `on update:`. ADR 0049
wired them into `dbmd refs`, whose whole purpose is to be asked "and what happens
to those rows" immediately before a delete. The canvas was left out of both.

Measured on 2026-09-07 in Chromium against the studio running on
[`examples/shop`](../../../examples/shop). Every edge is a `path.edge` carrying
one `<title>`, and all eleven of them read like this:

```
addresses.customer_id references customers.id
order_items.order_id references orders.id
```

The second of those is the one ref in the model that cascades. Nothing on the
drawing says so. The value was never missing from the browser: the inspector has
bound an `on delete` control to `column.ref?.onDelete` since ADR 0046, so the
only way to learn a delete rule from the canvas was to select the table, find the
column in the panel, and read it there.

This is a join nobody owned, in the same shape as the one ADR 0049 filled, and it
is worth a record for one reason: **the interesting decision is not what to say
but when to keep quiet.** Ten of the eleven refs in `examples/shop` say
`on delete: restrict` and the eleventh says `cascade`, so a title that appends the
clause unconditionally writes the same three words onto ten edges.

There is also an open question this record deliberately does not touch. Whether a
cascade and a restrict should *look* different on the canvas, and whether that is
a marker at the child end rather than a colour, is the owner's taste and is
unanswered. Whatever wins there, the value has to reach the edge first.

## Decision

**The edge's `<title>` quotes what the file wrote about the constraint, in the
file's spelling, and says nothing where the file said nothing. Both clauses, not
just the delete. No marker, no colour and no weight changes.**

```
addresses.customer_id references customers.id, on delete: restrict
order_items.order_id references orders.id, on delete: cascade
```

A ref whose file wrote neither clause keeps the sentence it has today, with
nothing appended to it.

### There is no default to suppress, and inventing one makes silence ambiguous

Hiding the common value is the tempting move and it is refused, for the reason
ADR 0049 refused the same move for `dbmd refs` and for one more that is specific
to a tooltip.

**dbmd has no default to measure "common" against.** SQL's default is `no action`.
This model's habit is `restrict`. Neither is dbmd's: `src/model/read.ts` declines
even to warn about `on delete: set null` on a `nullable: false` column, in as many
words, because "saying otherwise would be dbmd ruling on engine behaviour". A
renderer that dropped `restrict` as understood would be making exactly that
ruling, from a rendering, where nobody would look for it. The only other candidate
is "whatever most refs in this model say", which makes one edge's tooltip a
function of a different edge, so editing an unrelated table changes what this one
says.

**And absent is not a value.** ADR 0046 decided that on disk and ADR 0049 carried
it through `--json`. If a written `restrict` were hidden, an edge saying nothing
about deletes would be either a ref that wrote `restrict` or a ref that wrote
nothing, and the person hovering could not tell which. That is the conflation this
format keeps refusing, arriving in the one place it is hardest to notice, because
a tooltip has no schema for anybody to check it against.

**The concern the suppression was for is real and this is not where it is
answered.** A wall of identical text is a property of a *list*: ADR 0049 accepted
one, in a form where ten rows are on the screen at once. A tooltip is one edge at
a time, so there is no wall for a `cascade` to be buried in. What makes a cascade
*stand out* among ten restricts is a mark on the drawing, and that is the open
question above. Answering it with a hidden word would pre-empt the decision and
do it badly.

### `on update` is in, because quoting half a constraint is the same conflation

The question asked was about deletes, and the reason `dbmd refs` prints the clause
is ADR 0042's: it is the question asked immediately before an irreversible thing.
Nothing on the canvas poses the update question, and `examples/shop` writes no
`on update:` at all, which is a decision its own test records rather than a gap.

It is still in. A title that quoted one clause of a constraint and silently
dropped the other would leave an edge showing nothing about updates meaning
either "the file wrote no `on update:`" or "the file wrote one and this tooltip
does not carry it". That is the same two-meanings failure as the paragraph above,
and it would be introduced by the fix for it. So the rule is one sentence and it
covers both clauses. The cost is a clause on edges in imported models, where both
catalogues report an action for every constraint, and it is the cost ADR 0046
already accepted and already named an upstream answer for.

### The words, and where they are built

`, on delete: cascade` after the reference clause. A comma rather than a new
sentence, because the action is a fact about the reference and not a second
subject. The keyword is kept rather than a bare `cascade`, for ADR 0049's two
reasons: `cascade` alone does not say which clause it is, and the string shown is
the string in the file, so somebody who wants to change it can search the model
for what they were shown.

The sentence that explains an end drawn at a table's header instead of a column
row stays last and keeps its per-end reason, which is ADR 0018's. The clauses go
before it because they are about the reference and it is about the drawing.

`edgeTitle` moved from `src/studio/client/canvas.ts` into
`src/studio/client/edges.ts` and is exported. That file owns `RoutedEdge` and the
two reasons an end can be unanchored, it already touches no DOM, and this is the
argument `src/studio/client/columns.ts` makes in its own header: the shape of the
drawing is proven by looking at the page, and the words are a function of the
model and can be held by a test.

## Consequences

- **`EdgeSpec` carries two more optional values.** Beside `from` and `to` rather
  than inside `to`, which is ADR 0049's shape for the same pair in `--json` and
  is the same argument: under `to` an action reads as a property of the column
  pointed at, shared by every ref into it, which is what it is not. They are
  omitted rather than set to `undefined`, because `exactOptionalPropertyTypes` is
  on and the absent key is the fact being preserved.
- **The accessible name of every referencing edge got longer.** The `<title>` is
  what a browser computes the path's name from, so this is not only hover text.
  Ten of eleven edges in `examples/shop` gained four words. That is the price of
  the paragraph above and it was paid deliberately.
- **The canvas gained its first assertion about words rather than geometry.**
  `test/studio/canvas.test.ts` says in its header that the drawing and the
  pointer handling need a DOM and are proven by driving the studio. The eight
  cases added here are not about the drawing: they pin the rule that silence
  means the file said nothing, which a screenshot cannot show and which is the
  thing a later change would break without looking broken.
- **A model imported from a live database will say more.** Both providers report
  an action for every foreign key, so an imported model writes both clauses
  everywhere and every edge's tooltip will carry both. ADR 0046 named that cost
  and named the answer as an option on the import; this record does not move it.
- **The inspector and the canvas now say the same fact in two places.** They read
  the same `Ref`, so they cannot disagree, but the panel says `on delete: unsaid`
  where the drawing says nothing at all. The panel is an editor and has to offer
  a way to clear the value; the drawing is not and does not.

## Revisit when

- **The owner decides how a cascade should look.** A marker at the child end is
  the recommendation on the table. When it lands, ask whether the title should
  stop repeating what the drawing then shows, and the answer is probably still
  yes: a marker is a shape and the title is the word, and a person who cannot see
  the shape is the reason the title exists.
- **The `no action` wall arrives on the canvas rather than in a list.** ADR 0046's
  revisit condition fires the same way here as it does for `dbmd refs`, and its
  answer is still upstream at import. A rendering that hides some actions is the
  thing both records refuse.
- **The canvas becomes operable by keyboard.** ADR 0065 left that open and edges
  are not focusable today, so this string is reached by hovering or by a reader
  walking the tree. A focusable edge makes the title something a person lands on
  deliberately, and its length starts to cost rather than merely to exist.
- **A referential action stops being a value the file writes.** ADR 0049 lists
  this and it applies here word for word: the title's whole claim is that it is
  quoting, so a computed or defaulted action makes it a lie.
