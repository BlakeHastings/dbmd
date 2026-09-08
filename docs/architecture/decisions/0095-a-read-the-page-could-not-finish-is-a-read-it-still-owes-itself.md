# 0095. A read the page could not finish is a read it still owes itself

Takes the shape [ADR 0061](0061-a-read-that-hangs-off-the-question-the-page-was-already-asking.md)
and [ADR 0092](0092-a-refused-write-is-retried-on-the-beat-the-page-already-keeps.md)
already built, in the one direction neither of them covered: the page's own
read, rather than the server's.

## Context

[ADR 0025](0025-an-edit-names-the-model-it-was-made-against.md)
gives the page a revision to compare against and a two second beat to compare on,
and says in as many words why the session's own writes do not move that number:

> A revision moves only when a re-read found something the session did not
> already know, which by construction is exactly "the picture you were shown is
> no longer what the files say". The session's own writes do not move it, so an
> ordinary editing session never trips over it.

That is right, and it is load-bearing: a counter that moved for the studio's own
write refused the very next character typed into the column the developer had
just added, which is the defect that record has already been through once.

**The consequence nobody had followed through is what happens when the page's
own re-read does not answer.** A create, a delete and a rename move a file
rather than editing one, so each of them ends in `reload()` and adopts what the
reader found (ADR 0021). `reload` caught a read that failed, wrote a line into
the status element and returned. Nothing after that would ever put the new model
on screen: the revision has not moved, because the thing that changed the
directory was this session, so every beat afterwards compares equal and adopts
nothing.

Measured on 2026-09-08 in Chromium at 1600 by 947, against a throwaway copy of
`examples/shop` outside the repository (ADR 0079), with the page's reads of
`/api/model` refused for the length of one delete and answered normally
afterwards:

```
[before anything] {"revision":0,"tables":8}
[delete landed, read refused] status: Deleted tables/subscriptions.md. Undo is git checkout, if it was committed.
[delete landed, read refused] {"revision":0,"tables":7}
[delete landed, read refused] box still drawn: true
--- reads are answered again
[+2s]  box still drawn: true
[+10s] box still drawn: true
--- tables/products.md saved from outside
[after an unrelated save] box still drawn: false
```

The revision is 0 on both sides of a delete that took the model from eight
tables to seven, which is ADR 0025 working. What follows it is not: the box for
a file that no longer exists was still on the canvas ten seconds after the reads
were being answered again, under a status line saying the file had been deleted,
and only a save nobody in this story made cleared it.

**That run was taken before ADR 0094's branch landed**, which is why the status
line in it is the plain `Deleted ...`. That branch has since made the same
sentence say the read failed too, and it changes nothing about the rows under
it: the box is the measurement, and a sentence saying the canvas is behind over
a canvas that stays behind for ever is the same defect better narrated.

**It is not the recheck ADR 0061 added, and that was worth measuring rather than
assuming.** That one re-reads on `GET /api/model` while the session is holding a
file it could not open, and ADR 0092 added the other half, a refused write
retried on the same beat. Both are the server answering a request the page was
already making. Here the server is right about everything and has nothing to
recheck: the model it serves is seven tables, the revision it serves is honest,
and the page is the one holding a picture it knows it meant to replace. Neither
gate is even open, because nothing is unreadable and no write failed.

## Decision

**A read that did not answer sets `stale`, which is the page's word for "the
picture is older than the disk", and the beat already retries what that word
stands for.**

```ts
} catch (error) {
  showLine({ text: `Could not read the model: ${messageOf(error)}`, tone: 'bad' })
  stale = true
  return messageOf(error)
}
```

`peek` asks `catchUp` about a debt it is holding on every beat, on
`visibilitychange` and on `window.focus`, and `catchUp` re-reads unless
something on the page is in the middle of happening. So the read is owed rather
than lost, and it is paid at the first moment it is safe to redraw.

