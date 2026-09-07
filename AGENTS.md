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

**It is not published to npm.** `package.json` says `"private": true`, on
purpose, and nobody has asked for it to be published. The name is free as of
2026-09-07. So `npx dbmd` does not work for anybody yet, and a document, a
recipe or a message that says it does is wrong: run it from a checkout with
`node dist/cli.js`. dbmd-50 made the package ready and deliberately left that one
line in place, so publishing is a decision somebody makes rather than something
that happens.

## What exists today

Four pieces. `src/model/` turns a `db-model/` directory into a typed
model plus a list of diagnostics, says where that model disagrees with itself,
writes one back canonically, and `src/index.ts` exports all three. `src/import/` holds the introspection contract, the provider
seam, the PostgreSQL and SQL Server providers behind it, and the pure function
that turns a canonical document into a model. `dbmd query`, which prints the SQL
a person runs, is still an open item. `src/cli.ts` and `src/cli/` are the entry
point, and it has five commands: `dbmd init`, `dbmd import`, `dbmd check`,
`dbmd studio` and `dbmd export`. `src/studio/` is the studio server and the page it serves,
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

`npm run check` is typecheck, format check, decision-record numbering, the
reviewable-diff check, tests, a build, and a smoke test over the packed tarball,
in that order. It is the only mechanical gate and it is exactly what CI runs, so
a green local run and a green CI run mean the same thing.

The last of those, `npm run check:pack`, packs the package, installs it into a
temporary directory and drives the installed binary, because the source tree has
everything and the tarball is what ships. ADR 0024.

Individually: `npm run typecheck`, `npm run format`, `npm run test`,
`npm run build`.

## The backlog is beads, not GitHub issues

```bash
bd ready              # what can be dispatched right now
bd show dbmd-4        # one item in full, and the first line of every brief
bd comment dbmd-4 --file review.md
bd blocked            # and why
```

ADR 0002 says why. Items are `dbmd-N`; branches are `<area>/<N>-<slug>`.

`.beads/issues.jsonl` is the tracked file and the thing that survives a clone.
The database under `.beads/embeddeddolt/` is local, derived and untracked, so a
checkout without a working `bd` still has the whole backlog: it is one JSON
object per line and `node -e` reads it fine. Use `bd` when it works, read the
file when it does not, and do not treat a missing tool as a missing backlog.

Use beads **v1.2.2 or later**. v1.2.0 and v1.2.1 were published by accident
without release testing and migrate a local database to a schema later binaries
refuse. Creating items with an explicit `--id dbmd-N` keeps the numbering the
branch convention above depends on; without it `bd` will hand out a suffixed id.

## Invariants

Two, and both are about this repository rather than about code that does not
exist yet.

**Agents do not land code.** Push the branch, open the pull request or report
the branch, and stop. The orchestrator reviews and merges. This holds when the
checks are green and when the change is one line.
`docs/process/working-an-issue.md` has the prohibited commands, and
`scripts/guard-merge.mjs` refuses several of them.

**Decision record numbers are handed out, never taken.** The orchestrator
assigns the number, checked against `main` and every open branch.
`scripts/check-adr-numbers.mjs` fails a collision, and it runs in
`npm run check`.

**Every tracked source file has to be readable as a diff.** This project argues
that the model is markdown so the diff is the review, and a file git treats as
binary produces no diff at all. `scripts/check-reviewable.mjs` fails on a NUL
byte in a tracked file, and it runs in `npm run check`. See Gotchas.

## Conventions

- TypeScript, ESM, Node 20 or later. `"type": "module"`, `NodeNext` resolution,
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
