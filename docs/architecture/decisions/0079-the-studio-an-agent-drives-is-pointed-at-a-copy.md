# 0079. The studio an agent drives is pointed at a copy

## Context

[`docs/process/working-an-issue.md`](../../process/working-an-issue.md) told an
agent that had touched the studio to bring it up like this:

```bash
npm run studio -- --port 0
```

and closed the paragraph with the sentence this record is about:

> That script builds first and then opens the repository's own `examples/shop`,
> so there is nothing to set up. An edit you make in the page is written back to
> those files and shows in `git status`: `git checkout examples/shop` puts it
> back.

Every clause of that is true. It is safe only when nothing under
`examples/shop` is uncommitted, and it does not say so.

**On the morning of 2026-09-07 ten `layout:` files under that directory were the
owner's uncommitted work and were destroyed**, by a `git reset --hard` run in the
main checkout. They were an afternoon of dragging boxes into place. The owner's
`README.md` edit from the same morning came back out of a dangling stash object;
the layout lines existed nowhere else and are gone.
[`docs/process/handoff.md`](../../process/handoff.md) carries that under a
heading reading "What was destroyed, because a successor will find the gap", and
[`docs/process/orchestrating.md`](../../process/orchestrating.md) carries the
rule that came out of it.

`git checkout examples/shop` is the same instruction pointed at the same files.
It was measured rather than assumed. With eight tracked table files edited under
`examples/shop` in a worktree:

```
$ git checkout examples/shop
Updated 8 paths from the index
```

That is the whole of what it says. It reverts every uncommitted change under the
path rather than the one file the page wrote, it names none of them, it asks
nothing, and nothing recovers them: the changes were never added, so no blob
holds them and `git stash list` is empty. An agent typing it on a day when the
owner has been arranging boxes destroys the arrangement, and the page the agent
was told to drive is what put the edits there in the first place.

**None of this is an argument against
[ADR 0004](0004-the-studio-is-a-local-editor-of-files.md)**, which
decided that the studio has no Save button and no undo of its own because git is
the undo. That is right, and it is about a developer's own model directory,
where the only writer is the person at the keyboard and a revert throws away
exactly their own last few minutes. `examples/shop` is not that. It is a shared
file set with a second writer who is not in the room, and a revert there is a
revert of whatever they were in the middle of. The product's undo is sound; what
was wrong was handing it to an agent as the recovery step for somebody else's
files.

**The guidance had already diverged from the practice.** Every brief written on
2026-09-07 told agents to copy `examples/shop` to a temporary directory first,
and the decision records written from those sessions say so where they record
what was driven. **Ten records name a copy**, 0015, 0016, 0018, 0025,
0028, 0035, 0039, 0061, 0067 and 0072, several of them in the exact words
"against a copy of `examples/shop` in a temporary directory".
[`docs/process/verified.md`](../../process/verified.md) says it in six more
places, twice adding "Nothing tracked was touched". **Nothing anywhere records
an agent deliberately driving the tracked example.** So an agent reading both
was told two things, and `working-an-issue.md` is the one they find without
being briefed.

