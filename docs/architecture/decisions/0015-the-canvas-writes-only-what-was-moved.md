# 0015. The canvas computes what it can, and writes only what was moved

Refines ADR 0004, which chose a hand-rolled canvas of absolutely positioned
boxes, one SVG overlay and a CSS transform, and ADR 0013, which decided that the
studio server writes only the files it was asked to edit. This is what building
that canvas turned out to require.

## Context

The canvas has to put every table somewhere, draw every `ref`, and get a drag
onto the disk. Each of those three has an easy answer that is wrong in a way
that only shows up later.

**Not every table has a position.** `layout` is optional, so a model written by
hand or produced by an import has tables with no coordinates at all. The obvious
answer is to lay them out and save the result, which is what a diagram
application would do.

**The server already debounces.** ADR 0004 put the debounce in the server and
dbmd-30 built it there. A client that has just learned the word "debounce" will
add one of its own, because the alternative looks wasteful.

**Two edges between one pair of tables land on the same line.** This one is not
a design question at all until it is drawn, at which point it is the difference
between a diagram that is right and one that is confidently wrong.

## Decision

**A position the developer did not choose is computed, never stored.** A table
with no `layout` is drawn on a deterministic grid below the tables that do have
one, in the model's own order, so the same directory produces the same picture
on every machine and after every reload. Nothing about that placement is
written. Opening the studio on a fifty-table import must leave `git status`
empty; the developer arranges the boxes and the drag is what writes the line.
The same rule is what will keep a group honest under ADR 0005, and it is the
same rule under a different name: **the file records a decision, not a
rendering.**

**One coordinate conversion, in one place, with no DOM.** Screen to model is
`toModel` and nothing else converts. A drag is expressed as the model point
under the pointer minus the model-space offset the pointer grabbed the box at,
which is scale-independent by construction rather than by a correction factor
applied in the right number of places. Keeping it free of the DOM is what lets a
test say that a box tracks the pointer at zoom 0.5 and at zoom 2, which is
exactly the property a screenshot cannot show and the one that is wrong in most
hand-rolled canvases.

**The client sends every move and the server owns the only debounce.** The page
sends at most one request per table at a time and coalesces everything that
arrives while one is in flight down to the latest position, then drains until
what was sent is what is wanted. That is back-pressure, not a timer: no edit is
ever sitting in the page waiting for an event, and the end of a drag needs no
special case, because the drain is already the special case. A timer in the page
would be a timer a backgrounded tab is allowed to throttle, and a drag that was
not written because the tab lost focus is the bug that makes a developer stop
trusting write-through.

**Edge geometry is a property of the pair of tables, not of the edge.** Edges
between the same two tables are fanned apart by a sideways offset, and the
sideways direction is taken from the two table names in a fixed order rather
than from the direction each edge happens to be read in. Derived from the edge,
the offset flips on the return leg of a mutual reference and the two shifts
cancel, so the one pair the fan exists for is the one pair still drawn as a
single line. That was a real defect in this branch and a screenshot is what
found it.

## Consequences

- **A model can be opened, read and closed without a single file changing.**
  The cost is that a table with no `layout` moves the first time somebody drags
  it and not before, so an import's grid is not reviewable in a diff until
  somebody has touched it.
- **The canvas is testable without a browser.** `geometry.ts`, `place.ts` and
  `edges.ts` are arithmetic over numbers and rectangles. `canvas.ts` is the DOM
  and the pointer handling and has no unit tests, deliberately: what it does is
  proven by driving the studio, because a test double for a pointer capture
  proves that the double works.
- **A drag is several requests and one write.** The server sees a request per
  pointer move that it had time to answer, and writes once when the drag stops.
  A drag driven by a robot, one move per second, writes more than once, because
  the debounce it is defeating is a real one.
- **A table whose file did not parse cannot be dragged.** ADR 0013 has the
  server refusing to write it; the canvas refuses the drag as well, so the
  refusal arrives before the developer has moved anything rather than after.
- **The fan offset needs the ordering to be stable.** It comes from comparing
  the two table names, so it does not change when the model is re-read or when
  an edge is added to the same pair.

## Revisit when

- **Auto layout arrives.** Then a computed position becomes a proposed one, and
  the question of whether it is written is open again. ADR 0004 already names
  the trigger for adopting a layout library; this record is the reason that
  adoption has to say what it writes.
- **A drag is slow enough to feel on a real model.** The rerouting is every
  edge on every animation frame, which is nothing at tens of tables and is the
  first thing to narrow at hundreds. It is not narrowed today because nobody has
  measured a model where it matters.
- **Something other than a table becomes draggable.** Notes are the next one
  (dbmd-34), and a group drag moves several tables at once, which is the first
  time one gesture produces more than one file's worth of edits. The
  back-pressure above is per table already, which is the shape that wants, but
  the batch is a new thing to say.
