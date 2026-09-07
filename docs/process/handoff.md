# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with nothing running, three agents cancelled, and every
epic closed.**

## Where the work is

**Do not quote the merged count from arithmetic.** I did, and said 162 when
`gh pr list --state merged` said 158. Every pull request has merged through
`merge-pr.mjs` and the provenance audit is clean across every commit on `main`;
for the number, run the command. As of the last measurement: **168 merged, 120
items closed, 4 open, and no P1s.**

**Three of the four open need the owner rather than an agent.** The visuals epic,
which is taste. The stale screenshot, which needs a browser extension whose
server failed to connect in this session, so it is not one click any more. And a
character count in `README.md` that cannot be corrected while they have that
file open, which is `dbmd-53w` and is now the last unmeasured instance of a
number checked in three other places.

**The fourth, `dbmd-s22`, is dispatchable and small**: run `dbmd studio` on an
empty directory and it starts, lets you add a table, and warns forever about a
`_model.md` it has no way to create. Every other refusal in this tool says what
to do next and that one does not. **All eight epics are closed**, the last
two on 2026-09-07: import, which closed when re-import landed, and publishing.

**The screenshot item needs a server rather than a click.** It was one click
until the browser tool's server stopped connecting at all in this session, and a
session cannot take a screenshot without it. Do not dispatch an agent at
`dbmd-joa`: it cannot succeed and the wall is invisible from a brief.

**`main` now tells a pull request what its merge did to `main`.** ADR 0057 and
`scripts/report-merge-aftermath.mjs`, triggered by
[`aftermath.yml`](../../.github/workflows/aftermath.yml) on a `workflow_run` that
did not finish green. It comments on the pull request the commit came from,
because its author is already subscribed there, so nobody has to remember to
look. Run it with no arguments at any time for the current state of `main` and
the all-time count of red runs, which it labels a floor rather than a rate
because a re-run updates a run in place.

**`merge-pr.mjs` now names the branches a merge is about to make stale**, before
merging, and the four refusals it has always had are ordinary tests for the first
time. Recovered from a branch that had never been pushed. Its first real merge
named its own pull request as the branch it was making stale, which is the
change demonstrating itself.

**`npm run check` passes on `main`**, and CI has been green on every post-merge
run since. It is typecheck, format, the four content checks, the tests, the
build, the pack smoke and the pack guard, and it is the command `release.yml`
runs through `prepublishOnly`, so it is the closest thing there is to a
rehearsal of the publish. **Do not quote a test count here.** It moved four times
on 2026-09-07 alone and a number in this file is a number nobody updates; run the
command, or read what `report-merge-aftermath.mjs` says about `main` right now.

**Eight runs on `main` have finished red across all time and nobody noticed any
of them**, including me. Seven on `check` and one on `provenance`, and that last
is the repository's own first push, which needs no investigation. Of the seven,
four were a race the flush repair had already fixed by the time I read them and
three were the watcher flake, fixed in #144. **That count is a floor**, because a
re-run updates a run in place and every failure later re-run green has stopped
being counted anywhere. `report-merge-aftermath.mjs` prints it and says so.

**Nothing is blocked.** That has been true since the owner answered the two
questions that were, at about 13:20.

From a checkout, the tool does the whole loop:

```bash
node dist/cli.js query    # prints your engine's introspection SQL, for you to run
node dist/cli.js import   # that JSON becomes a model directory, and a re-import is a delta you confirm
node dist/cli.js init     # scaffolds a model directory
node dist/cli.js check    # validates it, exits 1 on an error, --strict promotes warnings
node dist/cli.js refs     # what points at this table, from which column, and what a delete does to it
node dist/cli.js export   # a mermaid diagram GitHub renders in a pull request
node dist/cli.js studio   # a canvas: drag, edit, rename across files, add and delete tables
```

Every one of those takes `--json`, and every one of those shapes is now shown on
a page and run by `test/docs/payloads.test.ts`. **The canvas is reachable
without a mouse** since #167: one tab stop, arrows to walk it, `Enter` to select,
and every object names itself to a screen reader since #162.

`npm run studio:dev` is the same studio with the feedback toolbar on it, which is
the owner's own channel for design notes. It never ships; ADR 0064 says how that
is guaranteed rather than argued.

**The journey runs end to end for the first time.** `dbmd query` prints the SQL,
you run it with the client you already trust, and `dbmd import` reads what came
back. It was proved against a PostgreSQL 16 container: query, run, import,
`dbmd check` clean. No credential and no driver is ever this tool's business.


