# 0080. A version after `dbmd@` names the version this package is

## Context

[ADR 0028](0028-the-ci-recipe-is-pinned-and-this-repository-runs-it.md) put a
GitHub Actions recipe in [`docs/ci.md`](../../ci.md) and pinned the version in
it, for a reason the page still states in its own prose: `npx dbmd@latest` in a
CI job is a supply chain decision made by accident. That argument is settled and
nothing here reopens it.

What nothing had noticed is that the pin is a copy of the number in
`package.json`, that there were four of them, and that nothing kept any of them
in step with it:

```
docs/ci.md:42    - run: npx --yes dbmd@0.1.0 check db-model
docs/ci.md:52    - run: npx --yes dbmd@0.1.0 export --stdout db-model > "$RUNNER_TEMP/db-model.md"
docs/ci.md:82    `node dist/cli.js` wherever the recipe says `npx --yes dbmd@0.1.0` does the same
README.md:180    `npx --yes dbmd@0.1.0 studio db-model` fetches the package, runs it and leaves
```

`package.json` says `0.1.0`, so on the day this was written all four were right.
They were right for one reason, which is that nobody had released anything yet.

This is the fifth time this repository has met the shape that
[`docs/process/orchestrating.md`](../../process/orchestrating.md) calls "a
reference repeated everywhere is a reference nobody checked". Four copies
agreeing is not four copies verified; it is one copy typed four times, and the
agreement is what hides it, because there is nothing inconsistent for a grep to
find.

`scripts/check-commands.mjs` already understood the shape and walked past the
number. Its own header said `npx dbmd`, `npx --yes dbmd@0.1.0` and
`node dist/cli.js` were the same claim written three ways, and its pattern threw
the version away in a non-capturing group to get at the command name after it.
So `npx --yes dbmd@0.1.0 fmt db-model` was refused, because `fmt` is not a
command, and `npx --yes dbmd@0.9.9 check db-model` passed.

**Nothing is wrong today and everything is wrong on the next release.** The
package is unpublished. The owner is about to push `v0.1.0`, at which point all
four pins are correct. The moment the version becomes `0.2.0`, a reader copying
that workflow installs the version before it, silently, and the page that told
them to pin is the page that went stale.

The question underneath is what a documented pin is, and both answers are
defensible. It is either a pointer at the current release, in which case it
tracks `package.json`; or it is a claim that **this** version of the recipe was
run, in which case bumping it without running it is a claim nobody checked, and
it should stay where it was last tested.

## Decision

**A version written after `dbmd@`, as code, anywhere this repository documents
itself, names the version in `package.json`.** `npm run check` reads them and
fails on any that does not, through `check:commands`, which was already walking
the same files with the same reader.

**It tracks rather than freezes, and the deciding argument is that this
repository runs its own recipe.** The freeze position rests on a pin being an
untested claim once it is bumped. That is a strong argument about a recipe
nobody executes and a weak one here.
`.github/workflows/model.yml` is the same two jobs as the recipe with
`node dist/cli.js` where the recipe says `npx`, against
[`examples/shop`](../../../examples/shop), on every pull request; ADR 0028 built
it for exactly this reason. The commands, the flags and the redirect in that
recipe are exercised against the tree on every change, and the tree at the
moment of a release is the tree that gets published under that number. So the
pin is not an independent claim that some artefact on npm was tested. It is a
claim about which build of this code to fetch, and that build is the one the
gate has just read.

**The freeze position also cannot be held by anything here.** Its rule is that
the pinned version is one that exists, which is a question for the registry, and
the registry is a network call inside a check that reads 186 files in a quarter
of a second and never leaves the machine. Worse, it cannot pass: nothing is
published, so a guard asking npm would be red today and would be red on the
owner's first push, which is the one moment nobody wants a mysterious failure.

**And what is left of freeze once the network is taken away is worse than
nothing.** Offline, the strongest freeze rule available is that the four pins
agree with each other. Four pages all saying `0.1.0` after `0.2.0` shipped is
four pages agreeing. That rule passes on precisely the defect it would have been
written for, and a guard that permits the thing it exists to catch is worse than
no guard, because it is believed.

