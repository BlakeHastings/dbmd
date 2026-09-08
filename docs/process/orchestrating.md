# Orchestrating this repository

Written at the end of setup, from the traps setup actually sprang, which is what
there is at this point. It is not a guide to running the loop: the loop has not
run yet. Correct it from what happens, and say what you observed when you do.

## The shape

The backlog is beads, not GitHub issues. Items are `dbmd-N`, branches are
`<area>/<N>-<slug>`, and the areas are the epic labels: `format`, `cli`,
`studio`, `import`, `publish`.

```bash
bd ready            # what can be dispatched
bd blocked          # and what each one is behind
bd list --label owner --limit 0   # what is waiting on a human
```

`bd ready` is the dispatch list. `bd list` is not: an item with no blocker can
still be undispatchable because it is waiting on the owner or has no spec, and
those are a label (`owner`) and a label (`needs-refinement`) respectively.

## What setup got wrong, so you do not repeat it

**`bd init` commits by itself, and `--skip-agents` does not stop it.** It ran
twice here and one of those commits swept an unrelated file into a commit
titled `bd init: initialize beads issue tracking`. Both were squashed away. If
you ever re-initialise, read `git log` immediately afterwards.

**The backlog was not in source control and looked like it was.** This version
of beads stores issues in an embedded Dolt database that its own `.gitignore`
excludes, and the JSONL export is off by default. ADR 0002 records the
correction. The general shape is worth keeping: a claim about where state lives
is checkable in about ten seconds and was wrong here on the first try.

**`bd export` with no `-o` prints to stdout and does not write the tracked
file.** That is still true, and it is no longer something you have to do
anything about. `.beads/config.yaml` sets `export.auto: true` and
`export.git-add: true`, so beads writes `.beads/issues.jsonl` on every write and
stages it. Measured on 2026-09-07: a fresh `bd export` of all ninety-one items
and the committed file agreed on every id and every `updated_at`, with nobody
having run an export.

This paragraph used to end by telling you to run an npm script called backlog
before any commit that changed the backlog. That script is gone (dbmd-7xa), and
it is written here without backticks because it is no longer a command: a
backtick is a claim the thing exists, and `scripts/check-commands.mjs` is the
thing that found this sentence when the script was deleted. It could not run
anyway: `bd` lives at `%LOCALAPPDATA%\Programs\beads\bd.exe`, which is on no
PATH npm can see from a plain checkout, so it answered `'bd' is not recognized`. A
script that cannot run, doing a job already done, in the file people read to
learn how the project works, is the shape this repository has paid for twice.
If you do want to force an export, `bd export -o .beads/issues.jsonl` is the
whole of what it did, and it needs a `bd` you can already run.

**`bd create` refuses `--id` together with `--parent`.** Create with `--id`,
then add the edge with `bd dep add <child> <parent> --type parent-child`. Worth
knowing before you write a seeding script that half works.

**The guard was wired in the same session that needed it.** Hooks are read once
at process start, so the session that installs one runs unguarded until it is
restarted, and so does everything it spawns. `node scripts/guard-merge.mjs
--probe` is the only way to find out, it must be alone on the command line, and
being refused is the answer you want.

Both answers were observed here, which is the pair worth keeping:

```
# before the restart
The merge guard is NOT loaded in this process.

# after
The merge guard is loaded in this process. This probe was refused before it ran.
```

Nothing else changed between those two runs. The wiring was identical, the
script was identical, and `check-setup.mjs` reported layer 2 `ok` for both. That
is the whole reason the probe exists: a guard that was never loaded produces
exactly the same silence as a guard with nothing to deny. **Ask it after every
restart, before the first dispatch.**

## Dispatching

Three agents is the comfortable number and the real variable is collision
surface, not count. On this repository the surfaces are:

- `src/model/` is one surface. The reader, the writer and the validator are
  sequential by dependency anyway, so this rarely matters.
- `src/studio/server` and `src/studio/client` are two, but the server's API
  shape is the contract between them, so the server lands first and the two
  client items go out together afterwards.
- The Postgres query and its JSON contract touch neither.

`package.json` is this repository's version of the file everything links from.
Two items that each add a script or a dependency collide there even when they
sound unrelated. Expect it and sequence around it. Naming one item as its owner
for the wave, and telling the others to add no dependencies, worked: the first
two-agent wave came back with no collision in it at all.

## Do not land your own commits into a live wave

The rule that cost the most in the first wave, and it cost it twice.

While two agents were working, a docs-only pull request was merged: two files,
no code, nothing either agent touched. Both branches were then refused by
`merge-pr.mjs` with "the required checks are green, but the branch is behind
main, so that green is stale", and both agents had to rebase and re-earn a green
they had already earned.

**One orchestrator commit costs one rebase per agent in flight**, however small
it is, because the wrapper judges the green against what would land rather than
against the branch point. It is right to. The commit that caused this was
process notes that could have waited an hour.

So: land orchestrator work **before** dispatching a wave or **after** it drains,
never during. Nothing an orchestrator writes between dispatches is urgent
enough to be worth a round trip per agent, and the round trip is the cheap half.
The expensive half is that a rebase puts a tree you already reviewed back into
motion, so the review has to be redone against what actually landed.

Two things follow when it happens anyway:

- **The rebase is the agent's, never yours.** Resolving it makes you the author
  of a change you are about to review. Send it back, and if that agent is gone,
  brief a fresh one whose job is rebase-and-re-verify rather than build.
- **Re-verify after the rebase, not before.** The claim you checked was checked
  against a different tree. Re-running the adversarial fixture against the
  rebased branch took under a minute both times and is the only thing that makes
  the earlier review still true.

## Sequence a wave so nobody rebases twice

Once both branches are stale, the ordering matters. Merging one moves `main`
again, so the other goes stale a second time.

Wait for whichever is already rebasing, land it, then send the other for one
rebase onto the result. One rebase each instead of one and then another.

## The evidence bar is the part to get right

Every item in the seeded backlog carries one, and they are all of the same
shape: **show the diff, or show the screen**. That is not decoration. This is a
tool whose entire value is that the diff is readable, so an agent reporting
"tests pass" has told you nothing about whether the thing works.

If you write a new item, the bar goes in it. If you cannot think of one, the
item is probably not specified yet.

## Merging

`node scripts/merge-pr.mjs <n> <sha-you-reviewed>`. It reads the check rollup,
refuses on anything red, refuses a branch behind its base, refuses unless the sha
you name is the head it is about to merge, and squash merges. A ruleset on `main`
refuses a direct push from anyone including the owner, so this is not a
convention: it is the only path.

The second argument is the head sha you read when you reviewed, which is
`gh pr view <n> --json headRefOid --jq .headRefOid` at **review** time. Seven
characters are enough. The section below headed "A pull request you reviewed is
not the pull request you merge" is why it exists.

**Run it from the main checkout.** It refuses from a linked git worktree,
including an agent's and including your own throwaway rebase ones, because that
is where a merge happens by accident: an agent did exactly that on 2026-09-08,
meaning to run a read-only harness. Running it in the main checkout does not
break the read-only rule below, because it only calls the GitHub API and writes
no file there. **Watching a refusal fire from an agent's worktree still works**,
which is the reason there is no way to turn this off: the worktree refusal is
raised last, so a red check, a stale green and an unnamed commit all refuse from
a worktree exactly as they did before, and the only thing a worktree cannot
reach is the merge.
[ADR 0078](../architecture/decisions/0078-a-merge-runs-in-the-main-checkout-or-not-at-all.md).

Post the three-lens review record on the beads item before merging, with
`bd comment <id> --file review.md`. The pull request body carries the same three
headings, and the item is where it stays findable once the branch is gone.

## Never tell an agent to borrow the main checkout's `node_modules`

I put this line in eight consecutive briefs, because five agents in a row
reported `node_modules` in their worktree as empty or absent and junctioning to
`C:\...\proj-db-md\node_modules` was what each of them did to get moving. It
worked every time until it silently stopped.

**On 2026-09-07 a dependency was added, and the main checkout was not
reinstalled.** #160 added `react`, `react-dom` and their types as
devDependencies. The main checkout's `node_modules` predated that merge. So an
agent that junctioned to it got a tree missing three packages the tree needed,
and `npm run typecheck` failed with:

```
src/studio/client/feedback.ts(35,55): error TS2307: Cannot find module 'react'
src/studio/client/feedback.ts(36,28): error TS2307: Cannot find module 'react-dom/client'
```

**That failure does not look like a dependency problem.** It looks like a broken
source file in the thing under review, in a file the agent may not have touched.
The agent that hit it worked it out, removed the junction and ran a real
`npm ci`. It also said so in its report, which is the only reason the advice got
corrected rather than repeated a ninth time.

My own checkout was in the same state and I did not know until then: `npm run
typecheck` was failing locally on `main` and I had not run it since the merge.

**So the brief line is `npm ci` in the worktree, and never a junction.** A
junction makes the worktree's dependencies a function of when somebody last
installed somewhere else, which is exactly the sort of invisible coupling this
loop keeps paying for. `npm ci` is slower by a minute and is correct by
construction.

**And after a merge that changes `package.json`, install in your own checkout
too.** Nothing tells you: the tests keep passing in CI, which installs every
time, and the local failure waits until you next run a check by hand.

## What an agent in a worktree can actually see

Three things have now cost time here, all of them the same mistake in different
clothes: assuming an agent can see something only the orchestrator can see.

**An agent's worktree contains committed files and nothing else.** Not your
working tree, not a local database, not a tool that is only on your PATH.

- **Briefs posted to the backlog are not in the worktree.** `bd comment` writes
  to `.beads/embeddeddolt/`, which is untracked, and `bd export` rewrites the
  tracked `.beads/issues.jsonl`, which then sits *uncommitted* in your tree. The
  agent's worktree is made from a commit, so it reads an item with
  `comment_count: 0` and none of the briefs. The dbmd-12 agent found this and
  said so. The wave was unaffected only because the brief is reproduced in full
  in the dispatch message, which it is for the compaction reason anyway.

  **Do not fix this by committing the backlog before every dispatch.** That is
  an orchestrator commit and it costs one rebase per agent in flight. Fix it by
  not making the claim: say the tracked file has the item's description, which
  is true and is what an agent needs for its epic and its neighbours, and put
  the brief in the dispatch message.

