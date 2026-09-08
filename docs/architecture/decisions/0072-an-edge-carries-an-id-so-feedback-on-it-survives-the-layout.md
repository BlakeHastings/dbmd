# 0072. An edge carries an id, so feedback on it survives the layout

## Context

ADR 0064 gave every table, note and group an `id` and a `data-element`, because
the feedback overlay `npm run studio:dev` puts on the page reports what somebody
clicked as a CSS selector, and without an id a box came back as
`#canvas > .scene > .boxes > .box`, the path all eight boxes share. With one it
comes back as `#table-shipments`. That record measured the difference and took
it. It did not reach the edges, and could not have: nothing on the canvas
suggested edges were a different case.

They are, and the reason is a type. `agentation`'s selector builder, read out of
`node_modules/agentation/dist/index.mjs` on 2026-09-08, tries five things in
order: a lone `nav`/`header`/`footer`/`main`; then `el.id`; then a class, guarded
by

```js
if (el.className && typeof el.className === "string") {
```

then a recursion into the parent appending `> tag:nth-child(n)`; then the bare
tag. **An SVG element's `className` is an `SVGAnimatedString`, not a string.** So
no SVG element on any page can reach the class branch, whatever classes it
carries. Every edge is a `path.edge` with no id, so every edge fell through to
the count of children.

Measured on 2026-09-08 against the studio running on
[`examples/shop`](../../../examples/shop), by copying that function verbatim out
of the bundle into the page and running it on all eleven edges. Every one came
back as

```
div.scene > svg:nth-child(2) > g:nth-child(2) > path:nth-child(N)
```

with `N` from 1 to 11 and nothing else to tell them apart. Each of those resolves
to exactly one element, which is the trap: it works perfectly while the render
that produced it is still up. `rebuildEdges` builds the path elements from
scratch on every model change, in `edgeSpecsOf`'s order, so `path:nth-child(4)`
is a different relationship after a column is added to a table earlier in the
walk. The studio rewrites markdown underneath the page for a living. So "the
fourth path" is a fact with a shelf life of one render, recorded in a note
somebody reads later, which is exactly when it is no longer true.

The class branch would not have helped even if SVG could reach it. It also
rejects any purely alphanumeric class of six characters or more, as a guard
against CSS-module hashes, and it takes only the *first* class that passes rather
than trying the rest. `edge` would pass and then fail the uniqueness test, being
one of eleven.

Two facts bound the shape of the fix.

**An edge has no file of its own.** ADR 0003 makes a relationship a column saying
`ref:`, and ADR 0064's ids lean on the format: a table, a note and a group are
one per file, so their names are unique in the document for free. There is no
such guarantee to lean on here, and `validate.ts` reports two columns of one name
as `duplicate-column` rather than refusing the model, so two edges really can
want one name.

**And it must not change the drawing.** Whether a cascade should look different
from a restrict is the owner's open question, named in ADR 0071's *Revisit when*
and untouched here.

## Decision

**Every edge path carries `id="edge-<from table>.<from column>-><to table>.<to
column>"` and the matching `data-element`, through the same `nameForPointing`
that names a box, and only where that name occurs once in the render.**

The name is `edgeName` in `edges.ts`, beside `edgeTitle` and for the reason that
file's header already gives: it is a function of the edge and nothing about the
DOM, so a test can hold it without a browser.

**Both ends, not just the referring one.** The `from` end alone identifies an
edge, because a column carries at most one `ref`. The `to` end is in the name
anyway, because the string is read by a person in a design note: half of
`#edge-orders.customer_id-\>customers.id` is the half saying what the arrow was
pointing at. It is also what keeps a self-reference legible, where both halves
name one table and the columns are the whole of the difference.

**`->` and not the word.** An `id` attribute may not contain ASCII whitespace,
and a name built with spaces would have put one in every edge on the page. Both
`.` and `>` are legal in an id and both survive `CSS.escape`, which is what the
overlay runs before it writes a selector.

**Nothing about the referential actions.** `edgeTitle` grows a clause when the
file writes `on delete:`; this does not. A handle that changed when a rule was
added would stop naming the same edge across an edit that did not move it.

