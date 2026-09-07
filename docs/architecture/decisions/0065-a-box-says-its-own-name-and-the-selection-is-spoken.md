# 0065. A box says its own name, and the selection is spoken

The other half of [ADR 0064](0064-the-feedback-overlay-is-a-second-entry-point.md),
which named every canvas object for a development tool and, in the same
sentence, refused to do it with `aria-label`. That refusal was right and this
record does not overturn it. It answers the reader 0064 was not about.

## Context

**The studio's chrome announces itself and its canvas does not.** Counted across
`src/studio/client/` on 2026-09-07: fourteen `aria-label` attributes, seven
`aria-pressed`, one each of `<main>`, `<footer>` and `<aside>`, seven
`<button>`, and nothing at all on a table box, a note or a group.

That is a count of attributes in source, which is the weaker half of the
evidence. The stronger half is the accessibility tree the browser computes from
them, because that is the data a screen reader speaks from. Taken with
`Accessibility.getFullAXTree` over CDP, in Edge, against a studio serving a copy
of `examples/shop`:

| object                              | role      | accessible name, before             |
| ----------------------------------- | --------- | ----------------------------------- |
| the eight table boxes               | `article` | none                                |
| the `warehouse` group               | `generic` | none, and a `generic` cannot have one |
| the two notes                       | `article` | `notes/the-copies-are-deliberate.md` |
| a column row                        | `listitem` | `customer_id uuid → customers.id`   |
| the toolbar's buttons               | `button`  | `Zoom out`, `Add table`, and so on  |
| the sentence naming what is selected | `generic` | it is text, and text is not spoken when it changes |

Three things in that table are worth reading twice.

**An `article` with no name is not nothing, and it is not enough either.** The
table's name is inside it, in the `<header>`, so somebody reading the page from
top to bottom does reach the word `addresses`. What they cannot do is ask what
is on this canvas, or jump to one box, or be told which of eight boxes they have
landed in. The eight articles were indistinguishable from each other until read
through.

**The group was not in the tree at all as a group.** A `div` with no role is a
`generic`, and the only trace of `warehouse` was the loose text `Written by the
depot handheld`, which is the label somebody typed into the file and not the
name of anything.

**The notes had a name and it was the wrong one.** `title` is set to the note's
path, and a `title` with nothing better available becomes the accessible name.
So the two notes announced themselves as file paths.

**What is selected was already written down and never spoken.** Selecting a box
puts `Selected table shipments.` into `#selection` in the footer, and has since
the canvas was built. A screen reader says nothing about text that changes
unless the element it changed in is a live region, and this one was not. The
selected border is the only other signal, and a border is not something
everybody gets.

### Why ADR 0064 refusing `aria-label` does not settle this

0064 measured `aria-label` as a carrier for the feedback overlay's label and
refused it because it "changes the accessibility tree of a canvas box in order
to improve a development label". Two things about that are specific rather than
general.

**It was refused for what would have been written, not only for where.** The
string in question was the overlay's, `table shipments`, put on the element for
a tool's benefit. A label a person needs is not that, even when the words come
out the same, and the two are now produced by two functions from two sets of
reasons.

**`article` and `group` take their name from the author and never from their
contents.** That is what makes the cost 0064 was avoiding not arise here.
Naming a `<button>` with `aria-label` replaces the word on the button; naming an
`article` adds a name and leaves every child exactly where it was. That is
measured below rather than argued from the specification.

## Decision

**Every object a person can drag has a name and a role in the accessibility
tree, and the sentence that says what is selected is a live region.** Five parts,
and each is one or two lines of code.

### `nameForReading`, next to `nameForPointing` and separate from it

A second function rather than two more lines in the first. `nameForPointing`
writes what one development tool reads; `nameForReading` writes what a person
hears. Neither derives from the other, so a change to what the toolbar wants can
never change what somebody is told about the drawing. The `id` and
`data-element` 0064 added are untouched, and the `data-table`, `data-note` and
`data-group` the code actually finds objects by are untouched as well.

### The label is the kind and the name, in that order

