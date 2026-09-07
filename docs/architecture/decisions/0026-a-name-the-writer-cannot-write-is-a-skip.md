# 0026. A name the writer cannot write is a skip, and the rule that says so has one home

## Context

ADR 0010 drew a line through `writeModel`: a problem with the model is a
`WriteSkip` the caller can report, and a filesystem that will not accept a write
is an exception, because "a caller that carries on regardless has told the user
their work is saved when it is not".

The line was in the right place and the code did not reach it. `isFileName`
refused the empty string, `.`, `..`, and anything containing `/` or `\`, and an
object failing it was skipped as `unsafe-name`. Everything else went through to
the filesystem, which is where dbmd-15 found that a table called `a:b` throws
`EINVAL` out of the write. An `EINVAL` three frames down carries no object name,
so the one thing the caller needed, which table it was, is the thing it does
not get. A model problem had landed on the exception path.

Measured again while fixing it, on Windows 11 with Node 24, the class is wider
than the colon and stranger:

- `<`, `>`, `"`, `|`, `?`, `*` and every character below U+0020 fail `open` with
  `ENOENT`, and so does a file name of 256 characters.
- **`:` does not fail at all when you write it directly.** `orders:draft.md`
  opens an NTFS alternate data stream on a file called `orders`. `writeFile`
  reports success, the bytes are in no directory listing and no `git status`,
  and nothing anywhere says so. Through `writeModel`'s temporary file it fails
  on the rename with `EINVAL` instead, and leaves a stray `.orders` behind.
- **The writer's own temporary file is longer than the file it stands in for.**
  `.<name>.md.<uuid>.tmp` is 42 characters more than `<name>.md`, so a name that
  fits as a file does not necessarily fit on the way to being one. That was
  found by writing the length rule below and then testing the boundary it
  claimed, which is the only reason it is not still there.

`nul`, `con`, `com1`, a trailing dot and a trailing space were measured too, and
all of them wrote and read back as ordinary files.

The studio survives all of this because `src/studio/safe-path.ts` refuses `:`
first, at the HTTP boundary. So the guard that saved the writer belonged to one
of its two callers, and **dbmd-41 is a third caller with no boundary of its
own**: an importer takes names from a database catalogue, and a name a catalogue
accepts is not automatically a name a file can have. dbmd-44 imported a table
called `Ledger [Entry]`.

## Decision

**A name the writer cannot write is a fact about the model, however far down the
stack it surfaces, so it is a `WriteSkip` and never an exception.** The line
ADR 0010 drew is between the filesystem and the model, not between hard failures
and easy ones. A full disk, a read-only directory and a permission denied are
the filesystem's and still throw. A name no filesystem would accept is the
model's.

**The rule is `isFileName` in `src/model/paths.ts`, and there is one of it.**
It moved out of `write.ts`, where it was private, into the module that already
owns the mapping between a kind and a directory, for the same reason that
mapping is there: the reader, the writer and the studio have to agree on it
exactly, and three copies of a rule are three chances to disagree. It refuses
the empty string, `.`, `..`, the characters above, and a name whose file the
writer could not open. That is a superset of what it refused before, and all but
a subset of what `src/studio/safe-path.ts` refuses: the studio refuses more of
everything except length, where its limit of 255 characters is now the looser of
the two. Nobody will ever type a 230-character table name, and it is still a
reason the two want to become one.

**It answers only "will `open` accept this", and refuses the union across
platforms rather than the local one.** POSIX refuses `/` and NUL and nothing
else, so a table called `Ledger: Entry` imported on Linux is a file nobody can
check out on Windows. A writer whose answer depended on where it ran would also
break ADR 0006's rule that the output is deterministic.

**The two layers stay two, and they are honestly ordered rather than
duplicated.** `safe-path.ts` additionally refuses a trailing dot, a trailing
space and the Windows device names, none of which the filesystem refuses here.
That is suspicion, and suspicion is right at an HTTP boundary where a name comes
from a web page and wrong in the writer, where refusing them would mean a
directory the reader can read holding files the writer will not write back.
`safe-path.ts` should become `isFileName` plus that suspicion, and this record
does not make that change: another agent is in `src/studio/` today, and the
duplication is two regexes rather than two answers.

**`unsafe-name` gets no diagnostic code.** dbmd-23 asked whether it should, or
whether that belongs to dbmd-12, and the answer is neither. A diagnostic is what
a *reader* produces, and no read can produce this one: the filesystem refuses
the name before dbmd is involved, so no model on disk contains an object the
writer would refuse. A code for it would be unreachable in `dbmd check` and dead
in the table `docs/format.md` tests. The `WriteSkip` is the report, and turning
one into a diagnostic is the job of whichever caller built the model in memory:
for dbmd-41, an `import/` code naming the table the catalogue supplied.

## Consequences

- **`writeModel` still takes no options and still cannot be called unsafely.**
  The name rule is not something a caller passes, remembers or opts into, which
  is the property ADR 0010 bought with a required `complete` field and would
  have spent again on the first `{ checkNames: true }`.
- **The length limit is coupled to the writer's temporary file**, and the
  coupling is a constant in `paths.ts` with the arithmetic written out. It is
  pinned by a test that writes a name either side of the boundary, because a
  paragraph would not have noticed the day somebody shortened the UUID.
- **A name that only looks dangerous is written.** `Ledger [Entry]` is a legal
  file name everywhere and is written and read back under that name, with a test
  saying so. A rule written out of fear rather than measurement would have
  dropped a table on import, which is worse than the bug it was avoiding.
- **`docs/format.md` describes both layers and now describes them precisely.**
  It already said the two refuse different amounts; it said the wrong amounts.
- **The studio is unchanged and carries a duplicate of the first half.** Named
  here so that whoever next opens `safe-path.ts` deletes it rather than adding
  to it.

## Revisit when

- **A caller wants to know before it writes.** `isFileName` is exported and an
  importer could ask, but the skip is the better report because it names the
  object, and a caller that asks first will end up with a second copy of the
  message. If it happens anyway, that is a sign the `WriteSkip` needs to carry
  more than a path.
- **A name that the writer accepts still fails to write.** That is this record's
  premise failing, and the fix is another measurement rather than another guess:
  the set above came from running the writes, and the temporary-file case came
  from testing a rule instead of believing it.
- **Somebody wants a model directory on a filesystem stricter than these three.**
  A FAT volume or a zip export refuses more, and the answer is not to tighten the
  writer for everybody: it is that a name a checkout cannot hold is a portability
  problem the model should be told about, which is a `dbmd check` rule and not a
  write-time refusal.
