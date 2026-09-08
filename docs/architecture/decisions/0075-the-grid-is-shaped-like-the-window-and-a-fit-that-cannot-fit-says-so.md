# 0075. The grid is shaped like the window, and a fit that cannot fit says so

Supersedes one paragraph of ADR 0029, under **The layout is a grid, and it is
the studio's grid**, which says tables go at
`(40 + n mod 5 x 300, 40 + floor(n / 5) x 260)`. Everything else that paragraph
decided still holds: name order, the studio's own pitches, the copy across the
browser seam, and no auto layout. Only the five is replaced.

## Context

The first thing a person does with this tool is import a real database and look
at it. Nothing had ever pointed it at more than eight tables.

`src/import/model.ts` put every imported table on a grid five columns wide,
whatever the count, at a 300 pixel column pitch and a 260 pixel row pitch. The
constant said `PER_ROW = 5` and no comment said why it was five.

Measured on 2026-09-07, in Chromium at a 1600 by 947 window, against synthetic
payloads built from the table shape in `test/import/fixtures/postgres-raw.json`.
The canvas itself is 1600 by 798 of that window, the rest being the header, the
toolbar and the status bar.

| Tables | Layout written | Zoom after Fit | Boxes on screen |
| --- | --- | --- | --- |
| 8 | x 40..1240, y 40..300 | 100% | 8 of 8 |
| 100 | x 40..1240, y 40..4980 | 25%, clamped | 70 of 100 |
| 600 | x 40..1240, y 40..30980 | 25%, clamped | 70 of 600 |

**Six hundred tables is five columns and a hundred and twenty rows.** As drawn
that is about 1424 by 31172 model units, and at 25%, which is `MIN_SCALE` in
`src/studio/client/geometry.ts` and the furthest the studio zooms out, it is 356
by 7793 screen pixels against a canvas 798 pixels tall. Ten screenfuls of a
ribbon four boxes wide.

**The page drew it correctly and quickly.** 600 boxes, 599 edges, no console
error. This is not a performance problem and no part of it is fixed by drawing
less.

**Pressing Fit said nothing.** The status line after it read `Nothing written
this session. Undo is git checkout.` and the selection line was empty. A person
who presses a button called Fit, watches the view move and reads a status line
that mentions nothing has been told that Fit worked. It had not: 530 boxes were
below the window and the button had no more zoom to give.

**A status line that does not correct itself was treated as a defect eight hours
earlier.** ADR 0074 is about `Creating tables/x.md.` still standing fifteen
seconds after the file existed. This is the same shape with the sentence missing
rather than stale.

**Two more things turned up while measuring and both are in this record because
they changed the code.**

The load-time fit was taken against the wrong canvas. `adopt` fitted straight
after the draw and rendered the diagnostics list and the status line afterwards,
both of which sit under the canvas and take height from it. On the 600-table
model the fit was computed against a canvas 128 pixels taller than the one the
page ended up with, and the first view was therefore a row of boxes further down
than it should have been.

And the sentence moves the thing it is describing. It is three lines where
`Nothing written this session.` is one, so saying it takes another 16 pixels off
the canvas and invalidates its own count: 308 said, 286 actually on screen.

## Decision

**The grid is as close to the shape of the window as a whole number of columns
gets, and the number of columns comes from the number of tables.**

```
columns = max(1, round(sqrt(count * VIEWPORT_ASPECT * ROW_PITCH / COLUMN_PITCH)))
```

with `VIEWPORT_ASPECT = 16 / 9`. A grid of `columns` by `count / columns` is
`columns * COLUMN_PITCH` wide and `(count / columns) * ROW_PITCH` tall; setting
that ratio to the window's and solving for `columns` is the line above. Four
tables land two wide, eight land four wide, sixteen land five wide, a hundred
land twelve wide, six hundred land thirty wide.

**Sixteen by nine is an assumption and is named as one in the code.** This
module runs in Node and has never seen a viewport. Being wrong about the aspect
costs a column; having no opinion at all costs what the table above measures.

**`MIN_SCALE` is not touched.** Letting the zoom go further out is the other
available answer and it is the wrong one: a box at 15% says nothing a person can
read, so it would trade a picture nobody can navigate for a picture nobody can
read. The floor stays at 25% and the layout is what moves.

**Rejected: a bigger fixed number.** Twenty per row fixes six hundred tables and
puts eight tables in one row 2140 units wide, which is a ribbon the other way
up. Any fixed number is right at one size, and the count is already known where
the decision is made.

**Rejected: an auto layout.** `src/studio/client/place.ts` says there is no auto
layout and that the same input gives the same coordinates, and this keeps that
promise exactly: it is still a grid in name order, still deterministic, still
arranged once by the developer. Choosing the width is not choosing a position.

**Second: Fit says when it could not fit, and says nothing when it could.**

