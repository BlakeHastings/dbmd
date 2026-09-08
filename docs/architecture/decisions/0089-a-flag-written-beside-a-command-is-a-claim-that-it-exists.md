# 0089. A flag written beside a command is a claim that it exists

## Context

[ADR 0036](0036-a-command-in-backticks-is-a-claim-that-it-exists.md) made a
backticked command name a claim the build checks, and
`scripts/check-commands.mjs` has been checking it ever since. It resolves a
name, and it stops at the first space after that name.

So a flag was never read at all. Measured on a worktree on 2026-09-08, three
separate places, all three passing and all three wrong:

```
README.md                     $ dbmd check examples/shop --deep
docs/ci.md                    - run: npx --yes dbmd@0.1.0 check db-model --deep
.claude/skills/dbmd/SKILL.md  dbmd check --deep
```

Each run exited 0 and printed `188 files scanned, every dbmd, npm run and
scripts/ reference resolves, ...`. The same worktree proves the rest of the
guard was working: `dbmd chekc` in the skill made it exit 1 and name twelve
lines, and an `npm run` script that is not in the manifest made it exit 1 as
well. This is one hole in a control doing its job, rather than a control that
does nothing.

**The sharpest of the three is `docs/ci.md`.** That page is the workflow this
project hands a stranger to paste into their own repository. `dbmd check` exits
`2` on an unknown flag, by design, so that line would have failed somebody
else's CI on the first run and nothing here would have said so.

**The summary line was honest about the limit, which is why this is a gap to
close rather than a lie to fix.** It promised that every `dbmd`, `npm run` and
`scripts/` *reference* resolves, and a flag was not a reference. Closing the gap
is what lets that sentence say more, and it now does.

The interesting question is not whether to read flags. It is which of two
hand-written lists is the truth. Every command in `src/cli/` writes its flags
down twice, in the same file, a hundred lines apart:

- the `Options:` block inside its `help` template, which is what a person reads
- the options table it hands `parseArgs`, which is what the program accepts

Neither list is generated from the other, and nothing made them agree.

## Decision

**A flag written after a `dbmd` command, inside backticks or on a fenced command
line, names a flag that command accepts.** `check:commands` reads it, in
`npm run check`, beside the four reference shapes it already resolved.

**The options table is the authority, and the help block is checked against it.**
Both, rather than one, and the argument is that each single answer fails in a
way the pair does not:

- **Help text alone** would fail a correct command line on the day a flag works
  and is undocumented. A guard with false positives gets deleted rather than
  fixed, and this one is cheap to delete because it is one script.
- **The table alone** would let that documentation gap live forever, unnoticed,
  which is the exact shape of `dbmd query`, of the README that counted five
  commands, and of the four version pins in
  [ADR 0080](0080-a-version-after-dbmd-names-the-version-this-package-is.md).
  Three times in this repository, one file, one cause: two copies of one fact
  that can disagree in silence.

They were measured before choosing rather than assumed. All seven commands
agree today, seventeen flags, `dbmd init` with none on either side. So this
decision costs nothing on the day it lands and is a trap that is now closed
rather than a cleanup.

**The disagreement check is also the loud failure this technique owes.** The
table is read out of TypeScript as text, the way `test/docs/format.test.ts`
reads the `ModelDiagnosticCode` union out of `src/diagnostics.ts`, and text
reading fails silently by default: a table this could no longer find would leave
every flag in the repository unchecked and every page green.
[`docs/process/orchestrating.md`](../../process/orchestrating.md) has a section
about exactly that failure. The help block is an independent witness, written by
hand in a different shape in a different part of the file, so a rename that
hides the table leaves the help still listing `--strict` over a command that now
takes nothing, and the build stops. A guard that read one list would have gone
quiet instead.

**The source is read rather than the built CLI, and that is forced.**
`check:commands` runs *before* `build` in the `npm run check` chain, so `dist/`
may be absent or stale when it runs, and reordering that chain to let a guard
run `--help` would put a build in front of the cheapest check in the gate. Nor
could each command export its flags: that is a change to `src/`, and this reads
`src/` the way the registry read has been read since ADR 0036.

**The global flags are read from `src/cli/main.ts` rather than listed.**
`--json`, `--no-color`, `--help` and `-h` are valid after every command and
appear in no command's own table, because the entry point strips them before
dispatching. A copy of those four inside the checker would be a fourth
hand-written list of one fact, which is the thing this file exists to prevent,
so they come from `takeGlobalFlags` and from the line in `dispatch` that offers
a command's help. Both reads assert they found something: a list that quietly
emptied would call every `dbmd check --json` in the tree a defect.
`--version` is deliberately not among them, because it is read only as the first
token.

**Which tokens on a line are the command's is settled by where the match ended,
and everything after that is conservative.** The reference shapes already match
from the runner through the command word, so in
`npx --yes dbmd@0.1.0 check db-model --deep` the `--yes` that belongs to npx
falls out for free and only what the command was given is read. Then: a bare
`--` ends the flags, the way it does in `takeGlobalFlags`; a shell operator ends
the command line, so `dbmd check 2>/dev/null` stops at the redirect; the value
of a string option is skipped using that option's own declared type, so
`dbmd studio --port -1` does not report a flag called `-1`; and brackets and
trailing punctuation are trimmed, so the synopsis `dbmd check [directory]
[--strict]` is read as the claim it is. **A token that cannot be classified is
left alone rather than reported.**

