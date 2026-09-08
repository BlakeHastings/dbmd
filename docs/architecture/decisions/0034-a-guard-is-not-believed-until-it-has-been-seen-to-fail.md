# 0034. A guard is not believed until it has been seen to fail

## Context

ADR 0001 makes a handful of scripts the layer that decides what lands here.
Branch protection needs a paid plan on a private repository, so those scripts
are not a convenience over GitHub's enforcement; they are the enforcement.

On 2026-09-07 every one of them was mutation-tested by hand. Every one failed
correctly:

| Guard                    | Mutation                                | Result                                    |
| ------------------------ | --------------------------------------- | ----------------------------------------- |
| `check-reviewable.mjs`   | NUL byte in a tracked file              | exit 1, names the file, offset and line   |
| `check-adr-numbers.mjs`  | two records claiming 0001               | exit 1, names both files                  |
| `check:pack`             | `!dist/studio/client/**` added to files | exit 1, says the page would be blank      |
| the init scaffold's test | `pk: true` removed from `example.ts`    | one test red                              |
| `guard-merge.mjs`        | `--probe` run directly                  | refused, which is the answer it exists for |

That table is the problem rather than the reassurance. All of it was true
because somebody spent an hour breaking things on purpose, and nothing repeated
it the next day.

One row is in the list precisely because it spent weeks unable to fail. The
`dbmd init` scaffold had no primary key on `accounts.id`, 622 tests were green,
and dbmd-54 found it by reading rather than by running. This repository has now
found four tests that had stopped testing something, two of them in one week.

The guards are the last line and the least exercised code in the tree, because
**a guard that never fires looks exactly like a guard that cannot.** Every one
of them has passed on every commit it has ever run on, which is the same
observation you would make about a guard whose condition had been inverted.

The one thing standing in the way of simply running all of it on every commit is
`check:pack`. It packs a tarball, installs it into a temporary directory, starts
the studio and asks it for three things. Measured on this machine on 2026-09-07:

| Script                              | Wall clock |
| ----------------------------------- | ---------- |
| `npm run test` (758 tests)           | 9.4s      |
| `npm run check:pack`                 | 7.9s      |
| `npm run check`, before this record  | 26.5s     |
| the `check:pack` mutation, once      | 8.1s      |

So mutating `check:pack` costs about as much as the entire test suite. Putting
it in `npm test` would take the inner loop from 9.4s to about 17s, which is the
kind of change people work around rather than report.

## Decision

**Every guard is fired on purpose, and where each one is fired is decided by
what it costs.**

**The cheap ones are tests.** `test/guards/broken-on-purpose.test.ts` breaks
`check-reviewable.mjs`, `check-adr-numbers.mjs`, the init scaffold's primary key
and `guard-merge.mjs`'s deny rules, and asserts each one says so. It runs in
`npm test`, and therefore in the inner loop and in the gate. It costs about
1.5s, because each mutation is a scratch directory holding a copy of one script,
or a value in memory.

**The expensive one is a script, and it stays in the common path.**
`scripts/check-pack-guard.mjs` copies the tree, adds `!dist/studio/client/**` to
`files`, runs `smoke-pack.mjs` against the copy and fails unless it refuses.
`npm run check:guards` runs it, and `npm run check` runs that immediately after
`check:pack`. It is **not** in `npm test`.

That split is the whole decision. `npm run check` is the pre-pull-request gate
and what CI runs; it already pays 7.9s for `check:pack`, and paying 8.1s more to
know that check can still fail is proportionate on a gate that runs once per
push. `npm test` is what somebody runs twenty times an hour, and it stays where
it is.

**Opt-in was considered and rejected.** A `check:guards` that nothing invokes is
a guard that never runs, which is the exact disease this record is about. There
is no honest version of "we wrote the test and then arranged for it not to
happen".

**Every assertion reads the words as well as the exit code.** dbmd-54 is the
precedent: a smoke test that could not see a warning was made to read it. Two
things make this non-negotiable here. A guard exiting 1 for the wrong reason is
still broken and an exit code cannot tell the difference. And these mutations
run in a scratch copy, so a scratch copy that failed to assemble also produces
exit 1, and only the sentence separates the two.

