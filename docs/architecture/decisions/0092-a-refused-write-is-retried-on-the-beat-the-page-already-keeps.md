# 0092. A refused write is retried on the beat the page already keeps

Answers a condition ADR 0083 wrote down for itself, and it is the cheap half of
what that record expected the answer to cost.

## Context

ADR 0083 shaped the sentence the studio says when the disk refuses a write. Four
things about the old behaviour were called right and left alone, and one of them
was this:

> `src/studio/edits.ts` put the files back in the pending set, so the next flush
> retried and nothing was lost.

That is true and it is not enough, and the record's own "revisit when" said so:

> **Somebody asks the studio to retry on its own.** The sentence says the edit
> rides out with the next write, and the next write is the next edit or a close.
> A person who fixes their permissions and then walks away still has an unwritten
> edit, and nothing prompts them. That is a decision about a retry timer, which
> is larger than a sentence.

Measured on 2026-09-08, in Chromium at 1600 by 947, against a studio on a
throwaway copy of `examples/shop` (ADR 0079). `attrib +R` on
`tables/addresses.md`, then that box dragged from 40, 40 by 90 across and 70
down. The status line turned bad and said what ADR 0083 designed it to say. Then
the attribute was cleared, and the page was left alone:

```
--- read-only attribute cleared
[after clearing +2s] status: Could not write tables/addresses.md. ...
[after clearing +2s] addresses.md on disk: layout: { x: 40, y: 40 }
[after clearing +4s] addresses.md on disk: layout: { x: 40, y: 40 }
[after clearing +6s] addresses.md on disk: layout: { x: 40, y: 40 }
--- one unrelated drag of shipments
[after an unrelated drag] status: Wrote tables/addresses.md, tables/shipments.md at 3:54:11 AM. Undo is git checkout.
[after an unrelated drag] addresses.md on disk: layout: { x: 141, y: 118 }
```

The status line was the same red sentence at all three reads, and the file held
its pre-drag coordinates at all three.

Every clause of the sentence was true. "The edit is still here": true. "Rides
out with the next write": true, and the trap, because there is no next write
until the developer makes another edit. "Nothing is lost yet": true, and the
`yet` was load-bearing.

**The mechanism is that nothing re-arms the timer.** `write`'s catch puts the
refused files back into `edited` and stops there. `schedule` is what sets the
debounce, and only a `PATCH` calls it. So a pending edit after a refusal waits
for an event that only the developer can produce, and the one thing the
developer just did, which was to fix the problem, is not one of them.

**Two answers were available and they are genuinely different work.** Make the
sentence true, or make the sentence say what happens. Saying what happens is
smaller and would have read something like "clear whatever the system is
refusing and then make another edit, which writes this one with it". It was
rejected: the studio would then be asking a developer to nudge it, in the one
situation on this page where they have already done the only thing they can do,
and ADR 0083's whole argument is that the last clause of that sentence is the
"what to try".

## Decision

**The retry hangs off `GET /api/model`, which the page already asks for on a two
second beat and on every focus and visibility change.** `recheckUnreadable` is
now `recheck` and answers both of the states only the filesystem can clear:

```ts
async recheck(): Promise<void> {
  if (anythingUnreadable(this.diagnostics)) await this.reload()
  if (this.failure !== null && this.edited.size > 0) await this.flush()
}
```

**This is ADR 0061's shape and it is why the retry costs no timer.** That record
made the same argument for the file nobody could read: a lock being released is
not a filesystem event, so `fs.watch` never fires, and the page was already
asking. A read-only attribute being cleared is not a filesystem event under the
model directory either. The two states are the same shape, they clear for the
same kind of reason, and they are now answered in the same place and in the same
line of the same route.

**Rejected: a timer of its own.** That is what ADR 0083 assumed this would cost
and it is what makes it "larger than a sentence": a timer needs an interval, a
backoff, a bound, and a story about what the status line says between attempts.
A request the page already makes needs none of those, and it stops when the page
does, which is the right lifetime: a studio nobody is looking at has `close` to
flush it and no one to tell.

**Rejected: calling `schedule` from the catch.** One line, and the debounce is a
few hundred milliseconds, so it retries five times a second against a disk that
is refusing. The beat is two seconds and is already the rate at which this page
decides things.

