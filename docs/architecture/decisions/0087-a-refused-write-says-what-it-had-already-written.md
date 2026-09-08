# 0087. A refused write says what it had already written

## Context

`writeModel` writes a model one file at a time, in path order, and stops at the
first file the filesystem refuses. Every file before that one is already on disk
under its real name: the write goes through a temporary file and a rename, so a
job that finished, finished.

The throw did not say so. `WriteFailed` carried the path that refused and the
temporary file behind it (ADR 0083) and nothing else, and the list of what had
been written was a local in the loop that the throw discarded. `dbmd import` did
not catch it at all, so the refusal reached the last-resort handler in
`src/cli/main.ts`.

Measured on 2026-09-08, on Windows, against a build of `main`. The two-table
model in `test/import/fixtures/postgres-raw.json`, imported into a scratch
directory outside the repository; the `notes` column deleted by hand from both
`tables/order_line.md` and `tables/orders.md`, so both files need a rewrite; then
`attrib +R` on `orders.md` alone. Sorted by path, `order_line.md` is written
first and `orders.md` refuses second.

```
$ dbmd import --file schema.json --dir db-model --confirm
dbmd: EPERM: operation not permitted, rename 'C:\...\db-model\tables\.orders.md.e93ee33d-....tmp' -> 'C:\...\db-model\tables\orders.md'
$ echo $?
1
```

**Afterwards `order_line.md` had the column back.** The command's entire output
is one error about the other file, and a developer reading it has no reason to
think their tree changed at all. It had. In `--json` the same run was worse,
because there is not even a directory in it to go and look at:

```
{ "schema": 1, "ok": false,
  "error": { "code": "failed", "message": "EPERM: operation not permitted, rename '...' -> '...'" } }
```

Two defects, and only one of them is about wording. `dbmd export` had the same
message defect and ADR 0083 fixed it there, in a shape this could copy: lead with
the file the person was editing, name no cause, keep the system's words, explain
the temporary file rather than hiding it. But that record's sentence is "Nothing
was changed", and it is true there because `export` writes exactly one file. It
is false here, and no wording can make it true: the report has to say what
actually happened, and until now the writer did not tell it.

## Decision

**`WriteFailed` carries what the write had done when it stopped**: `written`,
the files already on disk, and `skipped`, the objects the writer declined, which
are the same two lists a `WriteResult` returns. The loop is the only frame that
holds them and the throw is the only thing leaving it.

**The writer's own behaviour does not change.** It still stops at the first
refusal and still tries nothing after it. What changes is only what the throw can
be asked afterwards, which keeps ADR 0083's note that exactly one file refused,
so exactly one is named.

**Rejected: returning a result that carries a failure instead of throwing.** It
is the tidier type and it changes every caller, including the studio, whose
handling of a failed write is a measured, browser-tested surface (ADR 0083). The
whole defect is that one caller could not answer a question; making three callers
rewrite their control flow to answer it is not proportionate, and `writeModel`'s
own notes argue for the throw: a filesystem that will not accept a write is not a
diagnostic about the model, and a caller that carries on regardless has told the
user their work is saved when it is not.

**Rejected: `dbmd import` re-reading the directory to work out what landed.** The
files are there and could be listed. What could not be recovered is which of them
this run put there, which is exactly the thing worth saying, and a directory read
after a failure would report the nine files that were already correct as though
this run had written them.

**`dbmd import` reports the refusal itself**, in ADR 0083's shape, with the
middle sentence replaced by what happened. Measured, same reproduction, same
machine, on this branch:

```
dbmd: Could not write db-model/tables/orders.md, and 1 file had already been written:
  tables/order_line.md
db-model has some of the changes this run was confirmed to make
and not the rest.
Clear whatever the system is refusing and run the same command again.
What landed is not a change any more, so the list it makes will be shorter.
The write goes through a temporary file in the same directory, which is why the
system names that one first: EPERM: operation not permitted, rename 'C:\...\.orders.md.727a5a9b-....tmp' -> 'C:\...\orders.md'
```

Exit 1, which is the code this command's own `--help` already promised for "a
table could not be written".

**The last sentence is a claim, so it was run.** With the read-only attribute
cleared, the same command again reported one change rather than two, wrote
`tables/orders.md`, and exited 0.

**What to do next is a different sentence on each half of the command, so it is
two sentences.** A first import that lands part of a model has left a directory
that is no longer empty, so the run after it is a re-import and needs
`--confirm`; a re-import that lands part of its changes just makes a shorter
list. Saying "run the command again" alone would be true and would send the first
reader into a delta they did not expect. Where nothing landed at all, the report
says so and stops, which is `dbmd export`'s sentence and is true in that case.

**`--json` gets the same two facts under keys that already mean them.** `files`
is what this run wrote, which is what `files` means on the reports where it
finished, and `error` is `write-failed` with the refused file beside the message:

```
"files": ["tables/order_line.md"],
"error": { "code": "write-failed", "file": "tables/orders.md", "message": "EPERM: ..." }
```

`removed` is `[]` and is there rather than omitted, because the deletions a
confirmed re-import makes happen after the write and this run never reached
them: the files listed for deletion are all still on disk, and the text says so
on a run that had any.

## Consequences

- **The temporary file is still in the message and is still explained**, and the
  explanation is now conditional. `writeModel` can refuse at the read that
  precedes a write, where there is no temporary file, and ADR 0083 says a
  sentence about one there would point at a file that never existed. `dbmd
  export` cannot reach that case and does not have the branch.
- **`dbmd import --help` gained a paragraph** under the exit codes, because a run
  that leaves a directory half written is a contract, not a message.
- **The studio ignores both new fields, and this is where it is written down that
  it could not.** `src/studio/edits.ts` catches `WriteFailed`, names the file on
  the status line and retries. Measured on 2026-09-08 with two pending files and
  one of them refused: the flush reports `lastWrite: null`, although
  `tables/addresses.md` had landed, and the retry records a `changed` conflict
  against that file, because the studio wrote it and its baseline is still what
  the disk said before. Nothing is lost either way and the edit is on disk. Both
  are now answerable in a line each from `error.written`, and doing it changes
  what a person sees on a page, which wants its own measurement in a browser.
  `test/studio/write-refused.test.ts` pins the behaviour as it stands, including
  those two, so a fix has a test to update.
- **Two constructor parameters with defaults**, so `writeAtomically` and
  `dbmd export` are untouched: `export` writes one file, it has no progress to
  report, and an empty list is the truth there.
- **The loop rebuilds the refusal rather than mutating it.** `WriteFailed` stays
  a value whose fields are `readonly`, and the rebuild is around the same cause,
  so the message a reader sees is the same string either way.

## Revisit when

- **A third caller writes a model.** Two callers and one of them needing progress
  is what makes a field on the throw the proportionate answer. Three, with two of
  them branching on it, is the argument for the result type this rejected.
- **The studio starts using `written`.** The two measurements above are the work,
  and the page is where the answer has to be seen. That is the follow-up this
  record deliberately did not take.
- **A writer ever carries on past a refusal.** ADR 0083 already names this: the
  status line's sentence names one file because one file refused. A writer that
  tried the rest would make `written` a list beside a list of failures, and this
  record's shape would have to change with it.
