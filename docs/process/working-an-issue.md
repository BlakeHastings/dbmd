# Working an issue

How a change gets from an issue to the default branch. Read `review.md` first:
it defines what "done" means. This file is only the mechanics.

## Before you start

Read, in this order:

1. `AGENTS.md` for the invariants and how to run the environment
2. `docs/architecture/decisions/` for the decisions already taken, especially any
   your issue names
3. `docs/process/review.md` for the three review lenses
4. The work item itself, `bd show <id>`, including its parent epic

If the item conflicts with something you find in the code, say so on the item
with `bd comment <id>` rather than quietly picking one. **A stale issue is a normal thing to find**, and
checking the premise is part of the job.

## Branch and commits

```
<area>/<issue-number>-<short-slug>
```

for example `format/4-markdown-parser` or `cli/9-studio-server`. The number is
the beads id's numeric part, so `dbmd-4` becomes `format/4-markdown-parser`.

Commit messages say **why**, not what. The diff already says what.

## Verify before you open the PR

Do not open a PR you have not run.

```bash
npm ci
npm run check
```

`npm run check` is typecheck, format check, tests and build, and it is the same
command CI runs. It is the whole mechanical gate: there is nothing else to
remember.

Where the change touches the studio, bring it up and drive it:

```bash
npm run studio -- --port 0
```

That script builds first and then opens the repository's own
[`examples/shop`](../../examples/shop), so there is nothing to set up. An edit
you make in the page is written back to those files and shows in `git status`:
`git checkout examples/shop` puts it back.

`--port 0` lets the OS pick a free port and the command prints the URL it bound
to, **on stderr**, which with the default port is the only way to learn which
port you got. Use it rather than a fixed port: several worktrees run at once and
a fixed port makes them collide, silently, with whichever started first. It is
already the default, and typing it is a reminder rather than a requirement.

`--no-open` binds and prints the URL without opening a browser, which is what
you want when you are driving the page with something other than your eyes.

Then exercise the change the way the real user would, not the way a test does.

Stop the server you started, by its own process, before your worktree is
removed. Ctrl-C is what it is waiting for: it flushes an edit still inside the
debounce and then stops listening. Do not kill node globally: other agents are
working in other worktrees on this machine.

## The pull request

Title: what changed, in plain language. Name the work item, `dbmd-N`, in the
title or the first line of the body.

The body is the three lenses, filled in honestly. See
`.github/pull_request_template.md`. An empty section means the lens was skipped;
write "not applicable, docs only" rather than leaving it blank.

## You do not merge. Ever.

If you are an agent working an issue, these are prohibited, without exception:

- `gh pr merge` in any form
- `git push` to the default branch, including `git push origin HEAD:main`
- `git merge` while standing on the default branch
- merging through `gh api`
- `npm publish`, and pushing a tag, which is the thing that triggers one

That last one is the same rule wearing a different hat: a release goes to a
public registry and cannot be taken back, so the person who owns the consequence
pushes the tag. ADR 0051.

Push your branch, open the PR, report back, and stop. The orchestrator reviews
and merges. This holds even when your checks are green, even when the change is
trivial, and even when you are confident.

## Merge discipline

CI runs one check, named `check`, and it is `npm run check`. One entry point
rather than four jobs, so that what CI runs and what you can run are the same
thing by construction. It is a required status check on `main`.

It runs on two Node versions, so `check.yml` has two jobs rather than one: a
matrix called `verify`, which GitHub reports as `verify (22)` and `verify (24)`,
and a job named `check` that passes only if both legs did. The required check is
that second job, and its name is the thing the ruleset matches on. A matrix put
straight onto the job called `check` renames the status GitHub reports, which
does not fail: it blocks every pull request on a check that never arrives.
[ADR 0032](../architecture/decisions/0032-what-ci-builds-on-and-what-the-package-promises.md).

A second workflow, `model`, also runs on every pull request. It is the recipe
from [`docs/ci.md`](../ci.md) pointed at [`examples/shop`](../../examples/shop),
so the recipe this project publishes cannot quietly go stale. It is **not** a
required check and must not become one: it is an opinion about the example model
rather than about your change, and `check` is the thing that decides whether
anything merges. [ADR 0028](../architecture/decisions/0028-the-ci-recipe-is-pinned-and-this-repository-runs-it.md).

**GitHub enforces the first half, and this repository the second.** A ruleset on
`main` requires a pull request and a green `check`, allows squash merges only,
forbids deletion and force-push, and has an empty bypass list. The owner cannot
bypass it either. What the ruleset does not do is stop an agent merging *its
own* pull request, which is why the layers below still exist:

1. **`node scripts/merge-pr.mjs <n>`**, the sanctioned way to land a PR. It
   reads the check rollup, refuses unless every required check is green, and
   always squash merges.
   *Not covered:* anyone who does not use the command. It is a tool, not a gate.
2. **`scripts/guard-merge.mjs`**, a PreToolUse hook wired up in
   `.claude/settings.json`. It denies the commands above before they run.
   *Not covered:* sessions that did not load it. A net, not a guarantee.
3. **`scripts/check-main-provenance.mjs`**, run on every push to `main`. It asks
   the API whether each new commit belongs to a merged pull request and fails
   loudly when one does not.
   *Not covered:* prevention. It notices afterwards, which is why it cannot be
   bypassed. It is kept despite the ruleset because the ruleset is an API object
   that the token agents run under can delete. ADR 0001 has that argument.
4. **`scripts/report-merge-aftermath.mjs`**, run by
   [`.github/workflows/aftermath.yml`](../../.github/workflows/aftermath.yml)
   when a workflow finishes on `main` without going green. It comments on the
   pull request the commit came through, so the person who merged is told rather
   than left to look. Everything above is about the branch; this is the only one
   about the merge result, which is a combination that did not exist until the
   merge made it.
   *Not covered:* prevention, again, and deliberately. The run starts after the
   merge, so waiting for it would stall every merge for a verdict that arrives
   too late to act on. Seven merges left `main` red before this existed and
   nobody noticed one of them.
   [ADR 0057](../architecture/decisions/0057-a-merge-that-leaves-main-red-says-so-on-the-pull-request.md).

To ask what `main` looks like right now, across every workflow that runs on it:

```bash
node scripts/report-merge-aftermath.mjs
```

That form writes nothing anywhere. A run that has not appeared yet is reported
as such rather than as a failure, which matters in the minute after a merge.

Landing a PR:

```bash
node scripts/merge-pr.mjs 42
```

**Squash, always.** One issue becomes one commit, so the log stays a readable
list of changes and reverting means reverting one commit.

If a commit ever reaches the default branch outside this path, treat it as a
**defect in the guard** rather than a mistake by whoever did it: work out what
the guard missed, add the case, and say so.

## When the process is the problem

If the same manual check is done on every issue, that check belongs in CI, not
in a reviewer's head. If a rule keeps getting broken by accident, it probably
needs a linter rule rather than another paragraph in `AGENTS.md`.

Open an issue and say what you observed. Improving the process is in scope.