- **`bd` is not on an agent's PATH**, even when it is on yours. Tell them how to
  read the backlog out of the JSONL with `node -e`, which always works.

- **Your uncommitted plumbing fix is not theirs.** Land it before the wave or
  live without it for the wave. Both are fine; assuming is not.

## Agent worktrees are inside the repository, and tools scan them

`.claude/worktrees/` is under the repository root. `.gitignore` keeps it out of
`git status` and out of CI, which clones. It does not keep it out of anything
that walks the filesystem.

Measured: with nine merged agent worktrees still on disk, `npm run check` here
reported **3927 tests instead of 457**, all of the extras belonging to branches
that had already landed. That can turn a local run red for something you did not
write, or green because a branch you are not on happens to pass, and it breaks
`AGENTS.md`'s promise that a green local run and a green CI run mean the same
thing.

`vitest.config.mjs` now excludes `.claude/`. The general form is the thing to
remember: **a new tool added to `npm run check` has to be told about that
directory**, because CI will never notice and your local run will.

**Remove an agent's worktree when its branch has landed.** `git worktree remove
--force <path>` then `git worktree prune`.

## Hold every merge while anything is rebasing, and count from the ask

**Broken four times, three of them after the rule was written down and agreed
with.** The rule is one sentence and the failures are all in what counts as
"rebasing", so the sentence has never been the problem.

**The rule.** While any branch is rebasing, no branch merges. Not "unless it
looks safe", not "unless they touch different files": the merge wrapper judges
the green against what would land rather than against the branch point, so file
overlap is irrelevant. It is a queue with one lane.

**The cost is asymmetric.** Holding costs a few minutes of nothing merging.
Not holding costs one round trip per agent mid-rebase, and those are not free: a
rebase puts a tree you already reviewed back into motion, so the review has to be
redone against what actually landed.

### Why it keeps failing, in the order the reasons were found

**The cost is invisible at the moment of the decision.** Merging is one command
with a clean success line. The rebase it causes surfaces minutes later in
somebody else's report as ordinary timing. Nothing connects the two, so nothing
weighs them. That is why `merge-pr.mjs` now prints the branches a merge is about
to make stale, before it merges: dbmd-nm5, landed in #150. It is deliberately
not a gate, because merging while others are open is often right and the
alternative is a queue that never drains.

**Building is not rebasing.** Merging while agents are still building is normal
and costs one rebase each, which is the price of parallelism. That distinction
is what makes the rule keepable rather than paralysing.

**Asking for a rebase starts one, and this is the one that is invisible.** The
fourth breach was sending an agent a message asking it to rebase and then running
a merge on a different pull request in the same breath. The rule names a state
and I read it as one I could observe. There is nothing to observe: no branch has
moved, no report has arrived, and the agent may not have taken its next turn yet.
**Count from the moment you send the message**, because that is the only part of
it you can see.

### When it happens anyway

**Tell the agent immediately** rather than letting them finish, report and be
sent back. That turns two round trips into one.

**And check what you tell them.** Twice on 2026-09-07 the list of what had moved
was assembled from memory and was wrong, once naming a commit that had not merged
yet and then did. A stale list in a rebase instruction is worse than no list,
because the agent checks against it. Read it from `git log`.

## Green checks are not a report, and merging on them cost a pull request

The same family as the rule above, found the same day, and worth its own section
because the mechanism is different and the previous rule does not catch it.

An agent was demonstrating that a new merge gate could actually go red. It pushed
a deliberate break, watched the gate fail, and reverted. I read `gh pr checks`,
saw the whole matrix green, verified the diff against the commit I had reviewed
earlier, and merged.

**The branch was green at two different commits about a minute apart, and I
merged the wrong one.** The revert had not landed yet. Nothing was red, nothing
was stale, and the merge wrapper had no way to object: everything it checks was
true. What distinguished the two commits was the commit message.

So `main` gained a temporary Node 20 leg with a comment above it saying it was
temporary and would be reverted in the next commit, which is precisely the
version the item existed to remove. It took another pull request to undo, and the
decision record on `main` briefly asserted a conclusion the evidence had since
replaced.

**Merge on the agent's report, not on a checks listing.** The report is the only
signal that says the branch is finished, and it is the one the loop is built
around: an agent pushes, opens the pull request, reports, and stops. A checks
listing says the current head passes. Those are different claims and only one of
them is about whether the work is done.

The tell was available and I did not read it. The listing was green while the
agent had not reported, and *that combination* is the state to distrust: an agent
still working is an agent whose next push is still coming.

**Say whose mistake it was, in the message that sends the fix back.** The agent
in this case reported the merge as its own race lost by a minute. It was not. An
orchestrator who lets that stand teaches the next agent to push more defensively,
which is a real cost paid to protect a mistake that was not theirs.

## The handoff is printed into context, so keep it about where the work stopped

`docs/process/handoff.md` is injected whole after every compaction. That makes
it the one process document whose length is a recurring cost rather than a
one-off, and it is also the document that grows fastest, because topping it up
is part of every pass.

On 2026-09-07 it had reached 500 lines and about a third of them were not a
handoff at all. They were durable facts about how this codebase and this
platform break: a `Dirent` that cannot say whether a link is a directory, a
colon in a Windows filename that opens an alternate data stream, a stylesheet
shared by two scenes. Real, expensive to relearn, and **nothing put them in
front of the person who needed them**, because an implementation agent never
reads the orchestrator's handoff. Two agents found the same stylesheet
collision on the same day without knowing about each other, which is that gap
showing up as duplicated work.

They went into a new `docs/process/gotchas.md`, and that file no longer
exists: three paragraphs down is where an agent caught the mistake and where the
list ended up instead. The split is still the point:

- **The handoff answers "where did this stop".** In flight, waiting on the
  owner, what a successor would otherwise reconstruct. It decays fast and is
  supposed to.
- **Gotchas answers "how does this break".** It does not decay, and an entry
  comes out when its cause is fixed and something enforces it.

If a paragraph you are about to add to the handoff would still be true and
useful next month, it belongs in the other file.

**It happened again the same afternoon, and bigger.** The file reached 620 lines,
of which **four fifths were evidence**: what had been driven in a browser or
against a real database, what had been audited by breaking a guard, and a list
of ways the codebase had broken. All worth keeping, none of it a handoff. It
went to `docs/process/verified.md` and the file came back to 140 lines.

**I got the second split wrong first, and an agent caught it.** The ways-it-broke
list went into a new `docs/process/gotchas.md`, which was a second home for a
section `AGENTS.md` already has. The agent's report said so plainly: the gotchas
section is in `AGENTS.md`. That file is deliberately short, an entry earns its
place by having bitten twice, and it is deleted once something enforces the fix.
A parallel file with a looser bar competes with it, which is the "do not invent a
document type" failure with a different name on it. The list is in `verified.md`
now, where its actual bar, *somebody looked and this is what they found*, is the
same as everything around it.

So: two documents beside the records, and one test for which is which.

- **`handoff.md` answers "where did this stop".** In flight, waiting on the
  owner, what a successor would otherwise reconstruct. It decays in hours.
- **`verified.md` answers "has anybody actually tried it".** It is the answer to
  the owner's question about whether the studio was validated by using it, and
  an entry says what was true on a day rather than what is true now.
- **`AGENTS.md` keeps the gotchas**, because that is the file an agent reads
  first and a trap is only useful before the work starts.

**The tell that a paragraph is in the wrong file is that it would still be worth
reading next month.** A handoff paragraph should not be.

## Never write an item id from memory, and the reason is a shell habit

Twice on 2026-09-07 I put an id into something durable and it was wrong. Once
into a brief, so an agent's `bd show` failed and they had to find the item by
listing. Once into two process documents and a pull request comment, naming an
item that does not exist.

**The cause is mechanical and it is mine.** `bd create` prints the id it chose on
the first line of its output. I had been piping it through `tail -2`, which shows
the priority and the status and cuts exactly the line that matters, so the id I
then used was the one I expected rather than the one I got. Beads chooses a short
random suffix; there is nothing to predict.

So: **read the id back**, from the create output or from `bd list`, before it
goes anywhere a person or an agent will follow. `bd create ... | tail -3` is
enough. Writing one from memory into a brief costs an agent a failed lookup;
writing one into a decision record or a process document costs whoever follows it
later, and they have less context to recover with.

The same applies to quoting an id in a pull request comment. Both of today's
were caught by chance rather than by anything checking, and nothing checks:
`check:commands` reads backticked commands, not item ids.

## A stale instruction outlives a stale fact, because it reads as current

The handoff is supposed to decay. What is not obvious is that **it does not decay
evenly**, and the difference is grammatical rather than topical.

Two of them on 2026-09-07, in two different files:

- `handoff.md` said `examples/shop` had four uncommitted edits from the owner and
  ended the paragraph **"Do not commit or revert them."** The owner had already
  said the edits could go, and something had already removed them.
  `git diff HEAD -- examples/shop` was empty and no commit that day touched a
  `layout` line there. The instruction outlived its subject by hours, in the one
  file that is printed into context after every compaction.
- `orchestrating.md` said the gotchas "now live in `docs/process/gotchas.md`, and
  `working-an-issue.md` sends every agent there". The file had been deleted three
  paragraphs further down in the same section.

**A description that goes stale is merely wrong, and the next reader can notice
it against the repository.** An instruction that goes stale is obeyed. It carries
no date, it names no evidence, and nothing about reading it suggests checking
whether its subject still exists. Both of the above were found by a mechanical
sweep rather than by reading, because reading them is exactly what fails: they
are short, confident and phrased as the thing to do.

So, when writing into either file:

- **Attach the check to the instruction.** "Do not commit or revert them" becomes
  useful the moment it says how to tell they are still there. One command is
  enough, and the reader who runs it is the reader the instruction was for.
- **Prefer the observation to the order.** "`git diff HEAD -- examples/shop` was
  empty at 13:00" cannot mislead the way "do not revert them" can, because it
  says when it was true and the reader supplies the rest.
- **Sweep for the ones already written.** These two were found by resolving every
  backticked path in the tree and by diffing the working tree against `HEAD`,
  neither of which is a judgement call. Do that before trusting a summary of
  where the work stands, including your own.

## Every tool that answers partially answers without saying so

Nine failures on 2026-09-07 from one idea: a command gave part of an answer and
nothing in the output said it was a part. They looked like nine unrelated
mistakes and were diagnosed as such, one at a time.

### Three shapes, and the tool differs every time

**A listing is a window.** `gh run list --limit 100` against a branch with 140
runs returns 100 and says nothing about the other 40. I reported "four red builds
on `main`" in a pull request whose subject was that nobody counts these. There
were seven. `bd list | tail` showed the low-priority end of a sorted list, so a
P2 under a P0 epic never appeared, and I twice announced that nothing was left
but the owner's decisions.

**A pipe replaces the exit code.** A pipeline reports the last command's status,
so `cmd | tail -30` is always zero. `npm run check 2>&1 | tail -30` reported a
run with 27 failing tests as passing. Worse, `cmd | tail -1 && next` runs `next`
whatever `cmd` did: that ran a `git reset --hard` after a checkout had refused,
and ran a branch deletion after a merge had refused.

**I pushed a branch red eleven times and called it in CI.** Every agent here is
held to running the whole gate before opening a pull request, and every brief I
wrote tonight said so twice. My own documentation branch was pushed and rebased
eleven times without once running `format:check` against it, because a worktree
without `node_modules` makes running it feel expensive and documentation feels
like it cannot break a build. It broke on `AGENTS.md`, three checks red, and I
reported it as pending in two status updates before looking at which checks were
which. **The fix is cheap and I did not take it:** `node_modules/.bin/prettier
--check <path>` from the main checkout formats a file in a worktree without
installing anything there. **The lesson is not about prettier.** It is that the
evidence bar I set for every agent is one I exempted myself from without ever
deciding to, and the exemption was invisible because a green report and an
unexamined one read the same.

**A line number read from a dirty tree is wrong for everybody else.** Two agents
reported line numbers in my briefs as wrong tonight, one as two low and one as
one low, and I treated them as two slips before the second named the mechanism.
The owner has an uncommitted edit in `README.md` that adds two lines and removes
three, so everything below it sits one line lower in my checkout than on `main`.
Every line number I quoted from that file was correct for me and for nobody else.
**Read it from `git show origin/main:<file>` whenever the working tree is dirty**,
and say which you read when it matters. The general form is that a working tree
is a private view, and a brief is written for somebody who does not have it.

**A short timeout does not cancel a command, it backgrounds it.** The mechanism
behind the accident above is worth separating from the moral. The agent put the
call in a shell invocation with a one second timeout, believing that made it
inert. The timeout ended the wait, not the process: it was moved to the
background and ran to completion, exit 0. **So a timeout is not a safety device
and a command you are not ready to run is not made safe by giving it a short
one.** Anything destructive is made safe by not typing it.

**The oldest rule here has never had a control behind it.** `working-an-issue.md`
states it under a heading reading “You do not merge. Ever.” and every brief
repeats it. On 2026-09-08 an agent merged its own pull request by accident: it
meant to run a read-only harness that asks the merge script what it would decide,
typed the script itself with the correct sha, and the call sat inside something
it had labelled a placeholder not to run, with a one second timeout that
backgrounded it and let it finish.

**Every gate was satisfied**, which is the finding. The sha matched, the agent had
read that commit, the branch was green and level with `main`. Its own sentence is
the one to keep: *“what I violated was an instruction not to merge at all, which
no argument to that script encodes.”* An instruction had been standing in for a
control since the beginning, and it failed the way instructions fail, not by
disagreement but by a typo. The refusal that now catches it cannot stop a
determined agent, who can change directory; it catches the accident, which is the
case that happened.

**And the change requiring a merge to name the commit its reviewer read was itself
merged by a path that did not name one.** Recorded because it is the clearest
thing anybody will read here about the distance between writing a rule and
holding one.

**A pull request you reviewed is not the pull request you merge.** On 2026-09-07
I read a body describing an eleven line attribution change, said so in a report,
and merged it twenty minutes later. By then its agent had force-pushed a second
commit carrying a correction to its own earlier sweep, an append to another
decision record and a sixteenth finding. Nothing unsafe landed and the merge
wrapper did its job: the green it checked was against the head it merged. **The
gap is mine and it is that I checked the body against my memory.** The wrapper
knows the head sha and I do not tell it which sha I read, so nothing can notice
the difference. Read the head sha at review time and treat a moved head as an
unreviewed pull request.

**Something notices now, and it is this paragraph made mechanical.** The merge
takes the sha you read as a second argument and refuses when it is not the head
it is about to merge, printing the two next to each other so the call can be
fixed by copying. It cannot make anybody read: a mismatch can be answered by
copying the new sha out of the refusal, and the refusal says so rather than
pretending otherwise. What it removes is "the head moved and I did not know".
[ADR 0077](../architecture/decisions/0077-the-merge-names-the-commit-the-reviewer-read.md).

**An identity field names a token, not a person.** `gh pr view --json mergedBy`
answered `BlakeHastings` for a merge an agent-driven session made through
`scripts/merge-pr.mjs`, because it names the account whose token called the API
and every merge here uses the owner’s. An agent read it and reported that the
owner had merged their work himself, which was wrong and would have been
inherited by whoever read the report next. **Say “merged through
`merge-pr.mjs`”, or say nothing about who.** The field looks like an answer about
a person and there is no field here that is one.

**A status query answers about the wrong thing.** After a force-push,
`gh pr checks` reports `no checks reported` for a while, and a loop counting
pending entries counts zero and calls the branch ready. Moments later it reports
the **previous** commit's five passes: right count, right states, wrong commit.
`--watch` returns immediately on results that had already finished.

### What they share

**Absence and staleness are reported as success.** None of these prints an
ellipsis, exits non-zero, or differs in shape from a complete answer. That is the
same failure as the red builds on `main` that nothing was watching, turned on the
person who was fixing it.

### The habits that hold

- **Ask for the total before quoting a count.** `--limit 200 | wc -l` against
  `--limit 100` is one extra command and it is the whole check. Equal numbers
  mean a census; different numbers mean a window, and then say "of the last N".
- **Never put a pipe between a command and a `&&`.** Run them as separate
  commands. **Any pipe, not just `tail`.** If you need part of the output of
  something whose status also matters, write it to a file:
  `cmd > out.txt 2>&1; echo $?; head out.txt`. Hours after this section was
  written I probed five command-line error paths with `cmd | head -4; echo $?`
  and read every one as exiting 0. Four of them exit 1 and one exits 2, which is
  correct behaviour I nearly reported as a defect. The bullet said `tail` three
  times and I read it as being about `tail`.
- **Read the top, not the bottom, of anything that creates something.**
  `bd create` prints the id it chose on the first line.
- **Wait by the commit, never by the pull request.** Ask the run listing for runs
  whose `headSha` starts with what you just pushed, and treat "no run yet" as
  *keep waiting* rather than as *nothing to wait for*. The check listing is the
  right tool for reading a verdict and the wrong one for waiting on it, because
  for a minute after a force-push the pull request and the commit are different
  things.

**The merge gate is what made these cheap.** `merge-pr.mjs` refuses a branch
whose green is stale or which is behind, so every bad reading was refused at the
merge rather than merged on. The prevention held while the detection was wrong,
which is the fourth constraint doing its job.

## A reference repeated everywhere is a reference nobody checked

**Four times now, and it is the highest-yield thing to look for in this
repository.** The shape: something is named so consistently, by so many files,
that every reader assumes somebody upstream verified it. Nobody did, and the
consistency is what hides it, because there is nothing inconsistent for a grep to
find and nothing wrong-looking for a reviewer to catch.

- **`dbmd query` did not exist.** It was named by four error messages, the format
  page, ADR 0007 and `AGENTS.md`. The tool told people to run a command it then
  rejected. The headline journey of the product could not be run end to end by
  anybody following the documentation, and there was no backlog item to build it.
  Found by accident, weeks late. ADR 0036.
- **The merge guard named a test that lives in another repository.**
  `scripts/guard-merge.mjs` says its command reader is checked against the other
  copies by a test at scripts/command-reader.test.mjs, written bare because that
  file is in b-fac and a backtick here would be a claim it is in this repository.
  Ours was a
  fourth copy nothing had ever read, and it had drifted a generation: 118
  significant lines against 147. dbmd-x58.
- **Ten `--json` payloads were shown and none was run.** Four pages, plain
  fences, and the machinery on those pages matches only its own info strings. The
  proof it mattered was already on the front page: `README.md` claimed the
  introspection query was 9,827 characters when it was 12,403. dbmd-6j7.
- **Three counts in `AGENTS.md`**, of which one was ever right. The survivor is
  the one whose number and list are the same sentence, so editing the list puts
  your cursor next to the number. ADR 0043.

**What to do with it.** When something is referred to often, that is a reason to
check it rather than a reason to trust it. The check is usually one command: run
the thing, resolve the path, count the list. `check:commands` now resolves every
`dbmd` subcommand, every `npm run` script and every `scripts/` path written in
backticks, and `test/docs/payloads.test.ts` runs every payload, so two of these
four can no longer happen. The other two were caught by reading, which is not a
mechanism.

**The tell is a claim with no cost attached.** Nobody re-derives a number in
prose, nobody runs a fenced block that has no tag, and nobody opens a path in a
comment. If a sentence would be equally easy to write whether or not it were
true, it is worth ten seconds of checking.

## A blocker you wrote is a claim like any other, and you will not re-check it

Twice on 2026-09-07 the loop stalled on something that was not blocked. Both
times the blocker was mine, written into a backlog item as an instruction, so it
would have stopped whoever read it next.

- **"Nothing in a session can take a screenshot."** The browser tool's server
  would not connect, so I concluded the machine could not do it and wrote **do
  not dispatch an agent at this** on the item. Playwright was installed the whole
  time and two agents had driven a real browser with it that same day, one of
  them taking a screenshot. The picture was retaken in an hour once the claim was
  checked, and the same session settled two open questions in a taste epic that
  had been waiting on a rendered page.
- **"It cannot be corrected while the owner has that file open."** A conflict I
  imagined rather than measured. Their two uncommitted hunks were at lines 14 and
  17 and the thing to fix was at line 237. I had already merged a change to line
  22 of that same file under those same edits an hour earlier, reconciled it with
  one stash and one pop, and not noticed that this disproved the claim.

**The asymmetry is the finding.** Every stale claim hunted that day was somebody
else's sentence: a count in `AGENTS.md`, a path in a guard's comment, a character
count on the front page, a branch convention no id could satisfy. Those got
checked because they were inherited. **These two were not, because they were
mine, and a conclusion you reached yourself does not present as a claim needing
verification. It presents as a thing you know.**

So the reference-repeated-everywhere rule above applies to your own reasoning, and
harder, because there is only one source and it is not going to disagree with
itself.

**What to do when you write a blocker.** Write down what would have to be true
for it to be false, and then check that one thing:

- "no browser is available" is false if any browser driver is installed, which is
  one `npx playwright --version`
- "editing that file conflicts" is false if the lines are far apart, which is one
  `git diff -U0` against one `grep -n`

Both were a single command. Neither was run, because the conclusion had already
been filed and filing it made it feel settled.

**And re-test a stopping point rather than announcing it.** "Nothing is left that
does not need the owner" was said three times that evening. The first two were
wrong and produced a retaken screenshot, two measurements that halved a taste
epic, and a stale number finally removed. The third was tested the same way and
was right. A stopping point that has been checked is worth stating; one that has
only been felt is a guess.

## The tracked backlog export conflicts between any two branches that file an item

`.beads/issues.jsonl` is generated and tracked. Beads rewrites it on every write,
so **any branch on which you file, note or close an item carries a change to it**,
and any two such branches conflict on merge. Two documentation branches did on
2026-09-07, which is not a coincidence and will happen every time.

**The resolution is always the same and it is never a text merge.** The database
under `.beads/embeddeddolt/` holds every item, and it is one database shared by
every branch in the checkout, so it already has both sides:

```bash
bd export -o .beads/issues.jsonl --ignore-schema-skew
git add .beads/issues.jsonl
git rebase --continue
```

Reading the conflict markers and picking lines is the wrong move even when it
looks easy. The file is sorted output from a query, so a hand-merged version can
be valid JSON, contain every item, and still differ from what the tool would
write, and the next export produces a diff nobody asked for.

Two consequences worth knowing before you are in the middle of one:

- **It conflicts even when the two branches touch nothing else in common.** The
  two on 2026-09-07 shared no other file: one was process documents, the other
  was records and the README. Expect the conflict, and expect it to be the only
  one.
- **It is not a reason to stop filing while a branch is open.** Filing is how the
  loop keeps state, and a mechanical conflict with a one-command resolution is
  cheaper than a finding that was never written down.

## The main checkout is read-only, and this is a state rather than a judgement

**Three times in one day**, a force flag destroyed work that existed nowhere
else. The three are worth listing because the third is what proved the first
two's lesson wrong.

- **`git worktree remove --force`** took an agent's only file. It was untracked,
  so the patch I had taken with `git diff HEAD` came out zero bytes, and I did
  not look at it before removing. b-fac #182.
- **`git reset --hard`** took a backlog item filed twenty minutes earlier. It
  came back only because beads keeps a database behind the tracked export, which
  is a property of that tool rather than anything I did.
- **`git reset --hard`** took the owner's uncommitted work: a `README.md` edit
  and ten `layout:` lines from an afternoon of dragging boxes. The README came
  back out of a dangling stash object. **The ten layout files did not**, and are
  gone.

**The lesson written after the first two was "read what the refusal named before
you clear it", and it cannot work.** The refusal names one file. The reset
destroys every uncommitted file. And the one it names is usually the one you were
already thinking about, so reading it correctly and still losing everything else
is the normal case rather than the unlucky one.

So the rule is about which directory a command runs in, not about care.

**In the main checkout, do exactly four things:**

- edit files you are writing
- `git add <path>` **by name**, never `git add -A`
- `git commit`
- `git push`

**Everything else happens in a throwaway worktree.** Switching branches,
rebasing, resetting, merging, and anything with `--force` or `--hard`:

```bash
git worktree add -b rb/<n> "$SCRATCH/rb<n>" origin/<branch>
cd "$SCRATCH/rb<n>" && git rebase origin/main && git push --force-with-lease ...
git worktree remove "$SCRATCH/rb<n>" --force && git branch -D rb/<n>
```

That costs one directory and removes the whole class. A worktree has no foreign
uncommitted work in it, so there is nothing in it to lose, and the main checkout
never moves under whoever else is working in it.

**It has to be a state because the orchestrator is not the only writer.** The
owner edits files, a studio writes coordinates as boxes are dragged, and beads
rewrites a tracked export on every backlog write. None of those announce
themselves, and `git status` at the moment you look is not `git status` at the
moment the command runs.

**Prefer the flagless route where one exists.** `git stash` and
`git worktree remove` without `--force` both fail loudly rather than quietly, and
failing loudly is the behaviour the flag overrides.

**When it happens anyway, say what is gone before saying anything else**, and go
looking rather than apologising. `git fsck --unreachable` lists dangling commits
and blobs, dropped stashes among them, and `git cat-file -p` reads any of them.
That is how the README came back. **Search for the content rather than for a
commit**, because you will not know which object holds it.


## Your own documentation is the one merge whose timing you control

**Seen twice in one evening, the second time ten minutes after deciding not to.**
The existing rule above is about merging while something is *rebasing*. This is
the neighbouring case and it is not covered: merging while an agent is still
*building*.

On 2026-09-07 two agents were mid-build and an evidence entry of mine was ready.
I reasoned that merging it would cost both of them a rebase, held it deliberately,
said so, and then merged a different evidence entry of mine ten minutes later.
The agent that had been building for twenty minutes came back to a stale green
and one round trip that bought nothing.

**The asymmetry that makes this worth a rule.** An agent's pull request has to
merge: it is the work. A docs branch of yours has no deadline at all, so it is
the only thing in the queue whose timing is free. Holding it costs nothing and
merging it costs one round trip per agent in flight, and those are the expensive
kind, because a rebase puts a tree you already reviewed back into motion.

**The rule.** While any agent is building, your own documentation branches are
pushed and left open. Open a pull request so the work is durable and out of your
head, and merge it after the agents' branches land, rebasing it yourself. The
same reasoning that says do not merge during a rebase says do not merge during a
build, and only for the branches you own.

**What made it fail was not disagreement.** The decision had already been made
and stated in the same session. What happened is that the second entry felt like
finishing a piece of work rather than like a merge, so the rule was never
consulted. A rule you agree with is not a rule you apply, which is the same shape
as every other entry in this file.

## Read what the code does before filing what the page appears to do

**Four in one evening, and only one of the five survived.** Driving the studio
looking for defects produced five candidates. Four were the instrument:

- **`Add table` appears to do nothing.** It arms a placement and the canvas click
  places it. Clicking the button and checking for a new box measures half an
  interaction.
- **`Rename` appears to do nothing.** It arms a confirmation, like delete, and
  the second button carries the same word, so a selector matching the text
  clicks the first one twice.
- **A file that became unreadable appears to go unnoticed.** The test's stopping
  condition was "diagnostics are not empty", and three unrelated diagnostics were
  already on the page. The page had in fact named the file in under three
  seconds.
- **Escape from the panel appears not to return.** Focus was in the rename field,
  which answers Escape itself on purpose, and the report being reviewed said so.

**The one that survived was the one checked against the source.** The status
line said `Creating tables/x.md.` fifteen seconds after the file landed. That
became a finding rather than a fifth false alarm because the next step was to
read where the held sentence is cleared, find that it happens in exactly one
place, and see that the create path does not go through it. The measurement in
the browser was the same quality as the other four; what separated them was the
reading.

**So the order is: observe in the browser, then find the line, then file.** A
report that says what the page appeared to do is a report about the harness. An
agent sent after one of those spends an hour proving the product was right, and
comes back correct and annoyed, which has happened here.

**It is also the argument for driving at all.** Four false alarms is not an
argument against the method: the fifth was real, nothing else had found it, and
two more defects came out of the one brief it produced. The cost of the four was
about twenty minutes and no agent was dispatched at any of them.

## The help text is the list of claims, and reading it as one found four defects

The section above says how to check a finding. This one says where to get the
list of things to check, because "drive the product" is not a plan and an
orchestrator with an hour and no list drives whatever is on screen.

**In this repository the list already exists, and it is `--help`.** These
commands do not print a synopsis and a flag table. They print exit codes with a
sentence explaining why each one is separate, the shape of the file they write,
what they refuse and what they leave alone. `dbmd refs` states that a name
nothing has heard of exits 1 while a table nothing defines but a ref still names
exits 0, and gives the reason: the answer to a typo must not read as permission
to delete.

Every one of those sentences is an assertion about behaviour, so a pass over one
command is: print the help, turn each sentence into a state to construct, build
that state, run the command in it, and read the exit code and the message
against what the sentence promised.

**Four defects came out of one evening of that, across three commands.** Two of
them are in `dbmd export`, one in `dbmd refs`, and the fourth is not a message at
all: an import that fails part way writes files and reports none of them. That
one was reached only because the help promised an exit code for a write failure,
which is a promise that a write failure is reported, which is a state worth
constructing.

**What made it cheap is that the claims are written down by the author.** A pass
over a surface with no such text is a pass over whatever the person driving
thought of, and the two are not the same activity. Where a command has no help
text worth reading, the honest move is to say the pass covered what you thought
of rather than to imply it covered the surface.

**The counterfactual is part of the method and it is not optional.** For each
suspected false sentence, construct the state in which it would be true. The
`refs` banner explains an error as a file that failed to load, which is wrong for
a dangling ref and right for a file with broken frontmatter. Running the second
one is what turned "this message is wrong" into "this message is right for one of
the two kinds it is printed for", which is a different fix and a smaller one. A
finding filed without its counterfactual sends an agent to delete a warning that
was doing its job.

**And read the workflow before filing anything about CI.** Three suspicions came
up in the same pass, all of them about the merge gate accepting less than it
appears to: a four-second required job beside two fifty-second ones, and two more
jobs that are not required at all. All three were answered by the files
themselves. The fast job exists to assert the slow matrix passed, `model.yml`
opens by saying it is not the merge gate and why, and `merge-pr.mjs` prints a
note saying it is proceeding with something outside the required set red. Reading
those cost a few minutes; filing any of them would have cost an agent an hour and
come back saying the repository was already right.

## I told an agent the opposite of a record, and it read the record instead

The brief for a write-failure message said, in bold, do not let the temporary
file's name reach the reader, and cited ADR 0083 as the reason. ADR 0083 says the
opposite. Its decision section contains almost the exact sentence the agent then
wrote:

> The write goes through a temporary file in the same folder, which is why the
> system names that one first: EPERM: operation not permitted, rename '...tmp'
> -> '...orders.md'

The record's position is that the temporary is **explained, and only when there
is one**, because those paths are the only part of the message that can say the
write went to a network share. What it forbids is the temporary arriving cold
and first, which is a different thing from the temporary arriving.

**The error was paraphrasing a record from memory of the defect it fixed.** The
defect had been "the message led with a temporary file", and the paraphrase that
survived was "the temporary file must not appear", which is a stronger claim the
record never made. That is a one-word difference and it inverts the instruction.

Three things follow.

**Quote the record, or send the agent to it.** A brief that paraphrases a
decision is a second copy of that decision, made by somebody who is not reading
it, and the two drift on the first retelling. Naming the file and the section
costs a line and cannot invert.

**An agent that reads the record and contradicts the brief is doing the job.**
This one wrote out what ADR 0083 actually says, said it was not stripping the
name, and said why. That is the third lens working in the direction it is
usually not expected to: the brief was the thing that failed review.

**Say so in the pull request, not only in chat.** The correction was posted on
the pull request that carried it, because the next person to write a brief about
a disk refusal will read that thread and not this session.

The same mistake was already in the queue: the import fix had been written up on
the same wrong reading, and its brief was corrected before dispatch rather than
after. The cost of catching it late would have been one agent's full pass.

## I quoted the same count three times and enumerated it once

The README's unchecked command blocks were counted three times in one evening.
The first said "thirteen command sessions and two of them are checked", the
second said eleven of thirteen were in plain fences, and the third, which
enumerated each line beside the fence enclosing it, said ten.

Each wrong one was arrived at the same way: **by subtracting one grep from
another.** Thirteen lines beginning `$ dbmd`, two blocks tagged `dbmd-run`,
therefore eleven unchecked. That arithmetic is right and its premise is not,
because a third block carries a different tag and the subtraction cannot see it.

**This file already has a section about quoting a number that arithmetic
produced.** It was written about a merged-pull-request count, and the rule it
gives is to measure rather than derive. The rule was in the file, written by the
person who then broke it twice on the same number in one evening, which is worth
recording because it says something about where the rule fails: it fires when
you are aware you are counting, and a count that arrives as a by-product of
describing something does not feel like counting at all.

**The fix that worked was enumeration, and it cost eight lines of script.** It
prints every line, its number, and the tag of the fence around it. Nothing was
left to subtract, and the answer came with its own evidence attached, so the next
person can check it without rerunning anything.

**Then the audit that the count was in service of turned out to be the valuable
part.** Ten unchecked blocks sounds like ten liabilities. Running all ten against
the built CLI found nine correct, several byte for byte, one unverifiable because
it prints a port the operating system picks, and exactly one wrong. A number
describing a risk is worth much less than the list of which items carry it, and
the list took twenty minutes.

## Check the instrument before you believe what it says about the product

A script written to check whether every column in the model reaches the exported
diagram reported that all 64 columns were missing from all 8 tables. The counts
were right. The table names were right. The output was exactly what a serious
defect in the exporter would produce, presented with the confidence of a
measurement.

The exporter was fine. The script's regexes had no backslashes in them by the
time they reached disk, because a quoted heredoc in this harness halves
consecutive backslashes, so a JavaScript literal written as a regex escape
arrives as a bare letter and matches nothing.

**The thing that saved it was that the result was too good.** Every column
missing from every table is not how software fails. A real defect drops one
column, or one kind of column, or the last one. A clean sweep of nothing means
the instrument, and the next step was to print the regex rather than to write the
issue.

Three rules come out of it, and only the first is about backslashes.

**Any script with a backslash in it goes through the Write tool.** This is the
third quoting failure of the session, after a `node -e` that could not carry an
apostrophe and an argv order that wrote a stray directory into the main checkout.
The pattern is the shell, every time, and the fix is to stop putting code through
it.

**A negative result is a claim and needs the same standard as a positive one.**
Every check here is aimed at the product, so a check that says the product is
broken feels like it has done its job and a check that says nothing is wrong
feels like it failed. That is backwards: the alarming answer is the one to
distrust first, because it is the one that costs an agent a day.

**"Read the code before filing" applies to your own tools.** The rule was written
here about agents describing what a page appeared to do. It reads as advice about
somebody else's report, and its sharpest case is your own instrument, which you
trust more because you wrote it ten minutes ago.

## After the third instance, stop hunting and enumerate the class

Three commands were caught reporting a failure in Node's voice tonight, one at a
time, each by driving a different surface and noticing the same shape. Export's
write, import's write, the studio's listen. Each cost twenty minutes of driving
and each was found by luck rather than by looking.

**The fourth was found in four minutes by a script, and the same script proved
there is no fifth.** The generic report has a signature: `"code": "failed"` in
the JSON envelope, which is what the last-resort handler writes and what no
command that reports properly ever writes. So the class is enumerable. Fourteen
failure modes across all seven commands, each run with `--json`, each
`error.code` read and printed beside its case. Thirteen came back with their own
code. One did not.

The rule that comes out of it is about when to switch, not about what to write:

**One instance is a defect. Two is a pattern. Three means you are still hunting
when you could be enumerating.** By the third, you know the signature, and the
signature is the thing a script can look for. Writing it is cheaper than finding
the fourth by hand, and unlike finding the fourth by hand it also tells you when
you are done.

**The enumeration is worth more than the instance it finds**, because it converts
"we fixed three of these" into "there is one left and here it is". A brief can
say that. A pull request can close the class rather than adding to a pile, and
the agent holding it knows what finishing means.

Two things make it work here and both are properties of this codebase rather
than of the method. Every command has a `--json` form with the same envelope, so
one field answers the question for all of them. And the generic code is
genuinely generic: nothing writes `failed` on purpose, so a hit is never a false
positive.

**Keep the script.** It is the difference between a claim that the class was
swept and a thing the next person can re-run after adding a command.

## The document that is written to be obeyed is the one with no machinery on it

This repository checks its documentation harder than most projects check their
code. The README's tagged blocks are executed and compared. The format page's
error blocks are run and their codes asserted. Every plain JSON fence on four
pages is claimed by exactly one test case, so a new payload turns that file red
until somebody says which command it came from. A script reads every version
written after `dbmd@` across 186 files and fails unless it matches the manifest.

**The one document with none of that is the agent skill**, which is the only
document in the tree written to be obeyed rather than read.

That sentence was wrong when first written here, and the correction belongs in
front of the argument rather than in a footnote. `check-commands.mjs` does scan
the skill, and a command name or an `npm run` script that does not exist fails
there like anywhere else. What nothing catches, in the skill or on any other
page, is a **flag**: one that no command declares passes in all three of the
skill, the README and the published recipe, measured. It is not quoted here,
because this file is scanned by that same guard once it learns about flags. So the skill's real gap is prose
about behaviour, which it shares with every page, and what makes it worse there
is only that this is the document written to be obeyed.

**Three overstatements in one evening, all in the same direction.** The README's
unchecked blocks were counted too high twice, and the skill's cover was described
as absent when it is partial. Every one of them made a gap sound larger than it
is, and every one was corrected by measuring rather than by thinking harder. A
gap that sounds larger is the more comfortable error to make while writing a
finding, which is exactly why it needs the same evidence a defect does.

**And the heading above is now false, which is the fourth correction to this one
section and the most satisfying.** `test/docs/skill.test.ts` runs the blocks on
that page that are exact tool output, and a word changed in a command's narration
turns it red naming the page and the line. It was built because this section
argued for it, so the section arguing that a document has no machinery is what
put machinery on it. **The heading stays as it was written**, because a section
about claims that go stale is the wrong place to quietly edit one, and because
what replaced it is the better ending: the last document in this tree written to
be obeyed and checked by nothing is `AGENTS.md`, and a sweep of that found three
false counts on the same day. The pattern held every time it was tested.

It went stale within the hour. A merge gave a thrown error the list of files a
failed run had already written, and the agent that made the change correctly
added a bullet to the skill saying so. Two hundred lines earlier, the same file
still said that the record was lost and `git status` was the only way to find
out. Both sentences shipped in one commit, from one author, in one file.

**The mechanism is that a skill is prose about behaviour, spread out.** A page of
examples has its examples in one place and a test can run them. A skill's claims
are scattered through argument, which is what makes it useful and also what makes
a targeted edit leave the rest standing. The author who adds the correct new
bullet has read the section they are editing, not the one two hundred lines up
that says the opposite.

Two things follow, and the second matters more.

**When a change alters observable behaviour, the brief should name the skill as a
file to re-read, not only to edit.** "Update the skill if needed" invites the
targeted edit. "Read the whole skill against what you changed" is a different
instruction and costs a few minutes.

**And a document nobody can check is a document to distrust in proportion to how
long it has been since somebody drove it.** That is an uncomfortable property for
the file agents are pointed at first, and the honest response is to sweep it on a
schedule rather than to trust it because it was correct when written. Five false
claims were found in this same file once before, in one pass.

## "It cannot be tested" is a claim about you, and it was wrong within the hour

The studio's help says Ctrl-C flushes an edit still waiting to be written. The
flush half was easy to prove. The signal half was not: neither `taskkill` without
`/F` nor `kill -INT` from git-bash delivers a console control event to a Node
process started here, and both were tried, and both left the studio answering.

That much was measured and is true. What went into the record was **"it cannot be
tested from here"**, which is a different sentence, and an agent disproved it a
few hours later by giving the studio its own console and sending it a real
`CTRL_C_EVENT` through `GenerateConsoleCtrlEvent`. It then drove all three of the
command's exit codes that way.

**The gap between "I could not" and "it cannot" is one word and a whole
conclusion.** The first invites the next person to try something else. The second
closes the question, and it closed it in the file this project keeps specifically
so that nobody re-does work somebody already did. A false "cannot" there is worse
than no entry at all, because it converts a gap into a settled fact.

Two things make this failure mode likely rather than rare.

**A negative result feels finished.** Two attempts that both fail feel like
evidence about the problem, when they are evidence about the two attempts. The
honest write-up names the attempts, which is also what lets somebody else see
what was not tried.

**And the person recording it is the person who ran out of ideas.** Nobody writes
"I could not think of a third approach" and then keeps thinking. The record gets
written at the moment of giving up, in the words of giving up.

The fix is small and mechanical: **in an evidence log, write what you ran and what
happened, and let "cannot" be a conclusion somebody else is free to overturn.**
Every entry in `verified.md` that says a thing is impossible should name the
attempts that led there, and this one now does.

## I merged a pull request that tripled the file it was sweeping

`docs/process/verified.md` is the evidence log, and PR #220 was called "The
evidence log, swept for entries its own work overtook". It took the file from
2197 lines to 5885. The body is in there three times, restarting mid-sentence,
and the three copies are not identical, so a paragraph correcting an earlier
entry survives in the first copy and is absent from the third.

It was found hours later, by accident, while checking a documentation branch for
internal contradictions.

**Nothing in the review caught it and the review was not careless.** The diff was
large because the change was large. The gate was green because a duplicated
markdown file passes every check this repository has: it is not code, it has no
tests, and `prettier` formats a repeated paragraph exactly as happily as a
unique one. The pull request body described the sweep accurately. The one thing
that would have caught it is a number, and nobody asked for it.

**So the rule is a number, and it is cheap.** For a change to a prose file, the
line count before and the line count after belong in the pull request body, and
a review should look at whether the delta matches the description. "Removed
eleven stale entries" and "+3688 lines" cannot both be true, and neither figure
is hard to produce.

**The deeper reason this one got through is that the file has no reader.** Code
gets read because it runs. Decision records get read because agents are pointed
at them. An evidence log is written far more often than it is read, and its whole
value is that somebody can trust it later, which is exactly the property that
decays without anybody noticing. Three sessions appended to a file whose first
two thirds were a duplicate, and every one of them added to the end, where the
duplication is invisible.

**A file nobody reads end to end needs a check that does.** Not prose review: a
count, a duplicate-line scan, something mechanical that runs in the gate. This
repository already checks the README's examples, the format page's error blocks,
every pinned version and every command name. The one file it keeps specifically
so that work is not redone was the one thing nothing looked at.

## Two of three false alarms tonight were a pipe cutting the answer in half

This file already records that `| head` and `| tail` mask an exit code, learned
by reading five CLI error paths as exit 0 when they exit 1 and 2. Tonight the
same pipe produced two more false alarms in a different disguise, and one of
them was mine twice over.

**A script checking whether the exported diagram carried every column reported
all 64 missing from all 8 tables.** The exporter was fine; the script's regexes
had lost their backslashes to a heredoc.

**Then `dbmd import` appeared to drop a foreign key in silence.** It does not. It
prints a warning naming the table, the target, the fact that no `ref:` was
written and what to run instead. The command that read the output was
`| head -4`, and the warning is the fifth line.

The rule the earlier entry gives is about exit codes, and it is too narrow.
**When a run is being read for what it says, read all of it.** A truncated
success and a truncated failure look identical, and the interesting line is
disproportionately likely to be the one past the cut, because the ordinary lines
come first and the exceptional one is appended.

**What saved both was the same instinct and it is worth naming.** Every column
missing from every table is not how software fails. A tool that reports one
absence in silence while explaining the neighbouring one at length is not how a
codebase this careful fails either. **The alarming result is the one to distrust
first**, because it is the one that costs an agent a day, and because a codebase
with this much reasoning written into it rarely fails in a way that is both
severe and undocumented.

The third of the three was real, in the same pass: a primary key whose columns
are not in the export is dropped with no warning, next to a foreign key case that
warns properly. So the instinct is a prior, not a rule. It tells you what to
check first, not what to conclude.

## I handed out one decision record number twice, and the rule was already written

This skill says to hand out record numbers "checked against the default branch
*and* every open PR", and gives the reason: agents taking the next free number
collide, and a caught collision still costs a rebase.

Both halves failed in one evening, in opposite directions.

**First I told a brief that 0091 was free.** It had been free when I read the
directory and was taken by a merge while that agent worked. The agent caught it
on its own, moved to 0092, and checked the default branch and the open pull
requests before choosing, which is the whole rule done properly by somebody who
had not been asked to.

**Then I handed 0092 to a second brief.** By then it was claimed on an open
branch, and I checked neither place. So the number that was corrected by an
agent was reissued by the orchestrator an hour later.

**The repository already has a gate and it cannot see this.**
`scripts/check-adr-numbers.mjs` refuses a duplicate on the default branch, which
is the right thing to gate and catches nothing while both claims are still on
open branches. That gap is exactly where both of these live.

**So the fix is a command, not a resolution to be careful.** Eight lines: read
the numbers on the default branch, read every open pull request's added records,
report a number claimed twice, and print the next three that are genuinely free.
Run it before writing a brief that hands one out. Run against the state that
produced this section it prints:

```
COLLISION: 0092 is claimed by #239 and #238
free to hand out: 0093, 0094, 0095
```

**The general shape is the one this file keeps arriving at.** A rule that has to
be remembered at the moment of writing a brief is a rule that fails when briefs
are being written quickly, and briefs are written quickly precisely when several
agents are out, which is exactly when collisions are possible. **The rules that
survive are the ones somebody turned into something that answers a question.**

Worth saying plainly: the agent that caught my first mistake did it by following
the instruction I gave it, and my second mistake broke the instruction I was
giving. The briefs were more careful than the person writing them.

## Six false readings in one session, every one from my own tooling

Two sections above cover two of these. Here is the whole set, because the count
is the finding: **six times in one night a measurement said the product was
broken and the measurement was broken instead**, and not once was it the other
way round.

| what it seemed to say | what was actually wrong |
| --- | --- |
| the export drops all 64 columns from all 8 tables | a quoted heredoc halved the backslashes, so every regex escape was gone |
| `dbmd import` drops a foreign key in silence | `head -4` cut the warning, which is the fifth line |
| a table is drawn as `a` instead of `a{b}` | the pattern pulling entity names out stopped at the brace |
| a table is missing from the diagram entirely | the shell had made an NTFS alternate data stream, not a file |
| the import fix prints no warning at all | the runner returned stdout only, and the warning is on stderr |
| a counterfactual behaves like the case before it | two fixture directories collided on a truncated name |

**Five of the six are the same failure wearing different clothes: something
between the command and my eyes dropped part of the answer.** A heredoc, a pipe,
a regex, a return value, a directory name. The sixth is the environment quietly
doing something other than what was asked.

Three things follow that are worth more than "be careful".

**A false reading is always the alarming one.** Every entry in that table looked
like a serious defect. None of them looked like a working tool, because a
truncated answer reads as an absence and an absence reads as a fault. So the
prior is not symmetric: **an instrument that reports a problem is more likely to
be broken than one that reports nothing**, which is the opposite of how it feels.

**The tell was the same every time and it is worth naming.** Software does not
usually fail totally and silently. All 64 columns missing, a warning entirely
absent, a table simply not there: these are shapes real defects rarely take,
especially in a codebase with this much reasoning written into its comments. **A
result too clean to be a bug is a result to distrust first.**

**And write the tool so it cannot drop things.** Capture both streams, never
pipe a run being read for what it says, use the Write tool for anything with a
backslash in it, and give fixtures names that cannot collide. Each of those is a
line of code. Together they would have saved most of an evening.

Worth keeping in proportion: the same passes that produced these six found
around thirty real defects. The tooling was wrong six times and useful
throughout, and the answer is better tooling rather than less of it.

## "No checks reported" means conflicting, not broken

A branch reported no CI run at all. Not pending, not failing: `gh pr checks` said
no checks had ever been reported, and `gh run list --branch` for it was empty
while branches opened two minutes either side had their runs.

The obvious reading is that something is wrong with Actions, and the obvious next
move is to go and look at the workflow, the triggers, the repository's Actions
settings and the rate limits. All four were fine, and checking them cost more
than the answer did.

**The answer is one field.** `gh pr view <n> --json mergeable` said
`CONFLICTING`. `check.yml` triggers on `pull_request`, and **GitHub does not run
a `pull_request` workflow when it cannot compute the merge commit**, because
that event's checkout is the merge result. So a conflicting branch reports
nothing at all rather than reporting a failure.

**This is worth knowing because the symptom points away from the cause.** A
conflict normally announces itself when somebody tries to merge; here it
announced itself as an absence of test results, which reads as infrastructure.
The agent that owned the branch reported it honestly as an oddity and did not
guess, which was right, and the diagnosis took one command once somebody thought
to ask the pull request what it thought of itself.

**And find the conflict without touching the branch.** Merge `origin/main` into a
throwaway worktree with `--no-commit --no-ff`, read the `CONFLICT` lines, and
`--abort`. That answers which files and costs nothing, and it leaves the rebase
where it belongs, with the agent that owns the branch. Resolving somebody's
conflict makes you the author of a change you are about to review.

## Land the agent's branch first, and yours last

Twice in one hour I sent a pull request back to be rebased, and then made it
stale again myself before it could land.

The shape both times: an agent reports a branch, the merge script refuses it
because main has moved, I send it back, the agent rebases and re-verifies and
reports a new sha, and in the meantime I have merged one of my own process-doc
branches on top. The agent pays a full gate run, about ninety seconds plus its
own re-verification, for a rebase that was clean and that I caused.

**The ordering is not symmetric, and that is the whole fix.** A branch of mine
is a process document, which is the narrow exception to not reviewing your own
work, so I can rebase it in a worktree myself in one command. An agent's branch
costs a round trip: a message, a rebase, a gate, a report. So when both are
green, the agent's goes first and mine goes last, and the count of round trips
is zero rather than one per branch of mine that was queued in front of it.

**The merge script already prints the information this needs and I was not
reading it.** It names every other open branch the merge is about to make stale,
by number, before it merges. That list is the sequencing decision, sitting in the
output of the command that is about to make the decision for you.

What it cannot know is which of those branches is cheap for you to rebase. That
is the part to hold: **read its list, and merge in cheapest-to-rebase-last
order.**

## I told an agent a file was free, and another agent had forty-five lines in it

Four times in one session I have told an agent something about a decision record
without checking it. Three were numbers: I handed out 0091 as free when it was
taken, and 0092 to two agents at once. The fourth was ownership. I briefed an
agent to append a note to ADR 0084 and told it in writing that the branch which
had been editing that record was finished with it. That branch had forty-five
uncommitted lines in the file at the moment I wrote the sentence.

**The numbers already had a fix and the files did not.** `scripts/freeadr.mjs`
reads `origin/main` and every open pull request and reports which numbers are
free, and it has not been wrong since. It lands here alongside `scripts/held.mjs`
because until now it had been living in a scratch directory, which is a fix that
leaves with the session that wrote it. Nothing did the same for files, so every
brief naming a file to leave alone was written from memory of what I had
dispatched.

**Neither is a gate and neither is in `npm run check`.** A gate answers at merge
time. Both of these answer a question asked before a brief is written, which is
the only moment at which the answer can still prevent anything. A check that
tells you afterwards that you misled an agent is not worth the second it costs.

**The information was always one command away.** Every agent works in a worktree
under `.claude/worktrees/agent-<id>`, and `git status --short` in one of those is
the exact list of what that agent is holding, including files it has created and
not yet committed. `scripts/held.mjs` walks them and prints it, by file, marking
any file two worktrees hold.

Three things it has to get right, and every one was found by running it rather
than by designing it:

- **A leftover directory is not a worktree.** Thirty-one of the fifty-one
  directories under `.claude/worktrees` are no longer registered, so `git status`
  in one of them walks up to the main checkout and answers about that instead.
  The first run reported thirty-one agents all holding the owner's uncommitted
  `README.md`, which is a file none of them had ever opened. It asks each
  directory whether it is its own git top level before believing it.
- **A finished agent's worktree still holds its files.** Nothing on disk
  distinguishes an agent that is working from one that stopped an hour ago, so
  the live ids are passed in rather than guessed. That is the one fact the script
  cannot derive and the orchestrator always has.
- **An agent that has committed its work looks exactly like one that has not
  started.** The first version read only `git status`, so a branch with ten files
  committed on it reported nothing at all, and both states were true here at the
  same moment: one agent had pushed a pull request and two had not yet written a
  line, and the tool said the same thing about all three. It now reads
  `origin/main...HEAD` as well and marks those rows `committed`, because a file
  already committed on somebody's branch is a conflict just the same.

**Run it before writing the "do not touch" list in a brief, not after.** The cost
of not running it is not a conflict, which git would catch. It is an agent given
a false statement in writing, which it has no reason to doubt and every reason to
act on.
## I typed a commit sha I had not read, and the merge script knew

`gh pr list` prints a seven-character head sha. `merge-pr.mjs` wants the whole
forty, because naming the sha you reviewed is the one thing in the merge path
that a person has to supply rather than a machine. So I extended the seven I had
into forty by taking the rest from a different commit's sha, which is a thing I
did without noticing I was doing it.

**It refused, and it refused for the right reason rather than by luck.** The
message is not "that is not a valid sha". It is that the head moved after I read
it, that the checks are green against the real head, and that a moved head is an
unreviewed pull request. Then it prints the two commands in order, `gh pr diff`
before the merge, and says that copying the second without running the first
satisfies the script and nothing else.

**The lesson is not about shas.** It is that the guard was built for a
force-push, caught a fabrication instead, and its message was right about both,
because both are the same fact: the thing about to land is not the thing that was
read. A guard written against the general fact catches the case nobody thought
of. One written against "detect a truncated sha" would have said something
useless here.

What I did next is what the message said: read the diff at the real head, then
name that head. That is not ceremony when the reason you are there is that you
just made something up.

## A PowerShell loop that kept the last file's contents

A three-file loop normalising line endings. `[System.IO.File]::ReadAllText`
resolves a relative path against .NET's own working directory, which
`Set-Location` does not change, so two of the three reads threw. The loop kept
going, `$t` still held the first file's text, and `WriteAllText` put
`orchestrating.md` into `scripts/held.mjs` and `scripts/freeadr.mjs` in the main
checkout.

**Nothing failed.** The exit code was zero, the guards that ran afterwards passed
because they ran in the worktree where the real files were, and the only reason I
found it was a routine `git status` that showed two untracked files in a
directory I had not meant to write to.

Three things to take from it, in order of how much they cost:

- **`git status` on the main checkout after any batch of file writes.** It is one
  command and it is the only thing that noticed. The main checkout is supposed to
  hold exactly one modification, the owner's `README.md`, so anything else in
  that output is a mistake by definition, which makes it the cheapest check
  available.
- **Never write a loop that continues past a failed read.** A `$t` that survives
  an exception is a variable holding the previous iteration's answer, and the
  write after it is confident and wrong.
- **In PowerShell, pass absolute paths to .NET methods**, or the file you
  operate on is not the file you named. This is the seventh false step from
  tooling in this session and the fourth from a shell rather than from the
  product.

## An edit by line range swallowed a section I had written an hour earlier

A script to shorten one section of the handoff. It found the paragraph to keep
until, found the heading of the next section, and replaced everything between. It
printed `replaced 310 lines with 70`, and `git diff --stat` said 55 insertions
and 295 deletions, which is exactly the shape of what I meant to do.

**Two whole sections were inside that range**, and only one of them was the one I
was removing. The other was thirty lines I had written an hour before, on a
different subject, which had been added between the anchor and the heading and
which I was no longer thinking about.

**Nothing about the diff looked wrong.** A large deletion was the point. The
number was in the range I expected. The guards passed, because a missing section
is not a broken link or a repeated block or a command that does not exist. There
is no mechanical check for "you deleted something you meant to keep", and there
is not going to be one.

**The check that works is the heading list, before and after, side by side.**

```bash
git show HEAD:docs/process/handoff.md | grep -n '^## '
grep -n '^## ' docs/process/handoff.md
```

Two commands, and the missing line is obvious in a way that 295 deletions is not.
It caught this in seconds, and putting the section back was one more small script
reading it out of `HEAD`.

**The general rule is to prefer an anchor pair to a line range**, naming both
ends by the text you actually mean, so that anything inserted between them is at
least a visible decision rather than an invisible one. Where a range is the only
practical shape, the heading list is the receipt. This is the same failure as
quoting a count from arithmetic: the number looked right, so nobody read what it
was a count of.

## Four places make one claim, and the ones with machinery on them are right

The claim is what `dbmd check` says when a file on disk did not load. ADR 0090
made one diagnostic stand down for the whole model in that case, and four places
in this repository describe the behaviour. They were written by different people
at different times and none of them cites another.

| where | what checks it | verdict |
| --- | --- | --- |
| `docs/format.md` | `test/docs/format.test.ts` | right, with its own section and three table rows |
| `test/cli/check.test.ts` | it is the machinery | right, and it knew first |
| `.claude/skills/dbmd/SKILL.md` | nothing | wrong, for an unknown number of weeks |
| `dbmd check --help` | `check-commands.mjs`, names and flags only | wrong, for an unknown number of weeks |

**The two that were wrong were both wrong in the same way and were found
separately, hours apart, by two agents who never spoke.** One was sweeping the
skill against recent merges; the other was reading all 258 lines of `--help` as
assertions. Neither knew about the other's finding. That is what a real class of
defect looks like from the inside: it does not present as one bug found twice, it
presents as two people independently noticing the same sentence is not true.

**The test knew before either of them.** `test/cli/check.test.ts` builds its
four-problem fixture out of a broken **note** rather than a broken table, and the
comment above it says why in as many words: a broken table would make
`group-empty` stand down and turn a four-problem fixture into a three-problem
one. So the exception was understood, precisely, by the person writing the test,
at the moment ADR 0090 landed. It just never reached the two documents a person
reads.

**The lesson is not "write more tests".** It is narrower and it is about which
documents get them. `docs/format.md` is a reference: people look things up in it.
The skill and `--help` are obeyed: an agent and a person act on them without
looking anything up. **The two documents that are acted on rather than consulted
are the two that had no machinery**, and they are the two where being wrong costs
something immediately.

That ordering is backwards and it is the argument for `test/docs/skill.test.ts`
and for whatever eventually checks `--help`. It is also the reason the fix for
both was to correct the sentence rather than the behaviour: the behaviour has a
decision record, an argued cost, and a test. Only the prose had drifted.

## "None of those commits touches your files", said twice, wrong once

Sending a branch back to be rebased, I told the agent which incoming commits it
was about to absorb and added that none of them touched its files. I had not run
anything. I was answering from memory of what I had merged.

The agent checked, and one of the four had changed the very file its whole branch
is about. It said so, and then did the thing that actually matters: it re-ran its
six block assertions against the post-merge page rather than treating git's
silence as an answer.

**A clean apply is not evidence.** Two commits can edit one file in different
places, merge without a conflict, and leave a test asserting against a page that
has moved underneath it. Git's job is to reconcile text. Nobody's job, until
somebody makes it theirs, is to ask whether the claims in that text still hold.

`scripts/held.mjs --incoming <branch>` answers it. It takes the merge base,
collects the files the branch touches, walks every commit ahead of it on
`origin/main`, and marks the ones that overlap:

```
$ node scripts/held.mjs --incoming syn/proof-of-overlap
syn/proof-of-overlap touches 1 file(s). 5 commit(s) are ahead of it on origin/main.

