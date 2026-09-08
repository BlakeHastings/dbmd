# 0098. A publish is refused where a merge is only sent back

Answers the last revisit condition ADR 0051 wrote for itself: "Somebody wants
the loop able to release. It is not, and the thing stopping it is that only the
owner can push a tag and only the owner holds the token, rather than a rule in
`scripts/guard-merge.mjs`. If that ever stops being enough, the rule is the next
layer and this is the record to amend."

## Context

`scripts/guard-merge.mjs` is a `PreToolUse` hook on `Bash|PowerShell`, wired in
`.claude/settings.json`. It exists so that "agents do not land code" is enforced
rather than repeated.

On 2026-09-08 the owner drove 25 command lines through the copy that is actually
wired. Thirteen were denied. **The four that were not denied are the ones that
cannot be undone.**

| driven | before |
| --- | --- |
| `gh pr merge 42 --squash` | DENY |
| `gh api -X PUT repos/o/r/pulls/42/merge` | DENY |
| `git push origin HEAD:main` | DENY |
| `git push --force origin HEAD:main` | DENY |
| `git tag v0.1.0` | allow |
| `git push origin v0.1.0` | allow |
| `git push origin --tags` | allow |
| `npm publish` | allow |

**So the guard denied the reversible thing and permitted the permanent one.** A
merge can be reverted, and this repository has a script that will do it. A
publish cannot: `npm unpublish` is refused outright after 72 hours, and it is a
rude thing to do inside them.

The distance from an agent's worktree to the npm registry was one command line.
`git push origin v0.1.0` starts `.github/workflows/release.yml`, which runs
`npm publish` with a token that agent will never see, and the tag is the whole
of the trigger. ADR 0051 designed that on purpose and named the protection
honestly: the loop "cannot reach the registry even by accident" because only the
owner pushes tags and only the owner holds the token. The second half of that is
still true. The first half was an instruction.

**Three documents say those actions are forbidden and none of them was
enforced.** `AGENTS.md` says no agent here pushes a tag or publishes.
`docs/process/working-an-issue.md` lists `npm publish` and pushing a tag under
"these are prohibited, without exception". `.github/workflows/release.yml` calls
pushing a tag "the one step of this that no agent in this repository is allowed
to take". ADR 0078 is this project's record of what that is worth: "You do not
merge. Ever." had its own heading, was repeated in every brief, and an agent
merged its own pull request anyway.

The asymmetry is the finding. A rule written down three times and enforced
nowhere sits in front of the one action in this repository whose consequence is
permanent, while a longer and better tested rule sits in front of the one that
can be reverted in a minute.

## Decision

**The rules that guard a release are added below the ones that guard a merge,
and they refuse rather than redirect.** A merge rule sends the caller to
`node scripts/merge-pr.mjs`, because there is a sanctioned way to merge. There is
no sanctioned way for an agent to release, so these have nowhere to send anybody
and say so.

Four rules, all reading only the command line, which is the constraint the file
already keeps everywhere:

