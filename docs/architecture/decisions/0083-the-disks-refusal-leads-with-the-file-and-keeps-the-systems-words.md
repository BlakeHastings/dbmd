# 0083. The disk's refusal leads with the file and keeps the system's words

## Context

Every refusal this tool prints says what happened and what to do next. `dbmd
check` on a missing directory names the errno and the diagnostic code. `dbmd
query --engine oracle` lists the engines this build knows. Deleting a table
names the three references it would leave pointing at nothing. A fit that cannot
fit says the zoom stops at 25% and points at the arrow keys (ADR 0075).

One message was not like that, and it is the one you meet when the disk refuses
you.

Measured on 2026-09-08. A studio on a copy of `examples/shop` in a scratch
directory (ADR 0079), `tables/orders.md` given the Windows read-only attribute,
then the `orders` box dragged in Edge at a 1600 by 947 window. The status line
turned bad, correctly, and said:

```
Last write failed: EPERM: operation not permitted, rename 'C:\...\scratchpad\ro\shop\tables\.orders.md.40c0e594-2c47-4a8a-a313-fccd1e307ab9.tmp' -> 'C:\...\scratchpad\ro\shop\tables\orders.md'
```

**Four things about it were right and are not being changed.** The write
genuinely failed. It said so. The tone was bad. And `src/studio/edits.ts` put
the files back in the pending set, so the next flush retried and nothing was
lost; its own comment says that saying nothing here is the failure the writer's
notes warn about.

**Three things about it were wrong.**

It led with `.orders.md.<uuid>.tmp`. That is `writeAtomically`'s temporary file,
an implementation detail of write-then-rename, and it was the first thing a
person read. They never created it and, by the time they read about it, it does
not exist: the writer deletes it on the way out.

The file they were actually editing was at the far end of a long line, after an
arrow, 200-odd characters in.

And nothing told them what to try.

**The obvious fix is the wrong one.** A rename fails from a read-only attribute,
an ACL, a lock another program holds, antivirus, a full disk, or a share that
went away. A message that says "the file is read-only" would be wrong often
enough to be worse than the raw error. `unreadableNotice` already made this
argument for the sibling case and named no cause for the same reason.

## Decision

**The message leads with the file the person was editing, keeps the operating
system's words verbatim, and says the edit is not lost.** Measured, same
studio, same drag, same window:

```
Could not write tables/orders.md. The edit is still here and rides out with the next write, so clearing whatever the system is refusing is enough and nothing is lost yet. The write goes through a temporary file in the same folder, which is why the system names that one first: EPERM: operation not permitted, rename 'C:\...\.orders.md.40c0e594-....tmp' -> 'C:\...\orders.md'
```

Three sentences and then the system's, in that order, because that is the order
the facts are useful in: which file, what it costs you, why the words look like
that, then the words.

**It names no cause.** The list above is why. What can be said without guessing
is which file, that nothing has been lost, and that whatever the system is
refusing is the thing to clear. That last clause is the "what to try", and it is
deliberately about the reader's disk rather than about a diagnosis this program
cannot make.

**The temporary file is explained, and only when there is one.** The sentence
exists to stop `.orders.md.<uuid>.tmp` being a mystery, and a failure that
happens before the temporary exists names the real file and no temporary. Saying
it there would point a reader at a file that never existed, which is the same
defect wearing the other hat.

### Where the shaping happens, and what crosses the wire

**The server sends facts, the page writes the sentence.** ADR 0058 argues for the
decision being separable from the effects, and the rule this page already follows
is `WireConflict.reason`: the server sends the code, the page switches on it, and
a client that reads prose is matching on prose. `staleNotice`,
`unreadableNotice`, `createdNotice` and `conflictSummary` all live in
`src/studio/client/write.ts`, and `writeFailureNotice` is the fifth beside them.

`writeError` is unchanged: it is still the operating system's message and
nothing else, which is the right answer to the `curl` that gets it and to ADR
0039's reading of the API. What is new is one key beside it:

```ts
readonly writeErrorFile: { readonly path: string; readonly viaTemporary: boolean } | null
```

Both facts are the server's alone. The page cannot recover `tables/orders.md`
from a message full of absolute paths without parsing prose, and it cannot know
whether the writer got as far as making a temporary file. They travel as one key
because a page says them in one sentence.