TOUCH  c9d2224  The skill said a warning fires that now stands down ... (#246)
         .claude/skills/dbmd/SKILL.md
       1b09898  the stand-down rule, driven in four models (#248)
       ...
2 of them touch a file this branch touches. A clean apply is not evidence
that the claims in those files still hold. Re-run what asserts against them.
```

That output is from a branch built on purpose to reproduce the case I got wrong,
cut from the commit the real branch was cut from, so the check is proven to catch
it rather than assumed to.

**This is the same failure as the decision-record numbers and the held files, for
the third time, and the shape is now unmistakable.** Every one of them is a claim
about the repository, made to an agent, in writing, from memory, when one command
would have answered it. The agent has no way to doubt it and every reason to act
on it. So the rule is not "be careful": it is that **a sentence in a brief that
states a fact about the repository is a sentence that should have a command
behind it**, and three of those commands now live in `scripts/`.

## I typed a sha from memory twice, and the second time I had already written the lesson

`merge-pr.mjs` wants the whole forty-character sha of the commit you reviewed.
Twice in one session I gave it a sha whose first seven characters were right and
whose remaining thirty-three I had supplied from somewhere else. It refused both
times, correctly, and said the head had moved.

**Between the two, I wrote a section in this file about the first one.** Writing
it changed nothing, which is the useful part of the story. An instruction is not
a control, and the instruction I had written was aimed at the wrong thing: it
said read the diff before naming the head, and I was reading the diff. What I was
not doing was reading the sha.

**The cause was in my own tooling and was one expression long.** The command I
had been polling with, and which I had put into this repository's own handoff as
the way to see what is open, ended:

```
--jq '.[] | "#\(.number) \(.mergeStateStatus) \(.headRefOid[0:7])  \(.title)"'
```

`[0:7]` is the whole bug. A seven-character prefix on screen, forty characters
wanted by the next command, and a gap that gets filled by whatever is nearby.
The prefix is there because a prefix is what a person likes to read, and this is
not a place with a person reading.

**So the fix is to stop truncating**, in the handoff and in every poll, and the
general form of it is worth more than the instance: **do not display a shortened
version of a value that a later step needs in full.** The convenience is one
line of screen width and the cost is a value reconstructed from memory at the
exact moment that is most expensive.

The guard caught it both times, which is the fourth constraint doing its job:
whatever prevention you have, add detection, because detection runs on the
result and the result is the one thing a mistake cannot avoid producing.

## A path list does not show a coupling, and the agent read the test instead

`held.mjs --incoming` compares two sets of file paths: the ones a branch touches
and the ones each incoming commit touches. When they do not intersect it says so,
and I built it after telling an agent twice that they did not.

An agent rebasing over it found the case it cannot see. The incoming commit added
`test/docs/skill.test.ts`, which touches no file its branch touched. But that test
**runs `dbmd refs` and asserts what the command narrates**, and its branch was
editing `src/cli/refs.ts`. The two commits have a real dependency, and no
intersection of path names contains it.

**The agent found it by reading what the new test does rather than what it is
named**, and then established the specific fact that made it safe: its own edit
to `refs.ts` is inside the help text, which no run of that block reads. That is
the difference between "the paths do not overlap" and "these two changes cannot
affect each other", and only the second one is an answer.

**Do not try to automate this one.** A tool that resolved which strings a test
asserts against, through the command that produces them, to the source that
writes them, would be a static analyser for this repository specifically, and it
would be wrong in both directions on the day somebody wrote a test cleverly. What
the path check buys is the cheap half, which is knowing when to look. **Say so
when handing it to somebody**: the overlap list is where to start reading, not a
verdict, and a branch with no overlap has not been cleared, it has been narrowed.

The general shape is one this project keeps meeting. A mechanical check answers
a question adjacent to the one you care about. It is worth having when the
adjacent question is cheap and the real one is not, and it is dangerous exactly
when its answer gets quoted as though it were the real one.

## Four studios of mine were still listening, hours later, and nothing said so

`working-an-issue.md` tells an agent to stop the server it started, by its own
process, before its worktree is removed. This file already records twenty two
left running in one session by the person who reviews everyone else against that
rule. Checking the loopback listeners tonight found four more, all mine, started
at 01:32, 01:32, 02:37 and 03:04 and still bound at 07:00.

**Nobody notices, because a studio that is still listening looks exactly like
nothing at all.** It takes no window, prints nothing, and the only symptom is a
port and a little memory on a machine whose ceiling is memory. So the rule has
been repeated for a day and broken for a day, which is what a rule with no
detection behind it does.

`scripts/stray-studios.mjs` is the detection. It prints every studio that is
listening, its port as a URL, its model directory, and which one is the owner's:

```
2 studio(s) listening.

OWNER'S  http://127.0.0.1:49192/  pid 34404
          examples/shop, the tracked one
  stray  http://127.0.0.1:64841/  pid 25924
          .
```

**It stops nothing, deliberately.** Killing a studio is a decision about
somebody else's window and it stays with a person. That is also why the owner's
is named rather than filtered out: the useful output is "one of these is theirs
and the rest are yours", and a tool that quietly hid theirs would be one step
from a tool that stopped it.

**Its first version reported eight studios and one of them was itself.** It
matched any command line containing the word "studio", which caught five
`npm run studio:dev` shell wrappers around one server, that server a second time
through a `cmd.exe` carrying its script name as an argument, and the PowerShell
query doing the asking. The fix was not a better pattern. **A studio is a thing
listening on a port**, so asking the ports rather than the process table answers
the real question and every wrapper falls away for free. That is the same move as
asking each worktree directory whether it is its own git top level, one section
up: when a reading is full of things that are not the thing, the filter is
usually the wrong question rather than a loose one.

Proven by starting a studio on an OS-assigned port, watching it appear as a
stray, stopping it by pid, and watching the count go back to one.

## Two wrong answers to "is this agent finished", and the one that works

`held.mjs` reported a three-way collision on one file whose three holders were
three merged pull requests. An agent found it, said so, and added the sentence
that turned out to be the useful part: **a collision line is a prompt to go and
look rather than an answer**, which both of us had been treating it as and
happening to be right about.

**The first wrong answer was ancestry.** A finished branch's tip ought not to be
reachable from `main`, except that every merge here is a squash, so it never is.
`origin/main...HEAD` keeps showing a landed branch's whole diff forever.

**The second wrong answer was content.** Compare each file on the branch against
`main`, and drop the ones that are identical, because what landed is on `main` by
definition. That is true on the day the branch lands and false the day after: a
later branch touching the same file makes the merged one's version differ again.
It failed on `test/guards/broken-on-purpose.test.ts`, which two branches had
touched, and it failed silently, reporting a collision that read exactly like the
real ones.

**The answer that works is not in the worktree at all.** A branch is finished
when nobody is asking for it to land, and the place that is recorded is the open
pull request list. One `gh` call, and twenty two finished worktrees drop out of a
reading that had been carrying them all night.

**What that costs is worth naming.** The tool now needs the network for its best
answer, and it says so in its own output when it could not get one. An agent that
has committed but not yet pushed has no open pull request either, so `--live`
still overrides, and it is still the one fact the tool cannot derive and the
orchestrator always has.

The general shape, for the third time in this file: **a question about the
present cannot be answered from a shape left behind by the past.** Which
directory is a worktree, which studio is listening, which branch is still wanted.
Every one of them was got wrong first by inspecting an artifact and got right by
asking the thing that currently holds the state.

## One record number to three agents, with the script that prevents it running

`freeadr.mjs` exists because I handed 0092 to two agents in one night. It reads
the default branch and every open pull request and it has been right every time
it was asked. Tonight I handed **0098 to three agents inside an hour**, ran the
script between the second and the third, and it reported 0098 free.

**It was right.** None of the three had pushed anything, so no branch and no pull
request carried the number. The claim was in three dispatch messages and nowhere
else. A tool that reads the repository cannot see a promise, and I had been
treating its answer as the whole answer for a week.

**Two of the three places it was missing are now readable, and one is not.** A
number an agent has written into a file and not pushed is on this machine, in its
worktree, so the script reads those too and it found the first agent's 0098
immediately. The fourth place is the one that produced this: a number promised in
a brief to an agent that has not yet written a file. Nothing on disk holds it.

So the script now ends by saying what it cannot see:

```
free to hand out: 0099, 0100, 0101
It cannot see a number you promised in a brief before the agent wrote a file.
Check what you have already handed out this session first.
```

**That closing line is the whole fix and it is not a mechanism.** There was a
temptation to build one, a file recording each handout, and it is the wrong
shape: it is state that has to be written at exactly the moment I am already
failing to keep state, and a stale one would be worse than none. The honest
answer is that the last hop is the orchestrator's memory, and the script's job is
to say so rather than to imply otherwise by answering confidently.

**The general form has now appeared four times in this file.** A tool answers a
question adjacent to the one you care about. Which directory is a worktree, which
studio is listening, which branch is still wanted, which number is free. Every
one was got wrong first by trusting a reading of an artifact, and every one got
better by naming what the reading does not cover **in the tool's own output**,
where the next person meets it, rather than in a document beside it.

## What a rebase invalidates, and the rule I broke twice while writing the rule

An agent, asked to rebase for the third time, did it and then said something I
should have said first:

> I have not rebased again unasked, because each rebase invalidates the review
> record you just placed and restarts the same race.

**It is right about the race and half right about the record**, and the half it
is wrong about is a thing I had been leaving implicit for a whole session.

**A rebase invalidates the sha and not the review.** `merge-pr.mjs` refuses a
sha the orchestrator has not named, which is correct and is what catches a
force-push. What it cannot tell is whether the change under that new sha is the
change that was read. Three things decide that, and when all three hold the
review still stands:

- the diff against the new base is unchanged
- the agent re-ran the whole gate on the rebased tree
- the incoming commits were **read** rather than counted, because a clean apply
  is not evidence

Every agent here has given all three every time, and my re-read on a rebase is a
check that those three are true rather than a second review. **Saying so is not
a formality.** An agent that believes each rebase throws away a review will
either rush the third one or stop reporting the things that make it hold.

**The race is mine and my own rule already covers it.** Two agent branches ready
at once cannot both merge without one rebasing, and no ordering avoids that. What
is avoidable is what I did in between: merging my own documentation branches
while an agent's sat green and waiting. The rule two sections up says the agent's
goes first and mine goes last, and I broke it twice in one session, in the
session where I wrote it down.

So the fix is not another sentence in this file. It is that **a branch of mine
that is green and waiting is not a branch to merge while any agent branch is
green and waiting**, and the merge script has been printing the list of branches
a merge will stale, by number, before every one of those merges.
