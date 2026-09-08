# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-07, with one pull request in flight and every epic closed.**

## Where the work is

**Do not quote the merged count from arithmetic.** I did, and said 162 when
`gh pr list --state merged` said 158. Every pull request has merged through
`merge-pr.mjs` and the provenance audit is clean across every commit on `main`;
for the number, run the command. As of the last measurement: **189 merged, 123
items closed, 3 open, and no P1s.**

**All three open items need the owner rather than an agent.** The visuals epic,
which is taste and now has a picture attached to one of its two questions. One
recoverable layout they have not said whether to restore. And the epic's own
parent question about box weight, whose recorded recommendation is to do nothing
without a reason.

**Everything dispatchable was dispatched and landed.** `dbmd-v6c`, the reading
half of the feedback loop, is done and closed in spirit though not in the
tracker, which cannot be written to. Three more pieces of work were found by
driving the studio rather than by reading the backlog, and none of them has an
item because of the same tracker problem: the edge tooltip, the edge ids and the
panel key, and the status line that lied after a create.

**All eight epics are closed**, the last
two on 2026-09-07: import, which closed when re-import landed, and publishing.

## In flight, and what is actually left

**One pull request is in flight**, the status line that stopped saying it was
creating a file it had created. Everything else has landed.

**The studio is running for the owner** at whatever port `npm run studio:dev`
last bound, with the feedback overlay on it and `npm run annotations` able to
read what they write. That command finds the studio's own page among the
hundreds of sessions on the annotation server, most of which belong to a
different project on this machine.

**The annotation server is reachable and the way it is reachable is not the way
this file used to say.** The earlier version of this paragraph claimed the
session had been restarted so that the server's tooling was available. That was
wrong in both halves and a successor should not inherit it.

What is actually true, read off this machine on 2026-09-07:

- `agentation-mcp server` is running and `GET http://127.0.0.1:4747/health`
  answers. Its only established client belongs to a different project on this
  machine, so it was somebody else's process before it was ours.
- **It is not registered as an MCP server for this project and does not need to
  be.** The only server in the user's config is `browsermcp`, and that one fails
  to connect. There are no `agentation` tools in a session here.
- **It answers plain HTTP.** `POST /mcp` with an `initialize` call returns an
  `mcp-session-id` header, and after `notifications/initialized` every one of
  its nine tools is callable with curl. Done by hand: the studio's own
  annotation session is `mtrqroy8-xdzike` at `http://127.0.0.1:57818/`, created
  21:17:26Z, and it holds no annotations yet.

So the owner does not have to restart anything for their feedback to be
readable, and `dbmd-v6c` is the script that closes it.

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

## The tracker is blocked, and this is how to replay what it missed

**`bd` stopped running partway through 2026-09-07 and the backlog has been
read-only since.** Windows Smart App Control moved into enforcement, `bd.exe` is
not digitally signed, and Application Control refuses it. The binary itself has
not changed since 15 August, so the policy moved rather than the tool.
`Get-AuthenticodeSignature` says `NotSigned`, and the registry value
`VerifiedAndReputablePolicyState` under `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy`
reads 1, which is enforced rather than the evaluation mode it was presumably in
before.

**Do not suggest turning Smart App Control off as though it were a setting.** It
can be turned off, and once off it cannot be turned back on without resetting
Windows. That is the owner's call to make knowingly, and the alternative is a
signed build from the beads project.

**`.beads/issues.jsonl` is still readable** as a plain file, so the backlog can
be queried with `node` or `grep`. **Do not hand-edit it.** The database is the
source of truth and the next export overwrites the file.

**These writes are owed to the tracker and should be replayed in this order once
`bd` runs again.** Each one is a thing that actually happened, not a plan:

```bash
# The feedback reader, if its pull request has landed by the time you read this.
bd close dbmd-v6c --ignore-schema-skew --reason "..."

# The work dispatched while the tracker was down, which has no item because
# there was no way to file one. Its whole brief is in its pull request body.
bd create --ignore-schema-skew -p 2 -t task \
  "Hovering an edge says what it references and not what a delete does"

# Found on 2026-09-07 and not yet filed anywhere but here.
bd create --ignore-schema-skew -p 3 -t task \
  "An annotated edge comes back as a position because SVG has no string className"

# Found on 2026-09-07 by driving the keyboard. ANSWERED BEFORE IT WAS FILED:
# ADR 0073 built the second Enter and the Escape back out, and index.html now
# says both clauses. File and close it in one motion; do not dispatch it.
bd create --ignore-schema-skew -p 3 -t task \
  "Enter says it opens the panel and does not say how to reach it"
```

The list above was written before three more pieces of work were found by
driving the studio, all of which are built, reviewed and merged. They have no
item because the tracker was already blocked when they were found, so they are
owed too, and each should be filed and closed in the same motion:

```bash
# Built, reviewed and merged. Filing these is bookkeeping; the reasoning for
# each is in its own pull request body.
bd create --ignore-schema-skew -p 2 -t task \
  "Hovering an edge says what it references and not what a delete does"    # PR 187
bd create --ignore-schema-skew -p 3 -t task \
  "An annotated edge comes back as a position, not an identity"            # PR 189
bd create --ignore-schema-skew -p 3 -t task \
  "The studio says it is creating a file it created fifteen seconds ago"   # PR 191
```

The last of those turned out to be two defects rather than one: a rename had it
too, and worse, because renaming a table that other files reference ended the
act by showing a true sentence about the least interesting file it touched.