**`writeModel` throws a `WriteFailed` carrying the model's own path.** Only the
job loop knows which of a dozen files the writer was on, and only
`writeAtomically` knows the temporary name; the class is thrown from the second
and re-thrown unchanged by the first, so both facts arrive with the words. Its
`message` is the cause's message, so the existing assertion that a failed write
rejects with `the disk filled up` still holds, and `cause` carries the original.

**The file it names is the one that failed, not the one just dragged.** A flush
writes the whole pending set in path order, so a drag of `addresses` beside a
pending edit to `orders` reports `tables/orders.md`. That was measured before
the change was designed: the first reproduction dragged `addresses` and the
status line correctly named `orders`.

**The `dbmd studio` stderr line changed too**, from `write failed: <words>` to
`failed to write tables/orders.md: <words>`. It now reads like the two refusals
above it in the same function, which say `refused to write <path>: ...`, and
somebody scanning that log is scanning for a file rather than for a verb.

**Rejected: shortening the operating system's message.** The two absolute paths
are most of its length and the temptation is to trim them to basenames. They are
the only part of this that can tell somebody the write went to a network share,
or to a directory they did not think they were in.

**Rejected: shaping it in `edits.ts` and sending a finished sentence.** It would
put prose meant for a person into a payload a script reads, which is the defect
ADR 0058's split and the `staleNotice` record are both about.

## Consequences

Measured in the same DOM at the same moment, by rendering the old string and the
new one into `#status-text` and reading the rectangles back. Edge, the studio on
the scratch copy, `orders.md` read-only, one drag.

| Window | Sentence | Characters | Status line | Canvas |
| --- | --- | --- | --- | --- |
| 1600 x 947 | before | 412 | 2 lines, 32px | 878px |
| 1600 x 947 | after | 670 | 3 lines, 48px | 862px |
| 1200 x 900 | before | 412 | 3 lines, 48px | 815px |
| 1200 x 900 | after | 670 | 4 lines, 64px | 799px |

- **It costs one line, which is 16 pixels of canvas, at both widths.** ADR 0075
  is the reason that number is here: a three line notice there made its own count
  wrong by taking height from the thing it was measuring. Nothing here counts
  anything, and the line appears only when a write has failed, which is the one
  moment on this page when the canvas is not what matters. 16 pixels of 878 is
  1.8%.
- **The line count depends on the path lengths, not on this sentence.** The
  scratch path measured here is unusually long; the system's message alone is 393
  of the 670 characters. In a model directory with a short path the whole thing
  fits in two lines at 1600 wide.
- **The retry is untouched and was re-verified.** With the read-only attribute
  cleared and the box dragged again, the pending edit landed and the status line
  went back to `Wrote tables/orders.md at 12:26:59 AM. Undo is git checkout.`,
  with `layout: { x: 659, y: 506 }` on disk. The stderr log shows three
  `failed to write tables/orders.md` lines and then `wrote tables/orders.md`.
- **`WireStatus` has one more key, and ADR 0039's list of them is now one
  short.** That record measured the `PATCH` response as `lastWrite`,
  `pendingWrite`, `writeError`, `conflicts`, `revision`, which was true when it
  was written. It is a record of a measurement rather than a specification, so it
  is left as it stands and named here instead.
- **`WriteFailed` is exported from `src/index.ts`**, beside `WriteSkip`, because
  a library caller that has to tell somebody a write failed has exactly the
  problem the studio had.
- **Three tests force a real refusal rather than describing one.**
  `test/model/write.test.ts` already mocks `rename`, which is how CI on Linux
  gets a Windows-shaped `EPERM`; the third replaces the target file with a
  directory, so the read that precedes the write refuses first and there is no
  temporary to explain. The wording itself is covered in
  `test/studio/inspector.test.ts` beside the other four sentences.

## Revisit when

- **A second thing on this page starts quoting the operating system.** There is
  one now. Two would be an argument for a shared shape rather than a key on
  `WireStatus`, and the shape would be roughly what `WriteFailed` already is.
- **Somebody asks the studio to retry on its own.** The sentence says the edit
  rides out with the next write, and the next write is the next edit or a close.
  A person who fixes their permissions and then walks away still has an unwritten
  edit, and nothing prompts them. That is a decision about a retry timer, which
  is larger than a sentence.
- **A failure is ever reported for more than one file.** A flush throws on the
  first job that refuses and the rest are never tried, so there is exactly one
  file to name. If the writer ever carries on past a refusal, this becomes a
  list and `conflictSummary` is the shape to copy.
- **The status line gets a second one of these at the same time.** Nothing here
  reasons about a write failure standing beside a conflict list; the failure wins
  outright in `showStatus` and always has.
