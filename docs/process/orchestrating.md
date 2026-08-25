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

**`bd create` refuses `--id` together with `--parent`.** Create with `--id`,
then add the edge with `bd dep add <child> <parent> --type parent-child`. Worth
knowing before you write a seeding script that half works.

**The guard was wired in the same session that needed it.** Hooks are read once
at process start, so the session that installs one runs unguarded until it is
restarted, and so does everything it spawns. `node scripts/guard-merge.mjs
--probe` is the only way to find out, it must be alone on the command line, and
being refused is the answer you want. Ask it after every restart, and ask it
from a worktree too.

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
sound unrelated. Expect it and sequence around it.

## The evidence bar is the part to get right

Every item in the seeded backlog carries one, and they are all of the same
shape: **show the diff, or show the screen**. That is not decoration. This is a
tool whose entire value is that the diff is readable, so an agent reporting
"tests pass" has told you nothing about whether the thing works.

If you write a new item, the bar goes in it. If you cannot think of one, the
item is probably not specified yet.

## Merging

There is no remote yet, so merging is local and the merge wrapper is dormant.
Until then: review the branch, run `npm run check` on it yourself, merge into
`main` with a squash, and post the three-lens review record on the item with
`bd comment <id> --file review.md`.

When the remote exists, `node scripts/merge-pr.mjs <n>` becomes the path and ADR
0001 has what else has to be confirmed at that point.
