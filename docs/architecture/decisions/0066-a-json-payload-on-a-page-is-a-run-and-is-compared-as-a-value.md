# 0066. A JSON payload on a page is a run, and it is compared as a value

## Context

Four pages show a `--json` report in a plain ` ```json ` fence: `README.md`
shows `dbmd check --json`, `docs/import-format.md` shows `dbmd query --json`
twice, `docs/ci.md` shows `dbmd export --json` three times, and
`docs/format.md` shows `dbmd refs --json` four times. Ten blocks. **Nothing read
any of them.**

That was not an oversight anybody could see. Three mechanisms already read
fenced blocks on those pages and every one of them matches its own info string:
`test/docs/format.test.ts` reads ` ```markdown dbmd: ` and
` ```markdown dbmd-error: `, `test/import/docs.test.ts` reads
` ```json dbmd-import:<tag> `, and `test/docs/readme.test.ts` reads
[ADR 0056](0056-a-block-in-the-readme-is-a-run-or-a-sketch.md)'s four. A plain
fence is none of those, so a payload could be pasted onto any of these pages and
land in the one shape the build has no opinion about.

**The same failure is already realised one item away.** `README.md` says the
PostgreSQL introspection query is 9827 characters. It is 12403, off by a
quarter, on the front page, in a plain fence, and it drifted for as long as
nobody ran it (dbmd-53w). A payload is worse than a number, because a reader
does not merely believe it, they write code against it. A renamed field or a key
that moved is a caller that breaks and a page that says it should not have.

ADR 0056's revisit list says a third page carrying output blocks is the moment
to lift the parser out of the two tests rather than copy it again. The parser is
not what was copied here: a plain fence needs three lines to find and the two
existing readers are looking for tags this one must not match. What was
copied, deliberately, is the shape of the argument.

## Decision

**Every plain ` ```json ` fence on those four pages is a report a command
printed, and `test/docs/payloads.test.ts` runs the command and compares.** Ten
blocks, one case each, plus six sentences those pages write about reports they
do not show.

**The blocks carry no tag, and the cases name the commands instead.** A tag
answers *how do I read this block*, which is the question ADR 0056 had: a
session, a file, and a sketch are three things one page was showing without
saying which. A `--json` payload has one reading. What an author would have to
write into the tag is the command line, flags and all, which is long and is
already written in the prose above every one of these blocks.

**What a tag buys is exhaustiveness, and that is bought by counting.** Every
plain ` ```json ` fence on the four pages must be claimed by exactly one case,
and the pairing is positional. A block added, removed or moved fails with the
line number of every fence on the page beside the command list, so the failure
says which one is new. This is ADR 0056's "an untagged fence is an author who
has not answered that yet", arrived at without asking the author to write
anything into the page.

**The comparison is the JSON value and not the bytes.** Both sides are parsed
and re-serialised at one indent before they are compared, so key order, the key
set and every value are still held exactly, and the only thing given up is
whitespace.

`README.md` is why. It is the one of the four pages Prettier formats:
`.prettierignore` holds it off `docs/` but not off the root, and ADR 0056
already records Prettier rewriting the inside of a fenced block on this page,
turning `default: "0"` into `default: '0'` in a block claiming to be a file. It
has done it again to the `check --json` payload, collapsing
`"counts": { "errors": 1, "warnings": 0 }` onto one line where dbmd printed four,
and the same for `at`. **A byte comparison would fail on that block today**, and
the fix would be either a `<!-- prettier-ignore -->` above it or a reformat of a
page whose owner has it open. Neither is worth having, because a JSON document's
claim is its keys, their order and their values, and the collapsing is invisible
to every reader of the page and every caller of the CLI.

**One block is honestly a prefix and says so inside itself.** The whole
introspection query is 12403 characters and does not belong on a page, so
`docs/import-format.md` shows the first four lines of `sql` and ends the string
with `[cut here, and only here: 12403 characters in all]`. That case compares
every other key whole and in order, checks that the live `sql` still opens with
what the page shows, and **reads the number back out of the marker and checks it
against the length of the real query**. The sentence inside the string is the
dbmd-53w defect verbatim, and it is now the same measurement as the payload
around it.