**There is a second, independent reason, and it was learned separately.**
`verified.md` records a measurement of `examples/shop` in a real browser that
found two notes covering three tables, with `shipments` 28,457 square pixels
hidden, filed as a defect and reported to the owner as the first picture anybody
sees. It was the owner's own uncommitted arrangement. `git archive HEAD
examples/shop` renders zero overlaps between the same ten boxes. The lesson
written there is that **a working tree with somebody else's edits in it is a
different program**, so a measurement of it says nothing about what ships.

## Decision

**An agent drives the studio against a copy of the committed example, never
against the tracked `examples/shop`.** The copy is made with `git archive`:

```bash
npm run build
mkdir -p "$SCRATCH/drive"
git archive HEAD examples/shop | tar -x -C "$SCRATCH/drive"
node dist/cli.js studio "$SCRATCH/drive/examples/shop" --port 0
```

`npm run studio` is unchanged and stays pointed at the tracked example. It
writes to those files on purpose and that is the owner's command: the layouts
committed in that model were dragged there through it. What changes is who is
told to run it.

`git archive HEAD` rather than `cp -r` because it takes the committed tree, so
it is right whatever state the working tree is in, and it is the same thing a
stranger clones. It is one command, so "there is nothing to set up" survives
almost intact, and the property the paragraph actually exists for, that an agent
drives the product rather than trusting a test, is untouched.

## The alternative that was rejected, and why

**Keep driving the tracked example and add the check that makes it safe**:
require `git status --porcelain examples/shop` to be empty before starting, and
say what to do when it is not. It is cheaper, it keeps "nothing to set up"
exactly, and it is a real answer rather than a straw one.

It was rejected for three reasons, in order of weight.

1. **It is a rule about care, in the one place this project has already proved a
   rule about care does not hold.** `orchestrating.md` reached the same fork
   after three destructive commands in a day and wrote: *"The lesson written
   after the first two was 'read what the refusal named before you clear it',
   and it cannot work."* Its answer was to make the rule about which directory a
   command runs in. This is the same shape of problem one directory down, and a
   copy is the same shape of answer as a throwaway worktree: there is nothing in
   it to lose, so there is nothing to be careful about.

2. **It is a check at the start of a session about a state that changes during
   one.** The owner is the other writer. They can begin arranging boxes at any
   point after the check passes, and the studio's own watcher exists precisely
   because files under it change while it is running. A precondition read once
   cannot cover a window that stays open for as long as the drive lasts, and the
   revert at the end is the destructive step.

3. **It leaves the sentence about `git checkout examples/shop` standing**, and
   that sentence is the actual hazard. It is unbounded over the path: it takes
   the owner's ten files exactly as readily as the one file a drag wrote, and it
   is not distinguishable at the keyboard from the safe case.

The copy's cost is honest and it is not zero: one command and one directory, and
an agent who wants to see their edit in `git diff` has to look in the copy
instead. That is the trade, and against ten files that a search could not
recover it is not close.

## The guard that was considered and not built

`npm run studio` could refuse, or warn, when `examples/shop` is dirty. This
project has twice in one night learned that prevention and instruction are
different things, so it deserved the argument rather than a shrug. It is not
built, for three reasons.

- **It fires at the wrong moment.** What destroys work is
  `git checkout examples/shop`, at the end. A guard on `npm run studio` speaks
  before anything has been lost and is silent when it is.
- **Its only reliable true positive is the owner.** The dirty state on
  `examples/shop` is, in the normal case, the owner mid-arrangement in their own
  example. A developer's own tool refusing to run on their own dirty tree is the
  kind of control that grows a `--force` flag within a week, and then the flag
  is the documented command.
- **After this record, no document sends an agent down that path.** A guard
  whose job is to catch a sentence that no longer exists is a guard nobody is
  keeping true.

Putting the refusal on the destructive command instead, in
[`scripts/guard-merge.mjs`](../../../scripts/guard-merge.mjs), was rejected for a
different reason: that file's charter is that nothing reaches the default branch
except through the sanctioned path, its accuracy about what it does and does not
cover is the most valuable part of it, and a rule about reverting a path is a
second subject in it.

**This is a documentation change and nothing else.** No code was written for it,
and saying so plainly is better than manufacturing a change to make the record
look more substantial than it is.

## Consequences

- Two commands where there was one, and a scratch directory to name. Everything
  else about driving the studio is the same, including `--port 0`, `--no-open`
  and stopping the server with Ctrl-C so a debounced write flushes.
- `working-an-issue.md` now agrees with what six decision records and four
  entries in `verified.md` already describe. The recipe is written once, in one
  place, so verification sections can stop each inventing their own wording.
- **An edit an agent makes no longer shows in `git status`.** That was a genuine
  convenience of the old paragraph and it is gone: the copy is outside the
  repository, so a diff of it is `diff -r` against a second extract, or reading
  the file. In exchange, a clean `git status` is now a fact about the drive
  rather than a thing to restore afterwards.
- **`npm run studio` keeps its meaning**, which matters because `README.md` is
  built around it and the owner uses it to arrange the example. Nothing about the
  product or the shipped `dbmd studio` changes.
- A second npm script that opens a copy for you was considered, so that the
  agent's path stays one command. It is not added: it would be a third entry
  point into the studio to keep true, and it would put the agent's edits
  somewhere the script chose rather than somewhere the agent named, which the
  verification sections above all need to read back.

## Revisit when

- An agent drives the tracked `examples/shop` anyway, and the reason is that the
  four-line recipe was more friction than the moment allowed. That is the
  evidence for the npm script this record declined, and it should be built rather
  than argued with.
- The owner reports that `npm run studio` destroyed their arrangement, which
  would mean the hazard was never only about agents and the guard is worth
  building after all.
- `examples/shop` stops being the only model anybody drives. A second example
  that no human ever edits by hand would be safe to drive in place, and this
  record's reasoning would not reach it.