**Nothing is mutated in place.** Every mutation happens to a copy or to a value,
never to a tracked file that is restored afterwards. A red test that leaves the
checkout dirty makes every later run in that session meaningless, and on Windows
a half-restored file is easy to produce and hard to notice.

**Two guards are deliberately not covered.**

`guard-merge.mjs --probe` is untestable from inside a test, and this is a
property of what it detects rather than a gap in effort. The probe answers "is
this PreToolUse hook loaded in the harness process I am running under". A test
can only observe that running the file directly prints "NOT loaded", which is
what it prints in a session where the guard is perfectly fine, because a child
process of vitest is not the CLI process the hook was loaded into. The test
would pass whatever the truth was, which is worse than no test. Its deny rules
are a different thing and are covered: they read a command line and never run
one, so a JSON payload on stdin is the whole of the interface.

`merge-pr.mjs` is a gap rather than a decision, and it is written down as one.
All four of its refusals (not open, conflicting, a red required check, a green
one that is stale) are decided from what `gh` answers about a real pull request,
and every path through the script begins with `execFileSync('gh', ...)`. Faking
`gh` means putting a shim earlier on `PATH`, and on Windows that shim cannot be
a `.cmd` file: Node refuses to spawn one without a shell, so `readPr` catches
the spawn error and refuses with "Could not read PR", which is a refusal for the
wrong reason and exactly the trap the paragraph above is about. Reaching the
real refusals needs the network and a pull request in a particular state.

## Consequences

- **`npm run check` goes from about 26.5s to about 34.6s, measured.** That is a
  30% increase on the gate, paid once per push and twice per pull request because
  CI runs a matrix (ADR 0032). It buys the property that the enforcement layer is
  known to be able to fail rather than assumed to be.
- **`npm test` is untouched**, and that is the number that matters for how
  people work. The inner loop stays under ten seconds.
- **A reworded guard message turns this red.** That is the cost of asserting the
  words, and it is the right cost: the alternative is an assertion that survives
  the guard being neutered. Every assertion pins a clause rather than a whole
  sentence, so counts, paths and ports are free to change. When one does go red
  for a rewording, the fix is one string and the failure says which.
- **`check-pack-guard.mjs` junctions `node_modules` into its scratch copy.** It
  needs `tsc` and `esbuild` because `npm pack` runs `prepack`. Copying them would
  cost more than the check. The junction is removed by name before the scratch
  directory is deleted, so nothing recursive is ever pointed at the real one.
- **The init scaffold's mutation is performed on the value, not on the source.**
  ADR 0012 makes the scaffold a `Model` rather than a folder of templates, so
  deleting `, pk: true` from `src/cli/example.ts` and deleting the key from the
  object it builds are the same mutation. Doing it in memory means no scratch
  checkout, no vitest inside vitest, and no way for a failure to leave `src/`
  altered. It does mean this suite would not notice a scaffold that stopped
  going through `writeModel`.
- **There is no unmutated control run of `check:pack`.** `npm run check:pack`
  runs immediately before `check:guards` and is that control, over the real tree.
  Reordering those two, or running `check:guards` alone, removes it.

## Revisit when

- **`check:guards` grows a second slow mutation.** Two of these is 15s on the
  gate and the arithmetic above should be redone rather than assumed. The likely
  candidate is a second `files` mutation, and the right answer may be one scratch
  copy packed twice rather than two copies.
- **A guard's message is reworded and this goes red.** Update the clause and,
  more importantly, note it here: a message that gets reworded often is one whose
  wording is not load bearing, and the assertion should move to a part that is.
- **`merge-pr.mjs` becomes reachable without the network.** If its decisions are
  ever separated from its `gh` calls, the four refusals become ordinary unit
  tests and the gap above closes. That refactor is worth doing for this reason
  alone if the script grows another rule.
- **This suite goes red for something nobody broke on purpose.** That is the case
  worth reading carefully rather than fixing quickly: it means a guard changed
  behaviour, and the question is whether the change or the assertion is the
  mistake.
- **A guard is added to `scripts/` without a mutation here.** The point of this
  record is that the set is complete and the omissions are named. A new
  enforcement script with nothing breaking it on purpose puts the repository back
  where 2026-09-07 found it.

