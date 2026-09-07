# 0035. A group's box says what it covers that is not in it

Extends ADR 0005 and ADR 0030. Neither is reversed: a group still has no
coordinates and the box is still the bounding box of its members, computed on
every draw. What changes is that the picture now says which of what it covers
never joined.

## Context

A bounding box is not a boundary. It is the smallest rectangle over a set of
things, and everything else that happens to sit between them is inside it too.
ADR 0005 chose that shape for good reasons and listed its costs, and it missed
one: **the author of a member has to reason about a non-member's enclosure.**

That cost is not hypothetical and it has already been paid. The agent laying out
`examples/shop` by hand wanted a group over `orders`, `order_items` and
`shipments` — the three tables a settlement story is about. It worked the
bounding box out on paper, saw that it would reach over `products`, which is not
one of them, and settled for a two-member group in a corner of the canvas
instead. **The model that shipped is shaped by this constraint rather than by
the domain**, and the same tax is due from everybody who arranges a diagram
after them.

The same hazard is sharper for notes, because a note can never be a member (ADR
0005 gives `group:` to tables alone). A note dropped into a convenient gap is
always a stranger and always reads like one of the family.

Until dbmd-34 this was an argument on paper: the studio drew tables and nothing
else, so nobody could see it. dbmd-34 landed and it is now the first thing you
see. Open `examples/shop`, drag any table between `shipments` and
`stock_movements`, and it is inside the warehouse box with nothing anywhere
saying otherwise. The only way to find out was to click the table and read
`(no group)` on its panel, which is a question you have to already suspect the
answer to before you think to ask it.

## Decision

**The box keeps its geometry. The fill is cut away around anything it covers
that is not a member, and the label bar counts them.**

`src/studio/client/groups.ts` computes the bounding box exactly as before, and
then, from the same rectangles in the same pass, works out what else that box
overlaps: every table that did not declare `group:` for it, and every note. Each
one gets a *clearing* — its own rectangle grown by `GROUP_CLEARANCE` and clipped
back to the box — and the group is drawn as one path with `fill-rule="evenodd"`
so those clearings are genuinely absent from the region rather than painted over
in the page's colour. The region visibly flows past a stranger. The label bar
says `covers 2 non-members`, and its tooltip names them.

Four things about that are load-bearing:

- **Nothing is stored and nothing moved.** This is arithmetic over the same
  rectangles the box already came from, recomputed on every frame, so it follows
  a drag the way the box does. A table dragged into a group's box grows a
  clearing while the pointer is still down and the count on the bar goes up,
  before any file is written and without `groups/` being touched at all.
- **The clearing is larger than the thing it excuses.** A table is opaque and
  the group layer is behind it (ADR 0030's z-order, which does not change here),
  so a hole exactly the size of the box it is under would be entirely hidden
  behind it and the picture would be unchanged. What a reader sees is a moat.
- **The test is overlap, not containment.** What misleads a reader is the fill
  lying underneath something, and it lies under every pixel of overlap. A table
  half inside a box reads half inside the group, which is a worse thing to be
  than a table wholly inside one, not a better one. A table sharing only an edge
  shares no area and is left alone.
- **The panel states the rule and never the count.** A group's panel is not
  redrawn by a drag (that is ADR 0016's rule 2, and `noteMoved` exists because
  of it), so a count read off the canvas and printed there would be true when
  the panel opened and false a second later. The panel says that the box is a
  bounding box and can reach over things that never joined; the live number is
  on the label bar, which is redrawn every frame.

An empty group is untouched. It has no members, so it can be a stranger to
nothing, and it still draws as the dashed placeholder in its deterministic slot
with its caption and its `group-empty` warning.

### What was rejected

**An optional `layout` on the group.** ADR 0005 names this as its own revisit
path and it is still the wrong answer for this problem. Both of that record's
arguments stand untouched: a stored box can disagree with its members, and a
stored box puts a shared file back in the path of every layout change. Neither
is weakened by the cost this record adds, because the cost is paid by whoever is
arranging the canvas and a stored rectangle hands them a second thing to keep
true. **If a future change to groups needs a stored rectangle, that is the
signal to stop and write a record, not to add a field.**

**A shape that hugs its members, or one box per cluster of them.** This is the
tempting one, because it makes the problem impossible rather than visible. It
was rejected on what it does to the thing a group is. The settlement group's
three tables are spread across the canvas on purpose; a shape that hugged them
would be three coloured badges rather than a region, and a per-cluster box needs
a distance threshold, which is a magic number that changes the shape of the
picture as somebody drags. A group is a region, and a region with a hole in it
is still one.

**A diagnostic in `dbmd check`.** Honest, and it would put the fact where the
model's other truths live, but it makes a layout accident into a model problem,
which is too strong: two boxes overlapping is a thing a person may have done
deliberately and no CI should fail on. It is also not cheaply available.
`dbmd-37` established that a table's box is measured from the rendered DOM and
moves with zoom, with fonts, and with every column added or removed, so a
validator with no browser has no honest way to compute it. **The studio is the
only place that knows where the boxes are, so it is the only place that can say
this without guessing.**

**Documentation alone.** ADR 0005's own consequences table is the argument
against it: this is not a rule somebody needs to look up, it is a fact about the
diagram in front of them, and a sentence in `docs/format.md` reaches the person
who reads the format reference rather than the person who is dragging a box.
The rule is worth writing down as well, which is what the panel sentence is,
but on its own it would have been the third time this project told somebody
something the window in front of them did not.

## Consequences

- **The three-member settlement group is now available**, and that is the test
  of this record. Built on a copy of `examples/shop`, it draws with `products`
  and the note about copied columns each in their own clearing, the bar reading
  `covers 2 non-members`. Whether that is the arrangement somebody wants is
  theirs to decide; what is gone is having to decide it against a picture that
  would have lied.
- **`groupBoxes` now takes the notes as well as the tables.** Notes were already
  on the canvas and were already inside these boxes; they were simply not being
  asked about. The signature grew one optional argument and every existing call
  and test is unchanged.
- **The group's area is an SVG path rather than a bordered `div`.** That is
  what makes a clearing an absence. A patch of background colour painted on top
  would look identical on an empty canvas and be wrong the moment two group
  boxes overlap, where it would rub out the neighbour's fill as well as its own.
  The dashed empty state and the selected outline moved from CSS borders to the
  same path's stroke and look the same.
- **A busy diagram will say so.** A group drawn over six unrelated tables now
  has six clearings and a bar that says six, which is loud. That is the point:
  it is loud in proportion to how much the box is claiming that the files do
  not, and the way to quieten it is to move something, which is one line in one
  table's own file.
- **This is the studio's answer and not the format's.** `docs/format.md` is
  unchanged, a model written by hand still means exactly what it meant, and a
  renderer that is not this one is free to draw a plain rectangle. Nothing about
  a file changed.

## Revisit when

- **Somebody asks for a group with a fixed size or a deliberate margin.** ADR
  0005's revisit path is untouched by this record and its price is unchanged.
  This one lowers the pressure on it rather than removing it.
- **A table wants to be in two groups.** Then "not a member of this one" is a
  weaker statement than it is today, and a table that is in the neighbouring
  group probably deserves a different mark from a table that is in none.
- **Nested groups arrive.** An inner group is inside an outer group's box on
  purpose, and a rule that cut it out would be exactly wrong. Today groups do
  not test each other and that is why.
- **A renderer outside the browser needs to know a table's box.** If dbmd-37's
  finding is ever overturned, the diagnostic rejected above becomes cheap and
  worth arguing about again.