**Prose is not a command line, and the answer is the one this script already
gave.** A flag is read only where a command was read: a code span or a fenced
line that a `dbmd` invocation begins. The tree is full of sentences with
`--strict` in backticks and none of them is a command being run, so none of them
is scanned. That rule covers all three of the real cases above, which are a
fenced shell line, a YAML `- run:` and a bare fenced command.

**A flag is only checked where the command resolves.** `dbmd fmt --deep` has one
finding in it and it is `dbmd fmt`. A second one about the flags of a command
that does not exist is noise in front of the answer.

**A flag can be marked hypothetical, `hypothetical: dbmd check --deep`.** ADR
0036's marker was the escape hatch for a command that does not exist yet, and a
shape with no escape hatch is a shape people work around. It goes stale the same
way: on the day the flag lands, the marker fails and the sentence around it gets
reread.

## Consequences

- **It found one on the first run.** `scripts/studio-dev.mjs` opens by arguing
  against a flag: "`dbmd studio --client-dir` would be a shipped option whose
  only purpose is development". That is a flag deliberately not written, in
  backticks, which is precisely the marker's case, and it now carries one. ADR
  0036 rejected inferring a hypothetical from words like "would" for exactly the
  reason this line shows: the words around it are indistinguishable from a
  sentence about a flag that is real.
- **The summary line moved with the rule.** It now reads `188 files scanned,
  every dbmd, npm run and scripts/ reference resolves, so do the 111 flags
  written beside a dbmd command, 5 pinned versions name 0.1.0, and README.md
  documents all 7 commands.` The count is there for the reason the pin count is:
  a sweep that quietly stopped finding anything prints the same success line as
  one that swept.
- **111 flag references across 25 files are read on every run**, over eighteen
  distinct command-and-flag pairs, `dbmd query --engine` thirty times and
  `dbmd check --json` twenty-two. None of them was a false positive.
- **A documented flag that does not exist is now a build failure rather than a
  README problem.** That is a real change in what this repository will let
  through, and it is the half that the table-only answer would have skipped.
- **A future command that parses its arguments some other way is not covered.**
  If a command stops calling `parseArgs`, it reads as taking no flags, and the
  disagreement check is what says so: its help block would still list them. If a
  command stopped documenting them too, both lists would be empty and both would
  agree, and every flag written beside it would be reported. That is loud, which
  is the right direction to fail in, but it is a hole in the sense that the
  failure names the pages rather than the command.
- **A short flag other than `-h` would be read and would resolve against
  nothing.** No command declares a `short` today. `src/cli/command.ts` already
  has a comment saying the same thing about clustering, and this inherits the
  same door-rather-than-room position.
- **A marker names one reference, and the first thing somebody reaches for is
  the command line they ran.** `<!-- hypothetical: dbmd query --engine postgres
  --bogus -->` parses as a marker for `dbmd query --engine`, which exists, so the
  author is told that marker is stale while `--bogus` is still unmarked: two
  messages, neither of them the one they wanted. The marker stops at the command
  and one flag on purpose, because the alternative is a pattern that swallows a
  whole line and then cannot say which part of it was the claim. Measured on
  review of this change, and the failure text now says so out loud rather than
  leaving it to be met.
- **The marker pattern had to grow, and the old reader proves it.** Running the
  previous version of the script against this tree now reports the two new
  markers as stale, because it truncates `hypothetical: dbmd check --deep` at
  the command word and finds that `dbmd check` exists. The extension is load
  bearing rather than decorative.
- **It costs nothing measurable.** Three runs each on this machine on
  2026-09-08: 290ms, 269ms and 314ms before, 268ms, 264ms and 269ms after. The
  flags are read off segments the reader had already computed, and the two lists
  per command are seven extra file reads of files it already opens.
- **It is broken on purpose, seventeen ways.**
  `test/guards/broken-on-purpose.test.ts` fires it on an unknown flag in a
  README fence and in a `docs/ci.md` YAML block, and holds the false-positive
  half: a real flag, a global flag, `--yes` in front of the package name, a
  token after `--`, a token after a redirect, a string option's value, prose
  about a flag, and a flag beside a command that does not exist. It also breaks
  both lists against each other in both directions, hides the options table, and
  hides one key inside it. [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md).

## Revisit when

- **A command grows a short flag.** The reader accepts `-x` and resolves it
  against a table that has never held one, so the first command to declare a
  `short` needs the table read to pick it up.
- **The two lists are ever meant to differ.** A deliberately undocumented flag
  is a reasonable thing to want, for something like the `--client-dir` argument
  above. It would need a marker of its own beside the table, written by the
  author, rather than the check learning to guess which omissions are on
  purpose.
- **A command stops using `parseArgs`.** The consequences above name what
  happens; the answer at that point is to read whatever replaced it, not to
  loosen this.
- **Somebody wants the same rule for `npm run` and `scripts/`.** Neither takes
  flags this repository documents, so there is nothing to check today. This
  stops at `dbmd` for the same reason the bare-path rule stops at `scripts/`:
  the boundary was where the evidence was.
