# 0051. The first release is 0.1.0, and it is a tag a person pushes

## Context

[ADR 0024](0024-the-tarball-is-what-ships.md) ended with `"private": true`
staying in `package.json`, and said why: it is the one thing standing between an
accidental `npm publish` and a name on npm that cannot be un-taken, publishing
had never been asked for, and removing that line "belongs to the owner rather
than to this item". Its **Revisit when** names the condition exactly: somebody
decides to publish.

On 2026-09-07, asked for the fifth time, the owner answered: _"Yes let's publish
to npm"_.

So the condition is met, and what is left is not one line. Six places in this
repository tell a reader that `dbmd` is not on npm: `README.md`, `AGENTS.md`,
`docs/ci.md`, `docs/process/handoff.md`, the `dbmd` skill under
`.claude/skills/`, and a comment in `.github/workflows/model.yml`. One of them,
[`docs/ci.md`](../../ci.md), tells them the CI recipe it prints **does not run as
written** for that reason.
[ADR 0028](0028-the-ci-recipe-is-pinned-and-this-repository-runs-it.md) wrote
`npx --yes dbmd@0.1.0` into that recipe as a placeholder and said so in a
paragraph: nobody had decided the first version, and the page had no standing to
decide it. This repository has already paid for the inverse mistake, twice: two
files claimed the package was published when it was not, and that false claim is
why a CI recipe invented a version number out of nothing.

Three things are true about the artefact and only two of them are proven.
`npm run check` runs `check:pack`, which packs the tarball, installs it into a
temporary directory, drives the installed binary and asks the studio it starts
for its page, its client bundle and its model. So **the package is correct** and
**the tarball is complete**, on every run, on every commit. What no check in this
repository can establish is that **a stranger typing `npx dbmd` gets anything**,
because that is a fact about the registry rather than about this tree, and only a
real publish establishes it.

The name was free: `https://registry.npmjs.org/dbmd` answered 404 on 2026-09-07.

## Decision

**`"private": true` comes out, and the first version is `0.1.0`.**

The number is `0.1.0` for two reasons that point the same way. The product here
is a file format that people commit, and the format is still free to change; a
`1.0.0` is a promise about that which nothing has earned yet, and semver already
has a way to say "shipped, not settled". And `0.1.0` is the number
[`docs/ci.md`](../../ci.md) and ADR 0028 have been carrying as a placeholder
since the recipe was written, so choosing it turns a page that was waiting into a
page that is true, rather than making it wrong for a second reason.

**Publishing happens when a person pushes a tag, and nothing else publishes.**
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml) runs on
`push` of a tag matching `v*` and does one thing. It is not on `main`, and that
is the whole point: a publish cannot be taken back, `npm unpublish` is refused
outright after 72 hours, and publishing on every green merge would make a
permanent consequence a side effect of an ordinary squash. An agent working an
issue here does not merge its own pull request and does not push tags; the loop
therefore cannot reach the registry even by accident.

**The token is the owner's and lives nowhere else.** `NPM_TOKEN` is a repository
secret. A workflow triggered by a pull request cannot read it, and this workflow
does not run on pull requests at all.

**The release job refuses two things before it uploads anything.** A tag whose
version disagrees with `package.json`, because otherwise `v0.2.0` at a tree
saying `0.1.0` publishes `0.1.0` and leaves the tag lying about what shipped. And
a tag on a commit that is not an ancestor of `origin/main`, because `check.yml`
is the reason anything on `main` has been read and a tag off to the side would
publish code that gate never saw.

**Nothing is added to test the tarball before publishing, because
`prepublishOnly` already is that.** It runs `npm run check`, so the typecheck,
the guards, the tests, the build and `check:pack` all run on the tagged commit
and the upload happens only if they are green.

**`check:pack` now reads `private` and `bin` out of the packaged manifest.**
Those two fields decide whether a stranger gets anything, and neither is
observable from anywhere else here: a package with `"private": true` packs,
installs, links its binary, starts its studio and serves its page, so every other
assertion in that script stays green. `npm publish --dry-run` does not object
either, which was measured rather than assumed: run against this package on
2026-09-07 while `private` was still set, it printed the tarball contents and
exited 0. The only thing that says no is a real publish, on a release day, after
everything else has already gone green.
`scripts/check-pack-guard.mjs` fires both mutations in the one nine-second run it
already pays for, so [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
is satisfied without a second copy of the tree.

**No page in this repository claims `npx dbmd` works.** Until the first tag is
pushed it does not, and the pages that used to say "not on npm" now describe the
two ways to run it and point at `npm view dbmd versions` for which releases
exist. A version list written into prose is a second copy of a fact the registry
already holds, and this repository's checks exist because two copies of one fact
disagree eventually.

## Consequences

- **This changes nothing for a user until the owner acts.** `npx dbmd` still
  resolves nothing today. What is different is that the distance from here to a
  published package is a secret and a tag rather than a design problem, and the
  pages say so in the tense that stays true either side of it.
- **A release takes minutes rather than seconds.** `prepublishOnly` runs the
  whole gate, `check:pack` included, and it does it on a runner. That is the
  correct trade on the one job whose output cannot be withdrawn.
- **The version is bumped by hand, in a commit, before the tag.** There is no
  release bot and no `npm version` in CI. The workflow does not guess: it
  compares and refuses.
- **A mistaken release is permanent.** 72 hours of `npm unpublish` is not a
  safety net worth designing around, and `0.1.1` is the correction.
- **`npm publish --dry-run` is not a rehearsal.** It does not check `private`, it
  does not contact the registry for a verdict, and it exits 0 on a package that a
  real publish would refuse. It is a listing, useful for seeing what ships and
  useless as a gate.
- **ADR 0024's `private: true` paragraph is superseded by this record.** It stays
  as written, per the convention in
  [`README.md`](README.md) in this directory, because the argument in it is the
  argument this was weighed against and it is still the right argument for a
  package nobody has decided to publish.
- **ADR 0028's placeholder is now a chosen number.** Its **Revisit when** asked
  for exactly this: the "not on npm" section of `docs/ci.md` comes out and the
  placeholder becomes the real first version. The workflow in this repository
  keeps building the checkout rather than installing the published package, for
  the reason that record already gives: running the published package here would
  test npm instead of the code in the pull request.

## Revisit when

- **The first tag is pushed.** Every path here has been reasoned about and none
  of it has run. That day is the only test of it, and it is worth watching rather
  than assuming, which is also the day `npx dbmd` becomes a thing anybody can
  verify.
- **The token could be replaced by OIDC.** npm's trusted publishing binds a
  publisher to a package that already exists, so it is not available for a first
  release and it is available afterwards. Swapping a long-lived secret for it is
  a deliberate change to make once, not something to invent on the way to the
  first publish.
- **`1.0.0` is wanted.** That is a promise that the on-disk format will not
  change under somebody's committed files without a major version, and it is
  worth making on purpose rather than by drifting into it.
- **Somebody wants the loop able to release.** It is not, and the thing stopping
  it is that only the owner can push a tag and only the owner holds the token,
  rather than a rule in `scripts/guard-merge.mjs`. If that ever stops being
  enough, the rule is the next layer and this is the record to amend.
- **There is a second maintainer.** One person's token is a single point of
  failure for releases, and npm's own answer to that is an organisation rather
  than a shared secret.
