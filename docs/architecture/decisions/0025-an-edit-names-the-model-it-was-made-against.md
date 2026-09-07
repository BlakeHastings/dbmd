# 0025. An edit names the model it was made against, and the page catches up when it is between things

Amends ADR 0019, which decided that the disk wins and the studio says which edit
it dropped, and which put the whole of that guard on the server. It is half of
it. Refines ADR 0004, which promised that the studio watches the directory and
reloads when a file changes underneath it, and ADR 0016, which composed a rename
out of the routes that already existed.

## Context

ADR 0019 opens with a two-step scenario and says it is fixed. On merged code,
with a watcher running, it is not:

    page holds : id, email, display_name, created_at
    server sees: id, hand_added, email, display_name, created_at
    PATCH status 200
    disk now   : id, email, display_name, created_at
    conflicts  : []

A person adds a column in their editor with **no studio write pending**. The
watcher notices, the server re-reads and correctly adopts it. Then the page,
which has been showing the same picture since it loaded, changes a column type,
which sends the whole `columns` array it is still holding. The hand-added column
is gone. The write succeeded. Nothing was reported.

Nothing in ADR 0019 is wrong about the server. Its check asks whether the file
about to be written still says what it said when the edit was made, and with
nothing pending the session's baseline was correctly refreshed to include the
hand edit, so the file does say what it said and the write is correctly allowed.
**The stale party is the browser**, which holds no baseline at all: it drew a
model once and has been sending edits computed from it ever since.

The same shape, seen through a bigger operation, is why a rename half-applies.
A rename is a create, a patch per referring table and a delete (ADR 0016), and
the write is debounced (ADR 0004), so a `PATCH` is answered `200` when the edit
is accepted and its refusal, if there is one, comes into existence a few hundred
milliseconds later at the flush. The client cannot abort on something that has
not happened yet. When one of the patches is refused the rest of the rename runs
anyway, the old file is deleted, and a table is left pointing at one that is not
there, which is a cross-object fact and therefore the validator's business rather
than the reader's (ADR 0017), so the studio's own diagnostics say nothing.

Two items, one seam. Both are the client acting on a model it has not checked.

## Decision

### Every mutation names the revision it was made against, and is refused if the session has moved on

`WireStatus.revision` already counted the times a re-read found something the
session did not already know, and was already documented as "the client's cue to
re-fetch and redraw". Nothing read it. It is now also the token: `PATCH`, `POST`
and `DELETE` carry `x-dbmd-revision`, and `edits.ts` refuses with `409 stale`
when it is not the number the session is on.

**It is the same number rather than a new one**, and that is the point. A
revision moves only when a re-read found something the session did not already
know, which by construction is exactly "the picture you were shown is no longer
what the files say". The session's own writes do not move it, so an ordinary
editing session never trips over it, and there is no second piece of bookkeeping
to keep in step with the first.

**It is a header rather than a key in the body.** `TablePatch` stays exactly the
shape of a table document, `DELETE` has no body at all and is guarded by the same
one line, and it is a second custom header on every mutation, which is the same
preflight argument `server.ts` already makes about `content-type`.

**Absent is a refusal, not a default.** A caller that has not said what it read
is one this server cannot tell from a stale one, and a bypass shaped exactly
like the defect is not a guard. The refusal says what to send.

**It is model-wide rather than per file**, and that is deliberate even though
ADR 0019's own comparison is per file. The two are asking different questions.
That one asks whether a file is about to be overwritten, which is about a file.
This one asks whether the picture an edit was computed from is still true, and a
page draws one picture from one read: a `columns` array it is about to send back
was computed against the whole model, and a rename moves a `ref` into a
neighbour. Narrowing it to the file being written would pass the case it exists
for. The cost is that a hand edit anywhere refuses the next edit anywhere, and
that cost is bounded by the next decision.

### The page adopts a change from disk, and only when it is between things

A guard that only ever refuses would make the studio worse: a developer would
be told no, with no idea why, until they reloaded. So the page reads `revision`
off every response it already gets and re-reads the model when the server is
ahead, which is also ADR 0004's promise that editing `orders.md` in an editor
and seeing the box change is the same feature as the studio writing it, finally
kept. A slow heartbeat, two seconds while the tab is visible, covers the case
where the page is not making requests at all.

**Adopting is deferred while anything is in the middle of happening**: a pointer
holding a box, a cursor in a field of the inspector, an edit not yet written, or
a placement that has been pointed at and not yet named. Each of those is
somebody's unfinished work, and redrawing is the page taking it away to show
them somebody else's. So it says the model moved and catches up at the next
moment when nothing is in flight.

The case worth naming is the cursor in a field, because that is where the answer
is least obvious. **The page does not adopt, and it does not have to, because
the guard has already made waiting safe**: any edit made from the stale panel is
refused rather than applied, so the developer's half-typed value is still on
screen and the change on disk is still on disk. What they lose by continuing to
type is the edit they are making, which ADR 0019 already argues is the
recoverable one. Leaving the field is what makes the panel catch up. Only while
the window actually has focus, because side by side with an editor is the
workflow this is for and `document.activeElement` still names the last field
used in a window nobody is typing into.

