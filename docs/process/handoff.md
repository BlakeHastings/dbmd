# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with nothing running, three agents cancelled, and every
epic closed.**

## Where the work is

One hundred and thirty-six pull requests have merged, all through
`merge-pr.mjs`, and the provenance audit is clean across every commit on `main`.
**100 items closed, 9 open**. **All eight epics are closed**, the last two on
2026-09-07: import, which closed when re-import landed, and publishing. The one
P1 is mine rather than the owner's: `dbmd-056`, the flaky watcher test, because
the publish the owner has been asked to trigger runs the suite it sits in.

**`npm run check` passes on `main` as of 2026-09-07**, run whole and locally:
typecheck, format, the four content checks, 1,021 tests, the build, the pack
smoke and the pack guard. That is the command `release.yml` runs through
`prepublishOnly`, so it is the closest thing there is to a rehearsal of the
publish.

**Four of the last hundred check runs on `main` went red and nobody noticed**,
including me. Two were a race the flush repair had already fixed by the time I
read them; two are live and both are in `test/studio/watch.test.ts`. `dbmd-056`
carries the evidence and `dbmd-rjd` carries the general problem, which is that
`merge-pr.mjs` prevents a red merge and nothing detects a red result.

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

**The journey runs end to end for the first time.** `dbmd query` prints the SQL,
you run it with the client you already trust, and `dbmd import` reads what came
back. It was proved against a PostgreSQL 16 container: query, run, import,
`dbmd check` clean. No credential and no driver is ever this tool's business.

Until 2026-09-07 that journey had no first step. `dbmd query` was named by four
error messages, the format page, ADR 0007 and `AGENTS.md`, and did not exist.
**The tool told people to run a command it then rejected**, and there was no
backlog item to build it. Look for that shape: a thing referred to so
consistently that nobody checks it is there.

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

**`examples/shop` has four uncommitted edits from the owner**, one `layout` line
each, all four written at 04:32 on 2026-09-07 and untouched since. The model
checks clean, including `--strict`. **Do not commit or revert them.**

Whether a studio is still open on them is **not known**: this session cannot tell
which local process is one, and probing unknown ports is not something to do
blindly. Earlier notes asserted one was open, which was never verifiable. What is
verifiable is that nothing has written those files since 04:32. If a studio from
before today's work is still open, it has neither the file watcher nor the
staleness guard and a hand edit made under it can still be lost, so restarting
it is the safe move either way.

## In flight, and what is actually left

**Nothing is running, and the three stopped agents are cancelled rather than
paused.** The harness refuses to resume an agent the owner stopped, and says to
treat its work as cancelled and to launch a fresh one only if the owner asks.
So **re-dispatching those three is the owner's call, not mine.**

What survives, and where:

- **`tooling/what-a-merge-costs-and-what-nobody-breaks`** still has commit
  `2f69db1` on it: `merge-pr.mjs` printing which branches a merge is about to
  make stale, `check-main-provenance.mjs`, the guard suite and a decision record.
  Never pushed, so no CI and no review. **Unverified.**
- **`docs/records-that-describe-a-future-that-happened`** kept its branch, and
  its uncommitted work is a 526-line patch in the session scratchpad under
  `cancelled-work/`.
- The flaky-watcher agent's only file was untracked and **was lost**, because
  `git diff HEAD` does not capture untracked files and its patch came out empty.
  Small in itself: that agent had barely started and the item carries the full
  recipe. Recorded as b-fac #182, because the mistake is not small.

**The worktrees are cleared: 3.0 GB down to 172 KB**, which was a real share of
the disk pressure that caused the stop. Branch refs and the patches survive.

**Read the machine before dispatching anything.** The factory gained
`assets/machine-load.mjs` today and shipped it as 0.51.0. On this machine the
largest consumer is six `claude` sessions at 2.7 GB, and a sibling project's
session runs sixteen processes beside this one. Counting your own agents
undercounts.

## What is waiting on the owner

**Both of the decisions that were blocking work were answered on 2026-09-07**,
and neither should be re-asked:

- **Re-import.** Not one of the three merge rules I offered. The owner's own
  words: _"it sounds like you are asking about a delta. When we import, we warn
  the user about the changes 'database table removed' in an itemized list for
  them to scroll through. Then they can confirm the change."_ That overturned my
  recommendation on the first case, and it is built and merged.
- **Publishing.** _"Yes let's publish to npm"_, after five asks.

**One step is theirs and the loop cannot take it.** Add an npm token as the
repository secret `NPM_TOKEN`, then `git tag v0.1.0` and push it. Until they do,
`npx dbmd` resolves nothing, and no page in the repository claims otherwise.

Two things about that step were checked on 2026-09-07 so the owner does not
discover them at the tag. **The name is free**: `dbmd` returns 404 from the
registry, and so do `db-md`, `db_md`, `dbMd` and `dbmd.js`, so npm's
too-similar rule has nothing to catch on. **And a red publish is not necessarily
about their tag**: `release.yml` has no test step because `npm publish` runs
`prepublishOnly`, which is the whole check suite, which contains the flaky
watcher test. If the publish job fails on that, the tag is fine and re-running
the job publishes. The workflow's own error text says to delete the tag and tag
again, which is right for a version mismatch and wrong for this. `dbmd-056`.

**Two agents were cancelled with finished or nearly finished work, and
re-dispatching them is the owner's call.** `docs/records-that-describe-a-future-that-happened`
is documentation, finished, 322 lines, and its uncommitted part is a 526-line
patch in the session scratchpad under `cancelled-work/`.
`tooling/what-a-merge-costs-and-what-nobody-breaks` is commit `2f69db1`, 1,158
lines through `merge-pr.mjs` and the guard suite, never pushed and so never
checked; the worst case if it is wrong is that nothing can merge.

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
- **Merge on the report, not on a checks listing.** Both merge-timing rules are
  in `orchestrating.md` with what each one cost. The second was found today and
  put a reverted commit onto `main`.
- **Close items when their branch lands**, in the same motion as the merge.
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
