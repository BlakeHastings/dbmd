# 0021. A table is created by pointing, and deleted after being told what it costs

Refines ADR 0016, which decided what the inspector shows and how it asks before
it edits other people's files, and ADR 0015, which decided that a position
nobody chose is computed and never written. This is what adding and removing a
whole table turned out to require.

## Context

`POST /api/table` and `DELETE /api/table/:name` landed with the server (ADR
0013) and had never been called by the page. Everything that reached the disk
until now went through `PATCH`, which is an edit to a file that exists. Creating
and deleting are the two operations that move a file rather than change one, and
each asks a question the routes do not answer.

**A new table has no position, and a computed one is not written.** ADR 0015 is
explicit: a table with no `layout` is drawn on a grid, nothing about that
placement reaches the disk, and opening a model must leave `git status` empty.
So a table created with no `layout` is a table that appears wherever the grid
puts it, which is below everything, off screen on any model with a few rows of
boxes, and which then stays there until somebody drags it. The `layout` is the
one part of a new table that nothing except the developer can supply.

**A name is a file name, and two layers already say so.** `safe-path.ts` refuses
what cannot be one path segment and answers over HTTP with a sentence written
for a person. There was no reason for a third opinion, and a copy of that rule
in the page would be a copy to keep in step.

Except for one rule that is genuinely not the server's to give.
`docs/format.md` measures it: creating `Orders.md` and then `orders.md` on
Windows 11 leaves one file, still called `Orders.md`, holding what was written
second. A model with `Orders` and `orders` therefore has two tables on the
machine that made it and one on the machine that checks it out, with the
survivor decided by the order the files arrived in. The server can only answer
for the filesystem it is running on, which is the one filesystem where the
question does not matter yet.

**Deleting is the only destructive thing this tool does.** ADR 0004 says git is
the undo and the status line says so on every screen. That sentence is true of
every other edit here and only half true of this one: `git checkout` restores a
file that was committed and has nothing to restore for one created and deleted
in the same afternoon.

## Decision

**A create starts with the pointer and finishes with the name.** The toolbar
arms placement, the canvas shows a crosshair for as long as it is armed, and the
press that uses it is a coordinate rather than a gesture: it captures no
pointer, changes no selection, and is not a drag on whatever happened to be
under it. The point becomes the new table's `layout`, which is the one thing a
create cannot compute and must not invent, and the panel then asks for the name.
Escape cancels, and this is the canvas's only mode, deliberately: a mode the
developer forgot they were in is a click that did something they did not ask
for.

**The new table's form is the inspector, not a second panel.** It is the same
confirmation, the same notes and the same fields, and the panel is already the
place a table's contents are typed. It says the file it will write, the
coordinates it will write into it, and that it will change nothing else, before
the button is pressed. That last sentence is the property a create has and a
rename does not, and it is worth saying out loud for exactly that reason.

**A new table is born with one column, `id`, marked as the key and with no
type.** The name and the key are what every table in every example has, so
filling them in guesses nothing and saves two clicks. The type is left empty
because it is the one part of a column that depends on the engine, and a `uuid`
chosen here would be this repository deciding something about somebody's
database. The inspector says an empty type is empty and `git diff` says
`type: ""`; neither is a surprise, and it is the same thing `Add column` has
always written.

**The page judges a name only where the server cannot.** A name a file cannot
have is refused by `safe-path.ts` and the refusal is shown in the form, in the
server's own words, beside the field it is about. The one rule the page owns is
the case clash, because its answer is about the machine the model will be
checked out on rather than about the name, and it is asked as the developer
types and confirmed before it is written rather than refused. An exact duplicate
is named as the developer types too, which is not a second opinion but an
earlier copy of the same one, for the same reason ADR 0016 runs the validator in
the browser.

**A delete says which file goes, which refs it strands, what dbmd will call
them, and what the undo is actually worth.** Every ref pointing at the table is
listed by `table.column`, with `ref-table-unknown` named, in the same shape ADR
0016 chose for removing a referenced column. A self-reference is not counted,
because it goes with the file. The confirmation says that `git checkout` only
restores a file that was committed, which is the sentence the status line is too
short to carry and the only place a developer will read it in time.

## Consequences

- **A created table is in `git status` immediately**, one file, with a `layout`
  in it, and no other file touched. That is the diff the format exists for, and
  it is the first write in this studio that is not an edit to something that was
  already there.
- **A deleted table's referrers go red rather than being rewritten.** The
  interface names them first and leaves them alone, which is the same decision
  ADR 0016 took for a removed column: a dangling ref is a diagnostic the
  developer resolves, not a thing for a delete to guess at.
- **The page has one rule about names that the server does not.** That is a
  duplication risk taken deliberately, and it is bounded: it is one function,
  `clashFor`, it is tested without a browser, and it is about the filesystem
  rather than about the format. Every other refusal is the server's.
- **A table created and deleted in the same session is gone.** Said in the
  confirmation, which is the only mitigation available to a tool whose undo is
  somebody else's version control.
- **The canvas has a mode.** It costs one boolean, one cursor and one Escape,
  and it is the first thing in this page that means different things at
  different times. The alternative, creating at a fixed point and making the
  developer drag it, writes a `layout` the developer did not choose, which is
  the thing ADR 0015 exists to prevent.

## Revisit when

- **Notes and groups arrive (dbmd-34).** They are placed the same way and have
  the same problem, so the mode becomes "what am I placing" rather than a
  boolean, and this is the record that says why placement is a mode at all.
- **Something other than the studio creates a table.** `dbmd import` writes a
  whole directory and has no pointer, so every table it makes has no `layout`
  and is laid out on the grid. That is correct today and stops being obviously
  correct the moment somebody wants an import to arrive readable.
- **A second window is open on the same model.** ADR 0013 already names the
  in-memory cache as one session's. A delete is the worst version of that race,
  because the other window's next patch is a refusal about a table that is no
  longer there.
- **An undo of a delete is wanted inside the studio.** It is buildable, since
  the page held the whole table a moment before, and it would be the first
  undoable action in a tool that has deliberately had none. That is a decision
  about ADR 0004 rather than about this record.
