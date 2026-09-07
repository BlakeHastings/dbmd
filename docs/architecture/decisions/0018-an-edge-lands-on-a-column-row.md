# 0018. An edge lands on a column's row, and the row is measured

Refines ADR 0015, which built the canvas and decided that edge geometry is a
property of the pair of tables rather than of the edge. This is the correction
the owner asked for on first seeing the studio, and what it turned out to cost.

## Context

The complaint, verbatim:

> the arrows need to point to the columns that they're related to, and they need
> to stay there.

It was accurate. `EdgeSpec` has carried `from.column` and `to.column` since
dbmd-31 and they fed only the hover text; `between()` took the centre of each
box. So `orders.customer_id` and `orders.shipping_address_id` left the same
point, and the picture said "orders is related to customers somehow" where the
file had said exactly which column.

Three things make this more than a change of two numbers.

**A column's row position is not a model fact.** Nothing in `db-model/` says how
tall a row is. It is a consequence of the font the browser picked, of how many
columns the table has, and of what the stylesheet does that week. The only place
that can answer it is the rendered page, and ADR 0015 put every unit-testable
piece of the canvas in files that never touch the DOM precisely so that the
arithmetic could be checked without a browser.

**"They need to stay there" is the harder half.** An anchor computed once at load
looks correct until somebody drags a box, and an anchor recomputed a frame late
reads as the arrows being loose, which is what was being objected to.

**The sideways fan was paid for and must not be undone.** ADR 0015 records that
the fan offset is taken from the two table names in a fixed order rather than
from the direction each edge is read in; derived from the edge it flips on the
return leg of a mutual reference, the two shifts cancel, and the one pair the
fan exists for is the one still drawn as a single line. That defect shipped once
and a screenshot found it, not a test.

## Decision

**An end is anchored at the left or right border of its box, at its own row's
height.** A row is a horizontal band, so those are the only two points on the
border that are at the row's height; anchoring anywhere else means picking a
point the row does not occupy. Which border each end uses is whichever of the
four combinations puts the two anchors closest together, which is right-to-left
for boxes side by side and the same border for boxes stacked one above the
other, where the alternative crosses both boxes to reach the far edge. The
control points leave and arrive horizontally, so the tangent at each end is
along the row and the arrowhead points at the row rather than across it.

**Where a row sits is measured once per layout, as an offset inside the box, and
`canvas.ts` is the only file that measures it.** `TableBox` carries `rows`, a map
from column name to the row's centre measured down from the box's top, and
`edges.ts` takes it as numbers. Because the offset is inside the box, an anchor
is the box's current `y` plus the offset: a drag moves the anchor on the same
pass that moves the box, with no second measurement and no frame of lag. The
measurement is `offsetTop` and `offsetHeight` rather than
`getBoundingClientRect`, because the scene is scaled by a CSS transform and a
painted rectangle would come back multiplied by the zoom, needing a scale factor
divided back out in the one place ADR 0015 says a scale factor must not appear.

**A measurement is redone when the box's content changes, and never on a
transform.** Two triggers, and they are the only two. `Canvas.show` re-measures
everything, and every model that arrives from the server goes through it. A
`ResizeObserver` per box covers the other case: the inspector (dbmd-32) adds and
removes columns from a table that is already on the canvas, and a row offset
taken at load and kept would leave every arrow below the edit pointing one row
out. Observed size is layout size, which a CSS transform does not change, so pan,
zoom and drag never wake it.

**The fan groups by the unordered pair of ends, not by the pair of tables.**
Row anchoring already separates the edges that differ in either column, which is
most of them, and a bow applied on top of that pushes two legs that had already
separated back towards each other. What rows cannot separate is a mutual
reference where each side names the other's exact column: both legs run between
the same two points. That is the group the offset is now for. The property ADR
0015 bought is kept exactly, one level finer: the pair is unordered and the
sideways direction comes from a fixed ordering of the two ends rather than from
the direction the edge is read in.

**The offset moves the control points and never the ends.** An end that slid
sideways to make room is an end that is no longer on its row. A cubic's midpoint
sits three quarters of the way to the average of its two controls, so the bow is
4/3 of the separation wanted, and the separation in the middle is the same
number ADR 0015 chose.

**An end that cannot find its row goes to the table's header and says so.** A
`ref` naming a column the target table does not have is a real line to draw,
because the `ref` is in the file and the reader has already diagnosed it (ADR
0008). It is drawn at the header, which is visibly the table's name rather than a
row, dashed, with the missing column named in the hover text, and `RoutedEdge`
reports it in `unanchored` rather than swallowing it. Falling back to the centre
of the box is the one answer ruled out: that is exactly the bug this record
fixes, wearing a disguise. An anchor is also clamped into the box, because a row
offset can be older than the height it was measured against for the moment
between a live edit and the observer firing.

## Consequences

- **`edges.ts` still has no DOM and is still tested without a browser.** What
  changed is that it takes one more measured number per column. A test supplies
  made-up offsets, which is enough for every property that matters: an end is on
  its row, it is still on its row when the box moves, and a mutual pair is two
  lines.
- **A box renders one attribute it did not.** Every column `<li>` carries
  `data-column`, which is how the measurement finds a row again. By name rather
  than by position, because a list that has had a column inserted into it would
  otherwise silently renumber every anchor below the insertion. This is the seam
  with the inspector: anything that rewrites a box's rows must keep that
  attribute or the anchors below it fall back to the header.
- **Two edges arriving at the same column now share an arrowhead.** That is
  intended and is the opposite of the old failure: they converge because they
  genuinely arrive at the same place, and they are two lines because they leave
  different rows. The old note about two arrowheads on one pixel reading as one
  edge was written when the box centre was the only thing an arrowhead could
  distinguish.
- **A `ResizeObserver` is a new thing in this file.** It is the browser's own
  answer to "this element changed shape" and the alternative was asking every
  caller to remember to tell the canvas. It costs one object and disconnects on
  every `show`.
- **The reroute is still every edge on every animation frame.** ADR 0015 already
  names that as the first thing to narrow when somebody measures a model where it
  matters; this change adds a map lookup per end and does not move that line.

## Revisit when

- **A box can scroll or be clipped.** The clamp is written for a stale
  measurement today, not for a box with `overflow`. The moment a very tall table
  gets a scrolling body, an anchor for a row that is scrolled out of view has to
  be a deliberate thing rather than a clamp that happens to land on the border.
- **The inspector rewrites a box's rows in place.** The `ResizeObserver` catches
  a change of height, which is what adding or removing a column does. A change
  that moves a row without changing the box's height would not wake it, and if
  one appears the trigger has to become explicit rather than inferred.
- **Groups arrive (ADR 0005).** A group drawn around its members is another
  thing whose geometry comes from a measurement of the page rather than from the
  file, and the question of where that measurement lives is the same question
  answered here.
