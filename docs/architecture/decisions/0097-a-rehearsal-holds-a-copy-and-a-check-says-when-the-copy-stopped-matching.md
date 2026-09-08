# 0097. A rehearsal holds a copy, and a check says when the copy stopped matching

Follows [ADR 0060](0060-a-guard-that-fails-two-ways-says-which.md), which split
the two ways the ancestry step in
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml) can
fail so the message names the right one, and
[ADR 0051](0051-the-first-release-is-a-tag-a-person-pushes.md), which put the
whole of publishing behind a tag a person pushes. It leans on
[ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md) for
why the drift check below is broken on purpose before anybody is asked to
believe it.

## Context

`release.yml` has one step that reads `origin/anything`, and the comment above
it says the problem in its own words:

> This is the only thing in the whole of CI that reads `origin/anything`, and it
> has never run, because no tag has ever been pushed here. Whether
> `actions/checkout@v7` populates `refs/remotes/origin/main` on a tag push is
> therefore unobserved rather than known.

`.github/workflows/provenance.yml` is the only other workflow asking for
`fetch-depth: 0`, so the option is exercised on this repository every day. It
runs on a push to a branch. That is evidence about the option and not about the
event, and the event is the whole of the question.

**The failure is safe and that is not the complaint.** `git merge-base` exits
128 when the ref does not resolve, 128 is not 0, and nothing is uploaded.
ADR 0060 already made sure the reader is told it was the checkout rather than
the tag. What is left is when they are told: the first execution of that step is
also the owner's first release, and an afternoon spent on the last step before
the upload is an expensive way to learn something a Tuesday could have taught.

### Why nobody can rehearse it with a real release tag

The version comparison runs before the ancestry check. A `v*` tag carrying a
deliberately wrong version fails at step one and never reaches step two. The
only `v*` tag that reaches step two is one whose version matches, and that tag
goes on to publish, which cannot be taken back. There is no `v*` tag that
rehearses and stops, and ADR 0060 said as much when it wrote that this guard
"has still never run in CI, and cannot be made to".

What ADR 0060 did instead was extract the `run:` body by hand and drive it under
`bash -e` against throwaway clones in three states. That proved the branching. It
could not prove that a real tag push reaches the step in either state, and it
said so.

### The thing that makes a rehearsal dangerous

A rehearsal that copies the release's configuration is a second place for that
configuration to live, and this repository has spent whole days on that exact
failure: a page whose claim went stale without anybody touching it, a list that
presented itself as complete and was not, a test that had stopped testing
something while staying green. A rehearsal that has silently drifted from the
thing it rehearses is worse than no rehearsal, because it reports green about a
setup nobody is using. Any design here that does not answer that is not worth
building.

## Decision

**There is a rehearsal workflow, it runs on a tag `release.yml` cannot match,
and it cannot publish.**
[`.github/workflows/rehearse-release-ancestry.yml`](../../../.github/workflows/rehearse-release-ancestry.yml)
triggers on `tags: ['rehearsal-*']` where `release.yml` triggers on
`tags: ['v*']`. GitHub's filter pattern cheat sheet gives a tag pattern a
whole-name match anchored at the start: `v2*` "matches branch and tag names that
start with `v2`", and a bare `main` "matches the exact name of a branch or tag
name". A tag matching `rehearsal-*` begins `rehearsal-`, which is not `v`, so it
cannot match `v*`.

It cannot publish for four separate reasons rather than one, because
"structurally incapable" should not rest on a single line staying absent. There
is no publish step. There is no `NPM_TOKEN` and no `secrets.` reference at all.
There is no `registry-url` on any setup step, and `release.yml`'s own comment is
the argument for that one: without it nothing writes the `.npmrc` that
`NODE_AUTH_TOKEN` is read through, so a token that somehow reached this job
would be set and ignored. And `permissions: contents: read`.

**It runs the release's own shell rather than a description of it.** The `run:`
body of the step named `the tagged commit is on main` is written to a file once,
from a quoted heredoc, and driven three times under `bash -e`, which is what
GitHub Actions runs a `run:` body under on Linux. Three states, one shell:

| probe | state | what it answers |
| --- | --- | --- |
| A | the tag-push checkout exactly as it arrived | the open question, and the verdict on the tagged commit |
| B | `GITHUB_SHA` set to a commit made in the runner and pushed nowhere | the ancestry branch still refuses |
| C | `refs/remotes/origin/main` deleted locally | the missing-ref branch still names the checkout |

A is first, before anything is altered, because it is the only one of the three
whose answer is not already known. B and C are the branches ADR 0060 wrote and
ADR 0034 says nobody should believe until they have been seen to fail.

**The job is red when `origin/main` did not resolve.** That is the answer the
owner needs loudly rather than in a paragraph, because it means a real release
today would print the checkout message. A tagged commit that is not on `main` is
reported and does not fail the job: it is the correct answer if the tag was put
there on purpose.

**When `origin/main` is missing, probe B is reported as not judged rather than
as broken.** It stops at the shell's first branch and never reaches the
comparison, so calling that a failure of the probe would be this rehearsal
committing ADR 0060's own error inside its own summary.

**The rehearsal holds a copy, and
[`scripts/check-release-rehearsal.mjs`](../../../scripts/check-release-rehearsal.mjs)
refuses when the copy stops matching.** It reads both workflow files and
compares the checkout's `uses:` line and its whole `with:` block, and the
ancestry shell character for character. `merge-base --is-ancestor` may appear in
exactly one place in the rehearsal, the copied body, because a second copy of
the comparison is a second thing that can be right while the first is wrong. It
also re-derives the tag-pattern disjointness from the two files rather than
trusting the comment that asserts it, and asserts the four publish properties
above. It runs first inside the rehearsal, before anything is reported, and it
runs in `npm test` and therefore in `npm run check`.

