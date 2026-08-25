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
- **No remote exists, and creating one is the owner's step.** So is publishing
  to npm. Neither has been asked for.

## What is waiting on the owner

- **dbmd-90**, the name. `dbmd` is a working name, free on npm as of
  2026-08-24. Everything proceeds under it and a rename would touch
  `package.json`, the bin name and the README only.
- **dbmd-91**, which database engines the import must cover. dbmd-40 proceeds on
  Postgres and is briefed to keep the JSON contract engine-neutral where that is
  free.
- **The format itself.** ADR 0003 is the design the owner asked to spec, and no
  item that builds against it should be dispatched before they have read it.
  That is the only thing holding dbmd-10, which is otherwise ready.

## What is dispatchable the moment that clears

`dbmd-10` (the reader) and `dbmd-40` (the Postgres query and its JSON contract).
They share no files. Everything else in the backlog is behind one of them.