**Both gates close themselves.** A flush that lands sets `failure` back to null,
and a read on a session that has never been refused does exactly what it did
before. `edited.size > 0` is the second half and is not redundant: a failure can
stand over a set that has since been written, and a flush is a write plus a
re-read, so an unguarded one would write files nobody edited.

**The sentence changes by four words**, because it is now a promise the studio
keeps:

```
Could not write tables/addresses.md. The edit is still here and this page keeps
retrying it, so clearing whatever the system is refusing is enough and nothing
is lost yet. The write goes through a temporary file in the same folder, which
is why the system names that one first: EPERM: ...
```

`this page keeps retrying it` is 27 characters where `rides out with the next
write` was 28, so ADR 0083's measurement of what this sentence costs the canvas
stands unchanged.

**A refusal that keeps refusing says so once.** The stderr line is written only
when the file it names is not the file the standing failure already names.
Without that, a permission nobody clears writes a line every two seconds for as
long as the tab is open. The comparison is on the path rather than on the
message because `writeAtomically` makes a new temporary file per attempt, so the
message never matches itself.

## Consequences

- **Measured after the change, same machine, same copy, same drag.** The
  attribute cleared, and nothing else touched:

  ```
  --- read-only attribute cleared
  [after clearing +2s] status: Wrote tables/addresses.md at 4:07:24 AM. Undo is git checkout.
  [after clearing +2s] addresses.md on disk: layout: { x: 141, y: 118 }
  ```

  Two seconds rather than six-and-a-drag, and the two seconds is the beat. The
  same run then dragged an unrelated table, which is the counterfactual: it
  wrote `tables/shipments.md` alone and said so, because `addresses` had already
  landed.

- **The server said `failed to write tables/addresses.md` once** across the
  first flush and the beats that followed it, which is the suppression above
  doing its job over a real refusal rather than a mocked one.

- **`recheckUnreadable` is now `recheck`, and ADR 0061 still names the old one.**
  That record is a measurement of a decision taken on the day it was written, so
  it is left as it stands and the rename is named here instead, the way ADR 0083
  left ADR 0039's list of `WireStatus` keys alone and said so.
- **The retry only runs while a page is open and visible.** `peek` returns early
  when `document.visibilityState` is not `visible`, so a minimised tab retries
  nothing until it comes back, and it comes back on the `focus` and
  `visibilitychange` listeners rather than on the interval. A studio with no page
  attached retries nothing at all, which is the state `close` already covers.
- **A `GET /api/model` can now write.** It could already re-read, and a read
  that adopts a directory is the more surprising of the two. What it cannot do
  is write something the session was not already holding: the flush writes
  `edited`, which is only ever filled by a `PATCH` or by a refusal putting its
  own files back.
- **It is one more thing on a route that is asked for on a beat**, so it is one
  more thing that a slow disk can make a read slow. The gate is what keeps that
  from mattering: on a healthy session both conditions are false and the route is
  what it was.
- **`test/studio/write-refused.test.ts` now has the retry, the gate and the log.**
  The retry case calls no flush, which is the assertion. The gate case drags a
  table on a one minute debounce and asserts a read leaves `lastWrite` null, so
  an unguarded flush fails it. The log case takes three beats over a standing
  refusal and expects one line.
- **The `failed to write` line is now once per file rather than once per
  attempt.** A failure whose cause changes on the same file, `EPERM` becoming
  `ENOSPC`, is not logged a second time. The page still shows the current
  message, which is where a person is looking, and the log's job here is to say
  which file is refusing.

## Revisit when

- **A second state gets stuck the same way.** Two conditions in `recheck` is a
  method that answers "what is this session waiting on the filesystem for". Three
  would be an argument for that being a list rather than two `if`s.
- **Somebody runs the studio with no page open and expects a retry.** Nothing
  drives `recheck` then, and the answer would be the timer this rejected, with
  the same questions it rejected it for.
- **A person asks why the log went quiet.** The suppression is deliberate and is
  the one thing here somebody could reasonably want the other way round. A count
  on the line, or one line a minute, are both smaller than reverting it.
- **The beat stops being two seconds.** `HEARTBEAT_MS` is the retry interval now
  as well as the adoption interval, and it was chosen for the second job.
