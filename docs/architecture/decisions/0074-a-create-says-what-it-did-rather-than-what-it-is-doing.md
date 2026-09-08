# 0074. A create says what it did rather than what it is doing

## Context

Driven in Chromium on 2026-09-07 against a studio pointed at a throwaway copy of
`examples/shop`. Creating a table through the panel wrote the file correctly and
drew the box, and the status line said:

    Creating tables/cupping_notes.md.

Measured at three seconds and at fifteen, unchanged both times. It stayed that
way until a drag of an unrelated box, which goes through a different path,
replaced it with `Wrote tables/customers.md at 8:14:50 PM. Undo is git checkout.`

**The write was never in doubt.** Only the sentence was wrong, and it was wrong
in the way that costs the most: a person was told an edit was in progress and
was never told it finished.

**The mechanism is `standing`.** `say()` in `src/studio/client/main.ts` sets a
module-level sentence that `showStatus` renders in preference to
`status.lastWrite`, because the status line is otherwise a rendering of
`WireStatus` redrawn by every heartbeat and a sentence written straight into the
element would be wiped by the next beat. That is the right design and it is why
a refusal is readable at all. **`standing = null` appears in exactly one place**,
inside `ObjectWriter`'s `onStatus`, so an ordinary edit clears it by landing.

**A create does not go through `ObjectWriter`.** ADR 0013 writes a new file
immediately rather than debouncing it, so `create()` calls `createTable`
directly. Nothing on its success path cleared the sentence it had left standing,
and the standing sentence then suppressed the `Wrote ...` line that would have
corrected it, for as long as the page stayed open.

**Three of the five paths were measured, not assumed, and they did not agree.**

| Act | Before |
| --- | --- |
| Create a table | `Creating tables/cupping_notes.md.` at 3s and at 15s |
| Create a note | `Creating notes/cupping-note.md.` at 3s and at 15s |
| Create a group | `Created groups/cupping-group.md. Nothing is in it yet...` |
| Drag a box | `Wrote tables/customers.md at 8:14:50 PM. Undo is git checkout.` |
| Rename a table | `Renaming cupping_notes to cupping_scores.` at 3s and at 15s |

**`createGroup` was already right**, and it is right by having written its own
closing sentence for its own reason: an empty group draws as a placeholder and
`dbmd check` reports `group-empty`, so the panel says so. It was not designed as
the answer to this defect and it is the answer to this defect.

**A rename has the same shape and the same hole.** `renameTable` reaches
`ObjectWriter` only for the tables that reference the one being renamed, so
renaming a table nothing references clears nothing, and the page said `Renaming a
to b.` for as long as it stayed open. Renaming a table that *is* referenced
happened to clear it, part-way through, and then finished by showing `Wrote
tables/<some referrer>.md`, which is a true sentence about the least interesting
file the act touched.

## Decision

**Each of these paths ends by saying what it did, in its own words, held rather
than written.**

Two answers were available and the other one was rejected.

**Rejected: clear `standing` and let the ordinary line render.** It is one line,
it needs no new prose, and it makes a create end exactly the way a drag ends,
which is the consistency argument and a real one. It was rejected because
**that line ends in `Undo is git checkout`, and after a create that is false.**
The file did not exist a second ago, so it is untracked, and `git checkout` will
not take it away. The page would have closed a create by giving an instruction
that does nothing. `remove()` already refuses the same trap from the other
direction: it says `Undo is git checkout, if it was committed.`

**Chosen: a sentence per act, and the undo clause tells the truth about each.**

- A create says `Created tables/x.md. Undo is deleting the file rather than git
  checkout, because it is new.`
- A rename says `Renamed a to b. tables/b.md is new and tables/a.md is gone, so
  undoing it is a delete and a git checkout.` Two things, because a rename is
  two things.
- A group create is unchanged. Its sentence is longer and is about
  `group-empty`, which is the thing a person needs next there, and lengthening
  it with an undo clause would bury that.

**The create sentence is `createdNotice` in `write.ts`, beside `staleNotice`,
`unreadableNotice` and `conflictSummary`**, rather than a template literal in
`main.ts`. That is where this project already keeps the prose the page says out
loud, and it is the only reason any of this is provable without a browser. The
rename sentence stays inline: it is said in one place, by the one function that
knows both names.

**`showStatus` is untouched.** The stale path and the conflict path short-circuit
above the standing sentence on purpose and this changes neither, and the
bad-toned standing sentence still outlives the next render, so a refused create
still says so. The fix is at the three call sites that were not answering
themselves, not in the renderer they all share.

## Consequences

- **The sentence now stands until the next deliberate act or the next landed
  edit.** After creating a table the person is normally typing in the panel
  within seconds, and the first keystroke that lands goes through
  `ObjectWriter`, clears `standing` and restores the ordinary `Wrote ...` line.
  So in practice this is a sentence that answers a question and then gets out of
  the way, which is the lifecycle `Deleted ...` already has.
