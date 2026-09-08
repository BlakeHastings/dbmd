# 0078. A merge runs in the main checkout or not at all

## Context

"You do not merge. Ever." is the oldest rule in this project. It has its own
heading in [`docs/process/working-an-issue.md`](../../process/working-an-issue.md),
every brief repeats it, and until now **nothing enforced it**.

The three layers that look like they might do not. The ruleset on `main`
requires a pull request and a green `check`, and an agent merging its own pull
request satisfies both. [`scripts/guard-merge.mjs`](../../../scripts/guard-merge.mjs)
denies `gh pr merge`, a merge through `gh api` and a push to the default branch,
and it deliberately permits `node scripts/merge-pr.mjs`, which is the sanctioned
path. And `scripts/merge-pr.mjs` itself is present and runnable in every agent
worktree, because a worktree is a full checkout: the file is committed, so it is
there, and `node` runs it.

**On 2026-09-08 at 03:23:28Z an agent merged its own pull request by accident.**
In its own words:

> I meant to run the read-only harness that asks `decideMerge` what it would say
> about a matching sha, which is how I showed the allow path without merging. I
> typed the real wrapper instead, with the correct sha, and it did exactly what
> it says it does: printed the head, named the branch it was about to make
> stale, and squash merged.

Nothing bad landed. The head that merged was the one the orchestrator had
reviewed and named in a review record, green and level with `main`. What it cost
was a pull request left behind owing a rebase nobody had asked it to pay, and
the orchestrator not getting to watch a refusal fire on a live pull request
before it merged.

**The sharpest reading of it is that agent's own**, and it is the reason this
record exists rather than a note about being careful:

> The check I built could not have caught this and never could. I passed the
> head sha, I had read that commit, the branch was green and level with `main`.
> Every gate was satisfied because every gate was satisfied. What I violated was
> an instruction not to merge at all, which no argument to that script encodes.

[ADR 0077](0077-the-merge-names-the-commit-the-reviewer-read.md) added the
refusal about the person, and it asks the right question of the wrong person: it
asks the caller which commit they read, and the caller had read it. Every
refusal in the file is about whether this merge is a good idea. None of them is
about whether the caller is allowed to merge anything.

**The mechanism of the accident is worth one line on its own, because it will be
repeated by somebody who has read everything above.** The command was in a tool
call labelled "DO NOT RUN placeholder" with a one second timeout, and the agent
believed the timeout made it inert. **A timeout ends the wait, not the process.**
The call was backgrounded and ran to completion, exit 0. A command you are not
ready to run is not made safe by giving it a short timeout; the only safe form
of a command you are not ready to run is one you have not typed.

## Decision

**`scripts/merge-pr.mjs` refuses to merge from a linked git worktree.** The
directory a merge runs in is now part of what it checks, alongside the branch
and the reviewer.

**The signal is git's own, not a path pattern.** `readCheckout` reads the three
lines of `git rev-parse --git-dir --git-common-dir --show-toplevel` and compares
the first two: a linked worktree is the checkout whose git directory lives
inside the repository's shared one. Measured on this machine, at the root of the
main checkout git answers `.git` twice; inside an agent worktree it answers
`C:/…/proj-db-md/.git/worktrees/agent-<id>` and `C:/…/proj-db-md/.git`.

Matching the path against `.claude/worktrees/` was the obvious alternative and
is worse twice over. It names one tool's convention, so it misses the
orchestrator's own throwaway rebase worktrees in a scratch directory, which are
no more a place to merge from than an agent's. And it is a refusal that a rename
turns off silently, which is the failure mode this project keeps paying for.

**Both answers are resolved against the working directory before they are
compared, and that is the whole subtlety of the function.** Measured: one
directory down from the main checkout, git answers an absolute path for
`--git-dir` and the relative `../.git` for `--git-common-dir`. Compared as
strings those differ, and every subdirectory of the main checkout would be
refused as a worktree. That is a refusal aimed squarely at the only caller
allowed to merge, which is how a control gets removed rather than fixed.

**The refusal is raised last, after every other refusal.** This is the ordering
decision and it is the reason there is no escape hatch, so it is worth stating
as a rule rather than as an implementation detail: **a run from a worktree still
reports the branch's real problem, and reaches the worktree refusal only when
the alternative was a merge.**

The orchestrator legitimately runs this script from an agent's worktree, and did
so three times on the night of the accident, to watch refusals fire against a
live pull request without merging anything. Whoever meets this refusal next
while doing that will think the tool is broken, so: it is not, and the ordering
is what keeps that use working. A red check, a stale green and an unnamed commit
all still refuse from a worktree, with their own words, exactly as before. The
only thing a worktree cannot reach is the merge.

**There is no flag, environment variable or argument that turns it off**, and
the refusal says so in as many words. The case for a hatch is that the
orchestrator might one day want the allow path from a worktree; the answer is
that the allow path from a worktree **is** the accident, and that the allow path
can already be watched without merging by importing `decideMerge` and asking it,
which is what ADR 0058 split the file for and what the agent in the incident had
built and then did not run. A hatch loud enough to be a control is a hatch that
gets copied into a brief, and a hatch nobody can find is a hatch nobody uses.

