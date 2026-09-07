# 0019. The disk wins, and the studio says which edit it dropped

Refines ADR 0004, which promised that the studio watches the directory and
reloads when a file changes underneath it, and ADR 0013, which recorded that the
server is not the watcher and named this gap.

## Context

The gap was not theoretical. On merged code, with the studio running:

1. open `db-model/tables/orders.md` in an editor, add a column, save
2. drag that table in the page

The second step wrote the studio's in-memory version over the first. No warning,
no diagnostic, no conflict, nothing on the status line. The developer's column
was gone and `git checkout` was the only way back, which only helps if the file
had been committed.

That is worse this week than last for three reasons. `dbmd studio` became a real
subcommand, so people leave it running. The canvas landed, so the habit is to
keep the page open beside the editor, which is exactly the workflow ADR 0004
says the tool is for. And the inspector turns the page from a viewer with a drag
into a thing that writes constantly.

**A watcher on its own makes this worse rather than better.** Getting a
file-changed event is the easy half. Four situations have to be answered and
only one of them is "redraw":

- **A change on disk to a file the session has an unwritten edit for.** Both
  versions are somebody's work and one of them is about to lose.
- **A change on disk to a file the session already wrote.** Nothing of the
  session's is at stake; adopting is all there is to do.
- **A file that stops parsing.** This is the ordinary state of a file halfway
  through being typed, and it is not a deletion. ADR 0008 leaves such a file out
  of the model entirely, so a studio that believed the model would see the table
  vanish from the canvas and would then be free to write over the very file whose
  error the developer is reading.
- **The studio's own save coming back as an event.** Every write here is a
  `.<name>.<uuid>.tmp` renamed over its target, so one save is at least two
  events, on names the reader is documented to skip.

And the window the first situation lives in is the debounce ADR 0004 requires. A
write is deliberately a few hundred milliseconds old by the time it lands. That
is where the race is, and it is a race the watcher cannot be relied on to win:
`fs.watch` is a different mechanism on every platform, coalesces at its own
discretion, and is allowed to be late.

## Decision

### The refusal is at the write, not in the watcher

**Immediately before writing, the session re-reads the directory and compares
each file it is about to write with the version that edit was made against. A
file that no longer says what it said is not written.**

Two properties follow from putting it here rather than in the event handler.

It does not depend on `fs.watch` at all. `startStudio({ watch: false })` still
refuses to overwrite a hand edit, and there is a test that asserts exactly that,
because a safety property that holds only when an optional operating system
facility fires in time is not a safety property.

And it is comparing the right two things. The baseline is what the disk said
when the edit was made, held per file and deliberately **not** refreshed by a
reload while that edit is unwritten. Refreshing it is subtle and fatal: the
watcher would notice the hand edit, adopt it as the new baseline, and the pending
write would then find the file exactly as it "expected" and go through. The first
implementation of this record did that and reproduced the original bug with a
watcher attached.

The comparison is of canonical text rather than of bytes, which is what makes it
usable on a hand-written model. ADR 0010 says a hand-written directory is rarely
canonical, so comparing bytes would call every file a conflict on the first
drag. Both sides go through the same renderer, so what is compared is what the
two versions of the file *mean*: retyping `'pending'` as `"pending"` is not a
conflict, and adding a column is.

### Refuse rather than reload-and-discard, and the disk is what survives

The choice was between refusing the studio's write and telling the developer,
and reloading while quietly dropping the pending edit. **Refusing is safer and
more annoying, and it is what this does.**

The reason is not that a drag matters less than a column, though it usually
does. It is that the two edits are not equally recoverable. A hand edit that the
studio overwrites is gone: the editor's buffer already matched the file when it
saved, so there is nothing to undo, and `git checkout` only helps if the work was
committed. A studio edit that is refused is a drag the developer can do again in
two seconds, against a canvas that now shows the file as it really is. **Prefer
losing the recoverable one.**

