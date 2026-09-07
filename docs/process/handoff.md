# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with three agents in flight and one pull request open.**

## Where the work is

Forty-five pull requests have merged, all through `merge-pr.mjs`, and the
provenance audit is clean across every commit on `main`. **43 items closed, 18
open, 1 blocked, none in progress that is not dispatched.**

From a checkout, the tool now does the whole loop, and the first command is new
as of today:

```bash
node dist/cli.js import   # a catalogue JSON becomes a model directory
node dist/cli.js init     # scaffolds a model directory
node dist/cli.js check    # validates it, exits 1 on an error, --strict promotes warnings
node dist/cli.js export   # a mermaid diagram GitHub renders in a pull request
node dist/cli.js studio   # a canvas: drag, edit, rename across files, add and delete tables
```

**`dbmd import` closes the argument the project was built to make.** A database
becomes markdown becomes a picture you can drag, and no credential and no driver
is ever the tool's business: you run the query, it reads what your client
printed.

**It is not published to npm** and `package.json` is `"private": true` on purpose.
`AGENTS.md` and `README.md` both say so. Two files claimed otherwise for a day and
that false claim is why a CI recipe invented a version number.

**The owner has a studio open on `examples/shop`**, started before today's studio
work, so it has neither the file watcher nor the staleness guard. Restarting it
picks both up. Four files are modified, one `layout` line each; the model checks
clean. Do not commit or revert them.

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused. Ask it
  again after every harness restart, alone on the command line.
- **`bd` needs `--ignore-schema-skew`** on this machine and is not on an agent's
  PATH. `.git/factory/machine.md` has the story, and a brief has to hand agents
  the full path.
- **An agent in a worktree sees committed files and nothing else.** Put the brief
  in the dispatch message.
- **Merge on the report, not on a checks listing.** Both merge-timing rules are
  in `orchestrating.md` with what each one cost. The second was found today and
  put a reverted commit onto `main`.
- **Close items when their branch lands**, in the same motion as the merge.

## In flight

- **PR #46**, restoring an ADR bullet that was replaced rather than appended, and
  dropping a temporary Node 20 leg that reached `main` by the merge mistake above.
- **dbmd-34**, notes and groups on the canvas. The owner asked for this by name
  and it is the last thing on their list that has not landed.
- **dbmd-nxb**, a composite foreign key warning twice on every import.

## What proved out, and is easy to lose

- **The provider seam is real.** SQL Server landed with **zero lines** changed in
  `src/import/contract.ts` and `src/import/provider.ts`, and `import` then landed
  on top of both without touching either.
- **An imported model writes the engine's own type, with its modifier.** Not the
  normalised vocabulary, because a model file is read by a person holding it
  against a real database where `string` is not a type any engine has. ADR 0029.
- **A colon in a table name does not fail on Windows.** It writes an alternate
  data stream: success reported, content invisible to every listing and to `git`.
  `src/model/paths.ts` now refuses it.
- **A test can stop testing without breaking.** Three instances now, and the
  third was a fence that never fenced: a `GET` that a comment called a barrier is
  answered from a snapshot and never awaits the write behind it. That one test
  helper produced a P0 that looked like three different bugs.
- **A matrix doubles the chance of seeing a flake and dresses it as the
  version-specific break the matrix was added to find.** Read the failing leg
  before believing the shape of the failure.
- **The parser's first error is not its most useful.** Neither emission order nor
  printed order finds the tab; character position does.

## What is waiting on the owner

- **Publishing to npm.** Asked three times, never answered, and nothing depends
  on it. The package is ready; removing one line is the whole decision.
- **The beads schema recovery.** One destructive statement, refused by the
  harness, backup taken. The stopgap has carried every backlog write today.
