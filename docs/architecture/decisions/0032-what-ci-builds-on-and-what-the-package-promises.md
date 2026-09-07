# 0032. What CI builds on, and what the package promises

## Context

Every workflow here pinned `node-version: 20`, and `package.json` said
`"engines": { "node": ">=20" }`. Node 20 reached end of life on 2026-04-30. As
of 2026-09-07 it receives no security fixes, and both of those lines were still
naming it.

They look like one fact and they are two, with different audiences and different
costs to getting them wrong.

**What CI builds and tests on** is a statement about this repository. It decides
which runtime every pull request is judged on, and nothing outside this
repository can observe it. Getting it wrong means the gate is proving something
about a runtime nobody runs.

**What `engines` says** is a promise to whoever installs this. It is the line
that decides who can run the tool, and `npm` prints a warning against it on
every install. Getting it wrong the generous way, by claiming support for a
version nobody tests and nobody would fix a bug on, is a promise that is not
kept; getting it wrong the strict way locks out people whose runtime is fine.

`CONTRIBUTING.md` made a third claim on top of those two, and it was load
bearing:

> CI builds and tests on Node 20 on Linux for every pull request, and this is
> developed on Node 24 on Windows, so both ends of that range are exercised
> rather than promised.

That sentence is the argument for why `>=20` was a supported range rather than a
guess, and it was true. A bump of the CI pin to a single current version would
have made it false in the same commit that made the runtime current, because the
floor would then be tested by nobody. That is the failure this record is mostly
about avoiding.

There is one more constraint and it has nothing to do with Node. A ruleset on
`main` requires a status check whose context is exactly `check`, with an empty
bypass list, and ADR 0001 is why that layer is the one that decides what lands.
GitHub names a matrix job's check runs `<job> (<value>)`. So putting a matrix
onto the job called `check` renames the status that reports, the required
context never arrives, and every pull request is blocked by a check that has not
failed. It does not go red. It goes quiet.

## Decision

**A matrix, not a bump, and the floor moves separately and on its own reasons.**

**CI runs `npm run check` on Node 22 and Node 24**, in `.github/workflows/check.yml`,
with `fail-fast: false`. Those are the two ends of the supported range: 22 is the
floor the package promises, 24 is the Active LTS and what this is developed on.
The middle is not tested, because a break that appears only on 23 and on neither
neighbour is not a thing that has happened here.

**`engines` moves from `>=20` to `>=22`**, and the reason is not that CI moved.
It is that the floor should name the oldest Node that still receives security
fixes, and today that is 22 rather than 20. Raising it further, to the Active LTS
at 24, was considered and turned down: Node 22 is supported until 2027-04-30, it
passes, and excluding a user on a maintained runtime buys this project nothing.

**The matrix does not touch the name the ruleset matches on.** `check.yml` has
two jobs. `verify` carries the matrix and GitHub reports it as `verify (22)` and
`verify (24)`. `check` is a single job, `needs: verify`, `if: always()`, and its
only step asserts `needs.verify.result == 'success'`. It reports under the one
name the ruleset knows, and it is green only when both legs were. `if: always()`
is load bearing rather than defensive: without it a failing matrix skips the
gate, and a skipped required check is a different thing from a failed one.

**`model.yml` and `provenance.yml` stay on a single version, 24.** Neither is the
merge gate. `model.yml` is the published recipe pointed at `examples/shop`
(ADR 0028), and the recipe is one job on one version; matrixing it here would
make this repository demonstrate something the recipe does not say.

**`docs/ci.md` is a fourth claim and it is about somebody else's runner.** It now
names 24, with a paragraph saying that is the Active LTS recommendation rather
than the floor, and that the floor is 22.

## Consequences

- **Every pull request now pays for two runs of `npm run check`.** Each is about
  a minute plus install, they are parallel, and the wall clock barely moves. What
  it buys is that the floor is a tested claim rather than a written one, which is
  the property `CONTRIBUTING.md` was already asserting.
- **The gate is one indirection further from the work.** `check` no longer runs
  anything: it reads a result. Somebody debugging a red check has to open
  `verify (22)` or `verify (24)` to see what failed, and the gate's log says
  which. That is the price of keeping the required context stable, and it is
  cheaper than renaming a required check.
- **A third Node version is now a one-line change**, and so is dropping one. That
  is deliberate: the next end-of-life date should be a line edit, not a redesign.
- **Two runs of the suite is two chances for an intermittent test to redden the
  gate**, and that is not theoretical: `test/studio/watch.test.ts` failed on
  four of eight legs while this change was being verified, a different assertion
  each time, having failed on none of the twenty-five Node 20 runs before it.
  That distribution looks exactly like the version-specific break this matrix
  exists to catch, and it is not one. A run with a third leg on Node 20 added as
  a control passed on all three at once, and the mechanism is visible in the
  test: `settle()` is a fixed 500ms sleep against write debounces of 250ms and
  400ms, so the margin is 100ms to 250ms and a loaded runner eats it. The
  failures cluster in one twelve-minute window rather than on one version.
  **So the matrix did not cause this, but it does roll the dice twice as
  often**, and "red on one leg only" is not by itself evidence of anything about
  Node. Read the failing leg before believing the shape of the failure. Fixing
  the fence is the answer; running the suite once is not.
- **The floor at 22 has an expiry.** Node 22 reaches end of life on 2027-04-30.
  This decision will be wrong on that date in exactly the way it was wrong when
  it was made, which is why the trigger below is a date rather than a feeling.
- **Nobody tests Node 20 any more, and some people are still on it.** `dbmd` will
  very likely keep working there for a while; this record makes no claim either
  way, and that is the point of moving the floor rather than leaving a promise
  nothing stands behind.

## Revisit when

- **2027-04-30, when Node 22 reaches end of life.** Move the floor to whatever is
  then the oldest supported line, move the matrix's lower leg with it, and edit
  the same four places: `package.json`, `AGENTS.md`, `CONTRIBUTING.md` and
  `docs/ci.md`. `docs/ci.md`'s number is a separate judgment about somebody
  else's runner and does not have to move in lockstep.
- **A leg of the matrix fails for a reason that is about Node rather than about
  the change.** That is the matrix earning its keep, and it is worth writing down
  what it caught, because this record currently claims a benefit it has not yet
  been paid.
- **The required check's context changes for any reason.** The ruleset's
  `required_status_checks` names `check` as a literal string, and nothing in this
  repository reads that ruleset. `scripts/merge-pr.mjs` carries the same name in
  `REQUIRED` and would also have to move. A rename is two edits in two systems,
  one of which is not in this repository.
- **This repository starts testing on more than Linux.** A matrix over Node and a
  matrix over operating system are the same mechanism and would multiply, and the
  question then is which combinations are worth a runner rather than which are
  expressible.
