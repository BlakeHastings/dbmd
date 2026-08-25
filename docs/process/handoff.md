# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision
records are the source of truth and this is only where the work stopped.

**As of the end of setup, 2026-08-24.**

## Where the work is

Setup is complete and nothing has been built. Four commits on `main`: the
unedited asset scaffold, the wired enforcement layer, the product decisions, and
the seeded backlog.

Nothing is dispatched. No agent has run.

## What a successor would otherwise have to reconstruct

- **The guard is wired and was never loaded.** `scripts/guard-merge.mjs --probe`
  printed rather than being refused, because `.claude/settings.json` was written
  during the session that would have needed it. Ask it again after a restart,
  and put the answer in the status update. Nothing mechanically stops an agent
  landing code until that probe is refused.
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