`fitTo` clamps at `MIN_SCALE` and hands back a viewport either way, so the fact
was not readable from its answer. `fitScale` is now the unclamped scale, split
out of it, and the difference between the two is the whole of "Fit could not
fit". `Canvas.fit` returns a `FitReport` counting what is on screen afterwards,
and `didNotFitNotice` in `geometry.ts` is the sentence:

> Fit is as far out as this page goes, and it was not far enough: 264 of the 600
> objects on the canvas are on screen and the rest are past the edges. The zoom
> stops at 25% so that a box still says what it is, so the way to the others is
> the arrow keys, which walk to one object at a time and bring it into view.

**It carries the count rather than saying that some objects are off screen**,
because the count is what tells a person which situation they are in: two boxes
over the edge is a scroll and five hundred is a model nobody will read at this
size. **It says what to do**, and what to do is not what the toolbar suggests,
since zooming out further is refused on purpose. **It says nothing when the fit
fit**, for the reason `sentenceAbout` in `delta.ts` says nothing when there are
no mentions: a line that fires every time is a line people stop reading.

The count is taken after the viewport moved, from the rectangles the browser
measured, rather than predicted from the bounds. It counts an object with a
corner on screen as visible, because that is an object a person can see and
click.

**Third, and consequent: the first fit happens last, and the fit that reports is
done twice.** `adopt` now fits after the diagnostics and the status have
rendered, so the canvas it measures is the canvas the page keeps. And
`fitAndSay` fits, says, and fits again, because saying it takes 16 pixels of
canvas away and makes its own count too generous. There is no third pass: the
status is already as tall as it gets.

## Consequences

Measured after the change, same payloads, same window.

| Tables | Layout written | Zoom after Fit | Boxes on screen | Said |
| --- | --- | --- | --- | --- |
| 8 | x 40..940, y 40..300 | 100% | 8 of 8 | nothing |
| 100 | x 40..3340, y 40..2120 | 30% | 100 of 100 | nothing |
| 600 | x 40..8740, y 40..4980 | 25%, clamped | 264 of 600 | the notice |

- **A hundred tables now fit.** That is the change that matters most, because a
  hundred is a real database and six hundred is a large one. The ceiling on what
  goes into a 1600 by 798 canvas at 25% moves from about 65 tables to about 260.
- **Six hundred tables still do not fit, and cannot.** 600 boxes at this pitch
  need about 47 million square model units and a canvas at 25% offers about 20
  million. No arrangement fixes that, which is precisely why the second half of
  this record exists: the honest answer is to show what fits and say so.
- **The arithmetic is now duplicated across the browser seam as a function
  rather than as a constant.** `src/import/model.ts` and
  `src/studio/client/place.ts` both have it, for the reason ADR 0029 gave for
  the pitches: one is Node's and one is the bundle's. What makes it safe is that
  `test/import/model.test.ts` imports both and drives them against each other at
  thirteen sizes, so drifting apart is a red test rather than a picture that
  moves the first time somebody opens the studio on an import.
- **`GRID` still carries the whole grid to `delta.ts`**, and now carries
  `columnsFor` too. A re-import hands it the number of tables that arrived, not
  the number in the model: the arrivals are what is being laid out, and both
  sides still land on `MARGIN + k * COLUMN_PITCH`, so a new block lines up with
  whatever is above it however wide that turned out to be. Driven: eight tables
  imported, two dragged in the studio to (177, 101) and (256, 533), then a
  re-import with six new tables. All eight kept their coordinates to the pixel
  and the six landed three wide at y 793 and 1053, under the lowest of them.
- **A model imported before this change keeps the layout it has.** Coordinates
  are in the files, a layout already written is a person's arrangement, and
  nothing re-lays-out an existing model. The five-wide shape is what those
  models look like and this changes none of them.
- **The sentence stands until the next landed edit**, like every other
  `standing` sentence. Somebody who presses Fit, reads it and then drags a box
  gets the ordinary `Wrote ...` line back.
- **Two fits per press.** The second is a transform and a walk over the
  rectangles, on a page that draws 600 boxes in under a second, and it is the
  difference between a count that is right and a count that is 8% high.
- **The count goes stale if the window is resized, and nothing says so.**
  Measured while re-verifying: a page fitted in one window and then resized to
  1600 by 947 said 180 while 286 boxes were on screen. That is not the fit being
  wrong, it is the fit not being redone: nothing re-fits on a resize, on purpose,
  because moving the view under somebody who did not ask is what `busy` and the
  once-only first draw both exist to prevent. The sentence is a standing sentence
  about a moment, like `Wrote tables/orders.md at 8:14:50 PM`, and pressing Fit
  again makes it true. It is named here rather than fixed because the fix is a
  decision about what a resize should do to the view, which is a larger question
  than this record's.