**The caller counts.** `UNIQUE_BY_NAME` settles uniqueness from the kind for the
three kinds the format makes unique. `edge` is not one of them, so `rebuildEdges`
counts the names it is about to write and passes the answer. A name that occurs
twice gets the `data-element` and no id, which is precisely what ADR 0064 already
does for an empty name and for every column: **an id that matches two elements is
worse than no id**, because the overlay's rule takes the first match and a note
about the second edge would come back naming the first.

## Consequences

- **The drawing did not change, and that was measured rather than assumed.** PR
  #187's method: the geometry, the marker reference, the class, the computed
  stroke, the computed stroke width, the dash array, the opacity, the bounding
  box and the total path length were read off every edge on a build of `main` and
  on a build of this branch, and compared value by value. **Zero differences
  across all eleven edges**, and no page errors on either. A screenshot was not
  used and would not have been evidence.
- **It survives a drag and a re-render, which is the thing that was broken.**
  Driven on 2026-09-08 against a copy of `examples/shop`, with the studio
  watching it. Dragging the `shipments` box moved **2 of the 11 paths**, which is
  its one outgoing ref and its one incoming one, and changed **0 ids**. Then a
  `ref: customers.id` column was added to `tables/shipments.md` on disk, the way
  an editor or the studio itself writes one: the page redrew with **12 edges, all
  11 existing ids intact and none lost**, and the new one arrived as
  `edge-shipments.packed_by->customers.id`. Under the old rule the added column
  would have renumbered the paths after it.
- **An id is derived from names, so a rename changes it, and only that one.**
  Renaming that column on disk to `packer_id` in the same session moved exactly
  one id and left the other eleven alone. `table-addresses` behaves the same way
  and always has, and a table created through the panel gets `table-<name>` like
  every other, so this sits beside a convention that already survives a create.
  It is the honest answer rather than a cost: an annotation taken before a rename
  names a relationship that no longer exists under that name, and the
  alternative, a synthetic id stable across renames, would be a stored identity
  for a thing ADR 0003 says is derived.
- **Ids are global, and `edge-` is the whole of what keeps this apart from the
  panel.** The inspector is a sibling on the same page and holds most of the
  page's focusable elements. It writes no ids at all: `inspector.ts` sets
  `id` nowhere, and the ids in `index.html` are the toolbar, the footer and
  `#inspector` itself. Checked on the running page on 2026-09-08 by counting
  every `[id]` in the document: **no id appears twice**, before or after.
- **`nameForPointing` grew a fourth parameter with a default.** The default is
  the old behaviour read off the kind, so the four existing call sites are
  unchanged. The alternative was a second near-identical function for one
  caller, which is the third convention `canvas.ts` already refuses to grow.
- **It is now possible to write an id nothing renders.** `edgeName` is a pure
  function and the uniqueness rule lives at the call site, so a second caller
  could take the name and skip the counting. The header of `edgeName` says the
  string is not unique on its own; that is the only thing holding it.
- **`npm run check:scenes` is unaffected**, and deliberately: it reads class
  names, this adds none, and no rule in the stylesheet names an id or an
  attribute of either scene's canvas half.

## Revisit when

- **Anything else on the canvas becomes SVG.** The class branch is closed to
  every SVG element and not only to paths. A group's shape is already an `svg`
  inside a `div`, and the `div` is what carries `#group-warehouse`; if that
  arrangement is flattened, the group loses its selector the same way the edges
  had.
- **`agentation`'s selector builder changes.** Its ordering is what makes an id
  the fix, and the version this was read from is pinned in the lockfile. The
  landmark branch above `el.id` is the one to look at: a page with exactly one
  `<main>` gets `main` for it whatever id it carries, and `index.html` has
  exactly one.
- **The overlay starts reading `data-element` for the selector as well as the
  name.** Today it takes the name from there and the path from the rule above,
  which is why the label alone was not enough. If that changed, the counting at
  the call site becomes the only thing still needed.
- **Two columns of one table with the same name stops being possible.** If
  `duplicate-column` is ever promoted from a diagnostic to a refusal, the
  counting in `rebuildEdges` becomes dead weight and `edge` can join
  `UNIQUE_BY_NAME` with the other three.
- **An edge becomes focusable or selectable.** ADR 0071 names this as open. An id
  that is written for one development tool would then be sitting on an element a
  person can land on, and ADR 0065's separation between what a tool reads and
  what a person hears would have to be decided for edges rather than inherited.