**The copy is checked rather than extracted, and that was not a free choice.**
The alternative is lifting the shell into a file both workflows run. Taking it
would mean editing `release.yml`, which is the one file here where a wrong edit
is expensive and stays unobservable until the afternoon somebody is shipping,
and no rehearsal is worth buying at that price.

It would also be the worse design if the price were zero. The whole of the
step's reasoning lives in the comment directly above it, which is most of
ADR 0060, and moving the body out leaves that argument pointing at a file the
reader has to go and find. It would make the release depend on a path resolving
at tag time, where today the step is self-contained in the file the owner reads
before they push. A rehearsal is a nice thing to have. The release working is
not optional, and it should not grow a dependency to buy the rehearsal a
convenience.

What the extracted version would have bought is that the two cannot differ. The
equality check buys the same property by a different route: they can differ, and
the moment they do, something goes red.

**The check parses by anchor rather than by YAML.** It demands one
`actions/checkout` step, a step by that exact name, one heredoc by that exact
marker, and refuses when it cannot find them. A YAML parse would be tidier and
would quietly succeed on a `release.yml` restructured so that none of those
anchors exist, which is drift of precisely the kind this exists to catch. It
also means the script imports nothing outside `node:`, so the rehearsal runs it
on a runner that never calls `npm ci` and therefore has no npm in the job at all.

**The mutations live in `test/guards/release-rehearsal.test.ts` rather than in
`test/guards/broken-on-purpose.test.ts`.** That is a fact about this week rather
than a claim about design: `node scripts/held.mjs` reported that file as held by
three other worktrees when this was written, and a mutation appended to a file
three branches are already editing is a rebase somebody pays for. It runs in the
same suite on the same command, which is the whole of what ADR 0034 asks. Every
mutation is applied to a copy of a workflow in a temporary directory, so nothing
here edits `release.yml` even for a moment.

**There is no `check:` entry in `package.json`.** The script reads two files and
imports nothing, so it costs milliseconds, and ADR 0034's split puts the cheap
guards in `npm test`. The control run over the real tree is the first test in
that file. A second reason is the same as the one above: `package.json` was held
by two other worktrees.

## Consequences

- **`npm run check` grows ten tests and about a second.** Nothing else about the
  gate changes, and no other workflow is touched.
- **`release.yml` is not edited.** Nothing in this record asks it to change, and
  the drift check's refusal message says in as many words that the fix for a
  disagreement is to change the rehearsal.
- **A rewording of the release's ancestry step turns the gate red.** That is the
  cost of an equality check and it is the right cost, because the alternative is
  a rehearsal that has quietly stopped being one. The fix is to copy the new body
  into the heredoc, and the refusal prints the first line that differs.
- **The rehearsal has to be run by a person, on purpose, and it leaves a tag
  behind.** `git push origin :refs/tags/rehearsal-1` removes it. Nothing here
  cleans up after itself, because a workflow that deletes tags needs write
  permission and this one has none.

### What this still does not prove

- **Nothing after the step it rehearses.** No `actions/setup-node`, no `npm ci`,
  no `npm publish`, and therefore no `prepublishOnly`. A green rehearsal says the
  ancestry step would have passed. It says nothing about the token being valid,
  the tarball being right, or the check suite passing on the tagged commit.
- **Nothing before it either.** The version comparison is not rehearsed, so
  ADR 0060's ordering argument is still an argument rather than an observation.
- **The two steps `release.yml` runs in between are absent.** `actions/setup-node`
  and `npm ci` run before the ancestry step there and not here, so the checkout
  the copied shell sees is the checkout as the checkout left it rather than as
  those two leave it. Neither is known to touch a git ref and no mechanism by
  which they could has been proposed, which is why the gap was named instead of
  closed: shutting it means putting npm into a job whose point is not having any.
- **The tag is not a `v*` tag.** Nothing suggests `actions/checkout` reads the
  tag's name, and this cannot rule it out.
- **Probes B and C prove the shell's branches, not the world's.** They are made
  by altering the runner's own repository, so they say the branch still refuses
  and not that a real off-main tag push produces that state.
- **One green run is one observation with a date on it.** It says a runner image
  and an `actions/checkout` release behaved this way that day. A later bump of
  either is a new question, which is the first entry below.

## Revisit when

- **`actions/checkout` is bumped, or the runner image changes under it.** The
  answer this workflow gives belongs to the version that gave it. The drift check
  will refuse until the rehearsal is bumped alongside `release.yml`, which is the
  moment to push another rehearsal tag rather than to edit two files and move on.
- **The first `v*` tag is pushed.** That run is still the only thing that
  observes the whole release path. If it prints the checkout message after a green
  rehearsal, the gap between them is the finding, and the list above is where to
  look for which part of it.
- **`release.yml` grows a step between the checkout and the ancestry check.** The
  third item under what this does not prove gets longer, and the argument for
  leaving it unclosed should be re-made rather than inherited.
- **A second workflow starts reading a remote-tracking ref.** ADR 0060 wrote this
  condition for itself and it now has a second file that would fire it, which is
  worth knowing when somebody counts consumers of `fetch-depth: 0`.
- **This rehearsal has not been run for a release.** A rehearsal nobody runs is a
  workflow file that costs a gate second and buys nothing, and deleting it would
  be the honest outcome.
