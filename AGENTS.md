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

**It describes a schema. It does not generate or apply DDL.** Nothing here
connects to a database except the import path, and that reads a JSON file a
human produced by running a query themselves.

MIT licensed, published as `dbmd` on npm, developed at
`github.com/BlakeHastings/dbmd`.

## What exists today

Setup only. There is no CLI yet, no parser, no studio. `src/index.ts` is a
placeholder so the build has a root module. Everything else in this file is
either about the repository or about a decision already recorded.

Do not read intent from this file as though it were implemented. Where a
decision record describes a property the code should have, that property is an
intention until the item that builds it lands, and the record says so.

## Running it

```bash
npm ci
npm run check
```

`npm run check` is typecheck, format check, decision-record numbering, tests and
build, in that order. It is the only mechanical gate and it is exactly what CI
runs, so a green local run and a green CI run mean the same thing.

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

Empty on purpose. An entry goes in when something has bitten twice, and comes
out, deleted rather than annotated, when the cause is fixed.
