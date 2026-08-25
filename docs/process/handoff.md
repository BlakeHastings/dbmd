# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision
records are the source of truth and this is only where the work stopped.

**As of 2026-08-25, with the first real wave dispatched.**

## Where the work is

Setup is complete and the enforcement stack is verified end to end rather than
installed: a ruleset refuses direct pushes from everyone including the owner,
three pull requests have landed through `merge-pr.mjs`, and the provenance audit
has run green on each merge commit after failing correctly on the first push.

Nothing of the product itself is built yet. `src/index.ts` is still a
placeholder.

**Two waves landed.** Wave two was dbmd-11 (canonical writer), dbmd-43
(Postgres provider) and dbmd-61 (the example model), merged as PRs #10, #9 and
#8. `main` now has a reader, a writer, a validated introspection contract, a
working Postgres provider and a real example model. No CLI and no studio yet.

Both send-backs in wave two came from driving the code rather than reading the
report, and neither was visible to CI:

- **dbmd-11** shipped a parse guard that was opt-in. `writeModel(dir, model)`
  was a legal call that silently deleted two columns from a file the reader
  could not fully read. The fix makes that call not compile, and the agent's
  chosen shape found a better line than the one asked for: `complete` is set at
  the phase boundary, so a file with an error that lost nothing is still
  writable.
- **dbmd-43** was correct, and reviewing it against a live Postgres surfaced
  dbmd-18: an expression index is indistinguishable from a column with a strange
  name.

**Wave one landed.** dbmd-10 (the model reader, `src/model/`) and dbmd-40
(the introspection contract and provider seam, `src/import/`) are merged as PRs
#5 and #6 and both items are closed. Nothing is in flight.

Both were verified by driving them against fixtures the orchestrator wrote
rather than the ones in the pull requests. That is what found the one defect
CI could not: a stray NUL byte that made the largest test file binary to git and
unreviewable as a diff, in a repository whose premise is that the diff is the
review.

What the wave produced besides code: `dbmd-13`, filed because both agents
independently invented a `Diagnostic` type and there are now two. It has to land
before `dbmd-21`, because ADR 0006 makes that shape a public contract the moment
`--json` ships.

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused after
  the harness restart, having printed before it. Ask it again after every
  restart, before the first dispatch, and alone on the command line: a
  `PreToolUse` refusal kills anything chained to it, so a probe joined with `&&`
  reports a comforting answer about a command that never ran.
- **`check-setup.mjs` went 4-of-4 MISSING to 4-of-4 ok.** Both outputs were in
  the first status update. Two of the four are dormant until a remote exists;
  ADR 0001 says which and why none was deleted.
- **The write boundary is owned**, recorded in `.git/factory/machine.md`, which
  is not committed and does not survive a clone. Whoever works this repository
  on another machine records it again, once.
- **The remote exists.** `github.com/BlakeHastings/dbmd`, public, MIT. A ruleset
  on `main` requires a pull request and a green `check`, allows squash only, and
  has an empty bypass list. Publishing to npm has still not been asked for.
- **Layer 3 fired on its first run and BASELINE moved once, deliberately.**
  ADR 0001 carries the correction and the reason it is the only time.

## The open format questions, in the order they bind

These came out of `examples/shop` being written by hand and they gate real work:

- **dbmd-14 (P0)**: a column cannot be declared unique. Blocks dbmd-41, because
  an import would silently drop a constraint the database enforces.
- **dbmd-16**: `null: false` reads backwards. Do it before anything writes a
  model at scale, or it becomes a migration.
- **dbmd-13**: two `Diagnostic` types. Blocks dbmd-21, because ADR 0006 makes
  that shape public the moment `--json` ships.
- **dbmd-18**: expression indexes. Blocks dbmd-41.
- **dbmd-15**: there is no format reference at all, only decision records.

All five touch the reader, the writer or the contract, so they mostly cannot run
alongside each other or alongside provider work. Sequencing them is the next
real orchestration decision.

## What is waiting on the owner

- **dbmd-90**, the name. `dbmd` is a working name, free on npm as of
  2026-08-24. Everything proceeds under it and a rename would touch
  `package.json`, the bin name and the README only.
Nothing. Both owner questions are answered and closed:

- **dbmd-90**: the name is `dbmd`, MIT, public on GitHub.
- **dbmd-91**: Postgres and SQL Server, behind a provider seam. ADR 0007, and
  dbmd-40 rewritten as the seam with dbmd-43 and dbmd-44 as the two engines.

## What is dispatchable

`dbmd-10` (the model reader) and `dbmd-40` (the introspection contract and the
provider seam). They share no files: one is `src/model/`, the other is
`src/import/`. Everything else in the backlog is behind one of them.

**dbmd-10 was dispatched once and stopped by the owner before it reported.** It
left `yaml@^2.9.0` in its worktree's package.json and nothing else: no commits,
no source, nothing merged. It was not resumed and not finished by the
orchestrator, and the item is open and unchanged.
