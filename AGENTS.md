# AGENTS.md

Read this first. It is the invariants and how to run things. `docs/process/`
has how work moves; `docs/architecture/decisions/` has why things are the way
they are.

## What this is

`dbmd` is a CLI that keeps an application's database model in its own
repository, as markdown, and gives developers a local web view to edit it. Edit
the model, commit the diff, open a pull request, and the next developer sees
what changed and why.

It holds more than tables: sticky notes and grouping boxes are first-class
objects on the same canvas, stored the same way, for the same reason.

Import supports Postgres and SQL Server, behind a provider seam, so a third
engine is one file and one registry line. ADR 0007.

**It describes a schema. It does not generate or apply DDL.** Nothing here
connects to a database except the import path, and that reads a JSON file a
human produced by running a query themselves.

MIT licensed and developed at
`github.com/BlakeHastings/dbmd`.

This was 100% vibe coded using [b-fac](https://github.com/BlakeHastings/b-fac),
and the owner built it as a tool for their own use. The README says both, near
the top. It is also the scope you work to: solve the issue in front of you, and
do not build for a userbase this repository does not have.

**You run it from a checkout, never from an install.** `node dist/cli.js` is the
command written as `dbmd` everywhere, and that holds whatever is on the registry:
an agent working an issue is changing the code in front of it, and an installed
copy is a different program that would hide the change.

**Releases are a tag the owner pushes.** `.github/workflows/release.yml`
publishes on a pushed `v*` tag and nothing else does; no agent here pushes a tag
or publishes, and the npm token is a repository secret only the owner can add.
**Do not write a publication status or a version number into a page** as though
it were a fact you can check from this tree:
`npm view dbmd versions` is what says which releases exist, and a copy of that
answer written into prose goes stale without anybody touching it. Two files once
claimed the package was published when it was not, and that false claim is why a
CI recipe invented a version number out of nothing. ADR 0051.

## What exists today

`src/model/` turns a `db-model/` directory into a typed
model plus a list of diagnostics, says where that model disagrees with itself,
writes one back canonically, and `src/index.ts` exports all three. `src/import/` holds the introspection contract, the provider
seam, the PostgreSQL and SQL Server providers behind it, and the pure function
that turns a canonical document into a model. `src/cli.ts` and `src/cli/` are the entry
point, and it has seven commands: `dbmd init`, `dbmd query`, `dbmd import`,
`dbmd check`, `dbmd refs`, `dbmd studio` and `dbmd export`.
`dbmd query --engine <id>` prints
that engine's introspection SQL on stdout and nothing else, which is the first
step of the journey `dbmd import` finishes; it connects to nothing and takes no
model directory. `dbmd refs <table>` says which columns point at a table and
which columns it points at, reading `referencesTo` off the model; it answers a
model with errors in it, which is what makes it usable half way through a
rename. ADR 0042. `src/studio/` is the studio server and the page it serves,
reachable either by importing `startStudio` or through that subcommand.
`src/export/` renders a model as a mermaid `erDiagram` for that last command.
Everything else in this file is either about the repository or about a decision
already recorded.

Do not read intent from this file as though it were implemented. Where a
decision record describes a property the code should have, that property is an
intention until the item that builds it lands, and the record says so.

## Running it

```bash
npm ci
npm run check
```

`npm run check` is typecheck, format check, decision-record numbering, the check
that a record answering another record's revisit condition is named back in it,
the reviewable-diff check, the check that no page holds a long run of its own lines
twice, the check that every command named in this tree exists,
the check that the studio's two scenes do not reach into each other's class
names, tests, a build, a smoke test over the packed tarball, and
one deliberate break of that smoke test, in that order. It is the only mechanical
gate and it is exactly what CI runs, so a green local run and a green CI run mean
the same thing. CI runs it twice, once on Node 22 and once on Node 24, so the
version you are standing on is the half of it your local run covers. ADR 0032.

`npm run check:pack` packs the package, installs it into a temporary directory
and drives the installed binary, because the source tree has everything and the
tarball is what ships. ADR 0024.

`npm run check:guards` then breaks it on purpose, in a copy of the tree, and
fails unless it refuses. Every other guard here is broken on purpose too, in
`test/guards/broken-on-purpose.test.ts`, which runs with the rest of the suite.
A guard that never fires looks exactly like a guard that cannot, and one of these
spent weeks in the second state. ADR 0034.

`npm run check:scenes` reads the studio's stylesheet and its two scene files.
The page is one `<style>` block for the canvas and the inspector, a bare class
selector matches both, and that cost two defects hours apart. A class name both
files write has to say which scene each of its rules means: `.scene > .notes`,
`#inspector .notes`, or any class only one of them writes. ADR 0037.

Individually: `npm run typecheck`, `npm run format`, `npm run test`,
`npm run build`.

## The backlog is beads, not GitHub issues

```bash
bd ready              # what can be dispatched right now
bd show dbmd-4        # one item in full, and the first line of every brief
bd comment dbmd-4 --file review.md
bd blocked            # and why
```

ADR 0002 says why.

**Both halves of the naming convention this used to state have lapsed, and the
file said otherwise until 2026-09-08.** It read: _Items are `dbmd-N`; branches
are `<area>/<N>-<slug>`._ Measured against the tracked export and the merged
pull requests: **62 of 126 items are numeric and 64 carry a random suffix**
(`dbmd-v6c`, `dbmd-53w`), because `bd create` hands out a suffix unless it is
given `--id`, and nobody has been giving it one. Branch names stopped carrying a
number too, and the last one that did merged more than a hundred pull requests
ago: since then they read `docs/two-blocks-nothing-checked`,
`tooling/the-merge-names-the-commit-reviewed`, `import/grid-shaped-like-the-window`
and the like. **A branch says what it does.** Neither drift caused a problem, and
the example `bd show dbmd-4` still resolves, but a reader following the sentence
would have written an id that does not exist.

`.beads/issues.jsonl` is the tracked file and the thing that survives a clone.
The database under `.beads/embeddeddolt/` is local, derived and untracked, so a
checkout without a working `bd` still has the whole backlog: it is one JSON
object per line and `node -e` reads it fine. Use `bd` when it works, read the
file when it does not, and do not treat a missing tool as a missing backlog.

Use beads **v1.2.2 or later**. v1.2.0 and v1.2.1 were published by accident
without release testing and migrate a local database to a schema later binaries
refuse. Creating items with an explicit `--id dbmd-N` gives a numeric id; without it
`bd` hands out a suffixed one, which is what has happened for the last sixty four
items and is fine.

## Invariants

Each of these is about this repository rather than about code that does not exist
yet. There is deliberately no count in this sentence: the one that used to be
here said two while five followed it, and ADR 0043 explains both why that
happened and why the answer is to drop the number rather than to correct it.

**Agents do not land code.** Push the branch, open the pull request or report
the branch, and stop. The orchestrator reviews and merges. This holds when the
checks are green and when the change is one line.
`docs/process/working-an-issue.md` has the prohibited commands, and
`scripts/guard-merge.mjs` refuses them before they run rather than after.

**That list used to be written out here and it went stale in four hours.** It
said the guard denies a merge, a merge through `gh api`, and a push whose
arguments name the default branch, which was exact when it was typed and short by
three the same afternoon: ADR 0098 added a tag push, a publish and a release cut
through `gh`. **So this says the rule and not the spellings.** The guard refuses
**a merge, a push to the default branch, a tag push and a publish**, in every
spelling of each it can recognise, and the list of spellings lives in
`scripts/guard-merge.mjs` and in `test/guards/broken-on-purpose.test.ts`, which
is where it cannot drift from what runs.

**What it does not cover is the part worth reading**, and it is stable in a way
the denials are not. It sees through the shell syntax that can stand in front of
a command, seven keywords and a variable assignment, and into a `bash -c` or
`pwsh -Command` payload, because shell syntax is a closed set. It does **not**
see through a program that launches another one: `sudo`, `env`, `command`,
`nohup`, `xargs`, `npx` and `npm exec` in front of a forbidden command are all
allowed, on purpose and with the reasoning in the guard's own header and in
ADR 0098. Wrapper programs do not share an argument grammar, so stripping a
leading word closes the flagless spelling and leaves the same wrapper open one
flag later, which turns named holes into unnamed ones. And it
deliberately permits `node scripts/merge-pr.mjs`, which is the route this
repository tells everybody to use. So the layer that was meant to stop an agent
merging allowed the only command an agent would reach for, and on 2026-09-08 an
agent merged its own pull request through it by accident from a call it had
labelled a placeholder. Every other gate was satisfied: the checks were green,
the branch was level with `main` and the sha it named was the head.
`merge-pr.mjs` now refuses when it is run from a linked worktree, which is where
every agent stands. ADR 0078.

**Decision record numbers are handed out, never taken.** The orchestrator
assigns the number, checked against `main` and every open branch.
`scripts/check-adr-numbers.mjs` fails a collision, and it runs in
`npm run check`.

**A record that says it answers another record's revisit condition is named back
in that record.** Not because records should cite each other: they should not. A
record declares its lineage in the lines above its first heading, and on `main`
at c5e95a5 there are **27 such declarations, of which 20 are never named back**.
A sweep on 2026-09-08 judged 19 of those 20 harmless, and they are: a record is
history, it cites what came before it, and an earlier record has no reason to
grow a link every time a later one leans on it. It is one situation. When a later
record answers an earlier one's `Revisit when` condition and the earlier record
never hears about it, that condition goes on reading as open work and the next
sweep re-judges finished work as unfinished. That happened three times and was
found by hand. **Only one of those three is inside the 27**, which is why three
does not fit inside one: the other two declare no lineage above their first
heading and name the record they answer further down the page.
`scripts/check-adr-backlinks.mjs` reads one line at a time for the words
"revisit entry" and "revisit condition" beside another record's number, and it
runs in `npm run check`. It is narrow on purpose and says so in its own summary
line: a record that answers a condition without using those words is invisible to
it, which is most of them. ADR 0096.

**Every tracked source file has to be readable as a diff.** This project argues
that the model is markdown so the diff is the review, and a file git treats as
binary produces no diff at all. `scripts/check-reviewable.mjs` fails on a NUL
byte in a tracked file, and it runs in `npm run check`. See Gotchas.

**No page holds a long run of its own lines twice.**
`scripts/check-duplication.mjs` finds, in each tracked markdown file, the
longest run of consecutive lines that appears at two disjoint places in it, and
fails at 40 or more. It runs in `npm run check`. `docs/process/verified.md` held
its own body three times over for two days in September 2026, from a pull request
whose diff was `+3688` and whose description said it was a sweep, and nothing in
the review or the gate was looking at it: a duplicated markdown file has no tests
to fail and Prettier formats a repeated paragraph as happily as a unique one. The
limit is about three times the largest legitimate repeated run measured across
this tree, which is 12 lines, and the summary line prints the current margin on
every green run so raising it can be judged. It reads one file at a time and only
`.md`, so a page pasted into a second page is not a finding, and one edited word
inside a pasted block hides the whole of it. ADR 0091.

**A command written in backticks is a claim that it exists.**
`scripts/check-commands.mjs` resolves every `dbmd <command>`, `npm run <script>`,
`node scripts/<file>` and bare `scripts/<file>` written inside backticks, against
the CLI's registry, `package.json` and the filesystem. A bare path is read only
where it begins the code, so a filename in the middle of a sentence is left
alone. It reads code spans and fenced blocks only,
so prose like "dbmd reads the model" is not a reference and costs you nothing.
If you mean something that does not exist yet, a future `dbmd fmt` say, mark it
on the line you wrote it: `<!-- hypothetical: dbmd fmt -->` in markdown, or
`hypothetical: dbmd fmt` in a source comment. A marker holds for its file, and
it fails once the thing exists, so the sentence gets reread on the day it stops
being hypothetical. ADR 0036.

**So is a flag written beside it.** The same script reads what comes after the
command word on a command line and resolves it against that command's own
options table, plus `--json`, `--no-color`, `--help` and `-h`, which the entry
point accepts after every command. `dbmd check --deep` was written on three
pages, one of them the CI recipe this project hands a stranger, and all three
passed. A flag is marked the same way: `hypothetical: dbmd check --deep`. The
options table is the authority on what a command takes and the `Options:` block
in its `--help` is checked against it, so a flag that works and is undocumented
is a red build rather than a gap somebody finds a year later. ADR 0089.

**A command that exists owes `README.md` an entry.** The same script reads the
registry the other way, and fails when a command on it is documented nowhere. An
entry is a paragraph under "The commands" that opens with the command in bold
code, the way the ones already there are written; being named in a sentence
elsewhere on the page is not one. This file and `docs/ci.md` are not checked,
because neither promises the full list. `dbmd import` and `dbmd query` each
shipped over a README that had not heard of them. ADR 0043.

**And a version pinned beside the name is a claim about what to install.** The
same script reads every version written after `dbmd@` and fails unless it is the
one in `package.json`, because a pin in a recipe somebody copies into their own
CI is a supply chain decision. A dist-tag is not a version and is not read, and a
number in prose is left alone. It says nothing about whether that version is on
the registry and it cannot, which is the same reason the top of this file sends
you to `npm view dbmd versions`. ADR 0080.

**A `--json` payload shown on a page is a run.** Every plain ` ```json ` fence
on `README.md`, `docs/import-format.md`, `docs/ci.md` and `docs/format.md` is a
report some command printed, and `test/docs/payloads.test.ts` runs the command
and compares. Adding one means adding the case beside it that says which command
line it came from, because the count is checked per page and an unclaimed fence
is red. The comparison is the JSON value rather than the bytes, so Prettier
reindenting a block on `README.md` is not a failure and a moved key is. A block
that shows only part of a value says so inside itself, the way
`docs/import-format.md` cuts `sql`. ADR 0066.

## Conventions

- TypeScript, ESM, Node 22 or later. `"type": "module"`, `NodeNext` resolution,
  strict plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Prettier decides formatting. Do not argue with it in review; `npm run format`.
  `docs/` is deliberately not formatted: prose is human-owned.
- Tests are vitest, beside the code or under `test/`.
- Commit subjects say **why**. The diff already says what.
- No dependency is added without a line in the pull request saying what it
  replaces or what it makes possible. This is a tool people run with `npx`, and
  install time is a feature.
- **stdout is data, stderr is narration, nothing ever prompts, and output is
  deterministic.** ADR 0006. This one is not a style preference: it is what makes
  the same binary usable by a human, by a GitHub Actions step and by an agent.

## Gotchas

An entry goes in when something has bitten twice, and comes out, deleted rather
than annotated, when the cause is fixed.

**Amended 2026-09-08, because the practice below is right and the sentence above
was not.** The only entry here has a fixed cause and is kept on purpose, saying
so in its own last line. Read literally, the rule says it should be gone. What
the rule is actually protecting against is a trap that is no longer real sending
the next reader looking for something that is not there, and an entry saying
_a check now catches this and here is what it was_ does not do that. **So an
entry stays only when it explains a check that exists, and it goes when the trap
simply stopped being one.** The entry below is the first kind. Whether it earns
its place even so is a fair question: `scripts/check-reviewable.mjs` opens with
the same two incidents and the same argument, at more length, and it is what a
reader meets when the check refuses them.

**A NUL byte makes a source file binary to git, and a binary file has no diff.**
Bitten twice: a test fixture in wave one, from a stray byte in something pasted,
and `src/studio/client/edges.ts` in dbmd-31, from a deliberate NUL written as
the character rather than as `\0`. Both times the file was reviewed without
being seen, and both times a reviewer noticed only because `grep` refused to
read it.

If you want a NUL in a string, and it is a reasonable thing to want for a
separator that cannot collide with a name, write the escape. `\0` is the same
character and leaves the file text. `scripts/check-reviewable.mjs` now fails the
build on the third occurrence, so this entry is here to say why that check
exists rather than to describe a trap you still have to remember.
