# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with one agent working on the owner's only P1, and every
epic closed.**

## Where the work is

One hundred and thirty-one pull requests have merged, all through
`merge-pr.mjs`, and the provenance audit is clean across every commit on `main`.
**99 items closed, 7 open**. One is the owner's and it is the only P1;
five are P3s I filed by driving the product or by reading the records against
the tree, and the seventh is the owner's visuals epic. **All eight epics are
closed**, the last two on 2026-09-07: import, which closed when re-import
landed, and publishing.

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

Two agents.

- **dbmd-o69**, the owner's, and the only P1. They asked for a prominent "This
  was 100% vibe coded using b-fac", a link to
  [b-fac](https://github.com/BlakeHastings/b-fac), and for the page to convey
  that they built this as a tool for personal use. Their sentence is quoted on
  the item and is not to be softened. The second half is the more useful one: a
  stranger arriving at a public repository assumes it wants users and issues,
  and this one was built by one person for their own use.
- **dbmd-c7q**, on pull request #131, rebasing. Reviewed and verified against a
  real lock on both sides: `main` tells you a file that parsed perfectly "did not
  parse ... Fix the file and reload", and the branch says it could not be read,
  while a genuinely broken file still says "did not parse" word for word.

**Five items are ready and held**, each saying why on itself: dbmd-dil,
dbmd-76x, dbmd-7b6, dbmd-nm5 and dbmd-5pj. Three of them are small, touch
different files, and should go to one agent as a batch.

**My own process docs are still uncommitted** and land the moment #131 does.

**The visuals epic, dbmd-fnl, is the owner's.** Both measured children have
landed; what is left is three questions with a recommendation each.

## What is waiting on the owner

**Both of the decisions that were blocking work were answered on 2026-09-07**,
and neither should be re-asked:

- **Re-import.** Not one of the three merge rules I offered. The owner's own
  words: _"it sounds like you are asking about a delta. When we import, we warn
  the user about the changes 'database table removed' in an itemized list for
  them to scroll through. Then they can confirm the change."_ That overturned my
  recommendation on the first case, and it is built and merged.
- **Publishing.** _"Yes let's publish to npm"_, after five asks.

**One step is theirs and the loop cannot take it.** Once #118 lands: add an npm
token as the repository secret `NPM_TOKEN`, then `git tag v0.1.0` and push it.
Until they do, `npx dbmd` resolves nothing, and no page in the repository claims
otherwise.

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
