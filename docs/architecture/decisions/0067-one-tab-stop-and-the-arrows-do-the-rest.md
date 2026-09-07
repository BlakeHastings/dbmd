# 0067. One tab stop, and the arrows do the rest

The other half of [ADR 0065](0065-a-box-says-its-own-name-and-the-selection-is-spoken.md),
which named every object on the canvas and said in its own consequences that
none of them could be reached. This is the reaching.

## Context

**After 0065 a screen reader can say what is on the canvas and cannot get to any
of it.** Eleven objects carry a name and a role, the sentence saying what is
selected is spoken, and every one of those eleven is selected by pointing at it
and by nothing else. Selection happens on `pointerdown`, nothing on the canvas
is focusable, and there is no key anywhere in `canvas.ts`.

The chrome around it was already fine and that is worth saying, because it is
what makes the gap specific rather than general. Seven real `<button>` elements,
fourteen labels, seven pressed states. Zoom, fit, and the three add buttons are
all reachable from a keyboard. What is not reachable is the drawing.

**Measured before the change**, with `Accessibility.getFullAXTree` over CDP in
Edge, against a studio serving a copy of `examples/shop`, which is how 0065
measured and is the data a screen reader speaks from:

| what                                    | before                       |
| --------------------------------------- | ---------------------------- |
| canvas objects reported `focusable`      | none of eleven               |
| elements in `#canvas` carrying `tabindex`| none                         |
| keys handled by `canvas.ts`              | none                         |
| `Tab` from the top of the page           | straight past the drawing to the toolbar |

### Three ways to fix it, and what each costs

**Every object in the tab order.** Simplest to write. Eight tables, two notes
and a group is eleven stops before anybody reaches the toolbar or the inspector,
every time, whether or not they wanted any of them. Rejected on that.

**A list beside the canvas.** Sidesteps the plane entirely and would be an
honest answer for a spatial view. It is a second way to select things, and this
project's whole shape is one way to do each thing; a list would also need its
own answer to what happens when a name is in both places and they disagree.
Rejected, and it is the one worth revisiting if the roving order turns out to be
unusable.

**A roving `tabindex`.** One stop for the whole canvas, the arrows move it,
`Enter` chooses. The standard pattern for a set of peers, and the only one of
the three that keeps the tab order short without inventing a second interface.
Taken.

## Decision

**Exactly one object on the canvas carries `tabindex="0"` at a time, the arrows
move it, and `Enter` or `Space` selects what it is on.**

### Moving and selecting are two presses, not one

Selection-follows-focus is the usual default for a single-select composite and
it is wrong here for a reason specific to this page. Selecting opens the
inspector, and the inspector is a column that takes width off the canvas, so
every arrow press would relay out the drawing under somebody who was walking
across it. It would also turn `#selection` into one sentence per step rather
than one sentence per chosen object, which is most of what 0065 bought.

So the arrows move a person and `Enter` commits them. `Space` does the same
thing, because a composite where `Space` scrolls the page instead is a composite
that surprises somebody once per session.

### The order is top edge first, left edge second, and exact

`reach.ts` holds it, takes rectangles and returns an order, and never touches
the DOM. The reading order is the corner each object is placed by, sorted by `y`
then `x`, with kind and then name as the last tie-breaks so the order is total
and a canvas walks the same way twice.

**It does not band near-equal rows, and the cost of that is visible in
`examples/shop`.** The two notes sit at `y: 320` and two tables at `y: 340`, so
the notes are walked before those tables rather than after them. That is a
surprise of twenty pixels. A tolerance that fixed it would need a number nobody
can derive from anything, would make the answer depend on which object the sweep
happened to start from, and would change what "next" means as a box is dragged.
An exact sort is a sort rather than a heuristic, and it is the same on every
machine and after every reload, which is the property `place.ts` and ADR 0006
already ask for elsewhere.

**A group is ordered by the rectangle `groups.ts` computes for it this instant**,
grown upwards by its header. Nothing is stored: ADR 0005 says a group has no
coordinates, and a reading order taken from a remembered rectangle would be one
wearing a different hat.

**The ring wraps.** These are peers on a plane, there is no first and no last,
and the alternative is a person pressing Down at the bottom and being told
nothing. `Home` and `End` reach the ends deliberately.

### Focus pans the canvas, because the canvas cannot scroll

`panToReveal` in `geometry.ts` makes the smallest change to the pan that puts
the object on screen, and returns the viewport unchanged when it already is. The
zoom is never touched.

This is not a nicety. `#canvas` is `overflow: clip` exactly so that nothing but
the transform can move the content, and the browser's own "scroll the focused
element into view" is one of the things that rule exists to stop; it was
measured at 811px of silent `scrollLeft` when that rule said `hidden`. So focus
is taken with `preventScroll` and the canvas does its own version of the same
idea, expressed as pan, which is the only coordinate the rest of the file
believes in.

A rectangle too large for the room it has is aligned to its top-left corner,
which is where a table's name and a group's label are. Showing the corner that
says what a thing is beats centring a box whose middle says nothing.

### The focus ring is dashed and the selected ring stays solid

Four declarations, one block, using tokens the stylesheet already has.

On this canvas focus and selection are two states that are true at the same
time, because the arrows move focus and `Enter` commits it, so between those two
presses somebody is standing on a box they have not chosen. One ring for both
would not say which. Selection keeps the solid accent it has always had; focus
is `2px dashed var(--ink)` at `outline-offset: 3px`, outside it. Dashed against
solid is legible without inventing a colour, and `--ink` has contrast on the
page, on a white table box and on all six note tints, because it is what the
words on them are written in.

