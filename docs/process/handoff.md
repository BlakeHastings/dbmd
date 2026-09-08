# Handoff

A snapshot with a decay note. Where this disagrees with the repository, the
repository is right: `bd ready`, `bd blocked`, `git log` and the decision records
are the source of truth and this is only where the work stopped.

**As of 2026-09-08, late, with five agents out, two pull requests open and every
epic closed.**

## Where the work is

**Do not quote the merged count from arithmetic.** I did, and said 162 when
`gh pr list --state merged` said 158. I then did the same thing four more times
in one night, telling four agents how far behind their branch was without running
`git rev-list --count`, and being wrong three times. Every number below was
measured just now.

| | |
| --- | --- |
| merged pull requests | 230 |
| decision records | 88 |
| tests | 1358 passing, 1 skipped, across 46 files |
| backlog | 123 closed, 3 open, and it still cannot be written to |
| the gate | 58, 58 and 60 seconds, timed three times on 2026-09-08 |

**Three items are open and only two are the owner's.** An earlier version of this
paragraph said all three were. It was wrong within an hour of being written,
which is the failure this file keeps a section about, arriving in the file that
keeps it.

- **`dbmd-v6c` is finished.** It is the reading half of the feedback loop and it
  merged as #186. It is open because nothing can write to the tracker, and
  closing it is the first line on the owed list below. **Do not dispatch it.**
- **`dbmd-fnl`, the visuals epic**, is taste and both of its questions now have a
  picture rendered on the live diagram and sent to the owner: four options for how
  an edge could say what a delete does, one of which was ruled out afterwards
  because a dash already means an unanchored end, and two options for making a box
  carry more weight, both of which argue for doing nothing.
- **`dbmd-6bf`, the recovered layout**, is a decision and now has a picture too:
  the four surviving coordinates drawn on the canvas against what is committed.
  **Its coordinates live in the item's `design` field and its `description` is
  empty**, so a reader checking one field concludes the item promises numbers it
  does not carry. It carries them.

**The backlog stopped being where work comes from at about midday.** Everything
in it an agent could do was done. What followed came from driving the product and
from making the project's own records audit themselves, and none of it has an
item because the tracker has been blocked since the afternoon. The owed writes
are listed below.

**All eight epics are closed**, the last
two on 2026-09-07: import, which closed when re-import landed, and publishing.

## In flight right now, which is five agents and one held branch

**Written at the point of most confusion rather than at a calm moment**, because
the calm version of this file was wrong about its largest claim within an hour
and that is the failure this document keeps a section about.

**Five agents are out and none has a tracker item**, because `bd` still cannot
run. Each brief is the whole issue and each pull request body carries it.

| branch | what it is |
| --- | --- |
| `model/six-sentences-and-the-states-that-make-them-false` | the six held diagnostic messages, four of them reproduced by hand first |
| `guard/a-page-that-holds-its-own-body-twice` | #235, approved, rebasing. The check that would have caught the tripled log |
| `studio/three-sentences-that-cost-somebody-something` | the three studio findings that cost a person something |
| `studio/five-things-the-panel-says-about-a-group-that-is-not-there` | the five inspector panel findings |
| `studio/a-fit-that-fitted-and-said-it-had-not` | the five canvas and status line findings |

**#234 is mine and is held**, carrying the studio sweep's full record.

**Three studio findings are not dispatched and are blocked on one file.**
`src/studio/client/write.ts` is held by the first studio branch, and these three
live in it: the refusal that says "The page is re-reading the model" in the one
case where it deliberately is not; "The diagnostics below say what the reader
saw" standing after the list has emptied; and a conflict entry whose "just now"
ages, in a list that renders the path twice. Dispatch them when that branch
lands.

**What to do if you are picking this up cold.** Read the pull request bodies
before the briefs: every one of these was measured, and the measurements are in
the bodies rather than here. Then `gh pr list --state open`, because this table
is a snapshot and the repository is not.

## In flight, and what is actually left

**Four agents were dispatched on 2026-09-08, all on the CLI, and none has an item
in the tracker because the tracker cannot be written to.** Each brief is the
whole issue and each pull request body carries it, so nothing is lost if this
file is. One of the four has already landed as #223. A fifth agent wrote nothing
at all: it drove `dbmd check` and `dbmd init` against their own help text and
reported, which is where three of the findings below came from. Nineteen agents
have now worked between the afternoon of 2026-09-07 and here.