What the studio does not do is keep the refused edit in memory and wait. ADR 0004
is explicit that the files are the state and there is no other, and an edit held
against a disk that disagrees is precisely the dirty document state that record
refused to build. So the refused edit is dropped, the disk's version is adopted
in its place, and what the page is shown is what the file says.

**The refusal is visible or it is not a refusal.** It is narrated on stderr, and
it stands on the API's status as a `conflicts` entry naming the file, when it
happened, and what to do, until the studio successfully writes that file again.
Writing it again is what happens when the developer makes the edit a second time
on top of the reloaded model, so the conflict clears itself by being resolved
rather than by being dismissed. Deleting a table runs the same check for the same
reason, and more so: `writeModel` never deletes, so the delete route is the one
place in this project where the file does not come back.

Conflicts are on the status rather than in `diagnostics` because a diagnostic is
a fact about the model that `dbmd check` would report too, and this is a fact
about one session of one studio.

### The watcher only ever says "look again"

**It reports that something under the model directory moved, once per burst, and
`edits.ts` re-reads and works out what that means.** It carries no filename to
the decision, never writes, and never refuses.

That is what makes `fs.watch`'s unreliability affordable. A spurious wake-up
costs one directory read; a missed one is covered by the check above. A watcher
that had to be right about *which* file changed would inherit the rename
reported as a delete and a create, the four events for one save, the `null`
filename, and the directory handle Windows invalidates when a directory is
renamed.

Three details it does own. It watches the model root and each kind directory
rather than passing `{ recursive: true }`, because a model directory is two
levels deep by ADR 0005 and no deeper, and recursion is the one option whose
support varies by platform and Node version. It debounces, so an editor's save
by rename is one wake-up rather than two. And it skips names starting with a dot
or not ending in `.md`, which is the rule `readModel` already skips the writer's
own temporary files by.

**The echo is answered by comparison, not by memory.** A re-read that produces
what the session is already serving changes nothing and is not reported, so the
studio's own save does not bounce back as an external change and there is no
bookkeeping of "files I wrote recently" to get wrong. A `revision` counter on the
status is incremented only when a re-read found something the session did not
already know, which gives a page one number to compare against the one it drew.

### A file that stops parsing keeps its last good version, and cannot be written

A table whose file no longer parses is missing from the read (ADR 0008), and the
session keeps the version it last had, marked `complete: false`. That flag is not
cosmetic: it is the flag `writeModel` skips on and the flag `patchTable` refuses
on, so a table shown from memory cannot be written back over the file it no
longer matches. The canvas keeps a box where the box was, the diagnostic says
where the error is, and fixing the file brings it back without a restart.

A table whose file is *gone* is gone. The two are told apart by asking whether
the file is still there, which is the only honest way to ask.

## Consequences

- **A drag can be lost, deliberately, and the developer is told.** That is the
  trade: the annoying failure is chosen over the silent one. It is bounded by
  making the edit again.
- **A flush now reads the directory twice**, once to check and once to adopt
  what the writer normalised. ADR 0013 already accepted one scan per flush and
  said it was not worth optimising for a local model of tens of files; this is
  the same order and the same argument, with the same revisit trigger.
- **The session holds two models rather than one.** What it serves, which
  includes its unwritten edits, and what the disk said when those edits were
  made. They are the same object whenever nothing is pending. A single model
  cannot answer both questions, and the attempt to make it is what produced the
  bug this record exists for.
- **The watcher can be switched off and nothing unsafe happens.** Only the live
  update goes away. That is the point of putting the refusal at the write, and it
  is how the write-time check is tested.
- **A refusal is reported after the request that caused it has been answered,
  so an operation composed of several requests cannot abort on one.** The write
  is debounced by ADR 0004, so a `PATCH` is answered `200` when the edit is
  accepted and the refusal happens at the flush, on the status. That is fine for
  a drag and is not fine for the inspector's rename, which is a create, a patch
  per referring table and a delete (ADR 0016). If one of those patches is
  refused, the rest of the rename still runs: the new table is created, the old
  one is deleted, and the file whose patch was refused is left referencing a
  table that is no longer there. **The rename half-applies rather than refusing
  cleanly**, the refusal is correct and visible in `conflicts`, and the dangling
  ref is not a reader diagnostic because ADR 0017 makes cross-object checks the
  validator's. Closing it means either a client that reads `conflicts` after each
  step and stops, or a rename endpoint the server can refuse as one thing.
