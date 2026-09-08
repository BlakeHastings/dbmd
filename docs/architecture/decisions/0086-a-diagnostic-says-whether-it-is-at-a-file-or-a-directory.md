# 0086. A diagnostic says whether it is at a file or a directory, and the summary counts what it was told

## Context

`dbmd check` closes with one sentence that says how far the damage spreads:

```
db-model: 1 error across 1 file.
```

It was produced by counting distinct headings and printing the number followed
by the word "file". A heading is `at.path` taken verbatim, and every model
diagnostic said `at: { in: 'file', path }`, so the sentence read as if the reader
had vouched for the claim. It had not: `inFile` was the only constructor there
was.

Measured on 2026-09-08, driving the built CLI. A model with a `views/` beside its
`tables/`, and a `tables/archive/` with markdown under it:

```
$ dbmd check m
tables/archive
    error    `archive/` is a directory inside `tables/`, and dbmd reads only the files directly in `tables/`, so `tables/archive/_model.md` is not a table; move the markdown up into `tables/` (object-in-subdirectory)

views
    warning  `views/` is not a kind of object dbmd knows; its files are ignored (unknown-kind-directory)

m: 1 error and 1 warning across 2 files.
exit 1
```

Zero files are involved. Both diagnostics are about directories and both say so
in their own text, one word into the message. The summary then adds them up as
files.

Two shorter forms of the same thing. A model directory that is not there:

```
$ dbmd check nowhere-at-all
nowhere-at-all
    error  cannot read the model directory: no such file or directory (ENOENT) (model-directory-unreadable)

nowhere-at-all: 1 error across 1 file.
exit 1
```

And a kind directory that cannot be listed raises `file-unreadable` whose own
message reads `cannot list the directory:`, at a path that is a directory.

**Two genuinely broken markdown files produce "across 2 files", and it is true.**
That is the common case, it is what the sentence was written for, and it is why
this survived.

## Decision

**`DiagnosticLocation` gains a third variant, `{ in: 'directory', path }`, and
the model reader uses it for the four codes that are about a directory.**
`model-directory-unreadable` (`.`), `unknown-kind-directory`,
`object-in-subdirectory`, `object-not-a-file`, and the `file-unreadable` that a
kind directory raises when it cannot be listed. `kind-not-a-directory` keeps a
file location, because there a plain file really is what is on disk and the whole
message is about it.

There is deliberately no `line`. A directory has none, and the point of ADR
0014's union is that a consumer wanting to open an editor at a line has to ask
first and can only ask a location that has one.

**`dbmd check` counts per kind and names each one.** "2 files" when they are
files, "2 directories" when they are directories, "1 file and 1 directory" when
it is both. A kind with none of them is left out rather than written as
"0 documents".

### What was rejected, and why

**One noun for all of them, "2 paths".** Every heading is a path, so it is never
false, and it is one line of change. It is also worse for the common case, which
is the case a person actually reads: "across 2 files" over two broken table files
tells them more than "across 2 paths" does, and this repository's own pages quote
that sentence. `README.md` and [`docs/ci.md`](../../ci.md) each show a run whose
`across 1 file` is true, and the one-word rename would have made both of them
wrong.

**Counting kinds in `dbmd check` by asking the filesystem.** It has the directory
and the heading, so a `stat` would answer. It would also be a second source of
truth about the disk, racing the read that produced the diagnostic, and the
reader already knew the answer at the moment it complained. Lens 3's question,
whether the single source of truth is still single, answers this one.

**Leaving the JSON alone and fixing only the printed sentence.** Nothing in the
JSON carries a file count, so the visible falsehood is in the text form. But
`"in": "file"` over a directory is a claim too, and it is the claim the text form
was reading when it got this wrong. Fixing the sentence and leaving the field
would have left the next reader of the payload to make the same mistake.

## The JSON contract

ADR 0006 makes these shapes public API and says adding a field is fine and
renaming one is breaking. Adding a variant to a discriminated union is neither,
so it is worth being exact about what moves.

**No payload that was correct changes.** A diagnostic about `tables/orders.md`
is byte-identical before and after. The five that change are the five that were
saying something untrue, and a consumer reading `at.in` was already being lied to
about them.

**`schema` stays 1.** A consumer that switched on `at.in === 'file'` and treated
everything else as a document now meets a third value; it was previously handed
`file` for a directory, which is not a better answer, and there is no version of
this fix that leaves such a consumer both working and correct. `docs/format.md`
and [`docs/import-format.md`](../../import-format.md) both say what the shapes
are, and `test/diagnostics.test.ts` holds one of each and tells them apart.

## `model-file-missing` keeps its file location, and that is on purpose

`dbmd check` on an empty directory says "1 warning across 1 file" about a
`_model.md` that is not there. The file does not exist and the sentence still
says file, which looks like the same defect and is not.

`model-file-missing` is about a path a file has to be written at. Its whole
message is "add one with `kind: model`, a `name:` and an `engine:`", ADR 0068 is
the argument for naming that fix, and the location is where the fix goes. A
directory location would say the opposite of what the diagnostic means. So the
count says one file, and what it counts is one file's worth of problem, not one
file on disk.

## Consequences

- **Adding a model diagnostic now means choosing a location kind**, and the
  choice is the same question the message answers: is this about a file or about
  a directory. `inFile` and `inDirectory` sit beside each other in
  `src/diagnostics.ts` so the choice is visible at the call.
- **`src/studio/unreadable.ts` asks for both.** It matches `file-unreadable` on a
  file *or* on the kind directory containing it, which is a rule it already had
  and stated; it now spells the test as "not a document" rather than "is a file".
  The set of diagnostics it matches is unchanged.
- **The summary sentence has three shapes rather than one.** That is the cost of
  the first rejected option above, paid in `scope()` in `src/cli/check.ts`, which
  is nine lines and a table of nouns.
- **`plural` takes an irregular plural.** "directory" does not take a bare `s`,
  and the alternative was choosing the project's nouns to suit a helper.

## Revisit when

- **A location needs a kind that is neither of these.** A symlink is the obvious
  candidate and is deliberately not one today: ADR 0038 and ADR 0040 both decided
  that what matters about a link is what it resolves to, so a link to a directory
  is a directory here.
- **A consumer outside this repository reads `at.in`.** There is none today. If
  one appears, the version field ADR 0006 put on every payload before it was
  needed is what a change like this one should move next time.
