# 0058. A decision that needs the network is two things

## Context

ADR 0034 broke every guard on purpose and wrote down the two it could not. One
of those, `guard-merge.mjs --probe`, is untestable by its nature. The other,
`scripts/merge-pr.mjs`, was recorded as a gap rather than a decision: every path
through it began with `execFileSync('gh', ...)`, faking `gh` means putting a
shim earlier on `PATH`, and on Windows that shim cannot be a `.cmd` file because
Node refuses to spawn one without a shell. So the shim produces "Could not read
PR", which is a refusal for the wrong reason and looks exactly like the right
one.

That record's list was short by one. `scripts/check-main-provenance.mjs` is the
other network-dependent guard and it was neither covered nor mentioned, in ADR
0034 or in the suite's own WHAT IS NOT HERE section. It is the **detection** half
of the merge gate and its own header says why that matters: the two preventive
layers can be bypassed, and a layer that can be bypassed cannot tell you it was
bypassed. It runs in CI on every push to `main` and by hand after every merge.
Nothing had ever proved it detects. If it silently stopped failing on a direct
push, every run would print the same reassuring line it prints today, and "every
commit on main came through a pull request" would quietly go back to being a
promise.

Two things made this worth doing now rather than noting again. `merge-pr.mjs`
grew a rule — it now names the branches a merge is about to make stale — and ADR
0034 says the refactor is worth doing for this reason alone the moment the
script grows one. And the rule inside the audit is one line: *a commit
associated with no pull request that merged into the default branch is a
violation*. That is testable the instant the API call stops being an import and
becomes an argument.

## Decision

**In both scripts the decision is an exported function whose facts are
arguments, and the network is a `main()` that runs only when the file is the
entry point.**

In `merge-pr.mjs` that is `decideMerge({ pr, behind, ... })`, which returns
`{ merge, why, notes, warnings }` and reaches all four refusals — not open,
conflicting, a red required check, a green one that is stale — from values, plus
`stalenessNotice({ pr, others })`, which turns the open list into the lines a
merge prints before it costs somebody a rebase.

In `check-main-provenance.mjs` it is `landedPulls`, which is the rule itself;
`auditCommits(shas, io)`, where `io` carries `pullsFor`, `describe`,
`predatesBaseline`, `attemptsFor` and `wait`; and `violationReport` /
`accountedReport`, which are the words.

**The entry-point guard is the mechanism, and it is one line per script:**

```js
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
```

Importing either file now runs nothing, spawns nothing and exits nothing. That
is what makes them importable from a test at all: a module that merges a pull
request on import is not a module you can ask a question of.

**Both stay one file each.** `check-setup.mjs` installs these by telling somebody
to copy one file into `scripts/`, and a `scripts/lib/` shared by two of them
turns a one-file instruction into a two-file one that will be followed halfway.
The split here is inside each file, marked with a banner comment, not across the
tree.

**The tests import the real script rather than a copy.** The rest of
`test/guards/broken-on-purpose.test.ts` copies a script into a scratch
directory, because those guards read a tree and the mutation is a file. Here
there is nothing to isolate: the mutation is the fabricated pull request or the
fabricated commit, and it is a value in memory. The specifier is a `file:` URL
built at run time, so TypeScript hands back `any` and a cast declares the shape;
a cast that disagrees with the script fails in the test rather than in a merge.

**Coverage of the staleness listing is part of this, not a footnote.** The new
line in `merge-pr.mjs` is a second API call added to a script nothing tested,
which made ADR 0034's gap worse on the way to closing it. It closes because the
listing's rules — do not count the pull request being merged, do not count one
aimed at another base, say "nothing else is open" rather than nothing — are all
in `stalenessNotice` and all asserted.

## Consequences

- **ADR 0034's revisit condition is closed rather than half closed.** Both
  network-dependent guards that could be reached were reached, and the suite's
  WHAT IS NOT HERE section now names what is genuinely left: the `gh`
  invocations, the argument parsing and the exit codes in each `main()`.
- **What is left unproved is smaller and honest about itself.** Nothing here
  proves that `gh pr list --json number,headRefName,baseRefName` answers what
  `stalenessNotice` expects, or that `commits/<sha>/pulls` is the endpoint that
  associates a squash merge. Those were checked by hand against real pull
  requests and real commits on the day this landed, and they are the part a
  future reader should re-check rather than trust.
- **The guard suite grows by about 25 tests and no measurable time.** Every one
  of them is a function call on a literal, so the file's cost is still the
  scratch directories the older sections make.
- **Two failure modes now show up as a red test rather than as a bad merge.** A
  reworded refusal, which is the cost ADR 0034 already accepted, and a rule
  quietly narrowed — the case worth reading rather than fixing quickly.
- **`main()` can still be wrong in ways nothing sees.** Argument parsing, the
  `PROVENANCE_BEFORE` fallback and the exit codes are unasserted. The split makes
  that boundary visible instead of putting the whole script beyond reach, which
  is a smaller claim than "these scripts are tested" and the true one.

## Revisit when

- **A third guard's decision needs the network.** The pattern above is now the
  answer rather than a new gap in ADR 0034, and a new script that mixes the two
  should be split before it is installed rather than after somebody notices.
- **`main()` grows a rule of its own.** The decision functions are the place for
  a rule. A branch in `main()` that decides something is the same defect this
  record fixed, one layer down, and it will be just as invisible.
- **A test here goes red for a rewording.** Update the clause, and note it: a
  message reworded often is one whose wording is not load bearing, and the
  assertion should move to a part that is. ADR 0034 says this and it applies to
  every clause added here.
- **The API answers something different.** `gh pr list` and
  `commits/<sha>/pulls` are the two shapes these functions are written against,
  and no test can notice GitHub changing either. A guard that passes every test
  and reads a field that no longer exists is exactly the disease ADR 0034 is
  about, moved from the decision into the fetch.