**Publishing was decided on 2026-09-07**, so `"private": true` came out of
`package.json` and the version is `0.1.0`. Nothing is on the registry yet. A
release is a `v*` tag the owner pushes,
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) is the
whole of the mechanism, and it needs an `NPM_TOKEN` repository secret that only
the owner can add. ADR 0051. The older lesson still stands: two files claimed the
package was published when it was not, and that false claim is why a CI recipe
invented a version number.
`npm view dbmd versions` is the answer to "is it out" that a page cannot get
wrong.

**`examples/shop` is clean and the owner's edits are gone.** This file carried
"four uncommitted edits from the owner, do not commit or revert them" for hours
after the owner said _"You can remove my edits if I have any on disk"_ and after
something removed them. Checked on 2026-09-07: `git diff HEAD -- examples/shop`
is empty, no commit since 04:00 changes a `layout` line there, so the edits were
discarded rather than landed.

**That paragraph is the reason to distrust an instruction in this file more than
a description in it.** A stale description is merely out of date. A stale
instruction directs whoever reads it, and this file is read by the most degraded
version of the orchestrator, immediately after a compaction, with nothing else
loaded. `orchestrating.md` carries the general form.

## In flight, and what is actually left

**Nothing is running and nothing is queued.** Every branch has landed and the
backlog is four items, three of which need the owner rather than an agent.

**The session was restarted here so that the annotation server's tooling is
available**, which is what turns the owner's design feedback into something a
session can read directly rather than something they paste. `npm run studio:dev`
brings the studio up with the toolbar on it, and the server it posts to is
`agentation-mcp` on port 4747, which the start command checks and names.

## What was destroyed, because a successor will find the gap

**Ten `layout:` files under `examples/shop` were the owner's uncommitted work and
I destroyed them** with `git reset --hard` in the main checkout. They were an
afternoon of dragging boxes into place. Their `README.md` edit came back out of a
dangling stash object; the layout lines existed nowhere else and are gone.

So `examples/shop` is exactly what is committed. If the owner's positions matter
to anything later, they were never captured and re-dragging is the only route.

**The rule that came out of it is above**, under the read-only heading, and it is
a state rather than a judgement: in the main checkout, edit, `git add` by name,
commit, push, and nothing else. Every branch switch, rebase, reset and force
happens in a throwaway worktree.

**Both branches that were cancelled on 2026-09-07 have landed.** The
documentation one had no commits at all: its work survived only as a patch, it
applied to current `main` cleanly, and it is #142. The tooling one rebased from
sixteen commits behind with **zero conflicts**, which is #150. I had recorded
that it conflicted in three files, and that was wrong: I read a `git merge-tree`
listing as conflict output when it was not, and that false reading was my only
reason for calling the work undispatchable.

**One thing from that stop was genuinely lost**: an agent's only file was
untracked, so `git diff HEAD` produced an empty patch and the worktree removal
took the original. b-fac #182.

**Read the machine before dispatching anything**, with `assets/machine-load.mjs`
from the factory. A sibling project's session runs sixteen processes beside this
one, so counting your own agents undercounts. And **do not run a test suite while
a wave is out**: doing that produced 27 failing tests that were nothing but
contention, and a false verdict on somebody else's change. b-fac #186.

## What is waiting on the owner

**Both of the decisions that were blocking work were answered on 2026-09-07**,
and neither should be re-asked:

- **Re-import.** Not one of the three merge rules I offered. The owner's own
  words: _"it sounds like you are asking about a delta. When we import, we warn
  the user about the changes 'database table removed' in an itemized list for
  them to scroll through. Then they can confirm the change."_ That overturned my
  recommendation on the first case, and it is built and merged.
- **Publishing.** _"Yes let's publish to npm"_, after five asks.

**One step is theirs and the loop cannot take it**, for two separate reasons
rather than one. A token can only be minted by whoever owns the npm account, and
`release.yml`'s own header says pushing tags is "the one step of this that no
agent in this repository is allowed to take", because a publish cannot be
undone.

The whole of it, for copying:

```bash
# 1. npmjs.com, Access Tokens, Generate New Token, choose Automation.
# 2. GitHub, Settings, Secrets and variables, Actions, New repository secret,
#    named NPM_TOKEN.
git tag v0.1.0
git push origin v0.1.0
```

Nothing else. The tag triggers
[`release.yml`](../../.github/workflows/release.yml), which compares the tag to
`package.json`, checks the commit is on `main`, and runs the whole check suite
through `prepublishOnly` before it uploads anything. Until that tag exists,
`npx dbmd` resolves nothing and no page in the repository claims otherwise;
`npm view dbmd versions` is the answer a page cannot get wrong.

**If the publish job goes red, read which step failed before touching the tag.**
A version mismatch is the tag's fault and the message says so. A checkout that
lacks `origin/main` says so separately since #147. A failure inside
`prepublishOnly` is the test suite and the tag is fine: re-running the job
publishes, and deleting the tag is the wrong move.