- **A `git push` whose own arguments name a tag.** `--tags`, `--follow-tags` and
  `--mirror`; a refspec containing `refs/tags/`; git's `git push <remote> tag
  <name>` shorthand; and a destination shaped like `v` followed by a digit.
- **`npm publish`,** and the same word under `pnpm`, `yarn`, `bun`, a path, a
  `.cmd` shim and `yarn npm publish`.
- **`gh release create` and `gh release edit`.** Creating a release writes a tag
  ref on the remote and GitHub fires the same push event for it, so this is a
  publish with no local tag anywhere.
- **`gh api` writing to a `releases` or `git/refs` endpoint**, which is the same
  route one layer lower, and is the shape the merge rule already closes for
  `pulls/N/merge`.

**A dry run is allowed on both sides, for the reason already in the file.**
`git push --dry-run` contacts the remote and changes nothing.
`npm publish --dry-run` uploads nothing. The publish refusal says out loud that a
dry run is not a rehearsal either, because ADR 0051 measured `--dry-run` exiting
0 on this package while `private: true` was still set, and a reader who takes a
green dry run for a verdict has learned the wrong thing from being allowed.

**The refusal says why a publish is different from a merge, in the workflow's own
argument, because the argument is the enforcement.** An agent that is refused and
does not know why looks for another way around. The message names the 72 hours,
names the tag as the trigger, names `NPM_TOKEN` as a secret nothing on a pull
request can read, and tells the caller to report that the release is ready and
stop.

### `git tag` stays allowed, and this is the half worth arguing

**The case for refusing it.** It is the step immediately before the push, so a
refusal there lands at the moment the intent is formed rather than one command
later. An agent holding a local `v0.1.0` is one `git push --follow-tags` from a
release, and `push.followTags` is configuration this guard cannot see, so a tag
that exists can leave on a push that does not name it.

**The case for allowing it, which won.** Creating a tag writes a ref inside one
checkout. Nothing outside sees it, and `git tag -d` removes it. **A guard that
refuses `git tag` refuses something that does nothing**, and this file's own
header says which way to weigh that: "A gap lets a merge through; a false
positive gets the guard switched off, and the second is the likelier failure."

And it cannot be done cleanly. `git tag` is also how you read: `git tag`,
`git tag -l 'v*'`, `git tag --points-at HEAD`, `git tag --contains <sha>`.
Telling a creating `git tag` from a listing one means knowing which of git's tag
flags swallow the next token, because `git tag --points-at HEAD` is a read whose
argument is shaped exactly like a name to create. That is the table of somebody
else's flags this file declines to keep in `apiEndpoint`, in `pushesToDefaultBranch`
and in `gitArguments`, each time with the same reason: a table of another tool's
flags rots silently. Keeping one here, to refuse a command with no consequence,
would buy refusing reads.

**What allowing it costs, stated rather than waved at.** The `push.followTags`
path stays open. Refusing `git tag` would narrow it and not close it, because
`git update-ref refs/tags/v0.1.0 HEAD` writes the same ref without the word
`tag` in a position any of this reads. A partial close bought with a flag table
and a refused read is not a good trade. The push rule denies `--follow-tags`
written on the line, and the configured version is named here and in the guard as
open.

### The wrapper words are a decided exclusion and stay closed as not-a-finding

`command gh pr merge` and `env gh pr merge` get through, and so does
`env npm publish`. That looked like an oversight and it is not. The guard's
`WHAT THIS DOES NOT COVER` section names `sudo`, `env`, `command`, `nohup` and
`xargs` in a code block, states that each was run and allowed, and gives the
reason: the threat model is "an agent that forgot, or that talked itself into
it, not one that is hiding", and "the set of programs that can launch another
program has no edge, so closing six of them buys a longer list rather than a
closed hole".

**Re-weighed against a consequence that cannot be undone, it still holds.** The
forgetting-shaped spelling of a publish is `npm publish`, and that is what is now
refused. Nobody types `sudo npm publish` by accident, and an agent that is hiding
has cheaper routes this file already names as invisible: a variable, a
`-EncodedCommand`, or a script whose name is all the line carries.

**The cheap version of the fix was measured and it is the "longer list" the
header predicts.** Stripping a leading wrapper word closes the flagless spelling
and leaves the same wrapper open one flag later, because these programs do not
share an argument grammar: `nice -n 10 gh pr merge` puts the command at index 3,
`env -u FOO gh pr merge` at index 3, `timeout 5s gh pr merge` at index 2 behind a
token that is not flag shaped, and `xargs -I{} gh pr merge` somewhere else again.
Finding the command inside each needs that program's flags, one table per
wrapper, and getting one wrong reads a duration or an environment variable name
as a command. So the cheap fix converts six named holes into six unnamed ones,
which is worse than the six named ones.

**And the change belongs upstream rather than here.** `LEADING_WORDS` sits inside
the `BEGIN command reader` region, which is a copy of an asset the
`orchestrated-delivery` skill installs, carried in three files upstream with a
test that compares them. ADR 0059 is what happens when this copy moves and that
one does not: a generation of drift that nobody saw because the verdicts happened
to agree. A wrapper fix written here is reverted by the next install of the
skill, silently.

**It is pinned as a passing test rather than left as a comment.**
`test/guards/broken-on-purpose.test.ts` asserts that `env npm publish` and
`command gh pr merge 42` are allowed. A decision recorded only in a comment is
one somebody deletes; as a test, widening the guard turns it red and whoever does
it has to come back to this record and say why.

### What was appended to the guard's header, and what was not

The header is the asset's. It is appended to rather than edited, the way
`docs/architecture/decisions/README.md` says a superseded record is treated, and
the appended block says which two lines above it have stopped being true:

**`\gh pr merge` and `/usr/bin/gh pr merge` are listed there as allowed through
and both are denied today.** They were denied before this change too, because
`commandName` splits on both separators and drops the leading backslash. That is
an upstream correction and this pull request does not make it.

**`git push --mirror` is named there as open**, and it is still open against the
branch rule, which is what that paragraph is about. It is closed against the tag
rule, because `--mirror` writes `refs/tags/*` and one of those tags publishes.

**`commandName` now drops `.cmd` and `.bat` as well as `.exe`.** It sits below the
copied region, so it is this repository's. npm, pnpm and yarn ship as `.cmd`
shims on Windows and this hook is wired to a PowerShell tool, so `npm.cmd publish`
is what a path completion produces here. It only ever widens a rule, because
every rule asks whether a name matches and none asks whether it does not.

## Consequences

- **The four commands the measurement found are refused, and so are eighteen more
  spellings of them.** The full table is in the pull request that carries this
  record. Nothing that was allowed before is denied now except by these rules,
  which was driven both ways rather than assumed.
- **A branch whose name starts with `v` and a digit cannot be pushed under that
  name.** `git push origin v2-spike` is refused, because the command line cannot
  tell a tag from a branch and only one of the two readings can be undone. The
  refusal says this, so the cost lands on somebody who can read why.
- **Deleting a remote tag is allowed, and the first draft of this rule refused
  it.** The refusal was written on the argument that the rule stays one sentence
  and that a remote tag is the owner's business. Then
  `.github/workflows/rehearse-release-ancestry.yml` turned out to document
  `git push origin :refs/tags/rehearsal-1` as the cleanup of a procedure this
  repository runs on purpose, so the rule as drafted refused the tidying half of
  a written procedure while allowing the push that starts it. A delete writes
  nothing and cannot publish, so it is allowed, and the carve out is a leading
  colon and a `--delete` flag.
- **A tag whose name is neither `v` and a digit nor spelled `refs/tags/` reads as
  a branch and is allowed.** `git push origin rehearsal-1` is the case, and it is
  a real one: that is how the ancestry rehearsal is started. It cannot match
  `release.yml`'s `v*`, so the consequence this rule exists for is absent, and
  refusing every bare refspec would refuse every ordinary branch push. It is
  written into the guard beside the rule rather than left as an edge somebody
  finds.
- **`npm publish --help` is refused.** That is a false positive and it is kept:
  asking for the help of a command you may not run gets you a refusal that
  explains why you may not run it, which is the more useful answer.
- **Two flag-value gaps are inherited rather than introduced.**
  `npm --loglevel info publish` reads as a command called `info` and is not
  caught, the same shape as the `git push -o main origin feature` gap the branch
  rule already carries and for the same reason: stopping early allows, and this
  file takes the allowing direction wherever it cannot be sure.
- **`push.followTags` is invisible.** A push that carries a tag because of
  configuration rather than because of its arguments is not refused. This is the
  same class as the `--all` gap already named in the header, and layer 3 is the
  answer to that class.
- **A reworded refusal turns the suite red.** Five assertions read the words, per
  ADR 0034, and one of them pins "A merge can be reverted. This cannot", which is
  the whole argument for these rules existing beside the merge rules. If that
  clause is reworded, this record is where to say so.
- **`scripts/guard-merge.mjs` is now a fork of the skill's asset rather than an
  install.** The header says that is the caller's to do and that saying so is the
  obligation. The next install of `orchestrated-delivery` reverts all of it,
  which is a real operational risk and belongs upstream as a filing rather than
  as a local drift check. ADR 0059 already argues why a vendored hash would not
  have caught the last one.

## Revisit when

- **Somebody wants the loop able to release.** ADR 0051 asked for the rule to be
  the next layer if the token and the owner's hands stopped being enough. This is
  that layer, and it points the other way: the loop is now refused by a script as
  well as by an instruction. Undoing it is a decision to record here, not a flag
  to add.
- **A wrapper word is used to publish.** That is the measurement that turns the
  exclusion above from decided into stale, and it should be recorded with the
  command line that did it. Until then the header's threat model stands.
- **The upstream asset closes the wrapper words, or corrects its `\gh` line.**
  Then this checkout's appended block is describing a header that has moved and
  should be re-read against it rather than trusted.
- **A release goes out and something in it was wrong.** The rules here refuse an
  agent. They do nothing about the owner's own hands, by design, and the first
  real release is the only test of whether the refusals sit in the right place.
  ADR 0051's first revisit entry asks for the same day to be watched.
- **`npm publish --dry-run` grows a verdict.** It is allowed here because it
  uploads nothing and proves nothing. If npm ever makes it contact the registry
  for an answer, the allowance is worth re-reading, because a rehearsal that
  reports "this would fail" is a thing worth being able to run.
- **A second guard starts refusing releases.** Two scripts refusing the same
  command with different words is how a reader stops trusting both, which is the
  argument the dry run allowance already carries in this file.