## Revisit when

- **The window's shape stops being roughly sixteen by nine.** A portrait monitor
  or a half-width window makes the assumption wrong in the direction that hurts,
  which is too wide rather than too tall. The fix is not a different constant: it
  is the studio laying out an unplaced model against the canvas it can measure,
  which is a thing only the browser can do and which would want its own record.
- **Somebody wants Fit to be able to show everything.** That is a zoom floor
  question, not a layout question, and it is `MIN_SCALE` and the box drawing
  together: boxes that draw as name-only plaques below some scale would let the
  floor drop without making the picture unreadable.
- **An import ever writes coordinates for a model that already has some.** The
  whole argument here assumes a layout on disk is never rewritten. If that
  changes, this grid becomes something that can move somebody's arrangement.
- **A third copy of the grid arithmetic appears.** Two with a test between them
  is a seam; three is an argument for a package the bundle and the CLI both
  import, which is ADR 0029's way out.
- **Somebody resizes the window and reads the old count.** The sentence is true
  of the moment it was said and a resize is the one act that falsifies it without
  anybody touching the model. The answer is a decision about resize and the view,
  not about this sentence: either the standing sentence is cleared on a resize,
  which is cheap and loses nothing, or a resize re-fits, which is a view moving
  under a person and would want arguing for on its own.

## Amended on 2026-09-08: the clamp happening and the clamp costing something are two questions

The second half of this record says the notice fires when Fit "could not fit",
and the code asked a question that is not that one. `Canvas.fit` reported
`clamped: fitScale(content, into) < view.scale`, which is true whenever the
ideal scale would have been below `MIN_SCALE`, and `fitAndSay` said the sentence
on that alone. **Whether the floor actually left anything off the screen was
never asked.**

Those two come apart on a small model in a small window, which is the case
nobody constructed. `examples/shop` is eleven objects. Measured in Chromium
against a throwaway copy, on the **first draw**, before anybody had pressed
anything:

| Window | Zoom after the first fit | On screen, walked from the DOM | Said |
| --- | --- | --- | --- |
| 420 x 300 | 25%, clamped | 11 of 11 | the notice |
| 500 x 340 | 25%, clamped | 11 of 11 | the notice |
| 380 x 260 | 25%, clamped | 11 of 11 | the notice |
| 640 x 400 | 30% | 11 of 11 | nothing |

> Fit is as far out as this page goes, and it was not far enough: **11 of the 11
> objects on the canvas are on screen and the rest are past the edges.**

There is no rest. The margin is what pulls the two apart: `fitScale` fits the
content inside a 48 pixel margin on every side, and once that margin is spent
the same content sits inside the canvas at 25% anyway. So the clamp happened and
cost nothing.

**This is the more important of the two places that fit**, and this record
already said why: the first draw is where somebody who has just imported a real
database is standing, nobody pressed anything, and so nobody is expecting an
explanation to be owed.

### What the code claimed, and what it does now

`fitAndSay` closed with a comment reading _"A smaller canvas cannot turn a fit
that was refused into one that fits, so the first sentence is never left
standing over a fit that worked."_ The first clause is true and the conclusion
does not follow from it: the clause is about the scale and the sentence is about
the count. Here the first fit already had everything on screen.

**`didNotFitNotice` now answers both halves and returns `undefined` when there
is nothing to say.** The sentence and the condition for saying it were two
things, the caller held the condition, and the condition it held was not the one
the sentence claims. That is the shape worth not repeating rather than the
missing comparison itself, so the fix is where the sentence is written and not
at the two call sites.

`FitReport` moved from `canvas.ts` to `geometry.ts` with it, because the only
thing that reads it is the sentence said about it, and "is there a sentence to
say here" has to be answerable without a browser. `canvas.ts` re-exports the
type and is still what fills it in.

### What did not change

The counterfactual this record was written for. Measured after the change, same
copy, same first draw:

| Window | Zoom | On screen, walked from the DOM | Said |
| --- | --- | --- | --- |
| 420 x 300 | 25% | 11 of 11 | nothing |
| 500 x 340 | 25% | 11 of 11 | nothing |
| 380 x 260 | 25% | 11 of 11 | nothing |
| 640 x 400 | 30% | 11 of 11 | nothing |
| 300 x 220 | 25% | 4 of 11 | the notice, saying 4 of the 11 |
| 260 x 200 | 25% | 3 of 11 | the notice, saying 3 of the 11 |
| 240 x 190 | 25% | 3 of 11 | the notice, saying 3 of the 11 |

The counts in the sentence are the counts an independent walk of the DOM against
the canvas rectangle found, which is the property the second fit exists for and
which this did not touch. The two-pass fit is unchanged, and so are `MIN_SCALE`,
the grid, and everything in the first half of this record.
