# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision
records are the source of truth and this is only where the work stopped.

**As of 2026-09-06, with wave three about to be dispatched.**

## Where the work is

Three waves of setup and two waves of product work have landed. `main` has a
model reader, a canonical writer, a validated introspection contract, a working
Postgres provider and a real example model under `examples/shop`. Eleven pull
requests have merged, all through `merge-pr.mjs`, and `npm run check` is green
at 298 tests.

**There is still no CLI and no studio.** `src/index.ts` exports the reader and
the writer and nothing else. Do not read intent from `AGENTS.md` or from a
decision record as though it were implemented.

Nothing is in flight. There are no open pull requests and no agent worktrees.

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused on
  2026-09-06. Ask it again after every harness restart, before the first
  dispatch, and alone on the command line: a `PreToolUse` refusal kills anything
  chained to it, so a probe joined with `&&` reports a comforting answer about a
  command that never ran.
- **`check-setup.mjs` reports 4 of 4 ok and the guest gate `n/a`.** The write
  boundary is owned, recorded in `.git/factory/machine.md`, which is not
  committed and does not survive a clone.
- **The remote is `github.com/BlakeHastings/dbmd`**, public, MIT. A ruleset on
  `main` requires a pull request and a green `check`, allows squash only, and
  has an empty bypass list. Publishing to npm has still not been asked for.
- **`bd` was missing from this machine entirely** on 2026-09-06 and was
  reinstalled. It needs `--ignore-schema-skew` on every command until a
  recovery step the owner has not yet approved is run.
  `.git/factory/machine.md` has the whole story, the backup location and the
  one command that fixes it permanently.
- **Do not land an orchestrator commit while a wave is in flight.** It costs one
  rebase per agent and, worse, puts a tree you already reviewed back into
  motion. `docs/process/orchestrating.md` has the reasoning.

## The format questions, in the order they bind

These came out of `examples/shop` being written by hand, and they gate the
import work. All of them touch the reader, the writer or the contract, so they
mostly cannot run alongside each other.

- **dbmd-14 (P0)**: a column cannot be declared unique. Blocks dbmd-41.
- **dbmd-16**: `null: false` reads backwards. Do it before anything writes a
  model at scale, or it becomes a migration rather than a rename.
- **dbmd-18**: an expression index is indistinguishable from a column. Blocks
  dbmd-41, and it touches both `src/import/contract.ts` and the markdown format,
  so it collides with provider work and with reader or writer work at once.
- **dbmd-13**: two `Diagnostic` types. Blocks dbmd-21, because ADR 0006 makes
  that shape public the moment `--json` ships.
- **dbmd-15**: there is no format reference at all, only decision records. It
  has to follow dbmd-14 and dbmd-16 or it documents a format about to change.

**dbmd-14 and dbmd-16 are batched into one item of work** for wave three. They
touch the same files, both migrate `examples/shop`, and doing them separately
means migrating the example twice.

## Wave three

Three agents, three directories, chosen for collision surface rather than theme.

- **dbmd-14 + dbmd-16 batched**, in `src/model/`, `test/`, `examples/shop` and
  an appended section on ADR 0003. ADR number 0011 if a new record is wanted.
- **dbmd-20**, the CLI entry point and `dbmd init`, in a new `src/cli.ts`. ADR
  number 0012.
- **dbmd-30**, the studio server, in a new `src/studio/`. ADR number 0013.

**dbmd-30 was descoped at dispatch.** Its item asks for `dbmd studio` as a
subcommand, which would have made it and dbmd-20 both owners of `src/cli.ts` in
the same wave. It builds the server as a module with a programmatic entry point
instead, and **dbmd-35** was filed to carry the CLI wiring and the `npm run
studio` script once both have landed. That script is named by
`docs/process/working-an-issue.md` today and does not exist, which is an
invariant standing ahead of its code.

The relay both dbmd-20 and dbmd-30 were given: the frontmatter is changing under
them, so generate model files with `writeModel` rather than hand-writing YAML.

## What is waiting on the owner

- **The beads schema recovery.** It is one destructive SQL statement, the
  harness refused it, and a full backup exists. Asked in prose at the end of the
  session's first status update. The stopgap is verified safe, so nothing is
  blocked on the answer.

Both original owner questions are answered and closed: dbmd-90 settled the name
as `dbmd`, MIT and public; dbmd-91 settled the engines as Postgres and SQL
Server behind a provider seam, which is ADR 0007.