**A checkout that cannot be identified is refused rather than assumed.** If git
is not on `PATH`, or the command did not run from inside a checkout, the
refusal says both causes and stops. That matches the missing-head-sha refusal
above it: the alternative is a control that passes by being unable to run.

**The fact is an argument and the git call is in `main()`.** `decideMerge`
gained a `checkout` parameter and `readCheckout` is a pure function of four
strings, so all of this is unit tested against the answers git actually gives.
ADR 0058, unchanged.

## Consequences

- **The orchestrator merges from the main checkout, which is one `cd`.**
  `merge-pr.mjs` only calls the GitHub API: it writes no file, checks nothing
  out and moves no branch, so running it in the main checkout does not touch the
  read-only rule in `orchestrating.md`. That rule is about commands that write
  to the working tree, and this is not one.
- **This cannot stop a determined agent and does not pretend to.** An agent can
  change directory to the main checkout and run the script there, and this
  record is not going to explain how much further that would have to go before
  it stopped being an accident. What this catches is the accident, which is the
  case that actually happened, and the case the file's other three refusals were
  each written for after it happened once.
- **The detection half is missing, and no sound signal was found.** The fourth
  standing principle here is that prevention is paired with detection, because a
  preventive layer that can be bypassed is silent when it is bypassed.
  `check-main-provenance.mjs` is the detector that already runs on the result,
  and it asks whether a commit on `main` came through a pull request. An agent
  merging its own pull request through this script satisfies it and always
  would. Nothing else separates the two callers: the token is the same, the
  script is the same, the squash commit is the same shape, and the machine is
  the same machine. The closest available signal is that the orchestrator posts
  a review record before merging, so a merged agent branch with no review
  comment is suspicious; it is not sound, because the orchestrator's own
  documentation branches carry no review comment either, and a detector that is
  wrong about half of what it flags trains people to ignore it. **So layer 1 got
  stronger and no layer 4 was added.** That is a smaller claim than the
  principle asks for and it is the true one.
- **A rejected candidate, recorded because it is the first idea anybody will
  have.** The merge endpoint takes a `commit_message`, so this script could
  stamp every squash it makes with the checkout it merged from, and a commit on
  `main` without that stamp would be a merge that did not come through here.
  That detects a bypass **of the script**, which is a real gap and not this one:
  a merge that came through the script from the main checkout is stamped
  correctly whoever ran it, so it is silent on exactly the case above. It also
  rewrites the shape of every commit message on `main` for a signal nothing yet
  reads.
- **A second rejected candidate, which is the strongest thing available.** The
  refusal could append a line to a file in the shared git directory, which every
  worktree can write to, so the orchestrator could see that an agent tried to
  merge and was stopped. That is a record of the prevention firing rather than
  detection of a bypass, which makes it evidence about whether this control is
  load bearing rather than evidence about a merge. It is not built here because
  it puts a write into a script whose refusals are pure and asserted, and the
  write would be the one unasserted part. Whoever wants the detection half
  should start there and should be clear about which question it answers.
- **Every merge now runs one `git` subprocess it did not run before.** It is
  local, it is milliseconds, and it is the only non-`gh` call in the file.
- **The first version of the tests was green here and red in CI**, and it is
  worth recording because it is this file's own subject arriving from the other
  side. The cases were written with the real measured `C:/Users/...` answers,
  which is the honest thing to do, and on the Linux runners `C:/x` is a
  *relative* path: `path.resolve` joined it onto the runner's directory, and two
  answers that name one directory on the machine this script runs on became two.
  A fixture that encodes the platform tests the platform. The cases now use
  rooted paths that mean the same thing on both, and the one case that is
  genuinely about Windows asks `process.platform` and asserts what the platform
  it is running on actually does, which is the precedent in
  `test/studio/safe-path.test.ts`.
- **A reworded refusal turns tests red.** ADR 0034 accepted that cost and it
  applies to the two clauses added here.
- **Nothing else in the tree calls `decideMerge` with facts of its own**, so the
  new parameter broke nothing silently. The test suite passes it explicitly,
  including a control that a run from the main checkout is not refused for the
  directory it is in.

## Revisit when

- **Somebody finds a sound way to tell an agent's merge from the
  orchestrator's, after the fact.** That is the missing layer 4 above and it is
  worth more than this refusal is, because it would cover the determined case as
  well as the accident. The consequence above says where two searches ended; a
  third that ends somewhere better should be written down either way.
- **A hatch is proposed.** Read the ordering argument first. If the case is
  still live after that, the thing to ask is what the caller wants to watch,
  because "watch the allow path without merging" is already answered by
  importing `decideMerge`, and any other answer is a request to merge from a
  worktree.
- **Somebody is refused while standing in the main checkout.** That is the
  resolve-against-cwd case getting something wrong, in a layout nobody here has
  measured. It is a false refusal on the merge path, which is the expensive
  direction, and the test named "asked one directory down" is where the next
  measurement belongs.
- **A merge ever needs to run somewhere that is not a checkout at all**, from CI
  or a container. The unknown-checkout refusal is what it will hit, and the
  answer is not to loosen that refusal but to decide whether an automated merge
  is a thing this project wants. ADR 0077 says the same about its own argument,
  and for the same reason.
