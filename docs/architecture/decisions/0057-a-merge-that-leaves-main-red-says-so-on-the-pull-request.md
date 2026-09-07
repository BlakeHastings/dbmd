# 0057. A merge that leaves `main` red says so on the pull request that did it

## Context

`scripts/merge-pr.mjs` refuses to merge a pull request whose required checks are
red, stale or behind. That is prevention, it is layer 1 of the stack in
[`docs/process/working-an-issue.md`](../../process/working-an-issue.md), and it
works. What no layer looked at is the **result**: the run that starts on `main`
a few seconds after the merge, against a combination of changes that did not
exist until the merge created it. A green rollup is a fact about the branch. The
merge result is a different thing, and it is the one thing a bypass of any layer
cannot avoid producing.

Measured on 2026-09-07, asking the API for `total_count` on a filtered query
rather than counting a listing page: `check` had 145 finished runs on `main` and
**seven of them were red**. Every one was a merge that reported green on the
branch and went red on the default branch minutes later. Nobody noticed any of
the seven.

Four of those were a race that the flush repair had already fixed by the time
they were read, which is the good case: `main` was red for the length of the next
merge and healed on its own. Three were the watcher debounce flake, since fixed.

**The seventh is why this is a record rather than a nice-to-have.** It is the
post-merge run of #137, whose entire subject was that nobody looks at a
post-merge run. That run went red at 18:35 UTC on `85cac58c` and was not noticed
for about an hour, by the person who had just finished writing the sentence.

Two counting traps were sprung while the item was being filed, and both are worth
recording because anything built here has to avoid them:

- **Every listing is a window.** `gh run list --limit 100` against a branch with
  145 runs answers 100 and says nothing whatsoever about the other 45. That is
  how the item was first filed reporting four failures when there were seven.
- **A re-run erases the record.** `gh run rerun --failed` updates a run in place,
  so a failure that was later re-run green is no longer a failure anywhere the
  API can be asked. Any historical count is a floor and never a rate.

There was already a report. It is the Actions page, in colour, with timestamps,
and it is exactly what failed twice in one afternoon. So the missing property was
never *more reporting*.

## Decision

**A new detection layer runs after the merge, on the result, and delivers what it
finds rather than filing it.**

**`scripts/report-merge-aftermath.mjs` judges one finished run and writes the
finding as a comment on the pull request the commit came through.** The pull
request is the channel because its author is subscribed to it by default, so
GitHub does the travelling. The difference between a report and a signal is who
has to remember to look, and that was the only thing actually missing.

**`.github/workflows/aftermath.yml` is the trigger**, on `workflow_run`
completion for every workflow that runs on `main`, filtered to a push on the
default branch that did not finish green. It runs on nothing else, so an
`aftermath` run appearing in the Actions list is itself the finding and an
ordinary merge stays silent.

**It is not a gate and it must not become one.** The run starts after the merge,
so there is nothing left to prevent, and waiting for it would buy a several
minute stall in exchange for a verdict that arrives too late to act on. It is
`check-main-provenance.mjs`'s shape applied to a different property: it reads the
finished state of `main` and reports.

**It goes red when `main` is red.** A green job sitting beside a red one,
reporting successfully that everything is broken, is the exact shape of the
problem being closed.

**Which workflows it watches is read out of `.github/workflows/`, not listed.**
Three run on `main` today, and only `check` has failed there in volume, which is
not a reason to look at only `check`: `provenance` has failed there once. The
parse is generous on purpose, so a push trigger with no branch filter, or one
this cannot read, is watched rather than dropped. Being wrong towards watching
too much costs a line of output; being wrong the other way is the defect.

**A run that has not appeared yet is not a failure, and neither is a pull request
association that has not arrived.** Both lags are real, both are the reason
`check-main-provenance.mjs` fails transiently right after a merge, and both are
answered by waiting and then saying what is not known. A signal that cries wolf
once a month is one people learn to close, and that failure mode is worse here
than a missed report.

