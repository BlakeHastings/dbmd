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
file.** The auto-export that does write it is throttled, so the committed
`.beads/issues.jsonl` silently lags behind the database. Four items were missing
from it on the first check. `npm run backlog` is the command that actually
writes it; run it before any commit that changed the backlog, and check the
count.

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
