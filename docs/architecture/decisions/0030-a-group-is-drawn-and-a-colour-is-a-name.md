# 0030. A group is drawn and never positioned, and a colour is a name

Implements ADR 0005 on the canvas. That record decided the format; this one is
what the studio does with it, and it exists because two of the format's choices
have an obvious wrong implementation that would have looked right on screen.

## Context

ADR 0005 put three kinds of object on the canvas and gave a group no
coordinates: its box is the bounding box of its members plus padding, computed
when it is drawn. Until now the studio drew tables and nothing else, so both
halves of that were a claim about a file format rather than about a program.

Two things then went wrong at once, and both were about a document that was not
true rather than about code that did not work.

`dbmd init` writes `notes/there-are-no-passwords-here.md`. The server served it.
The canvas drew nothing. So `README.md` said `init` writes "two tables and a
sticky note", the scaffolded `_model.md` said "A note is a sticky note on the
canvas", and the first window a new user opened contradicted both of them inside
a minute. `examples/shop` has two notes and a `warehouse` group that likewise
never appeared, and that is the model `npm run studio` opens for every
contributor. **A stated invariant that is not true is worse than an absent
one**, and this repository has already paid for that once: a false claim in
`AGENTS.md` about npm publication is why a CI recipe invented a version number.

## Decision

### A group's box is computed on every draw and there is nowhere to put one

`src/studio/client/groups.ts` is a pure function from the members' rectangles to
the group's rectangle. Nothing on the canvas holds a group's rectangle between
frames. That is not an optimisation left undone: a field holding the last
computed box is exactly the cache ADR 0005 says turns into a stored coordinate
the first time somebody wants to resize a group, and the failure it produces is
a file that can disagree with reality.

Three consequences follow and each is load-bearing:

- **Membership is read off the tables, live.** The canvas asks each table what
  its `group` is rather than reading `Model.groupMembers`, which the reader
  computed at the last read. ADR 0017's third rule, and here it buys the thing
  an inspector edit needs: a table that joined two keystrokes ago is inside the
  box before the file has been written.
- **A drag of the group's header moves the members**, and the drag is expressed
  as a delta applied to where each member was when the gesture began. The group
  follows because the same function runs again with fresher input.
- **`PATCH /api/group/:name` refuses `layout`**, in a sentence that says a group
  has no coordinates and names this record, rather than the general "unknown
  key". It refuses `members` the same way and points at
  `PATCH /api/table/:name` with `{ "group": "..." }`, which is where membership
  is written. A client that sent either believed something about this format
  that is not true, and the refusal is the only place it will find out.

### A group drag is one batch, on pointerup

Every other gesture on this canvas hands each move to its owner as it happens
and hands the final position over once more, so a write can never be waiting
inside the canvas for an event that is not coming (ADR 0015). A group drag is
the exception: it moves every member, so streaming it would be one request per
member per frame.

So it is handed over once, at the end, naming only the members whose rounded
position actually changed. What makes that safe is that the end of the gesture
always arrives: `pointercancel` and `lostpointercapture` are wired to the same
handler as `pointerup`.

Those patches all land inside the server's debounce window, so what reaches the
disk is **one `writeModel` whose `only` set is exactly the members that moved**.
The diff a reviewer gets is one `layout` line per box that moved, and the group
file is not in it. `test/studio/server.test.ts` asserts the narration line, not
just the bytes, because two writes of one file each leave the same bytes behind
as one write of two.

### A colour is a name from a short list, and an unknown name is drawn plainly

ADR 0005 writes `color: amber` and `color: violet`, and the reason is the diff:
a reviewer reading `color: amber` learns something and a reviewer reading
`color: "#fbbf24"` learns that somebody opened a colour picker. So the studio
offers seven names and never a hex value: `amber`, `rose`, `violet`, `blue`,
`teal`, `green`, `slate`. They live in `src/studio/client/palette.ts` and their
shades in one block of `index.html`, with a dark-theme block beside them, so no
component invents its own.