- **A create no longer shows the `Wrote ...` line at all, and that is a
  deliberate loss.** That line carries the time. Somebody who wants to know when
  the file landed now has to make another edit or read `git status`. The time
  was judged worth less than an undo instruction that works, because the create
  they are being told about is the one that just happened.
- **The evidence for this is a browser run, and the test is the weaker half.**
  ADR 0015 puts the DOM and the event handling behind driving the studio rather
  than behind a test double, and that is exactly right here: no assertion in
  `test/studio/inspector.test.ts` could have caught a sentence that was never
  reached. What the new tests hold is the wording, in particular that it does
  not end in the `git checkout` instruction the rejected answer would have given
  it. What proves the fix is the run in the table above, repeated.
- **The same hole can open again with the next path that skips the writer.**
  `standing` is cleared in one place, on purpose, and every direct call to the
  API is a path that must remember to answer itself. There are now four such
  paths (two creates, a delete, a rename) and every one of them ends with a
  `say`. That is a convention, not a guard, and this record is where it is
  written down.

## Revisit when

- **A fifth path writes without going through `ObjectWriter`.** Four call sites
  each remembering to close their own sentence is a pattern; five is an argument
  for the clearing to happen where the request is made rather than where it is
  narrated.
- **Somebody asks when a file was created.** That is the thing this trades away,
  and it is recoverable: the created sentence could carry `status.lastWrite.at`,
  which the server does set for a create because `addObject` goes through the
  same flush as everything else.
- **`git checkout` stops being the studio's undo story.** Three sentences on
  this page name it and they would move together.
- **A create is ever made undoable from the page.** The undo clause here is an
  instruction because there is no button. A button would replace all three
  clauses and this record with it.

## Amended on 2026-09-08: the closing sentence is said over a re-read that may not have happened

Each of the four paths this record gave a closing sentence to ends the same
three lines: write the file, `await reload()`, then say what it did. **The
middle line can fail, and the sentence after it is written on the assumption
that it did not.**

`reload` wrote `Could not read the model: <why>` straight into the status
element and returned, and the very next statement in the caller overwrote it.
Measured in Chromium with `GET /api/model` aborted at the browser, against a
throwaway copy of `examples/shop`:

| Act | What the status line ended on |
| --- | --- |
| Delete a table | `Deleted tables/sweep_inside.md. Undo is git checkout, if it was committed.` |
| Create a table | `Created tables/sweep_outside.md. Undo is deleting the file rather than git checkout, because it is new.` |

So the person was told the page had re-read the directory when it had not, and
the read that failed was on screen for no frames at all. The canvas underneath
was measurably still the old one: the deleted table was still drawn, and the
created one was not.

**The first draw was already right and is untouched.** With the endpoint failing
at page load the line reads `Could not read the model: Failed to fetch` and
stands, because nothing renders over it: the heartbeat and the write poll both
swallow a read that failed and say nothing, so the next render is the read that
worked. That is the one status sentence here that is not held, and this
amendment leaves it exactly as it was, word for word.

### Both facts, rather than one

`reload` now answers why it could not, and `sayDone` says both:

    Deleted tables/stock_movements.md. Undo is git checkout, if it was
    committed. The page could not re-read the model afterwards, so the canvas is
    still showing what it drew before: Failed to fetch.

The act's own half stays because it is the only thing here that changed
somebody's disk and they have to be told. The second half is there because the
canvas beside it is now older than the model and has to say so.

The two creates also stop selecting the object they made when the re-read
failed. Selecting a name the canvas has no box for opens a panel about an object
the page is not holding, which would be a second wrong thing said about the same
failed read.

### The clause is taken back by the read that falsifies it

A standing sentence is held until the next landed edit, so without more it would
go on saying the canvas was behind over a canvas that had caught up. `adopt` is
the read that makes it false, so `adopt` is what retracts it, and only the
clause goes: the act's own sentence stands, because it is still true.

Driven: delete with the endpoint aborted, then the endpoint restored, then a
table file written into the directory from outside. The moment the page adopted
that change, the line became `Deleted tables/stock_movements.md. Undo is git
checkout, if it was committed.` and the deleted box was gone from the canvas.

**Restoring the endpoint is not on its own enough, and that is by design rather
than a gap.** The revision counts the times the directory changed underneath
this session (ADR 0025), and the page's own create and delete are not that, so
nothing tells the page to look again. Measured: with the endpoint back and
`GET /api/model` returning 200 on every beat, the deleted box was still drawn
six seconds later and the sentence was still true. What clears it is any change
the session did not make, which is the ordinary next thing to happen in the
workflow ADR 0004 describes.