`table addresses`, `note there-is-no-stock-column`, `group warehouse`. The kind
is in the name because three kinds share one canvas and `addresses` alone does
not say which of them this is. The order is the footer's order: the status line
already writes `Selected table addresses.`, so a person hears the same phrase
from the announcement and from the box it is about.

### A group is given `role="group"`

An unroled `div` is a `generic`, `aria-label` on a `generic` is prohibited, and
a browser computes the name and then drops it. The group needs a role that can
hold a name before a name is worth writing. Tables and notes are `<article>`
already and are left alone.

### A column is named by nothing new

Its row is a `listitem` whose `title` already reads `customer_id uuid →
customers.id`, which was in the tree before this change and says what the row
says on screen. 0064 excluded columns from its ids for a different reason, that
`id` is not unique across tables. Both exclusions land in the same place and
neither is the other's reason.

### `#selection` becomes `role="status"`

One attribute in `index.html`. `role="status"` is `aria-live="polite"` plus
`aria-atomic="true"`, which is right for a short sentence that is replaced whole.
`Canvas.select` returns early when the selection has not changed, so this is one
announcement per selection and not one per press.

**Its neighbour `#status-text` is deliberately not a live region.** `showStatus`
rewrites it on every heartbeat poll, and a write in progress polls until it
finishes, so making it speak would put a running commentary of write states over
whatever else was being read. What is selected is the question this item asked,
and it is answered by the quieter of the two.

## Consequences

- **The canvas has eleven named objects where it had none.** Measured after the
  change, in the same way and against the same directory: eight
  `article "table <name>"`, two `article "note <name>"`, one
  `group "group warehouse"`, and one `status` node carrying
  `live: polite, atomic: true`. Clicking the `shipments` box put
  `Selected table shipments.` into that node; clicking the group's header put
  `Selected group warehouse.` into it.
- **A name was added and nothing was taken away.** The same snapshot still shows
  the header `addresses`, all ten column rows under it with their own names, the
  full prose of both notes, and the group's `Written by the depot handheld`. The
  cost 0064 was avoiding is not paid here, and this is the measurement rather
  than the inference.
- **A note's path became its description instead of its name.** `title` is still
  set and still shows on hover; with an `aria-label` present it computes as the
  accessible description, so a note now announces itself as the note and offers
  the path second. That is one attribute changing role, and it is an improvement
  by accident rather than by design.
- **This was measured in a browser's accessibility tree and not with a screen
  reader.** No NVDA, JAWS, VoiceOver or Narrator was run. What is proven is that
  Chromium computes the names, roles and live-region properties above; what is
  inferred is that a reader speaks them, which is what those properties are for
  and is not the same as having heard it.
- **The canvas still cannot be operated from a keyboard.** Nothing on it is
  focusable, selection happens on `pointerdown`, and there is no key that moves
  a box. A person can now tell what is on the canvas and what is selected, and
  still cannot select anything without a pointer. That is the larger half of the
  problem and it is a different piece of work: a roving `tabindex`, a key that
  selects, and something honest to do about drag.
- **The three layers are still unnamed.** `.boxes`, `.notes` and `.groups` are
  bare `div`s. Naming them would have said "tables" immediately before eight
  names that each begin with `table`, so the repetition was left out rather than
  written in.
- **There is no unit test, and that is this file's existing rule.**
  `test/studio/canvas.test.ts` says in its own header that the drawing and the
  pointer handling need a DOM and are proven by driving the studio. This was
  proven by driving the studio.

## Revisit when

- **The canvas becomes operable by keyboard.** Focus order, a selected
  descendant and `aria-activedescendant` are a different model from a page of
  named articles, and the labels here would become part of it rather than the
  whole of it.
- **Somebody runs an actual screen reader over this.** The names are right in
  the tree; the phrasing, the order and whether `article` is a good vehicle for
  a box are questions only listening can settle.
- **The feedback overlay starts reading `aria-label`.** It reads `data-element`
  today and the separation above assumes it. If that changes, one string is
  being read by two readers with different needs, and which one wins has to be
  decided rather than discovered.
- **A fourth kind of object joins the canvas.** The label is `${kind} ${name}`
  for three kinds that each own their file names. A kind that does not would
  need the same thought the `id` rule in 0064 needed.