- **LANDED as #222.** `dbmd export` told a README holding both diagram markers,
  in the wrong order, that it was missing one. It now says they are out of order,
  and a refused write answers in the command's voice. It also writes through
  `writeAtomically` now, so "nothing was changed" is true rather than usually
  true. Verified by building the sha and measuring the file, not by reading the
  report.
- **LANDED as #223.** `dbmd refs` counted the reader's errors and the
  validator's together and explained all of them as a file that failed to load.
  Three banners for three states now, and `readErrors` beside `errors` in the
  JSON. It also amended ADR 0042, whose claim was one size larger than its own
  reason, which is where the code came from.

**Two more waves went out after those, both from driving the command line.**

- **LANDED as #225.** `offendingOption` returned the first argv token starting
  with a dash rather than the one that offended, so every command could name a
  valid flag as unknown in a sentence that then listed it as accepted. It now
  takes the object the command handed `parseArgs`, types included, which is what
  lets it tell a mistyped short flag from an option's value. Sent back once,
  because the first version traded away a case that had been correct. Verified by
  building the sha and driving twelve command lines.
- **LANDED as #226**, the largest change of the night. `dbmd init` told a plain
  file it was a directory that is not empty and offered a remedy that provably
  failed; `dbmd check` counted diagnostic headings and called them files,
  including headings that were directories or nothing at all; and `dbmd check`
  said there was no `_model.md` on the line above the one that named
  `_model.md/`. `DiagnosticLocation` gained a third variant,
  `{ in: 'directory', path }`, with no `line`, and ADR 0086 is the argument.
  Sent back once, because the one code the branch added broke the rule its own
  record states. Verified by building the sha and driving both sides of the rule,
  every counterfactual, and the seam with #225.

**LANDED as #227.** The held import finding is done.  It was held until the export branch
settled the wording, and #222 settled it: a refused write leads with the
developer's file, says what happened to it, and hands over the system's words
with the temporary explained rather than stripped. `import/a-failure-half-way-says-what-it-wrote`
copies that shape and adds the part export did not need, which is a report that
names the files a failed run did land.

**What the held finding was.** `dbmd import` has the same
uncaught write failure, it leads with a temporary file whose name is gone by the
time anybody looks, and worse, a failure half way through writes files and then
reports nothing about them, because `writeModel` returns its list of written
paths after the loop and a throw discards it. Reproduced on two tables where only
the second was unwritable: the first was rewritten on disk and the entire output
was one `EPERM` about the second. It is held because the export agent is settling
the wording that ADR 0083 asks for, and the import fix should copy a landed
pattern rather than invent a second one beside it. Dispatch it once export lands.

**The studio is running for the owner** at `http://127.0.0.1:49192/`, started at
20:37 on 2026-09-07 with `npm run studio:dev`, with the feedback overlay on it.
`npm run annotations` reads what they write there. **Nothing has been annotated
yet.** The address moved five times before that one and then stopped on purpose;
do not restart it without saying so, because they were given that number.

**The loop they asked for is proved in both directions.** An annotation written
to that page's session comes back through `npm run annotations` with the comment,
the element and the selector, and `--reply` and `--resolve` answer in the thread
they will see. Verified by writing one, reading it, answering it and deleting it.

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

**Four more are owed from 2026-09-08, found by driving the CLI rather than the
studio.** Two are out with agents and the third is deliberately held; the fourth
is a note rather than a defect. File all of them when `bd` runs again, and check
the pull requests before closing any of them.