`:focus-visible` rather than `:focus`, so clicking a box does not draw it.
Clicking a box already tells you what you clicked.

**A visuals phase is starting and this is deliberately one rule to move.** It
borrows existing tokens rather than adding one, and it is written after the
`.selected` rules because `.box:focus-visible` and `.box.selected` have the same
specificity and the later one wins where both are true.

### The canvas says once that its arrows do something

`#canvas` becomes `role="group"` with `aria-label="Canvas"` and a description
naming the keys. The role is needed for the same reason a group box needed one
in 0065: an unroled `div` is a `generic` and a `generic` cannot carry a name or
a description at all. It is a description rather than part of the name so a
reader offers it on the way in and does not repeat it on every object inside.

### The canvas's keys stop at the edge of an object

`onKeyDown` acts only when the press is on a `.box`, `.note-card` or `.group`
itself. A note whose prose is taller than the note scrolls, and Chromium makes a
scroller like that focusable on its own account without any attribute this
codebase wrote. Measured on 2026-09-07: `Tab` off the last table box landed in
the body of `there-is-no-stock-column`. That was already true before the canvas
had a tab order, and it is right, because prose nobody can scroll to is prose
nobody can read. Stealing the arrows that scroll it would not be.

### Dragging is not in this

Selecting without a pointer is what unblocks reading the model. Moving a box
without a pointer is a different feature with a different bar: it writes to
files, it needs a step size, it needs an answer for a group, and it needs
somewhere to say what just moved. It is a separate item and it is not smuggled
in here.

## Consequences

- **One `Tab` from the top of the page reaches the drawing.** Measured after the
  change, the same way and against the same directory: eleven objects reporting
  `focusable`, exactly one carrying `tabindex="0"`, and one `Tab` landing on
  `article "table addresses"`, which is the top-left object.
- **Eleven `ArrowRight` presses walk every object and wrap to the start.** In
  order: `addresses`, `order_items`, `products`, the two notes, `customers`,
  `orders`, `group warehouse`, `subscriptions`, `shipments`, `stock_movements`.
  `Home` and `End` reach the first and the last, and `ArrowLeft` and `ArrowUp`
  walk it backwards.
- **The status line still fires once per change.** `Enter` on `addresses` wrote
  `Selected table addresses.` once; a second `Enter` and a `Space` on the same
  box wrote nothing. `Canvas.select` returning early is what does that and it is
  untouched. Counted with a `MutationObserver` on `#selection`: three writes for
  three actual changes, across eight presses.
- **`Escape` and `Tab` are not swallowed.** Every key the canvas does not answer
  falls out of the handler untouched, so `Escape` still reaches the document
  handler in `main.ts` that clears the selection, and `Tab` still leaves the
  canvas for the toolbar.
- **Focus survives a redraw.** `show`, `update`, `updateNote` and `updateGroup`
  all replace elements, and a watcher redraw arriving while somebody is standing
  on a box would otherwise drop them on `<body>`. Each remembers whether the
  element it is replacing had focus and gives it back.
- **A `Tab` into the canvas has to be listened for, not inferred.** Without a
  `focusin` handler the canvas does not know the browser put somebody on the tab
  stop, so `focused` stays null and the first arrow press is read as "start from
  nowhere" and lands where the stop already was. One dead press on every
  arrival, measured before the handler existed and fixed by it. This is the kind
  of thing only driving it finds.
- **This was measured in a browser and not with a screen reader.** No NVDA,
  JAWS, VoiceOver or Narrator was run. What is proven is that Chromium reports
  these objects as focusable, moves focus where the keys say, and computes the
  name and description above; what is inferred is that a reader speaks them.
  Whether the description on `#canvas` is announced at all varies by reader and
  was not heard.
- **The tab order is one stop for the canvas plus one per scrollable note.**
  Chromium's focusable scrollers are outside this file's control and were there
  before it. On `examples/shop` that is two extra stops in the worst case, which
  is still not eleven.
- **There is no unit test of the keys.** `test/studio/canvas.test.ts` says in its
  own header that the drawing and the pointer handling need a DOM and are proven
  by driving the studio, and the keys are in the same position. What is tested
  there is the arithmetic underneath: the reading order and the pan, both pure
  and both without a browser. That earned its place immediately, because the
  first version of `panToReveal` had its two bounds the wrong way round and the
  test is what said so.

## Revisit when

- **Somebody runs an actual screen reader over this.** Whether `Enter` reads as
  choosing, whether the description is heard on the way in, and whether an
  `article` is a good vehicle for a box are questions only listening settles.
- **A box can be moved from a keyboard.** That is the item this one deliberately
  did not take, and it needs a key that is not already spoken for here.
- **Somebody arranges a model where the exact reading order reads as wrong.**
  Twenty pixels in `examples/shop` is tolerable. A model where a row of boxes
  was dragged into place by hand, so no two share a `y`, is the case this order
  is worst at, and a tolerance or a nearest-in-direction move would then be
  worth its complexity.
- **The canvas gains something focusable that is not an object.** The keys are
  gated on the press being on a `.box`, `.note-card` or `.group`, which is a
  list of three class names in one condition. A fourth kind of focusable thing
  has to be added there or deliberately left out.
- **The visuals phase chooses a focus style.** The ring here is one block of
  four declarations using existing tokens, put there because an object that can
  be focused has to look focused. It is meant to be replaced rather than kept.