The third one needs its reasoning, so here it is. `agentation` records the
element a person annotated by building a CSS selector, and its rule is an id
first, then a class longer than two characters that matches exactly one element,
and otherwise a recursion into the parent with `> tag:nth-child(n)` appended.
Read out of `node_modules/agentation/dist/index.mjs` on 2026-09-07. The class
branch is guarded by `typeof el.className === "string"`, and an SVG element's
`className` is an `SVGAnimatedString`, so **no SVG element can ever match on
class**. Every edge on the canvas is an SVG path with no id, so feedback on a
relationship arrives as a position from the top of the drawing: resolvable while
that render is up, and meaningless once the layout moves. Every table box has an
id, so feedback on a table and on a column is anchored properly and needs
nothing.

The fourth one needs its reasoning too. `index.html` describes the canvas to a
screen reader as *"Tab reaches one object on the canvas. Arrow keys move between
objects, Home and End go to the first and the last, and Enter opens the panel for
the one you are on."* Every clause of that was driven on 2026-09-07 and every one
of them is true: arrows move between objects spatially, Home and End reach the
first and the last, and Enter opens `aside#inspector` with the right heading on
it.

**What the sentence does not say is how to get into the panel it just opened.**
Focus stays on the canvas object, which is defensible on its own, because it lets
somebody arrow to the next table and watch the panel follow. But the panel holds
101 of the page's 136 focusable elements, and reaching the first of them from
where Enter leaves you takes **nine presses of Tab**, through a note and the
whole toolbar. Nothing announces that and nothing shortens it.

So this is not a claim that the keyboard work is wrong. It is that the last step
of it has no key, and the help text is the evidence: it describes opening and
stops there.

**One entry above is now stale, and it is the fourth one.** The item "Enter says
it opens the panel and does not say how to reach it" was filed here against the
help text as it stood. ADR 0073 answered it, and the sentence in `index.html` has
grown the two clauses it was missing. Read off a running studio on 2026-09-07:

> Tab reaches one object on the canvas. Arrow keys move between objects, Home and
> End go to the first and the last, and Enter opens the panel for the one you are
> on. **Enter again moves into that panel, at its heading. Escape from the panel
> comes back to the canvas.**

Driven the same day and both clauses hold: a second `Enter` on a focused box
lands on the panel's `h2`, and `Escape` returns to the box. So that entry should
be filed and closed in the same motion like the three above it, rather than filed
as open work. The nine presses of Tab it describes are no longer the only route.

**The revisit lists in `docs/architecture/decisions/` were swept on 2026-09-07**,
all 263 conditions across 73 records, and [`verified.md`](verified.md) carries the
method and the count. **Sixteen** conditions had fired without anything saying so
and their records now say so. The sixteenth was the sweep's own mistake, found an
hour later when ADR 0075 landed: ADR 0021's second entry had fired and the sweep
said it had not, because it believed the record's description of `dbmd import`
instead of reading `src/import/model.ts`. That correction is on ADR 0021, on
ADR 0029 and in `verified.md`, and it is the reason to distrust any "not fired"
verdict in the sweep that does not name what was read. Three things came out of
it that are open work rather than history, and they are owed to the tracker too:

```bash
# ADR 0065, ADR 0071, ADR 0072 and ADR 0073 all carry a revisit entry that fires
# on this one condition, and none of them can close alone. Measured 2026-09-07 on
# a running studio against a copy of examples/shop: 0 of the 11 edges carry a
# tabindex and 0 carry an aria-label, while all 11 canvas objects carry both a
# name and a place in the arrow order. So a relationship is the one thing on the
# canvas a person cannot land on, and its title, which is the sentence saying
# what a delete does, is reachable only by hovering or by a reader walking the
# tree. Deciding it means answering three questions together: what an edge is in
# the reading order (0073), whether the id ADR 0072 wrote for a development tool
# becomes something a person lands on (0072), and whether the title's length
# starts to cost once it can be landed on deliberately (0071).
bd create --ignore-schema-skew -p 3 -t task \
  "An edge is the one thing on the canvas a keyboard cannot reach"

# ADR 0056's third revisit entry: "a third page starts carrying output blocks...
# the moment to lift the parser out of both tests rather than to copy it again".
# Four pages carry them now and four test files read fenced blocks out of them:
# test/docs/format.test.ts, test/import/docs.test.ts, test/docs/readme.test.ts
# and test/docs/payloads.test.ts. The fourth was added by ADR 0066 with an
# argument for its own shape and none about sharing, so the question the entry
# raises has not been asked rather than answered. It is a refactor with no
# decision in it. Whoever takes it should know the four do not read the same
# thing: three match an info string, one matches a bare json fence on a named
# page, and ADR 0069 added a fifth assertion inside readme.test.ts that reads a
# narration block against a command's stderr.
bd create --ignore-schema-skew -p 4 -t task \
  "Four test files read fenced blocks and none of them shares a parser"
```

**And one is the owner's rather than an agent's.** ADR 0002's first revisit entry
is *"the owner asks for the GitHub repository. The backlog does not have to move
with it, and moving it is a decision to make deliberately rather than by drift."*
That happened on 2026-08-24 and the decision was never taken: the backlog stayed
in beads because nobody asked. It is worth asking now rather than later, because
the tracker being refused by Application Control is a second fact pointing at the
same question, and because the file the entry sends a reader to,
`references/backlog-port.md`, is in the orchestrated-delivery skill and not in
this repository. **This is not a recommendation to move it.** It is that the
answer should be chosen once, and written into ADR 0002 as an appended section
either way.

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