```bash
# Out with an agent on 2026-09-08. Its whole brief is in its pull request body.
bd create --ignore-schema-skew -p 2 -t task   "export tells a README holding both markers that it is missing one"

# Out with the same agent, in the same branch, for the same reason.
bd create --ignore-schema-skew -p 2 -t task   "export prints a write failure in Node's voice with an absolute path"

# Out with a second agent on 2026-09-08.
bd create --ignore-schema-skew -p 2 -t task   "refs explains a validation error as a file that did not load"

# LANDED as #227. Filing it is bookkeeping; the reasoning is in ADR 0087.
bd create --ignore-schema-skew -p 1 -t task   "import fails half way, leaves files written, and reports none of them"

# Out with a third agent on 2026-09-08. All seven commands are affected.
bd create --ignore-schema-skew -p 2 -t task   "Every command names the first dash token as the unknown one, not the wrong one"

# Out with a fourth agent on 2026-09-08, as one branch.
bd create --ignore-schema-skew -p 2 -t task   "init tells a plain file it is a directory that is not empty"
bd create --ignore-schema-skew -p 2 -t task   "check counts diagnostic headings and calls them files"
bd create --ignore-schema-skew -p 2 -t task   "check says there is no _model.md above the line that names _model.md/"

# Found 2026-09-08 and NOT dispatched. Its fix has to edit README.md, which
# carries the owner's uncommitted edit, so it waits on them.
bd create --ignore-schema-skew -p 3 -t task   "The README shows thirteen command sessions and two of them are checked"

# Found 2026-09-08 and not dispatched. Lower than the rest.
bd create --ignore-schema-skew -p 3 -t task   "studio prints a busy port in Node's voice, with the advice it already knows"

# Found 2026-09-08 by driving docs/ci.md claim by claim. The page is not wrong,
# it says to commit the file first and calls the shape untested, so this is a
# sharp edge in a recipe that is about to ship.
bd create --ignore-schema-skew -p 3 -t task   "The CI recipe's git diff --exit-code shape is silent on an untracked README"

# Found 2026-09-08 by enumerating the class rather than hunting it. The last
# command that still reports a failure in Node's voice, with an absolute
# backslashed path that ADR 0006 rule 4 forbids.
bd create --ignore-schema-skew -p 2 -t task   "init leaks a raw ENOTDIR when the parent of its target is a plain file"
```

**The last three above are one branch**, `cli/a-busy-port-and-a-gate-that-cannot-fail`,
dispatched on 2026-09-08. With it and the import branch landed, no command
reports a failure through the last-resort handler any more. That was checked by
driving fourteen failure modes across all seven commands with `--json` and
reading `error.code`, not by counting the ones that had been fixed.

**Two more were found on 2026-09-08 and both are out with agents.** The agent
skill contradicted itself within an hour of #227, saying in one place that a
failed write's record is lost and in another that it is reported, both from the
same author in the same commit. And `scripts/check-commands.mjs` resolves every
`dbmd` command name written anywhere in the repository and no flag, so
a flag no command declares passes in the README, in the published recipe and in
the skill, all three measured. It is deliberately not quoted, because these
files are scanned by that same guard once it learns about flags. The recipe is the sharp one: that line would ship to a
stranger and exit 2 in their CI.

**Three of the four not-dispatched items are one small branch when a slot
frees**: the studio's busy port, the CI recipe's untracked-README hazard, and
whatever the README needs. The third is the one that waits on the owner, because
it edits a file holding their uncommitted work.

**One of those is blocked on the owner rather than on an agent, and it is one
block, not a page.** `README.md` holds thirteen lines beginning `$ dbmd`: two in
the `dbmd-run` blocks the test suite executes, one in the `dbmd-sketch` block,
and ten in plain fences. **All ten were then run by hand.** Nine match what the
built CLI prints, several byte for byte. One prints a port the operating system
picked and so can never match exactly. **Exactly one is wrong**, and it is
`dbmd refs addresses shop` around line 472: #223 replaced its two-line banner
with a three-line one saying the opposite, and the rest of the block still
matches. The replacement text is known and was produced by reconstructing the
model that block describes and running the command.

So the work here is one block plus, if wanted, moving the other nine under
`dbmd-run` so they cannot drift again. Both edit a file holding the owner's
uncommitted work, so both wait on them.

**The third of those is the one to read first if time is short.** ADR 0083
decided that a refusal from the disk leads with the file and keeps the system's
words. It was applied to the studio and to nothing else, so the two commands that
document a write failure in their own exit-code lists both leak the raw error
instead, and `dbmd import` names a temporary file that no longer exists. That is
a decision that was made and then not carried to the surfaces it was about, which
is a different failure from a decision nobody made.

## Six diagnostic messages are dispatched, and four were reproduced first

