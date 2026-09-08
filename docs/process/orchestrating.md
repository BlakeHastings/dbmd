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

`node scripts/merge-pr.mjs <n>`. It reads the check rollup, refuses on anything
red, and squash merges. A ruleset on `main` refuses a direct push from anyone
including the owner, so this is not a convention: it is the only path.

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
  commands. If you need the tail of something whose status also matters, write it
  to a file: `cmd > out.txt 2>&1; echo $?; tail out.txt`.
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
