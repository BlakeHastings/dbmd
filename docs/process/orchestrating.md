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

## Hold every merge while anything is rebasing

Seen three times in one session, which is past the threshold, and the third time
was after writing the rule down and agreeing with it.

The mechanism is simple and the mistake is not carelessness. A branch comes back
rebased and green. Merging it is the obviously correct thing to do with it. But
if another branch is mid-rebase at that moment, the merge makes that one stale
again, and its agent reports a rebase that was already obsolete before it
finished. Each occurrence costs a full round trip: a message, a rebase, a
re-verification, and a report.

It happened to dbmd-25 and dbmd-44 within minutes of each other, and then to
dbmd-48 an hour later, after the rule was already understood.

**The rule that actually works is a state rather than a judgement.** While any
branch is rebasing, no branch merges. Not "unless it looks safe", not "unless
they touch different files", because the merge wrapper judges the green against
what would land rather than against the branch point, so file overlap is
irrelevant. It is a queue with one lane.

The cost of holding is a few minutes of nothing merging. The cost of not holding
is one round trip per agent in flight, and the round trips are not free: a rebase
puts a tree you already reviewed back into motion, so the review has to be redone
against what actually landed.

**Tell the agent when it happens anyway.** If a merge does land under somebody
mid-rebase, say so immediately rather than letting them finish, report, and be
sent back. That turns two round trips into one and is the difference between an
orchestrator who noticed and one who did not.

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

They now live in `docs/process/gotchas.md`, and `working-an-issue.md` sends
every agent there before they start. The split is the point:

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

## The hold-every-merge rule broke twice in one afternoon

The section above says to hold every merge while anything is rebasing. On
2026-09-07 I broke it twice, the second time within an hour of writing about the
first, and that time it cost two agents a rebase and one of them two.

**The instruction was present, correct and mine, and it did not work.** That is
the same shape as the reporting rule further up: an instruction is not a control,
and the answer to a rule broken by accident and repeatedly is a linter, a hook or
a type rather than a firmer sentence.

**The mechanism is that the cost is invisible at the moment of the decision.**
Merging is one command with a clean success line. The rebase it causes shows up
minutes later, in somebody else's report, as a thing that reads like ordinary
timing. Nothing connects the two, so nothing weighs them.

`merge-pr.mjs` already asks the API whether the pull request in front of it is
mergeable, and in the same breath it could ask which others are open. Every one
of those is a branch it is about to make stale, by its own refusal's definition.
Printing them before it merges puts the cost in front of the person paying it.
That is **dbmd-nm5**, and it is deliberately not a gate: merging while others are
open is often right, because the alternative is a queue that never drains. What
is wrong is that the cost is currently paid by somebody who is not in the room.

**Until that lands, the practical version is narrower than the rule above and
easier to keep:** an agent that has been sent back is *rebasing*, and the window
between sending it back and its report is the one to keep clear. Merging while
agents are still *building* is normal and costs one rebase each, which is the
price of parallelism. Merging while one is rebasing costs that agent a second
round trip for nothing.

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

## A force flag exists to get past something, and the something was holding something

Twice on 2026-09-07 I reached for a flag whose whole job is to override an
objection, and both times the objection was the last thing standing between me
and a piece of work that existed nowhere else.

**`git worktree remove --force`.** An agent's only file was untracked. I took a
patch with `git diff HEAD`, which does not see untracked files, so the patch came
out zero bytes. I did not look at it, and the removal was the last copy. Recorded
as b-fac #182.

**`git reset --hard origin/main`.** A checkout had just refused because
`.beads/issues.jsonl` was dirty, and the dirt was an item I had filed twenty
minutes earlier and not yet committed. The reset threw it away. It was
recoverable only because beads keeps a database behind the export and I could
re-run `bd export`, which is a property of that tool rather than anything I did.

The shape is the same both times and it is not carelessness about the flag. It
is that **the refusal was the notification.** Git had already told me something
was there; the flag's purpose is to stop it telling me, and I used the flag
because the refusal read as an obstacle to the thing I was doing rather than as
information about the thing I was about to lose.

So: **when a git command refuses and a `--force` or `--hard` would clear it, read
what it named before you clear it.** Both refusals printed the path. One line of
`git status --porcelain`, or one `cat` of the patch you claim to have taken, is
the whole cost. And prefer the flagless route where one exists: `git stash` and
`git worktree remove` without `--force` both fail loudly instead of quietly, and
failing loudly is the behaviour being overridden.