**All six are now out** on `model/six-sentences-and-the-states-that-make-them-false`,
and the three that were with an agent landed as #231. Four of the six were
reproduced by hand before the brief was written rather than taken from the
sweep's report: `kind-mismatch`'s three false clauses, `kind-missing` run side
by side with the same message one directory down where every word of it is true,
and both halves of the `unknown-key` contradiction, the group half followed end
to end by writing the key the message calls known and reading what comes back.

The section below is the queue as it stood, kept because it carries the evidence
and the mechanisms, and a successor who needs to re-dispatch any of them should
read it rather than re-run the sweep.

## Six diagnostic messages are queued and the queue is the point

**A sweep triggered all 35 model diagnostic codes and read each message against
the state that produced it.** Nine came back suspect. Three are out with an agent
on `model/what-the-model-knows-is-not-what-the-disk-says`. **The other six are
held only because two agents cannot both be in `src/model/read.ts`**, and they
are written out here so that a successor can dispatch them without re-running the
sweep.

- **`kind-mismatch` on `_model.md` has three false clauses.** Reproduced twice.
  A `_model.md` carrying `kind: table` is told it is "in a directory of models",
  that "the directory decides", and "so this file is not loaded". There is no
  directory of models in the format; the file name decides and `readModelFile`
  passes the literal `'model'`; and the file loads, which was measured by reading
  `model.name` and `model.engine` back out of it through the library. Every
  clause is true one level down, on `tables/orders.md` with `kind: note`.
  `docs/format.md` repeats the false clause in that code's row.
- **`kind-missing` on `_model.md`** says "the directory says this is a model".
  The model root says nothing about kinds. This is the case the format page ships
  as its worked example.
- **`unknown-key` offers keys the same reader refuses.** One run says `w` and
  `h` belong to a note and not to a table, then three lines later lists
  `h, w, x, y` as that layout's known keys. Following the second produces the
  first. A group's message lists `layout` as known while a group's `layout` is
  separately refused. `reportUnknown` builds its list from every key passed to
  `take()`, and both of these are taken in order to be refused; the `reject()`
  path exists for exactly this and its own comment says so.
- **`frontmatter-empty`** fires on frontmatter holding a comment, where both the
  code's own doc and the format page describe delimiters with nothing between
  them.
- **`duplicate-key`'s documented input is unreachable**, since two identical
  keys are refused by the YAML parser first. It is only reached when two keys
  YAML sees as different resolve to one dbmd name. In one of its two live cases
  its "the first one is used" clause is false, because `reject()` deleted it.
- **`superseded-key`** tells a nameless column to write `columns: [this column]`,
  which is not writable YAML. Only reachable beside a `field-missing`, so low.

**One code is unreachable by `dbmd check` and that is correct.**
`duplicate-table` cannot happen there because a table's name comes from its
file's basename, and both `src/diagnostics.ts` and `docs/format.md` already say
it is import-only.

**Eighteen remedies were followed literally and every one cleared its
diagnostic**, which is the half of that sweep worth as much as the suspects.

## Twelve studio sentences, with the states that make them false

**Three of the fifteen are out with an agent and are not repeated here.** Five
are in the inspector panel and five on the canvas and status line, both
dispatched. **Three are blocked on `src/studio/client/write.ts`** and are the
ones to dispatch next. All fifteen were measured; the mechanisms are named so
nobody re-drives the page to re-find them.

**Blocked on `write.ts`, dispatch when the first studio branch lands:**