**`stale` now stands for two things and they are the same thing.** It was "the
server is ahead of what this page drew"; it is now that, or "this page tried to
draw what the server has and could not". Both mean the picture is older than the
disk, both are answered by the same re-read at the same moment, and the sentence
the status line already says about the first is true of the second: this page is
still showing what you were working on, and will catch up when you are between
edits.

**Rejected: moving the revision for the session's own edits.** It is the obvious
fix, it would make the beat notice on its own, and ADR 0025 has already paid for
finding out why not. A revision that counts what the session did is a revision
that refuses the session's next edit.

**Rejected: a retry inside `create`, `remove` and `rename`.** Three call sites
each remembering to retry their own read is exactly the shape ADR 0074 called
"a convention, not a guard", and it left the same hole open for the next path
that writes without going through the writer. One line in the function all three
already call covers every caller it has, including the ones that do not exist
yet.

**Rejected: a timer of its own, with a backoff and a bound.** ADR 0092 rejected
it for the write and every word of that argument holds here: a request the page
already makes needs no interval, no bound, and no story about what the status
line says between attempts, and it stops when the page does.

## Consequences

- **Measured after the change, same machine, same copy, same delete, on top of
  ADR 0094's branch:**

  ```
  [delete landed, read refused] Deleted tables/subscriptions.md. Undo is git
        checkout, if it was committed. The page could not re-read the model
        afterwards, so the canvas is still showing what it drew before: Failed
        to fetch.
  [delete landed, read refused] {"revision":0,"tables":7}
  [delete landed, read refused] box still drawn: true
  --- reads are answered again
  [+2s] box still drawn: false
  [+2s] Deleted tables/subscriptions.md. Undo is git checkout, if it was committed.
  ```

  Two seconds rather than never, and the two seconds is the beat. The two
  changes are visible in one line each: the middle clause is that record's, and
  it comes off because the read this record arranges is the read that falsifies
  it. Before either of them the page said only the first sentence, over a canvas
  that stayed wrong for as long as the tab was open.

- **A model directory that never becomes readable is asked for once per beat,
  forever, while the tab is visible.** That is ADR 0061's cost in a second
  place, for the same reason and with the same answer: it is cheaper than a
  retry limit that would give up on a share somebody reconnects after lunch,
  and it stops when the tab is hidden.

- **What the page says in that window belongs to
  [ADR 0094](0094-a-mode-holds-the-status-line-for-as-long-as-the-mode-lasts.md)'s
  branch rather than to this one, and the two halves meet in `reload`.** That
  one landed the same day and made a create, a delete and a rename say both
  facts: what they wrote, and that the page could not re-read afterwards so the
  canvas is still showing what it drew before. This is the half that makes the
  second of those stop being true, and the clause is taken back in `adopt` by
  the read that falsifies it, which is now the read this record arranges to
  happen. A page told its canvas is behind, with nothing that would ever catch
  it up, is the worse version of both changes.

- **The evidence is a browser run and there is no test.** ADR 0015 puts the DOM
  and the event handling behind driving the studio, and `main.ts` is the page's
  wiring: a double for a fetch that fails would prove the double works. What is
  provable without a browser is prose, and this change is not prose. Said here
  the way ADR 0074 said it about its own weaker half.

## Revisit when

- **A third thing makes the page owe itself a read.** Two reasons behind one
  boolean is a boolean; three is an argument for the reasons being a set, and
  the first sign will be a status sentence that has to know which one it is.
- **Somebody wants the failed read said in the page's own words.** It quotes the
  fetch's message today, which is a network error in a browser's phrasing, and
  every other sentence on this page has been through the opposite treatment.
  What stopped it here is that the page cannot tell a studio that has stopped
  from a laptop that slept, and a sentence that guessed would be the mistake
  ADR 0019's amendments keep removing.
- **A create or a delete has to work while the reads never come back.** Then the
  answer is the page keeping what it did and applying it to its own copy, which
  is a second source of truth about the model and is what ADR 0004 refuses.