**The format's rule stays wider than the studio's list.** `docs/format.md` says
`color` is carried through and not validated, and that does not change: a model
that says `color: seafoam` opens, round-trips and is never rewritten. The studio
draws it plainly and the panel says why. A server that had an opinion here would
be a second, narrower format than the one the reader implements, and the file
that suffered would be somebody's, not ours.

### A note is rendered and edited as text

The body of a note is the note (ADR 0005), so the canvas renders its markdown:
headings, paragraphs, bullets, code and the two emphases. The parser is
`src/studio/client/markdown.ts`, it is deliberately small, and it returns a
value rather than markup — the renderer builds elements and sets `textContent`,
never `innerHTML`, so a note whose body is a `<script>` tag is a note that says
`<script>`.

The inspector edits the same body as plain text in a textarea, under the same
line-ending rule every other body has. What reaches the file is the characters
somebody typed, and a rich editor would be a second opinion about that.

### A group is created without pointing at anything

A table and a note are created by pointing at a spot on the canvas, because
`layout` is the one thing about them the server cannot invent (ADR 0021). `Add
group` opens the form directly and asks for a name, a label and a colour, and
never for a position. It is born empty, which `dbmd check` reports as
`group-empty` until a table joins it, and the studio says so in the status line
rather than leaving the warning to be discovered.

### Nothing is cascaded

Deleting the last table in a group leaves the group file alone: it keeps its
label and its prose, draws as a dashed placeholder rather than disappearing, and
is reported as `group-empty`. The delete confirmation says all of that before it
happens. Deleting a group leaves the tables that still declare it alone, which
the reader reports as `group-unknown`.

The rule underneath both is the same one ADR 0021 took for a table: the studio
edits the file it was told to edit and names what that will break, rather than
tidying up files nobody asked it to touch. An empty group is nearly always a
rename that went wrong, and a tool that deleted it would delete the evidence.

## Consequences

- **The three documents that promised notes and groups are now true.** The
  scaffolded note is written with `color: amber` so that the first window a new
  user opens shows a sticky note rather than a plain box: it is the only place
  a new user meets the rule that a colour is a name, and a scaffold whose whole
  job is to be read once should demonstrate the key.
- **The first draw fits the model into the viewport.** That is what a person
  wants anyway, and it is also the fix for the zoom toolbar at (12, 12) sitting
  on top of the box at (40, 40) that `init` writes and that any table with no
  `layout` lands on. Only the first draw: a later reload moving somebody's view
  because a neighbour saved a file would be the theft the adoption guard exists
  to prevent.
- **`/api/note` and `/api/group` are the same route as `/api/table`.** ADR 0005
  made a kind a directory and a set of keys and nothing else, so the containment
  check, the revision guard, the debounce and the conflict check are shared and
  only the patch parser and the apply differ. A fourth kind is a case in three
  switches.
- **The canvas element class is `note-card` and not `note`**, because
  `#inspector .note` was already the panel's explanatory paragraph. Two things
  called `.note` in one stylesheet is one rule silently applying to the other,
  which is what happened: the panel's sentences became absolutely positioned and
  stacked in the corner of the page. Found by driving it, which is the only way
  it would have been found.

## Revisit when

- **Somebody wants a group with a fixed size or a deliberate margin.** ADR 0005
  already names the way out and the price: an optional `layout` on the group
  that overrides the computation, added only when asked for, because the moment
  it exists it can disagree with reality.
- **The palette runs out.** Seven is a number somebody can remember using. If it
  has to grow, the shades still live in one place and the rule that an unknown
  name draws plainly is what makes growing it safe.
- **A note wants more markdown than this.** The parser here covers every note in
  `examples/shop` and in `dbmd init` and shows anything else as the characters
  that were typed, which is the honest failure. A real markdown library is a
  dependency this page does not have, and ADR 0004's argument about install time
  applies to it.