- **`staleNotice` says "The page is re-reading the model" when it is not.** The
  refusal fires because the cursor is in the prose panel, and `catchUp()` returns
  immediately for exactly that reason. Measured: six seconds later the textarea
  still held the old body. The page says the true sentence first ("will catch up
  when you are between edits") and then contradicts it. True when the refusal
  comes from a drag, where the re-read happens on the pointerup.
- **`unreadableNotice` says "The diagnostics below say what the reader saw"
  after they have gone.** Release the lock and the list empties, while a standing
  `bad` sentence wins in `showStatus` and is only cleared by an edit that lands.
  The reader is pointed at an empty list in the state where they have just done
  what they were told.
- **A conflict entry's "just now" ages**, by design for the entry and not for the
  wording, and the list renders the path twice, once as its own element and again
  inside the message's backticks.

**Two more that are timing rather than truth**, recorded and deliberately not
dispatched, because fixing them means deciding how long a status line holds and
that is closer to taste than to a defect:

- The sentence saying a group move writes table files and not the group file is
  on screen for **13 milliseconds**, measured with a `MutationObserver`. It is
  the one place the interface says out loud that a group has no coordinates.
- `Renaming a to b.` lasts about **70 milliseconds**.

## What a successor would otherwise have to reconstruct
**SETTLED, and my framing of it was wrong.** I recorded here that my briefs and
`docs/process/working-an-issue.md` disagreed about the example model, mine saying
copy it and the document saying drive the tracked one and undo with
`git checkout examples/shop`. ADR 0079 settled it in favour of the copy on
2026-09-07, and the argument is better than the one I offered: `orchestrating.md`
had already reached the identical fork one directory up and concluded that a rule
about care cannot work, because a refusal names one file and a reset destroys
every uncommitted one. The answer there was to make the rule about which
directory a command runs in, and this is that answer one level down.

**It was never two voices.** Ten merged decision records already named a copy and
this evidence log named one in eleven places, both counted. Nothing anywhere
recorded an agent deliberately driving the tracked example. That document was the
only thing saying it.

Measured before accepting the change, in a throwaway worktree: eight table files
given an uncommitted edit, then `git checkout examples/shop` answers
`Updated 8 paths from the index` and leaves nothing. It names a count rather than
the files, asks nothing, and nothing is recoverable. **`npm run studio:dev` has
the same default and the same hazard**, and is left alone because no document
sends an agent at it; if one ever does, it needs the same treatment.

Same document, same paragraph: *"Stop the server you started, by its own process,
before your worktree is removed."* I left twenty two studios running across one
session, which is that rule broken by the person who reviews everyone else
against it.


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

## One thing worth deciding after the first publish, not before

**npm can attach build provenance and this package does not ask for it.**
`release.yml` publishes with `--access public` and nothing else; it declares
`permissions: contents: read` and does not mention `id-token`. npm on this
machine is 11.17.0, the repository is public and the publish runs from GitHub
Actions, which is the whole of what provenance needs. Adding it is two lines:
`id-token: write` in the job's permissions and `--provenance` on the publish
command. What it buys is a verifiable link on the package page from the tarball
back to the commit and the workflow run that built it, which is the same
argument `docs/ci.md` already makes when it refuses `npx dbmd@latest` in a CI
job.

**Do it after the first release rather than as part of it, and the reason is in
this file already.** `release.yml` has never run. Its own comments record one
step whose behaviour is unobserved: whether `actions/checkout@v7` populates
`refs/remotes/origin/main` on a tag push. Adding an untested flag to an untested
workflow doubles the number of things that can be wrong on the one run that
cannot be taken back, and a failed first publish burns a tag.

So: publish, watch it work, then add provenance and watch that work on 0.1.1.
Recorded rather than done, because the release path is the owner's and because
nothing here should touch it on a hunch.

## What the night actually found, for somebody deciding where to look next

Four defects, and the shape they share is worth more than the list.

- **A status line that said it was creating a file it had created**, which turned
  out to be true of a rename as well, and worse there: renaming a referenced
  table ended by naming the least interesting file it touched.
- **An import grid five tables wide whatever the schema's size**, which laid six
  hundred tables in a ribbon no zoom could fit, with a Fit button that silently
  did not fit.
- **A watcher that dropped a workflow** whose branch filter it could not read,
  which is a watcher watching one thing less for a reason nobody would see. Found
  by the first question anybody ever asked that parse.
- **A write refusal written in the operating system's words**, leading with a
  temporary file the person never created and which no longer exists by the time
  they read about it.

**Every one is about what the tool says rather than what it does.** Where this
tool could lose somebody's work it is careful: a rename moves the references and
says so first, a delete names what it will leave dangling, two writers on one
model refuse rather than overwrite, an unreadable file keeps the last good
drawing, and a locked file keeps the edit and retries. Nothing found tonight
threatened anybody's data.

**And the records were less reliable than the code.** Sixteen revisit conditions
had fired unread. Two records were born describing a future nobody re-read them
against, one of them seventeen minutes before the record that dissolved its
reasoning. A skill shipped with the repository carried five false claims, two of
which were never true. **A guard nobody had run found a real bug on the first
question it was asked.** If you are deciding where to look next, look at what
this project says about itself rather than at what it does.
