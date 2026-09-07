# 0061. A read that hangs off the question the page was already asking

Closes the last thing [ADR 0019](0019-the-disk-wins-and-the-studio-says-so.md)
left open about a file another program has hold of, and takes one of the two
answers its own "revisit when" named for `fs.watch` missing a change.

## Context

Take an exclusive lock on `tables/orders.md`, let it go, and touch nothing else.
Measured on Windows 11 with a real `FileShare.None` handle, against a studio
started on a copy of `examples/shop`:

|                                    | revision | unreadable diagnostics |
| ---------------------------------- | -------- | ---------------------- |
| before anything                     | 0        | 0                      |
| locked, after a flush               | 1        | 1                      |
| locked, asked again                 | 1        | 1                      |
| lock released, nothing else touched | 1        | 1                      |
| and again                           | 1        | 1                      |

The last two rows are the defect. **A lock being released is not a filesystem
event**, so `fs.watch` has nothing to deliver, `watch.ts` never fires, and the
session goes on holding the file as unreadable. It does not time out, because
there is nothing in the loop to fire. Editing any other file under the model
directory clears it in one revision, and so does anything else that re-reads.

**What this costs a person is smaller than it looks, and it is worth saying why
before saying what was done about it.** The refusal ADR 0019's second amendment
settled says "try it again once the file can be read", and that advice works:
the retry is a request that re-reads on the way through, so the person who does
what they were told is never stuck. What is left is a diagnostics panel, a
canvas box and an inspector panel all saying an error that is no longer true,
for as long as nobody touches anything. dbmd-dil is that, and it is a P3.

**Doing nothing was a real candidate, and one measurement is what ruled it
out.** Not the wrongness of the sentence, which is small, but the shape of what
it would have cost to fix later. The page already asks `GET /api/model` every
two seconds while it is visible, on `visibilitychange`, and on `window.focus`
(`wireHeartbeat` in `src/studio/client/main.ts`, which landed with ADR 0025).
The item recommended re-reading when the page regains focus **if that is cheap
in this codebase**, and it turned out that the whole of "when the page regains
focus" already exists and has for weeks. The server was the only half answering
out of memory: `snapshot()` returns the session's model and the session's
diagnostics, and the route never asked the disk anything.

So the choice was not between a fix and nothing. It was between one line at the
route and leaving a false sentence standing next to a mechanism already built
to remove it.

## Decision

**`GET /api/model` re-reads the model directory before it answers, and only
while the session is holding a file the reader could not open.**

Three things make that sentence affordable, and they are the whole of the
record.

### It is `reload`, not a second way of adopting a directory

`Edits.recheckUnreadable` calls the same private `reload` the watcher calls. Same
`readModel`, same fingerprint comparison, same `absorb`, same serialising queue.
Nothing about how a read becomes the served model is duplicated or forked.

That matters more than it reads. `src/studio/watch.ts` carries a long comment
about a hole in its filename filter, and the sentence that makes the hole
harmless is that a re-read which produces what the session already serves is
compared, found identical and dropped. **Anything that re-reads more often is a
bet on that comparison.** Going through `reload` is how this stays a bet on the
same comparison rather than a new one: an echo of the studio's own write reaching
this path is answered exactly as an echo reaching the watcher is.

The revision moves only when `shapeOf` moved, which for this case it does: an
object carried forward renders with an `incomplete` prefix and the same object
read back off the disk does not, so a page holding a box drawn from memory is
told to redraw. That is not a special case added for this; it is what
`renderObject` already said.

### The gate is the diagnostics of the read being served, so it closes itself

`anythingUnreadable` in `src/studio/unreadable.ts` is `saidAbout` with the path
taken off. Both answers come from the same two lines, which is the rule that
module exists for: a second way of asking what counts as unreadable is a second
chance for two places to disagree about somebody's disk.

Nothing has to notice that a lock cleared and switch the recheck off. The read
that makes the file readable is the read that removes the diagnostic that was
licensing the next one. dbmd-dil's own warning was "do not poll unconditionally,
only while something is actually unreadable, and stop when it clears", and a
self-closing gate is stronger than a stop condition somebody has to remember to
write.

### The beat belongs to the page, and the studio adds no timer

This is why it is a route change rather than a watcher change. A timer in the
studio would be a thing that runs whether or not anybody is looking; the page's
heartbeat already stops when the tab is hidden (`peek` returns early on
`document.visibilityState`) and already fires immediately on focus, which is the
gesture that follows closing whatever had the file. One request is one directory
read, of tens of files, and only in a state almost nobody is ever in.

**No client change, and that is the finding rather than the shortcut.** A focus
event is a client change and a server route when the page has to be taught to
send one. Here it does not: the request exists, and only the answer was stale.

## Consequences

- **A `GET` can move the revision now.** Only the watcher and a flush could
  before. It is still true that the revision moves only when the files moved, and
  the response that caused it carries the new number, so the caller that
  triggered it is never behind its own request. A caller that was already
  `busy` sets `stale` and adopts later, which is the path ADR 0025 built and not
  a new one.
- **`GET /api/model` can now wait on the flush queue**, because `reload`
  serialises. Only while something is unreadable, and a flush is the thing it
  would be waiting for to answer the same question. It is not on the path of a
  studio that has nothing unreadable, which is measured rather than asserted:
  three requests against a healthy model list the model directory zero times.
- **A file nobody ever unlocks is re-read once per heartbeat, forever.** That is
  the honest cost of the gate being a state rather than a countdown: a permission
  problem nobody fixes is a directory read every two seconds while the tab is
  visible. It is the cheapest of the three options the item listed and it is not
  free, and the reason to accept it is that the alternative is a retry limit that
  would give up on a lock somebody holds for a long lunch.
- **The studio's answer to a `GET` is no longer purely a function of what it last
  read.** Anyone reasoning about a request now has to know that this one route
  can read the disk. It is one line with the reason on it, and it is the only
  route that does.
- **`dbmd studio --no-open` scripted with `curl` gets this too**, which is
  incidental and worth knowing: a script that polls `/api/model` is now a way to
  watch a directory recover, and was not before.

## Revisit when

- **A `GET` is felt to be slow.** It would mean the model directory got big
  enough that a read costs something, and the answer then is the same one ADR
  0019 already parked: narrow the read to the files that carry a
  `file-unreadable`, rather than re-reading everything.
- **A second surface starts asking the same question.** Right now only
  `/api/model` rechecks, because it is the only route the page calls on a beat.
  A second one would be the moment to move the gate into `Edits` as a policy
  rather than leaving it at a call site.
- **The fingerprint stops being how the echo is answered.** `watch.ts` says this
  about its filename filter and it is now true of this too, from a second
  direction: this path re-reads more often than anything else in the studio and
  it is harmless only because a re-read that found nothing costs nothing.
- **Someone wants the stale panel gone without the page being open**, such as a
  second window that is hidden. Then the beat has to come from somewhere other
  than the visible page, and that is the timer this record declined to build.