That step is now driven as far as it can be without pushing a tag, and
[`verified.md`](verified.md) carries the detail. The short version: **the name is
free**, the tarball holds what it should, the version comparison was run against
five tag shapes, and the ancestry check was run against three repository states.
**What cannot be observed from here** is whether the checkout populates
`origin/main` on a tag push. It is the only thing in CI that reads a
remote-tracking ref and no tag has ever been pushed. The failure is safe either
way, and since #147 the message says whether the tag or the checkout is the
problem rather than blaming the tag for both.

**Two things are genuinely theirs and neither blocks anything:**

- **The visuals epic, `dbmd-fnl`.** Taste, and taste about a picture is not
  derivable from a repository. It carries a measurement, options and a
  recommendation each, so the conversation is five minutes rather than a blank
  page. Two of its bullets were measured against the owner's uncommitted layout
  edits and are corrected in place, in the description rather than in a note
  below it, because a correction read second is a correction that failed.
- **`dbmd-joa` needs a browser extension connected, and that is one click.** The
  README's one picture is stale in three ways, all three re-verified against the
  committed tree. Nothing in a session can take a screenshot: a studio starts and
  serves, and the browser tool answers "No connection to browser extension".
  **Do not dispatch an agent at this**; it cannot succeed and the wall is
  invisible from a brief.

What is left is neither urgent nor blocking:

- **Whether the tool should read prose at all.** The narrow version shipped: a
  rename says which sentences it leaves behind. A general check over every body
  changes what the tool is, and **dbmd-x82** says not to build it without asking.
- **The beads schema recovery.** The binary is older than its database, so every
  command needs `--ignore-schema-skew`. One destructive statement, refused by the
  harness, backup taken. The stopgap has carried every backlog write for two days.

## What a successor would otherwise have to reconstruct

- **The guard is loaded.** `scripts/guard-merge.mjs --probe` was refused. Ask it
  again after every harness restart, alone on the command line.
- **`bd` needs `--ignore-schema-skew`** on this machine and is not on an agent's
  PATH. `.git/factory/machine.md` has the story, and a brief has to hand agents
  the full path.
- **An agent in a worktree sees committed files and nothing else.** Put the brief
  in the dispatch message.
- **The main checkout is read-only.** Edit, `git add` **by name**, commit, push,
  and nothing else. Every branch switch, rebase, reset, merge and anything with
  `--force` or `--hard` happens in a throwaway worktree. This is the rule that
  cost the owner ten files before it existed, and it is a state rather than a
  judgement because the orchestrator is not the only writer here.
- **Never junction an agent's `node_modules` to this checkout.** Tell them
  `npm ci`. The shared copy has been out of date once already and the failure it
  produces is a TypeScript error in a file the agent never touched.
- **Wait for checks by the commit, never by the pull request.** Ask the run
  listing for runs whose `headSha` starts with what you pushed, and treat "no run
  yet" as keep waiting. For a minute after a force-push the pull request answers
  about the commit you replaced.
- **Merge on the report, not on a checks listing**, and hold every merge while
  anything is rebasing, counting from the moment you ask rather than from
  anything you can see. One section in `orchestrating.md` with what each of the
  four breaches cost.
- **Close items when their branch lands**, in the same motion as the merge.
- **Never put a pipe between a command and a `&&`.** A pipeline's exit code is
  the last command's, so `cmd | tail -1 && next` runs `next` even when `cmd`
  failed. That one habit caused three different failures on 2026-09-07: a cut
  identifier, a failing check reported as passing, and a `git reset --hard` that
  ran after the checkout before it had refused. `orchestrating.md` has the whole
  of it.
- **Do not summarise the backlog from memory. Print it.** I claimed twice on
  2026-09-07 that nothing was left but the owner's decisions, and both times it
  was false, for two different reasons. The first time **dbmd-45** was a P2 under
  the P0 epic `dbmd-1`, which sorts to the **top** of `bd list` where the `tail`
  I was reading never looks. The second time **dbmd-2z4** was an item I had filed
  myself twenty minutes earlier and left out of my own summary. Reading one end
  of a sorted list and trusting a memory of the rest fails the same way twice.
  The fix is one command: print the whole list, unfiltered, before saying what is
  in it.

## What has been checked, and how

Moved to [`verified.md`](verified.md) on 2026-09-07. Two sections, what has been
driven and what was audited by breaking it, had grown to four fifths of this
file, and this file is printed into context at every compaction. They are the
answer to "has anybody actually tried it", which is a question with a different
reader and a longer life than "where did the work stop".

**The owner asked whether the studio was validated by interacting with it rather
than by testing it.** It was, repeatedly, and that page is the answer.
