# 0091. A page does not hold its own body twice

## Context

`docs/process/verified.md` is this repository's evidence log: what was checked,
by whom, on what day, and what it showed. On 2026-09-08 it was found holding its
own body three times over. The duplication arrived in
[#220](https://github.com/BlakeHastings/dbmd/pull/220) two days earlier, a pull
request whose description said it was a sweep of entries later work had
overtaken and whose diff was `+3688`. The file sat at 5885 lines, of which
roughly two thirds were a copy of the other third. It grew by another six
hundred lines afterwards, on top of the duplicate, before anybody read it.

**Nothing in the review or the gate looked at it, and neither was careless.**

A duplicated markdown file has no tests to fail. It typechecks by not being
typed. Prettier formats a repeated paragraph exactly as happily as a unique one,
and `docs/` is in `.prettierignore` anyway, so even that much was not running.
The one signal available to a reviewer was a diff too large to read, which is the
signal a sweep of a 2800-line evidence log is supposed to produce. There was
nothing inconsistent to notice, which is the same shape as the defect
[ADR 0036](0036-a-command-in-backticks-is-a-claim-that-it-exists.md) was written
about: every copy agreed with every other copy.

### The naive check does not survive its first page

"No line appears twice in a file" fires on every page in this repository and
would be deleted within the hour. Markdown is made of repetition: blank lines,
list markers, `## Context`, a table's separator row, the same heading under every
entry of a log. A rule that reads a line at a time cannot tell a log from a
defect.

What is distinctive about this failure is not that a line repeats. It is that a
**long run of consecutive lines** repeats, verbatim, inside one file. Eighteen
hundred and twenty four of them, twice over.

### What the tree actually repeats

Measured on 2026-09-08 across all 156 tracked markdown files there were before
this record was written, longest run first:

| lines | file | what it is |
| --- | --- | --- |
| 1824 | `docs/process/verified.md` | the defect, at lines 2 and 1830 |
| 12 | `docs/format.md` | two objects in one `dbmd refs --json` payload with the same shape and the same values |
| 6 | `docs/ci.md` | the checkout-and-setup-node preamble two workflow jobs share |
| 5 | `README.md` | a fenced block's closing lines |
| 4 | `docs/import-format.md` | |
| 3 | 87 decision records, the fixtures, `AGENTS.md`, everything else | |

So the largest legitimate repeated run in this repository is twelve lines, and it
is not authored duplication at all: by
[ADR 0066](0066-a-json-payload-on-a-page-is-a-run-and-is-compared-as-a-value.md)
a `json` fence on a
documentation page is output some command printed, so those twelve lines are two
similar rows the tool emitted. Below that, everything is a workflow preamble or a
heading pair.

The gap between twelve and eighteen hundred is two orders of magnitude with
nothing in it. That is what makes a threshold defensible rather than invented.

## Decision

**`scripts/check-duplication.mjs` finds, in each tracked `.md` file, the longest
run of consecutive lines that appears at two disjoint places in that file, and
fails the build at 40 or more.** It runs in `npm run check`, between the
reviewable-diff check and the command check, and it costs 0.14 seconds over the
whole tree.

**The limit is 40 because the largest legitimate run measured is 12.** Roughly
three times it: enough room for a third workflow job to be added to `docs/ci.md`
or for a longer `--json` payload to be pasted onto a page, without anybody having
to touch the number. It is still forty five times smaller than the duplication it
exists to catch, so there is no version of this incident that squeezes underneath
it.

**The summary line reports the longest run it found, on every green run.**

```
158 markdown files scanned, none repeating 40 or more consecutive lines of itself.
The longest run one file holds twice is 12 lines, in docs/format.md at lines 1347 and 1434.
```

A number pulled out of the air is a number somebody trips over and then raises.
Printing the current margin means the next person to meet this check can read the
last green run and see whether raising the limit is making room for real
repetition or giving the check away. It is also the property
[ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md) asks
for in a different form: a sweep that has quietly stopped finding anything prints
the same "none" as one that swept, and the margin is what separates the two.

**Nothing is excluded, and the candidates were considered rather than skipped.**
`scripts/check-commands.mjs` excludes three prefixes and each earns it. Here:

- `docs/architecture/decisions/` **stays in**. Those records quote each other
  deliberately and at length, which is exactly why `check-commands.mjs` leaves
  them alone, and it is not a reason here: quoting another file is cross-file
  repetition and this reads one file at a time. Within a single record the
  longest repeated run in the whole directory is three lines. An ADR is long
  prose, which is the shape that gets pasted twice, so excluding them would give
  up more than half of the tree: 87 of those 156 files live in that directory,
  and this record makes 88.
- `test/fixtures/` **stays in**. Those models are deliberately malformed, and
  "holds forty identical lines twice" is not one of the malformations any of them
  tests. The longest run in the directory is three lines.
- `test/guards/` **needs no entry**. Its fixtures are wrong on purpose, which
  would earn one, but they live in string literals inside a `.ts` file and this
  reads `.md` only.

**It errs toward missing duplication rather than firing on repetition somebody
meant.** A guard with a false positive gets an exclusion added, then another,
then deleted. The bias is stated in the script's header rather than left to be
inferred, and the tests assert the misses as well as the catches.

## Consequences

- **This check failed on `main` for as long as the duplicate was on it.** It was
  written before the repair,
  [#232](https://github.com/BlakeHastings/dbmd/pull/232), landed, so for a few
  hours a branch cut from `main` was red at exactly one step, which was this one,
  over exactly the file this record is about. That is the strongest evidence
  available that it was worth building, and it is the reason it is recorded here
  rather than only in a pull request: the message it printed is the message a
  reviewer would have been given on 2026-09-06. It passes on `main` now, and the
  repaired file is what the margin below is measured against.
- **What it does not catch is written down, in the script and in `AGENTS.md`.**
  A guard that says what it covers is a guard somebody can tell has stopped
  covering it, which is the property `check-commands.mjs` already has and states
  in its own summary line. Four gaps, all deliberate:
  - **Anything under 40 lines.** A repeated paragraph, a repeated table row, a
    heading written twice: invisible, on purpose. This is not a prose linter.
  - **Duplication across two files.** A page pasted into a second page is not a
    finding, and pages here quote each other constantly.
  - **Anything not verbatim.** One word changed in the middle of a pasted block
    splits the run in two, and a duplicate with an edit every thirty lines passes
    completely. That is inherent to comparing lines. It misses a person editing a
    duplicate, which is not what happened here: a tool made this one and made it
    exactly.
  - **Anything that is not `.md`.** A duplicated TypeScript module, a JSON
    fixture written twice, a workflow with the same job twice: none of them are
    read.
- **The two occurrences a run is reported at never overlap.** A run is capped at
  the gap between them, so ninety identical lines in a row are reported as a run
  of forty five rather than a run of eighty nine repeated one line later. The
  second description is true and points at the wrong thing.
- **A cheap algorithm, because a clever one here would be wrong.** Positions are
  grouped by line, only pairs that agree on their first line are extended, and a
  pair whose preceding lines also match is skipped because the pair one line
  earlier describes a longer run. No hashing, no windows, no tuning. 0.14
  seconds over the whole tree, and 0.7 through `npm run check:duplication`,
  which is npm's own start-up rather than this. Against a gate of about a
  minute that is a rounding error, so the cost did not enter the argument.
- **It is broken on purpose in `test/guards/broken-on-purpose.test.ts`**, nine
  cases, as [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
  requires. The false-positive half is the larger half: the repetition markdown
  is made of, the same block in two files, a duplicated `.ts` file, an edited
  duplicate, and the limit asserted from both sides at 39 and 40.

## Revisit when

- **The limit is tripped by something legitimate.** Read the summary line from
  the last green run before raising it. If the largest legitimate run in the tree
  has climbed from 12 to 30, raising the limit is arithmetic. If it is still 12
  and one file wants 60, the file is the thing to look at, and an exclusion with
  a reason beside it is better than a number nobody can defend.
- **A page is pasted into a second page.** That is the gap this leaves widest and
  the one most likely to be paid for. Closing it means comparing files against
  each other, which turns a check with no false positives today into one that
  fires on `README.md` and `docs/` sharing a paragraph on purpose. Do it when it
  has happened, with the incident in hand, rather than now.
- **Something outside `.md` is duplicated.** The extension filter is one line and
  the algorithm does not care what it is reading. What would need arguing is the
  limit: 40 lines of identical TypeScript is a different claim from 40 lines of
  identical prose, and a generated file would fire on it immediately.