**A cancelled run is reported as no verdict rather than as fine.** It means a
commit nobody verified, which is a thing to know.

**Nothing is written without `--post`.** The three read-only forms are safe to
run against production at any time, and `--run <id>` without `--post` prints the
comment it would have written. The workflow is the only caller that passes it.

**Where a number is printed, the script says which number it is.** The local
summary's failure count comes from `total_count` on a filtered query rather than
from the length of a page, and it is labelled a floor.

## Consequences

- **A merge that breaks `main` now costs one notification instead of an hour.**
  The comment names the workflow, the commit, the failed jobs, the run URL and
  how long after the merge it went red, and it says explicitly that nothing is
  blocked and nothing has been reverted, because the remedy is a decision rather
  than a rollback.
- **Comments accumulate on merged pull requests.** A pull request that broke
  `main` acquires a comment about it forever. That is the intended cost: the
  record belongs next to the change that caused it, not in a listing that a
  re-run can erase.
- **A re-run that fails again posts a second comment, and the same attempt never
  posts twice.** The comment carries a hidden marker naming the run and the
  attempt, and the existing comments are scanned for it before posting. A second
  failure of a re-run is news; the same failure reported twice is noise, and
  noise is how a signal stops being read.
- **The direct-push case has no channel.** A commit on `main` with no merged pull
  request behind it gets the report in the job log and nowhere else. That is
  acceptable because it is a separate finding that `provenance` is already red
  about, and giving this script `contents: write` so it could leave a commit
  comment would be a real privilege bought for a case another layer covers.
- **`scripts/check-setup.mjs` is not extended.** It is a portable asset whose
  layer numbering comes from an external checklist, and adding a fourth layer
  there would fork it from its upstream for a repository-specific mechanism. The
  layer list in `docs/process/working-an-issue.md` is the one that is this
  repository's own, and it is where the entry went.
- **`merge-pr.mjs` is untouched.** Reaching into it was the tempting shape and it
  is the wrong one: it would make the merge path own something that happens after
  the merge path is done, and the first person to want the answer sooner would
  make it wait.
- **Nothing in `npm run check` covers this**, for the same reason nothing covers
  `check-main-provenance.mjs`: its body is API calls, and a test that mocks them
  would be a test of the mock. What stands in for it is that the script was run
  by hand against real runs before it landed, including the seventh failure, and
  that its read-only default makes doing that free. See below for what that did
  and did not prove.
- **The delivering half was not seen to fire.** The pull request lookup, the
  duplicate scan and the request shape were each exercised against the live API;
  the POST that actually writes a comment was not, because seeding the channel
  with a test alarm about a run from yesterday is precisely the cry-wolf failure
  the design is built to avoid. The first real red merge is what proves it, and
  it proves it loudly.
- **It costs nothing on a green merge**, because the workflow's `if` means the
  job does not start. On a red one it is a checkout, a Node install and a handful
  of API calls, with no `npm ci` because the script imports only the standard
  library.

## Revisit when

- **A red merge happens and no comment appears.** That is the mechanism failing
  in the only way that matters, and the job log for the `aftermath` run says
  which half stopped: the trigger, the lookup or the post.
- **Somebody starts ignoring the comments.** The signal is only worth what its
  precision is. If it is firing on flakes often enough to be tuned out, the fix
  is to make the flake stop, not to narrow what the comment reports.
- **A fourth workflow starts running on `main` and is not watched.** The parse is
  read from the files precisely so this cannot happen quietly, so an instance of
  it is evidence the parse has stopped understanding the workflows.
- **The pull request stops being where the person who merged is looking.** If
  landing ever moves off pull requests, the channel moves with it, and the
  mechanism is worth nothing until it does.
- **GitHub gains something that reports this natively**, or branch protection on
  this repository gains a "require the merge result to be green" rule. Either
  would make this the older half of two things doing one job.
