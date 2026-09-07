# 0020. What `dbmd check` fails on

## Context

Every part of `dbmd check` was decided somewhere else. ADR 0008 gave the reader
a list of diagnostics and a promise never to throw, 0017 gave the validator a
second list over the same type, 0014 made that one type, and 0011 gave a command
one way to write and one value carrying the exit code, the prose and the JSON.
This command is the join.

What none of them decided is the thing a team actually installs this command
for: **when the run fails.** ADR 0017 said so in as many words, and said why it
was not answering it: "Severity is a fact and stopping is a decision, and this
module only produces facts. That errors fail a run, warnings print, and
`--strict` promotes is dbmd-21's, because it is a property of a command line
rather than of a model."

Three questions came with it, and each one has a wrong answer that looks
reasonable in a diff.

- **Does a warning fail?** A validator that emits `primary-key-missing` and
  `group-empty` as warnings has already decided they are not fatal. A check that
  fails on them anyway is a check a team takes out of CI within a week, and a
  linter nobody runs is worse than none.
- **Does a file that did not parse stop the run?** The obvious shape, read then
  validate, invites `if (hasErrors(read)) return` between the two lines. It
  passes review, it passes its tests, and it turns a repository with one broken
  file into a report about one broken file.
- **Does `--strict` change the diagnostics or only the outcome?** Promoting a
  severity where it is easiest to promote it, on the way into the JSON, makes
  `--json` say a warning is an error, which is a lie about the model told by a
  flag about a run. ADR 0006 makes that shape public API on the day this ships.

## Decision

**The boundary is severity, and `--strict` moves it.** A run fails when it
produced at least one `error`; with `--strict`, when it produced at least one
diagnostic of either severity. A failing run exits `1`. `2` is reserved for what
it already means in this CLI: the command line was wrong and nothing ran. There
is no third code, and in particular a run that found warnings and was not asked
to be strict exits `0` and prints them, because that is the difference between a
gate and a report and this command is both depending on the flag.

**Both halves always run, and they are one list.** `readModel` returns a model
and diagnostics and never throws, so `validate` is called on whatever loaded, in
every case, including the case where nothing did. The two lists are concatenated
and sorted once with `compareDiagnostics`. There is no branch between the reader
and the validator and there must not be one: a file that failed to parse is
missing from the model, which the validator handles by ADR 0017's suppression
rule, and the other nine tables still deserve an opinion about their refs. The
run reports every file it could say anything about, which is the property the
work item cares about most.

A consequence worth naming: a broken table file also produces `ref-table-unknown`
from every ref pointing at it. ADR 0017 already recorded that pair as true,
adjacent in the sort, and not worth changing `Model` to fix. This command
inherits it rather than papering over it.

**The payload carries facts and the envelope carries the policy.** Each
diagnostic goes into `--json` exactly as its producer wrote it, `severity`
included, under `--strict` as much as without it. What `--strict` changes is the
exit code, and `ok` is derived from the exit code by ADR 0011's envelope, so a
consumer branching on `ok` and a consumer branching on `$?` get the same answer
and neither has to re-implement this policy. `strict` and the counts are in the
payload so that a consumer can see *why* a run of warnings failed without
comparing two arrays.

**A missing model directory is a diagnostic, not a usage error.** `dbmd studio`
refuses one, because opening a canvas on a directory that is not there would
invent files somewhere nobody meant. `dbmd check` has nothing to invent: the
reader already says `model-directory-unreadable` as an error, it sorts and
prints and exits like every other error, and `2` would tell a CI log that
somebody typed the command wrong when what happened is that a path is wrong in
the repository. The one liberty taken is cosmetic: the reader points at the
model directory as `.`, and a heading of `.` above "cannot read the model
directory" is a riddle, so the heading is the directory the caller named.

**Diagnostics are grouped under the file they are in, and the columns are as
wide as the run.** The file is a heading printed once rather than a prefix
repeated on every line, because the thing a reader wants from a run over four
broken files is the shape of the damage and repeated paths bury it. Line number
and severity are padded to the widest in the whole run rather than per block, so
one file with no line numbers does not shift the block after it and the
severities read as a column down the terminal. This is the text form, so ADR
0006 leaves it free to be reworded; `--json` is the half that is a contract.

## Consequences

- **`dbmd check --json`'s payload is public API from this commit**, per ADR
  0006: `directory`, `strict`, `counts.errors`, `counts.warnings`, and
  `diagnostics`, inside ADR 0011's `{schema, ok, ...}` envelope. The diagnostics
  are ADR 0014's shape unaltered, which is the whole reason that record exists,
  and there is no translation layer to keep in step with it.
- **Warnings not failing means warnings accumulate.** That is the trade, and
  `--strict` is the escape for a team that would rather not have it. The signal
  that it was the wrong call is a repository where `dbmd check` is green and
  nobody has read its output for a month.
- **Volume is still the reader's problem, not this command's.** One invalid file
  can produce forty true diagnostics because a broken flow sequence swallows the
  rest of the document. ADR 0017 already decided that a cap belongs at the one
  call site that cascades, in `parseFrontmatter`, and explicitly not in the
  presentation layer. Grouping by file makes a cascade look like a cascade, which
  is the most this command should do about it; dbmd-24 is the item.
- **There is no `--quiet` and no summary-only mode.** ADR 0011 already answered
  this: the text form is narration on stderr, so `2>/dev/null` is the quiet flag,
  and what is left is the exit code, which is what a CI step reads anyway.
- **`dbmd check` exits 0 on an empty directory**, with a `model-file-missing`
  warning. That is the reader's severity and this command does not second-guess
  it; `--strict` is how a team that disagrees says so.

## Revisit when

- **A caller wants to fail on some warnings and not others.** `--strict` is one
  bit and the next thing asked for is per-code severity, which is a
  configuration file and a decision of its own. The evidence will be somebody
  running `dbmd check --json | jq` to build the policy this command refused
  them.
- **Something needs a machine-readable count without the diagnostics.** The
  payload carries both today because it is small. A model big enough for that to
  matter is a model where somebody wants `--summary`, and that is where to argue
  it.
- **A third exit code becomes tempting.** "Warnings only" as its own code is the
  candidate, and it would be a breaking change to every script that treats
  non-zero as failure, so it needs to be worth that.