**Adopting rebuilds the panel, and that is not cosmetic.** The inspector's rows
are the previous model's values held as DOM, and `commitColumns` reads the whole
list out of them, so a panel left standing over an adopted model would send that
old list back with a fresh revision on it. That is this record's defect with the
guard passed rather than failed.

### A refusal is on the page, in both directions

ADR 0019 said a refusal is visible or it is not a refusal, and then nothing in
`src/studio/client/` rendered `conflicts`, so until now a developer learned about
one from stderr. They are rendered as a list in the footer, beside the
diagnostics rather than in them, standing until the studio writes that file
again, which is what happens when the developer makes the edit a second time. So
the list clears itself by being resolved rather than by being dismissed.

The status line grew one idea: a sentence the page says about its own act
outlives the next render. The line is otherwise a rendering of `WireStatus`,
redrawn by every response including the heartbeat's, and "the rename stopped
part-way" is the only place a developer is ever told that. A refusal outranks
everything except a write that threw; an ordinary "deleted tables/x.md" does not
outrank the news that the model has moved.

### A rename names one revision for all of it, and lands each step before the next

ADR 0019 named two ways to close the half-applied rename and this takes the
first, "a client that reads `conflicts` after each step and stops". Building it
showed that as described it cannot work: the conflict does not exist yet when
the next step goes out. So **`POST /api/flush`** was added, which lands what is
already accepted and answers with where that left things. It names no object and
carries no revision, because everything it writes was accepted by a request that
named one.

With that, the rename does not need to read `conflicts` at all. **Every step
names the revision the confirmation was written against, and the rename is
abandoned the moment the model is not on it.** That one number is what makes
several requests one decision: it is the model the developer was shown and
agreed to, so a step made against a different one is a step nobody agreed to. A
clean rename does not move it, because a re-read that produces what the session
already serves changes nothing (ADR 0019's answer to the echo), which is what
makes one number enough.

The delete asks a second time, after its own flush, because that flush is
allowed to discover a refusal and a delete is the destructive step. The rename
is still not atomic and still not one endpoint (ADR 0016), so what it now owes
the developer is a sentence, and the sentence names what landed, what did not,
and that nothing is left pointing at a table that is not there.

## Consequences

- **A hand edit anywhere can refuse the next studio edit anywhere**, for as long
  as it takes the page to notice, which is at most one heartbeat and usually the
  response to the edit itself. That is the price of a model-wide token, and it
  is paid down by adopting rather than by narrowing the token.
- **An idle page is no longer silent.** One loopback `GET /api/model` every two
  seconds while the tab is visible, where before there were none. Measured in a
  browser: fifteen requests over thirty idle seconds, and three of the forty
  requests a five-second typing session makes, against twenty-six patches. The
  beat is what makes ADR 0004's live update true, and it is the first thing to
  make conditional if a model ever gets big enough for the response to matter.
- **A rename that stops leaves the new file behind.** ADR 0016 already accepted
  that a rename failing halfway leaves two files, with `git status` showing it
  and `git checkout` undoing it. What is new is that both are named in the
  sentence, and that the old file is never deleted, so the model it leaves is
  consistent rather than dangling.
- **`readJsonBody` no longer checks the content type**; `requiresJson` does, and
  each mutating route asks it first, then for the revision, then for the body.
  The order is deliberate: the content type is the one that is security, and
  `POST /api/flush` has it and no body to read.
- **Every existing test that mutates had to say what it read.** That is churn,
  and it is the useful kind: a suite that could mutate without naming a revision
  is a suite that is not exercising the client that exists.
- **Two sessions on one model would now refuse each other twice.** ADR 0013 and
  ADR 0019 both name this trigger already; this adds a second mechanism with the
  same answer, and does not make it worse, because a second window would move the
  revision and the first would re-read.

## Revisit when

- **The heartbeat is the wrong shape.** The first sign is a model where
  `/api/model` is big enough that two seconds of it is noticeable, and the answer
  then is a cheaper question than the whole model rather than a slower beat: the
  status alone would do, and the reason it is not a separate route today is that
  one route that always tells the truth beats two that can disagree.
- **A refusal happens often enough to be annoying rather than rare.** ADR 0019
  already says the answer to that is a way to say "mine, not theirs" out loud in
  the page rather than a quieter default, and that is still the answer, with one
  addition: the page could offer to re-apply a `layout` patch after adopting,
  because a drag carries no content from the model it was computed against. No
  other patch is safe to replay.
- **Something other than a table gets a panel**, or a group drag moves several
  tables at once. Both make a gesture that spans files, and the rename's "one
  revision for the whole thing" is the shape that wants.
- **The token needs to survive a reload of the page rather than of the model.**
  It does not today: a page that reloads reads the revision along with the model,
  which is right, and a page that could restore a pending edit across a reload
  would have to answer what revision that edit was made against. ADR 0004 says
  there is no such state, so this is a trigger for that record rather than this
  one.
