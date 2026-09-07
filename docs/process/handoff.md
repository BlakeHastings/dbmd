# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with one agent in flight and nothing waiting to merge.**

## Where the work is

The tool does the whole loop. From a checkout:

```bash
node dist/cli.js init      # scaffolds a model directory with a real example in it
node dist/cli.js check     # validates it, exits 1 on an error, --strict promotes warnings
node dist/cli.js export    # writes a mermaid diagram GitHub renders in a pull request
node dist/cli.js studio    # a canvas: drag, edit columns, rename, add and delete tables
```

Thirty-five pull requests have merged, all through `merge-pr.mjs`, and the
provenance audit is clean across every commit on `main`.

**It is not published to npm** and `package.json` is `"private": true` on
purpose. `AGENTS.md` says so at the top, because two files claimed otherwise for
a day and that false claim is why a version number was invented in a CI recipe
before anybody chose one.

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused this
  session. Ask it again after every harness restart, alone on the command line.
- **`bd` needs `--ignore-schema-skew` on every command on this machine**, and it
  is not on an agent's PATH at all. `.git/factory/machine.md` has the story and
  the one command that fixes it permanently.
- **An agent in a worktree sees committed files and nothing else.** Put the brief
  in the dispatch message. `docs/process/orchestrating.md` has the measurement.
- **Do not land an orchestrator commit while a wave is in flight**, and **do not
  merge one branch while another is rebasing.** The second cost two agents an
  extra round trip each this session. Wait for whichever is already rebasing,
  land it, then send the next for one rebase onto the result.
- **Remove an agent worktree once its branch lands.** They are inside the
  repository and tools that walk the filesystem find them.

## The open defects, in the order they matter

- **dbmd-48 and dbmd-39 (P0, in flight, batched).** A page holding a model from
  before a hand edit destroys that edit: a column patch replaces the list
  wholesale and nothing in the client reads `revision`. Reproduced on `main`.
  **ADR 0019 claims this is closed and is wrong**; amending it is inside the item.
- **dbmd-47 (P1).** The studio can stop passing `only` and every test stays
  green, because `examples/shop` became byte-canonical and the fixture stopped
  distinguishing. Acceptance is that removing it turns the suite red.
- **dbmd-52 (P1).** The watcher test fails intermittently on Windows. Seen by two
  agents independently, never reproduced deliberately.
- **dbmd-49 (P2).** Four small wrongnesses in the studio's confirmations,
  including a rename dialog that confirms and then fails.
- **dbmd-54 (P2).** The tarball smoke test asserts an exit code where it should
  assert the words, so a warning is invisible to it.
- **dbmd-53 (P2).** Every workflow, including the merge gate, targets a
  deprecated action runtime.
- dbmd-24, dbmd-23, dbmd-19, dbmd-45, dbmd-46 are format and import debts, each
  with its reasoning already written down.

## What proved out this session

- **The provider seam is real.** dbmd-44 added SQL Server with **zero lines**
  changed in `src/import/contract.ts` and `src/import/provider.ts`. ADR 0007
  claimed a new engine is one file and one registry line, in August, and it is.
- **The format page cannot go stale**: its examples are executed on every build,
  and a wrong claim in its prose was caught by a reviewer and corrected.
- **The CI recipe proves itself**: it breaks a copy of the model on every run and
  fails unless the exit code is exactly 1.
- **A NUL byte can no longer make a file unreviewable.**
  `scripts/check-reviewable.mjs` fails the build; it has bitten twice.

## What is waiting on the owner

- **Publishing to npm.** Never asked for and asked about three times. The
  package is ready and deliberately private; removing one line is the whole
  decision. The name was free on 2026-09-07. Nothing depends on the answer and
  the documentation now states the truth either way.
- **The beads schema recovery.** One destructive SQL statement, refused by the
  harness, with a backup taken. The documented stopgap has carried every backlog
  read and write.