## Amendment, 2026-09-07: the list of omissions was itself short by one

Two guards are named above as deliberately not covered. There were three
uncovered, and the third is not in this record at all.

`scripts/check-main-provenance.mjs` is the other network-dependent guard, and it
is the **detection** half of the merge gate: `guard-merge.mjs` and `merge-pr.mjs`
prevent and can both be bypassed, and a layer that can be bypassed cannot tell
you it was bypassed. This one runs on the result, in CI on every push to `main`
and by hand after every merge. Nothing had ever proved it detects. Had it
silently stopped failing on a direct push, every run would have printed the same
reassuring line it prints today.

This is worse than a missing test, because the section above presents itself as
exhaustive. "The point of this record is that the set is complete and the
omissions are named" is the last bullet of it, and the set was not complete. A
list that claims to be and is not is the failure this repository keeps paying
for, and correcting it is the minimum this amendment exists to do.

The gap is now closed for both scripts rather than for one. The condition
recorded above — *`merge-pr.mjs` becomes reachable without the network* — is met:
both scripts keep their decisions in exported functions whose facts are
arguments, and their `gh` calls in a `main()` that runs only when the file is the
entry point. **ADR 0058** records that split, what it covers, and what remains
unproved inside each `main()`. The original decision above stands unchanged; the
timings, the split between `npm test` and `npm run check`, and the rule that
every assertion reads the words are all still what this record says they are.


## The first revisit entry fired, and the arithmetic is redone rather than assumed

Appended rather than edited, as part of a sweep of every record's **Revisit when**
list on 2026-09-07. The decision stands unchanged: the cheap guards are tests, the
expensive one is a script, `npm test` is untouched, every assertion reads the
words, and nothing is mutated in place.

**"`check:guards` grows a second slow mutation."** It has.
`scripts/check-pack-guard.mjs` runs two rounds, each its own scratch copy and its
own pack. The second arrived with ADR 0064 and breaks the release entry point by
appending `import './feedback.js'` to `src/studio/client/main.ts`, which is a
one-line edit that type-checks, builds, packs, installs and serves a page that
works.

**The answer this entry suggests was considered and refused, with a reason.** It
says "the right answer may be one scratch copy packed twice rather than two
copies". It is not, and the guard's own header says why: the first round negates
`dist/studio/client/**` in `files`, so a copy carrying that mutation has no client
bundle for the overlay assertion to read, and the assertion would pass trivially.
That is the shape of a guard that has stopped guarding, which is the disease this
whole record is about. The two independent mutations do share a copy, which is the
half of the suggestion that was taken.

**The arithmetic, re-measured rather than carried forward.** One run of each, in a
worktree on the same machine, on 2026-09-07:

| | as written above | measured now |
| --- | --- | --- |
| `npm test` | 9.4s | 15.1s |
| `npm run check:pack` | 7.9s | 9.3s |
| `npm run check:guards` | 8.1s, one mutation | 18.5s, two rounds |
| `npm run check` | 26.5s before this record, ~34.6s predicted after | 54.9s |

The orchestrator ran the gate independently on the same machine the same night
and got **1m0.2s**, which is their number and not this sweep's. Two runs an hour
apart differing by five seconds is what a single run of anything is worth, and
both are more than double what this record recorded.

**What that changes and what it does not.** `check:guards` is now the single
largest item in the gate, at about a third of it, where this record priced it as a
30% increase on a 26.5s run. The two things the decision actually rests on are
unchanged: `npm test` is still outside it and still under sixteen seconds, and the
gate is still paid once per push and twice per pull request. So nothing is
proposed here. This entry asked for the arithmetic to be redone rather than
assumed, and this is it, with the numbers dated so the next person redoes them
rather than quoting these.

**Two of the other four entries have already been answered above.**
`merge-pr.mjs` became reachable without the network and ADR 0058 is that split;
the amendment above records it. A guard has not been added to `scripts/` without a
mutation here: `check-commands.mjs` and `check-scene-classes.mjs` both arrived
after this record and both have a `broken on purpose` block in
`test/guards/broken-on-purpose.test.ts`. **The remaining two have not fired.** No
assertion has gone red for a rewording, and this suite has not gone red for
anything nobody broke on purpose.
