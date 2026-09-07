# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision
records are the source of truth and this is only where the work stopped.

**As of 2026-09-06, with waves three to six landed and nothing in flight.**

## Where the work is

`dbmd` does something now. From an installed tarball:

```bash
npx dbmd init          # writes a model directory with a real example in it
npx dbmd studio        # opens the canvas on it, drag a table, the file changes
```

Nine pull requests landed today, #12 through #21, all through `merge-pr.mjs`,
and the provenance audit is clean across all 21 commits on `main`.

What exists: the model reader and canonical writer, a validator, one diagnostic
type shared by every producer, the introspection contract with a working
Postgres provider, a CLI with `init` and `studio` behind an enforced output
contract, a studio server on loopback with four independent security layers, a
canvas with boxes, edges, pan, zoom and drag, a format reference whose examples
are executed on every build, and 457 tests.

What does not exist: `dbmd check`, `dbmd export`, the SQL Server provider, any
import path into a model, the inspector, the watcher, and notes and groups on
the canvas.

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused this
  session. Ask it again after every harness restart, before the first dispatch,
  and alone on the command line: a `PreToolUse` refusal kills anything chained
  to it, so a probe joined with `&&` reports a comforting answer about a command
  that never ran.
- **`bd` needs `--ignore-schema-skew` on every command on this machine**, and it
  is not on an agent's PATH at all. `.git/factory/machine.md` has the whole
  story, the backup location, and the one command that fixes it permanently.
  That command is the only thing still waiting on the owner.
- **The write boundary is owned**, recorded in `.git/factory/machine.md`, which
  is not committed and does not survive a clone.
- **Do not land an orchestrator commit while a wave is in flight.** It costs one
  rebase per agent and puts a reviewed tree back into motion.
- **Remove an agent worktree once its branch lands.** They are inside the
  repository and tools that walk the filesystem will find them.
  `docs/process/orchestrating.md` has the measurement.

## What this session changed about the loop

Both are in `docs/process/orchestrating.md` with the evidence.

- **An agent in a worktree sees committed files and nothing else.** Briefs posted
  to the backlog are not visible to it, `bd` is not on its PATH, and an
  uncommitted plumbing fix is not in its tree. Put the brief in the dispatch
  message.
- **Agent worktrees are inside the repository and tools scan them.** Nine stale
  ones made `npm run check` report 3927 tests instead of 457.

And one new enforcement layer: `scripts/check-reviewable.mjs` fails the build on
a NUL byte in a tracked file, because a file git treats as binary has no diff
and cannot be reviewed. That has now happened twice, in wave one and in dbmd-31,
and both times the file was reviewed without being seen. The gotchas section in
`AGENTS.md` has its first entry for the same reason.

## What is ready, and how it groups

`bd ready` is the truth. The shape of it:

- **The import journey is the biggest unstarted thing.** dbmd-41 is blocked on
  dbmd-18 (expression indexes), dbmd-19 (`unique` versus `isUnique`) and dbmd-23
  (`writeModel` throws where it should skip). Those three plus dbmd-44, the SQL
  Server provider, are one coherent run of work and they collide with each other,
  so they want sequencing rather than a wave.
- **The studio has three items that attach to named seams** dbmd-31 left:
  dbmd-32 the inspector at `onSelect`, dbmd-33 the watcher at `Canvas.show` and
  `fetchModel`, dbmd-34 notes and groups inside `canvas.ts`. dbmd-33 is the one
  that matters most: a hand edit while the studio runs is silently overwritten,
  which is data loss rather than staleness.
- **dbmd-21, `dbmd check`, is now unblocked** and is the obvious next CLI item.
  Everything it needs landed today.
- **dbmd-36 is a flaky test** that can make CI red at random, which is corrosive
  in a way a slow gate is not.

## What is waiting on the owner

- **The beads schema recovery.** One destructive SQL statement, the harness
  refused it, a full backup exists, and the stopgap is documented as verified
  safe for exactly this database and binary pair. Asked in prose. Nothing in the
  loop has waited on it.