**The fixtures are built from `examples/shop` on every run and never committed.**
`docs/format.md`'s second block is that model half way through a rename, with
`tables/addresses.md` deleted and nothing else touched. A committed copy is a
second thing to keep in step by hand, which is the failure this file exists to
stop. `examples/shop` is copied and never read in place or written to: the owner
works in it, and `dbmd export` writes a `README.md` into the directory it is
given.

**One fixture is committed, because it is not a copy of anything.**
`test/fixtures/db-model/` is a two-file model with one broken `ref:` in it, and
it is what `README.md` and `docs/ci.md` are both looking at when they show a run
that failed. Both pages show a command given no directory at all, so it is
copied into the sandbox under `db-model`, which is the default
(`src/cli/check.ts`), because otherwise the report's `directory` would not be
that word.

**The sentences are checked as well as the fences.** Six claims these pages make
in prose with no block at all: that `characters` is `sql`'s own length for both
engines and is the two numbers the page names, that a second export of an
unchanged model returns the same keys with `written: false` and `ok: true`, that
the intact directory reports the `addresses.superseded_by` ref the mid-rename
copy lost, that a table nothing points at is `exists: true` with an empty
`incoming` and exit 0, that a directory typed before the table is
`no-such-table` on exit 1 rather than a usage error on exit 2, and that `--json`
carries the same exit code as the text form. Those are the reason for a second
key or a second exit code, so they are what a caller is most likely to have
built on.

## Consequences

- **The guard has been seen to fail, as [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
  requires**, in six shapes. A value edited in a block (`relationships` 11 to 12)
  fails with a diff. The dbmd-53w defect fails in all three places it could
  live: the `characters` key, the number inside the cut marker, and the two
  numbers in the prose. A new plain ` ```json ` fence appended to `docs/ci.md`
  fails the count and names its line. Renaming an emitted key in
  `src/cli/refs.ts` fails the block that shows it. Skipping the deletion that
  makes the mid-rename fixture fails both the block and the sentence about it.
- **It costs about 190 milliseconds** and no build: the commands run in process
  through `test/cli/harness.ts`, the way `test/docs/readme.test.ts` runs its
  sessions.
- **`process.chdir` is used and is global to the worker.** It is restored in an
  `afterAll` before the sandbox is removed. `test/docs/readme.test.ts` has the
  same assumption for the same reason, and vitest runs one file at a time per
  fork.
- **The sandbox is built at file level rather than inside a `describe`**,
  because two of them run commands in it and a `describe`'s `afterAll` would
  take it away before the second started.
- **`README.md` was not edited and its payload block passes.** It is the block
  Prettier collapsed, and the decision above is what lets it pass without
  anybody touching a page the owner has open.
- **`README.md`'s 9827 is still wrong.** This file makes the number checkable
  and checks it where it appears in `docs/import-format.md`, three times. The
  sentence on the front page is dbmd-53w and is left to dbmd-53w.
- **A payload that needs a fixture nobody has is now a visible cost**, not a
  quiet paste. That is the intended shape: the page and the fixture arrive
  together or the block does not go on the page.
- **The count is per page and positional**, so moving a block within a page
  passes and moving it to another page fails. That is the right way round, since
  the case names the command rather than the position.

## Revisit when

- **A payload block wants a non-zero exit code the page does not state.** Every
  case carries the code as data today because all four pages state it in prose
  beside the block. A block whose code is unstated is a page that has stopped
  saying half of what the report is.
- **A fifth page starts showing a payload.** Adding it is one line in `PAGES`
  and its cases, and the moment to check that the positional pairing is still
  the right pairing rather than a fingerprint.
- **Prettier stops collapsing short objects, or starts formatting `docs/`.** The
  first removes the reason the comparison is a value; the second makes it the
  reason for all four pages rather than one. Neither changes the decision, and
  both should be noted here rather than discovered again.
- **A block needs a key held loosely**, the way ADR 0056 holds `layout:` as a
  key and not a value. Nothing here has one and nothing should get one without
  the argument that exception has: a value a person changes on purpose does not
  belong in an exception, because then the page can be wrong about it and
  nothing says so.