- **A residual race remains and is named.** Once the rename that lands a write
  has started, which of it and an editor's save reaches the directory last is the
  filesystem's decision. The studio adopts whatever ended up there. Closing that
  would mean holding a lock on a directory the developer owns, which is worse
  than the thing it prevents.
- **The API grew two fields and the page renders neither yet.** `conflicts` and
  `revision` are on every status response and nothing in `src/studio/client/`
  reads them, because the inspector is being built in that directory right now.
  The data-loss half of this item is server-side and complete; the visible half
  is a follow-up, and until it lands a developer learns about a refusal from
  stderr rather than from the page.

## Revisit when

- **Refusing turns out to be more annoying than it is worth**, which will show up
  as people restarting the studio to clear a conflict rather than redoing the
  edit. The answer then is a way to say "mine, not theirs" out loud in the page,
  not a quieter default.
- **Two windows on the same model.** ADR 0013 already names this; the check here
  is per file and per session, and two sessions would each refuse the other
  forever without either being wrong.
- **`fs.watch` misses a change often enough to notice.** Then the fallback is
  polling `stat` on the files the model was built from, and the reason it is not
  the design today is that the write-time check already makes a missed event a
  stale page rather than lost work.
- **A flush becomes slow enough to feel.** Then narrow the pre-write read to the
  files being written, which is a real optimisation this deliberately did not
  take before anybody had a model where it mattered.

## Amended by dbmd-48 and dbmd-39, once somebody sent a `columns` patch from a stale page

Two of the sentences above are wrong, and they are wrong in the same way: this
record treated the page as a consumer of the guard rather than as part of it.

### "The data-loss half of this item is server-side and complete"

It was not. The reproduction, on the code this record describes, with a watcher
running and nothing pending:

    page holds : id, email, display_name, created_at
    server sees: id, hand_added, email, display_name, created_at
    PATCH status 200
    disk now   : id, email, display_name, created_at
    conflicts  : []

The check this record puts at the write is correct, and it is not the whole
guard. It asks whether the **disk** has moved since the session read it, and
with nothing pending `absorb` has already adopted the hand edit, so the answer
is honestly no and the write is correctly allowed. What has moved is the
**browser**, which holds no baseline at all, and which sends the whole `columns`
array it is still holding, because that is what a `TablePatch` is.

So the last consequence above is not a note about presentation. "The API grew
two fields and the page renders neither yet" describes a page that can silently
overwrite a column it never saw, which is the same data loss this record was
opened for, entered from the other end. **A staleness check on the client is
part of the data-loss guard, not part of showing it.** ADR 0025 adds it: every
mutation names the `revision` it was made against and is refused when the
session has moved on, and the page adopts a change from disk when it is between
things rather than waiting to be told.

The narrower lesson is about how this was verified rather than about what was
built. The review that closed it exercised the guard with a `layout` patch,
which carries no column list, so there was nothing for a stale page to lose. The
destructive case needs a patch that replaces content, and a narrow verification
passed where a wider one would not have.

### "The rename half-applies rather than refusing cleanly"

Recorded above as a consequence to be closed later, with the two ways out named.
The first of them is now taken, and building it showed that the way it was
described could not have worked: "a client that reads `conflicts` after each
step and stops" cannot read a conflict that does not exist yet. The refusal comes
into existence at the flush, and the next step goes out before the flush fires,
which is the whole reason the rename half-applied. So the client needs a way to
make the write happen, and `POST /api/flush` is it.

