# 0059. An installed copy says so, and is not checked here

## Context

`scripts/guard-merge.mjs` is layer 2 of ADR 0001. It is not written here. The
`orchestrated-delivery` skill installs it, and it arrives whole, including a
region marked `BEGIN command reader` / `END command reader` that the skill also
carries in two other files of its own.

The comment on that region described the skill's repository rather than this
one. It called the file it sits in "this asset", which is true where the asset
is authored and false in an installed copy, and it said a sibling test ran every
copy over one corpus so that a drift was a red test rather than a lucky reading.
That test exists, it reads three paths, and all three are upstream. Ours was a
fourth copy and nothing anywhere had ever read it.

It had drifted, and the measurement is the point rather than the suspicion.
Lifting the region out of each file and dropping whole-line comments and blank
lines, which is the normalisation the upstream test uses:

| copy | significant lines |
| --- | --- |
| this repository, before this record | 118 |
| skill `assets/guard-merge.mjs` | 147 |
| skill `assets/guard-guest-writes.mjs` | 147 |
| skill's own `scripts/guard-merge.mjs` | 147 |

The three upstream copies agreed with each other. Ours agreed with none of
them, and the difference was structural: ours emitted each command as a list of
tokens, theirs emit `{ tokens, substituted }` and track how deep inside a
`$(...)` the command was found.

It was not a live hole. Thirty command lines fed to both guards on stdin, which
is safe because a guard reads a command and prints a verdict, agreed on
twenty-nine. The one disagreement was `node "$(cat pointer)/guard-merge.mjs"
--probe`: the shipped reader refused it as a liveness probe and ours allowed it,
because ours ended the outer command at the `$(` and so never saw `node` and the
script name in the same command. That is the one defect the generation gap
actually cost, and it points the harmless way, at a probe rather than at a merge.

So what was wrong was the claim, not the behaviour, and the failure shape is an
invariant written ahead of the code that holds it. A comment telling a reader
that a test is holding something, when nothing is, is worse than silence,
because silence gets checked.

## Decision

**Refresh the region wholesale from the asset, rewrite its comment to describe
an installed copy, and add no drift check here.**

The refresh is the whole region rather than a merge hunk by hunk, because the
newer reader changes what it returns and every rule downstream reads that shape.
Everything outside the region was already byte-identical to the asset, and is
untouched, so no verdict was imported along with the reader. After the refresh
this file is byte-identical to the asset apart from the region's own comment.

The comment now says what is true: this is a copy the skill installs, the
authority is upstream, nothing in this repository checks it, and here is how to
compare it by hand. It also records that it has to differ from the asset's
version, so that the difference is not read as the drift it is warning about.

No check, and the reason is that neither available check catches the failure
that happened:

| option | catches a local edit | catches falling behind upstream |
| --- | --- | --- |
| vendor a hash of the region | yes | **no** |
| fetch the asset at check time | yes | yes |
| refresh and fix the comment | no | no |

The observed defect is the second column. This copy did not drift because
somebody edited it here. It drifted because upstream moved and this did not, so
a hash of our own region compares this file to this repository's own expectation
and stays green for the entire gap.

Fetching catches it and costs more than the defect. `npm run check` runs in
`prepublishOnly` and is what a release tag runs. A network call to another
repository inside it means a release that fails because GitHub is slow, and it
turns "is this tree good" into "is this tree good and is the internet up".
`docs/ci.md` already argues exactly this about a dependency resolved at run time.

The detection belongs where the asset is authored and where every copy is
visible, and it is filed there.

## Consequences

- **This repository knowingly carries an unchecked copy of somebody else's
  code.** That is not new; what is new is that the file says so instead of
  claiming otherwise. The remaining defence is a person reading the comment and
  spending the minute it describes.
- **The gap can happen again, and nothing here will go red when it does.** The
  cost of that was measured once and it was one liveness probe. It is accepted
  on that evidence rather than on the assumption that it stays that cheap.
- **One command changed verdict, from allow to deny.** `node "$(cat
  pointer)/guard-merge.mjs" --probe` is now refused, which is the answer a probe
  wants. Nothing became permitted that was not permitted before, and that
  direction is the one that matters: a false positive is what gets a guard
  switched off, and this guard's own header records it denying a `gh issue
  comment` within seconds of first firing.
- **Reinstalling the skill overwrites the comment.** The asset's own version
  will come back, describing the skill's repository again, and whoever
  reinstalls has to put this one back. That is the price of the region being one
  file rather than two, which is the constraint the skill is built on.

## Revisit when

- **Upstream stamps a version into the region.** Then a host repository can
  compare one line without fetching anything, and the reason for having no check
  here goes away. Read the comment's second paragraph again at that point.
- **A second file arrives here from the same skill.** One unchecked copy is a
  comment. Several are a directory, and a directory is worth a manifest.
- **Any refresh of this region changes a verdict in the allow direction.** That
  is the case this record's evidence does not cover, and it should stop the
  refresh rather than be absorbed into it.