**A dist-tag is not a version and is not read.** `latest`, `next`, `beta`:
letters, no number, nothing in `package.json` for a moving target to equal.
There is one in this tree, `npx dbmd@latest` in the paragraph of `docs/ci.md`
written to say not to, and telling that apart from the same word arriving in the
recipe needs a marker the way ADR 0036's hypotheticals do. One page writing one
word does not yet earn one.

**A version in prose is left alone**, because only a pin is a claim about what
to install. "`0.1.0` is the number chosen for the first release" stays true
after the second release, and a rule that read every number in the tree would
demand that sentence be falsified on release day.

**It lives in `check-commands.mjs` rather than beside it.** Not for the file
walk, which is cheap, but for `EXCLUDED`. `docs/architecture/decisions/` is
excluded there because a record says what was true when it was decided and is
never edited, and three records name `dbmd@0.1.0` as history. A second script
would have to reproduce that list, and the day somebody edited one copy and not
the other, either this rule would start demanding that history be rewritten or
it would quietly stop covering a page. `.beads/` and `test/guards/` are the same
argument. One exclusion list, one reader, two questions asked of it.

## Consequences

- **A release moves five lines rather than four.** The fifth is the comment in
  `check-commands.mjs` itself, which was already carrying a pin as an example of
  the shape. It is held by its own rule, and that is the cheapest available
  proof that the rule reaches a `.mjs` comment and not only a markdown page.
- **The window between the bump and the tag is a real cost and this does not
  close it.** Under [ADR 0051](0051-the-first-release-is-a-tag-a-person-pushes.md)
  a release is a tag a person pushes, and `release.yml` refuses a tag whose
  number disagrees with `package.json`, so the bump lands on `main` first and the
  tag follows. For the length of that window the pages name a version npm cannot
  resolve, which is a 404 for anybody copying the recipe in it rather than a
  version behind. Two things hold it down and neither is this check: pushing the
  tag is one command and the whole of the release, and both pages already say in
  their own prose that `npm view dbmd versions` is the authority on what exists
  and that the page is not. That sentence was written before this decision and it
  is what makes this decision honest rather than a second thing to get wrong.
- **Nothing here says the pinned version is on the registry**, and no check in
  this repository can. ADR 0051 said the same thing about the tarball: that a
  stranger typing `npx dbmd` gets anything is a fact about the registry rather
  than about this tree.
- **`@latest` in the recipe would pass.** Named here rather than left to be
  discovered, because a guard whose holes are unwritten is a guard people think
  covers more than it does. ADR 0028 is the only thing standing between the
  recipe and that word today.
- **The other direction is not held.** Nothing checks that `package.json`'s
  version is one anybody meant, and that is `release.yml`'s job: it compares the
  tag to the manifest before it uploads.
- **A page that ever needs two versions in one sentence fails**, for instance
  prose telling somebody to change one pin to another. Nothing in this tree does
  that. The day one does, the answer is a marker beside it, written by the
  author, the way ADR 0036 handles a command that does not exist yet, rather than
  a rule that guesses which of two numbers is the live one.
- **It costs nothing measurable.** One regex over segments the reader had already
  computed. Three runs each, on this machine, on 2026-09-08: 220ms, 248ms and
  252ms before, 238ms, 275ms and 271ms after, which is inside the spread of three
  runs of either.
- **It is broken on purpose, both ways.**
  `test/guards/broken-on-purpose.test.ts` moves the manifest away from the pages
  and moves a page away from the manifest, and asserts each is named with its
  file, its line and both numbers. ADR 0034.

## Revisit when

- **The first tag is pushed and something is on the registry.** Then "the pinned
  version exists" becomes a question that can be answered, and the honest home
  for it is the release path or a job allowed to touch the network, not a check
  that runs in the inner loop.
- **A page needs to name a version that is not the current one.** That is the
  marker conversation above, and it should be had when there is a sentence to
  look at rather than in the abstract.
- **Somebody wants `@latest` in the recipe caught.** The hole is named in the
  consequences; closing it is the same marker.
- **The recipe stops being run by this repository.** The whole argument for
  tracking rather than freezing is that `model.yml` exercises the recipe against
  the tree on every pull request. If that job goes, the pin becomes an untested
  claim and freezing becomes the better answer.
