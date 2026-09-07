# 0055. A ref gets a line, rather than the box getting the width

Refines ADR 0018, which put an edge's ends on the rows of the two columns it is
about. This is about the row itself: the text in it, and what it had stopped
saying.

## Context

Measured in a real browser, `examples/shop` at 1600x1000, fitted:

- **Seven of sixty-four column rows overflowed their box.** The worst,
  `uuid → subscriptions.id` on `orders.subscription_id`, by 61 pixels.
- What a person saw was `subscription_id  uuid → subsc…`.
- The element that clipped was `span.type`, and it had **no `title`**, so
  hovering it recovered nothing. The whole string was in the DOM and reachable
  by nobody.

That is information loss rather than a preference about how things look. The
argument for this tool over a diagram is that a `ref` names a *column* and not a
table: `dbmd refs` answers with the column (ADR 0042), the inspector shows it,
and the canvas is where somebody is looking when they ask. The one view whose
whole job is that fact was the view that stopped saying it.

The row was one flex line holding two spans. `.name` had no way to shrink and
`.type` had `overflow: hidden`, so every pixel of the shortfall came out of the
end of the type's text, which is the end the ref is on. A column called
`shipping_address_id` in a 220px box has about eighty pixels left for
`uuid → addresses.id`.

Four things could have been done and each costs something.

**A `title` and nothing else.** One attribute, works today, and it is not an
answer: nobody hovers a row they are scanning past. It is a floor.

**Let the box size to its content.** Honest, and it makes a table with long names
much wider than its neighbours. Every coordinate in a `layout:` was written by
somebody dragging boxes of a known width past each other (ADR 0015), so changing
the width silently rearranges what overlaps what in every model anybody has
already arranged. `examples/shop` alone has eight of them and two notes tucked
into the gaps.

**Elide the middle**, `→ custom…id`, so the column name survives. Cheap, and it
reads badly: a name with a hole in it is not a name, and the reader still cannot
tell `customers.id` from `custom_orders.id`.

**Give the ref its own line.** Always fits for every ref in `examples/shop`,
changes no width, and costs a taller row on every referencing column.

## Decision

**The ref is its own element on its own line, and the box stays 220 pixels
wide.** `renderColumn` writes a third span, `.ref`, holding `→ table.column`, and
the stylesheet gives it the full width of the row with `flex: 0 0 100%`. The
name and the type are on the first line exactly as they were. The row's gap is
`0 10px`, so a row with no ref is exactly the height it always was and only a
referencing row grows.

The width is the part being deliberately protected. A `layout:` coordinate is
what a person wrote by dragging, this project does not auto-layout, and a box
that grew sideways would move what overlaps what in files nobody touched. A box
that grows downwards moves nothing but its own bottom edge.

**The ref line is right-aligned and the arrow leads it.** Right-aligned so that
it stays in the column the type is in rather than starting under the name, where
it reads as another column. The arrow first, `→ customers.id`, so the line reads
as a continuation of the row above it rather than as a name in its own right.

**Every column row carries a `title` holding all of it.** Name, type and ref,
which is exactly the text of the spans and nothing else, so the tooltip and the
row cannot come to disagree. This is the floor, and it is worth having whatever
the layout does: a line of its own is enough room for every ref in
`examples/shop` and not for every ref there could be. The ellipsis stays on both
spans, and when a ref is longer than a whole row it clips and the `title` is
what is left. That case was driven in a browser rather than reasoned about.

**The strings are a pure function and the shape is not.** `columns.ts` holds
`refLabel` and `columnTitle`, has no DOM, and is tested in
`test/studio/canvas.test.ts`, for the reason `geometry.ts` is separate from
`canvas.ts` (ADR 0015) and `fields.ts` from `inspector.ts` (ADR 0016). What the
row looks like is proven by looking at the page; what it says is a function of a
column and a test can hold it.

## Consequences

- **Zero of the sixty-four rows in `examples/shop` overflow**, measured with the
  same probe that found the seven: `span.type`, and now `span.ref` too, with
  `scrollWidth > clientWidth`. The worst was 61 pixels and is 0.
- **Six of the eight boxes are taller**, by 17 pixels per referencing column:
  `orders` by 52, `addresses`, `order_items` and `stock_movements` by 35,
  `shipments` and `subscriptions` by 17. Every box is still 222 pixels wide,
  and no pair of boxes or notes in `examples/shop` overlaps that did not before.
  A `layout:` in a model with many refs now has more of the canvas under it than
  it did, and that is the price of the decision rather than a defect.
- **The edges did not need changing and were checked anyway.** A row's centre is
  measured from the DOM per ADR 0018, so a taller row moves its own anchor and
  every anchor below it on the same pass; the `ResizeObserver` covers the box
  growing. Driven in a browser after the change: all twenty-two ends of the
  eleven edges sit inside their column's row, within 0.59 of a pixel of its
  centre, four pixels off the border, and they were still there after dragging
  `orders` across the canvas.
- **A long name and a long type now wrap too, and stop clipping.** The row wraps,
  so a name and type too wide together put the type on its own line instead of
  eating the end of it. `margin-left: auto` on `.type` keeps it in the same
  column it is in on every other row. This was not the reported defect; it is
  the same information loss on the other half of the row and it now costs
  nothing to be rid of.
- **`ref` is a class name both scenes write.** The inspector's ref field has used
  it since dbmd-32. Both rules are anchored, `.box li .ref` and
  `#inspector ol > li .ref`, which is what ADR 0037 asks for. Worth knowing:
  `check:scenes` reads a line at a time and the panel's call is spread over five,
  so it does not currently see the pair. The check was run against a one-line
  copy of that call to confirm it passes when it can see it.
- **Nothing about the model or the format changed.** No file on disk is written
  differently, `dbmd export` is untouched, and a model opened in an older studio
  looks the way it did.

## Revisit when

- **Somebody wants the width to be theirs.** A `width:` on a table's `layout:`
  is the honest version of the option this record turned down, and it is a
  format change with a diff, rather than a rendering rule that moves everybody's
  boxes at once.
- **A row needs a third thing.** `on delete` is the obvious candidate, and the
  epic this came from proposes a marker at the child end of the edge instead. If
  it ever goes in the row, the wrap will need saying which line it is on rather
  than letting flex decide.
- **A very long name makes a box tall enough to matter.** The wrap is unbounded
  today: a name, a type and a ref can each take a line. That is three lines for
  one column, which is fine at the sizes anybody writes and is not fine forever.