What replaced the per-step `conflicts` check is smaller and says more: **the
whole rename names one revision, and is abandoned the moment the model is not on
it.** A clean rename does not move the revision, because a re-read that produces
what the session already serves changes nothing, which is a property this record
built for the echo and which turns out to be exactly what makes one number enough
for a multi-step edit. ADR 0025 has it.

### What still stands

Everything else, including the two things it would be easiest to lose in a
rewrite. The write-time refusal stays exactly as it is, because it catches the
case the client check cannot: a hand edit landing inside the debounce, before
anything has noticed, which no revision on either side has been told about yet.
And the watcher still only ever says "look again". The three checks answer three
different questions, and the page is now the third: has the disk moved since the
session read it, has the session moved since the caller drew its picture, and is
there anything new to draw.

## Amended by dbmd-e6e, once somebody locked a file the studio was about to write

An amendment rather than a record of its own, because the decision here is
unchanged and one of its sentences is not. **"A file that no longer says what it
said is not written" is two facts wearing one sentence**, and the studio was
telling the developer the wrong one of them.

Take an exclusive lock on `tables/orders.md`, the way an editor, OneDrive, a
backup agent or antivirus does on Windows, and drag that table in the page:

    PATCH /api/table/orders 200
    conflicts: tables/orders.md changed on disk after the studio read it, so
               writing over it would lose that change. The studio has reloaded
               the file and dropped its own edit to it; make the edit again if
               you still want it
    diagnostics: tables/orders.md error file-unreadable: cannot read the file:
               the file is in use (EBUSY)

Nothing was written, the file was byte-identical afterwards, and the next edit
landed normally once the lock cleared. Everything this record asks for happened.
What the developer was told is that somebody had edited their file, which nobody
had, and to make the edit again, which fails the same way until whatever has the
file lets go of it. The true sentence was on the same page, two inches below the
false one.

**The conflation is in the comparison, and the comparison is not wrong.**
`readModel` does not throw on a file it cannot open: it raises `file-unreadable`
and leaves the object out of the model. So `renderOf` differs, exactly as it
does for a file somebody edited, and the path takes the refusal branch. "Absent
because it could not be read" and "present and different" are the same thing to
that comparison, and they are opposite facts about somebody's disk.

### What changed

**The refusal did not.** Writing over a file the studio could not read is
precisely what must not happen, and it is worse than the case this record was
opened for: there is no version of that file anybody has seen. The refused edit
is still dropped rather than held, for ADR 0004's reason, which does not change
because the reason for the refusal changed.

**The reader is asked which of the two it is, and the refusal repeats what the
reader said.** A `file-unreadable` at that path, or at the kind directory that
would not list, is the whole of the test. `WireConflict` gained a `reason` of
`changed` or `unreadable`, so the page switches on a code rather than on prose,
which is the rule ADR 0025's refusal already follows, and the delete route
raises `unreadable` where it used to raise `conflicted`.

**Neither sentence names a cause.** A lock is what produces this on Windows and
a permission change produces the identical refusal, so a message that said
"another program has it open" would be this same defect with a different face.
The reader has already turned the errno into a clause a person can act on, and
repeating it is the honest move. The advice changed with it: "make the edit
again" is right when there is a change on disk to make it on top of, and here
there is nothing until the file can be read, so that is the condition it names.

### What this leaves open, deliberately

**A table the studio is holding from memory still says it "did not parse".** The
carried-forward object is marked `complete: false` whatever the reason, and the
`incomplete` refusal, the canvas and the inspector all say the file did not
parse, which for a locked file is the same guess this amendment removed from the
writer. Fixing it means the page knowing why an object is incomplete, which is
plumbing through two scene files rather than a sentence, so it is an item of its
own rather than a rider on this one.

**Nothing wakes the studio when a lock is released.** A release is not a
filesystem event, so the watcher does not fire and the session goes on holding
the file as unreadable until something else under the model directory moves or
the next flush re-reads. The developer's next edit to any other table clears it.
That is `fs.watch` being what this record already says it is rather than a new
thing, and the same "revisit when" applies: polling `stat` is the answer if it
turns out to bite.
