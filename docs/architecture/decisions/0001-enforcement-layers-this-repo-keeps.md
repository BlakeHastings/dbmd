# 0001. Which enforcement layers this repo keeps

## Context

This repository was created empty on 2026-08-24 and is run by the orchestrated
delivery loop. That loop's second constraint is that agents do not land code,
and the layers that hold it are described in the skill's `enforcement.md`:

0. the instruction in every brief and process doc
1. the merge wrapper, `scripts/merge-pr.mjs`
2. the PreToolUse guard, `scripts/guard-merge.mjs`
3. the provenance audit, `scripts/check-main-provenance.mjs`

The arithmetic is per layer, and the question each time is what the layer covers
that nothing else here already covers. Two facts about this repo drive it:

- **There is no remote yet, and no ruleset.** Whether this lands on GitHub, and
  whether public or private, is unsettled. Branch protection is therefore not
  available as a substitute for anything.
- **Every implementation agent works in a git worktree.** That is the guard's
  documented blind spot: a bare `git push` from a worktree names no destination
  on its command line, so the guard cannot judge it.

## Decision

Keep all four. Nothing here is redundant with anything else, because the one
thing that would make layer 3 redundant, a ruleset requiring pull requests, does
not exist.

Two of them are **dormant until a remote exists**, and this record says so rather
than letting a directory listing imply otherwise:

| Layer | State today |
| --- | --- |
| 0. Process docs | Live. `docs/process/` and `.github/pull_request_template.md` |
| 1. Merge wrapper | Installed, `REQUIRED = ['check']`. Reads a GitHub check rollup, so it does nothing until there is a remote to read |
| 2. Guard hook | Live. Wired in `.claude/settings.json`, and it refuses a local `git push origin main` and a `gh pr merge` today |
| 3. Provenance audit | Installed with `BASELINE = 9bb58f8`, wired to `.github/workflows/provenance.yml`. Runs on push to `main`, so it does nothing until there is a remote and Actions |

Until the remote exists, "landing" means merging an agent's local branch into
local `main`, and the gate for that is `npm run check` passing on the branch,
run by the orchestrator, not by the agent that wrote it.

## Consequences

- Layers 1 and 3 are claims about a future state. Whoever creates the remote has
  to confirm the check name GitHub actually reports matches `REQUIRED`, because
  a name that never appears reads as "never ran" and refuses every merge.
- `scripts/check-setup.mjs` reports all four green on file presence and wiring,
  which is a weaker statement than "all four are firing". Layer 2 is the only one
  whose liveness can be probed today, with `node scripts/guard-merge.mjs --probe`.
- Nothing detects a direct commit to local `main` before the remote exists. That
  is a real gap and it is accepted for the length of time it takes to create the
  remote, rather than papered over with a git hook nobody will maintain.

## Revisit when

- **A remote exists.** Confirm layer 1's `REQUIRED` name against a real run, and
  confirm the provenance workflow ran and passed. Update the table above.
- **A ruleset requiring pull requests is applied.** Layer 3 becomes redundant
  with it: delete the script and the workflow, and append the deletion here.
- **Layer 2 has never been observed denying anything after six weeks of use.**
  Then it is either not loaded or not matching, and that is a defect to find
  rather than a layer to trust.
