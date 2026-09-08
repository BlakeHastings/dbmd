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

**Name the branch for what changed, not for the item.** A prefix like `docs/` or
`studio/` is welcome and not required.

The three names this paragraph used to give as recent were
`model-file-missing-names-the-fix`, `keyboard-reaches-the-canvas` and
`json-payloads-are-run`. All three are real and all three merged, and by the time
anybody read the word "recent" about sixty more had landed behind them. **A list
of examples that calls itself recent is a claim with a shelf life**, so here is
the command instead:

```bash
gh pr list --state merged --limit 10 --json headRefName --jq '.[].headRefName'
```

This used to say `<area>/<issue-number>-<short-slug>`, with the number taken
from the id, so that `dbmd-4` became `format/4-markdown-parser`. **Beads stopped
issuing numeric ids**: they are short random suffixes now, like `dbmd-6j7` and
`dbmd-y6k`, and there is no numeric part to take. Every branch merged on
2026-09-07 was named for its change instead, which is also what a reviewer
reading a list of branches wants to see.

Commit messages say **why**, not what. The diff already says what.

## Verify before you open the PR

Do not open a PR you have not run.

```bash
npm ci
npm run check
```

`npm run check` is the same command CI runs, and it is the whole mechanical gate:
there is nothing else to remember.

**This sentence used to list four stages and there are twelve.** It was the third
place in this repository the gate is enumerated, and the only one of the three
that had gone wrong, which is what happens to a copy nobody updates. The list
that is kept correct lives in `AGENTS.md`, beside the invariants, and it is kept
correct by habit rather than by machinery: every commit that has ever changed the
chain edited that file in the same commit, seven of seven, measured. So read it
there, or ask the manifest, which cannot be wrong:

```bash
node -p "require('./package.json').scripts.check"
```

Where the change touches the studio, bring it up and drive it. **Point it at a
copy of the example, and make the copy with `git archive`**, where `$SCRATCH` is
a directory of your own outside the repository:

```bash
npm run build
mkdir -p "$SCRATCH/drive"
git archive HEAD examples/shop | tar -x -C "$SCRATCH/drive"
node dist/cli.js studio "$SCRATCH/drive/examples/shop" --port 0
```

There is still nothing to set up: `git archive HEAD` writes the committed model
into an empty directory in one command, and it is the same eight tables, two
notes and one group a stranger clones. Driving it is driving the product, which
is the whole reason this paragraph exists and is not what changed about it.

**Do not use `npm run studio` for this.** That script opens the repository's own
[`examples/shop`](../../examples/shop), which is tracked, and every edit the page
makes is written straight into those files. That is the owner's command and
writing to those files is the point of it for them: the layouts committed in
that model were dragged there through that exact script. It is not a scratch
model for an agent, and the undo it needs is the part that bites.

**`git checkout examples/shop` reverts every uncommitted change under that path**,
not the one file your drag wrote, and it reports only how many paths it updated.
On the morning of 2026-09-07 ten `layout:` files under that directory were the
owner's uncommitted work, an afternoon of dragging boxes into place, and a
`git reset --hard` in the main checkout destroyed them. They were searched for
exhaustively and they are gone; `handoff.md` records that under "What was
destroyed". `git checkout examples/shop` is the same loss down a narrower path
and with no more warning, and this page used to close the paragraph by
recommending it.

A copy costs one command and removes the whole class, the way a throwaway
worktree does in
[`orchestrating.md`](orchestrating.md#the-main-checkout-is-read-only-and-this-is-a-state-rather-than-a-judgement):
there is nothing in it to lose, so there is nothing to be careful about, and it
holds when the owner starts arranging boxes while you are already driving.
Requiring `git status --porcelain examples/shop` to be empty before you start
would be the cheaper fix and was rejected, because it is a rule about care in a
place where the same rule has already failed twice.
[ADR 0079](../architecture/decisions/0079-the-studio-an-agent-drives-is-pointed-at-a-copy.md).

**It also makes the measurement about the product rather than about somebody's
working tree**, which is a second reason and was learned separately.
`examples/shop` was once measured in a browser with four of the owner's
uncommitted `layout:` edits in it, reported as two notes covering three tables,
and filed as the first picture anybody sees. The committed model renders zero
overlaps. `verified.md` carries both halves.

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

**`scripts/merge-pr.mjs` now refuses to run from a worktree**, which is where you
are, so this rule is enforced rather than repeated at you. It was repeated at
people until 2026-09-08, when an agent merged its own pull request by accident:
it meant to run a read-only harness, typed the wrapper instead with the correct
sha, and every gate the script had was satisfied because every gate was about
the branch. Read [ADR 0078](../architecture/decisions/0078-a-merge-runs-in-the-main-checkout-or-not-at-all.md)
if you meet the refusal. **The command that did it was in a call labelled as a
placeholder, with a one second timeout, and a timeout ends the wait rather than
the process**: it was backgrounded, ran to completion and exited 0. A command you
are not ready to run is not made safe by giving it a short timeout.

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

1. **`node scripts/merge-pr.mjs <n> <sha-you-reviewed>`**, the sanctioned way to
   land a PR. It reads the check rollup, refuses unless every required check is
   green, refuses a branch behind its base, refuses unless the sha you name is
   the head it is about to merge, and always squash merges.
   It also refuses to run at all from a linked git worktree, which is the one
   refusal in it that is about whether the caller may merge anything rather than
   about whether this merge is a good idea.
   *Not covered:* anyone who does not use the command. It is a tool, not a gate.
   It cannot make you read the commit you name, only refuse to merge one you
   did not name. And an agent that changes directory to the main checkout is
   past the worktree refusal, which catches the accident rather than the intent.
   [ADR 0077](../architecture/decisions/0077-the-merge-names-the-commit-the-reviewer-read.md),
   [ADR 0078](../architecture/decisions/0078-a-merge-runs-in-the-main-checkout-or-not-at-all.md).
2. **`scripts/guard-merge.mjs`**, a PreToolUse hook wired up in
   `.claude/settings.json`. It denies the commands above before they run.
   *Not covered:* sessions that did not load it. A net, not a guarantee.
3. **`scripts/check-main-provenance.mjs`**, run on every push to `main`. It asks
   the API whether each new commit belongs to a merged pull request and fails
   loudly when one does not.
   *Not covered:* prevention. It notices afterwards, which is why it cannot be
   bypassed. It is kept despite the ruleset because the ruleset is an API object
   that the token agents run under can delete. ADR 0001 has that argument. **Nor
   does it notice an agent merging its own pull request**, which has a pull
   request behind it and satisfies this audit exactly as the orchestrator's merge
   does. That is the detection half layer 1's worktree refusal does not have, and
   ADR 0078 records where two searches for a sound signal ended.
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

Landing a PR, where `a1b2c3d` is the head sha you read when you reviewed it:

```bash
gh pr view 42 --json headRefOid --jq .headRefOid
node scripts/merge-pr.mjs 42 a1b2c3d
```

**Read that sha at review time, not at merge time.** Reading it now makes the
argument a formality; reading it when you read the diff is what makes the merge
refuse when the branch has moved underneath you since.

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
