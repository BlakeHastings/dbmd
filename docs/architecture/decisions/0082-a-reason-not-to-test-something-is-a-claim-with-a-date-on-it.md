# 0082. A reason not to test something is a claim with a date on it

## Context

ADR 0057 installed `scripts/report-merge-aftermath.mjs`, 456 lines that judge
what a merge did to `main` and comment about it on the pull request that did it.
Its consequences say why nothing tests any of it:

> **Nothing in `npm run check` covers this**, for the same reason nothing covers
> `check-main-provenance.mjs`: its body is API calls, and a test that mocks them
> would be a test of the mock.

That reason is a claim about another file, and the other file stopped supporting
it **seventeen minutes later**. ADR 0057 landed at 14:47:59 on 2026-09-07. ADR
0058, "A decision that needs the network is two things", landed at 15:04:48 the
same afternoon. It opens by saying ADR 0034's list of untestable guards was short
by one, names `check-main-provenance.mjs` as that one, and splits it into a
decision whose facts are arguments and a `main()` that holds the network. Today
that script exports `landedPulls`, `auditCommits`, `violationReport` and
`accountedReport`, and `test/guards/broken-on-purpose.test.ts` breaks each of
them on purpose.

So ADR 0057's stated reason cites, as its precedent, the exact script that
stopped being an example of it before the afternoon was over. Nobody went back,
and this record is that visit.

**Why nothing noticed, which is the part worth recording.** ADR 0057's four
revisit conditions are a red merge with no comment, people ignoring the comments,
a fourth workflow going unwatched, and landing moving off pull requests. All four
are about the mechanism failing in production. **None of them fires when the
reason for not testing the mechanism stops being true**, because that is not an
event in the mechanism at all. The sweep of all 263 revisit conditions on
2026-09-07 read this record six hours later and correctly ruled every one of them
out. A sweep can only read the conditions somebody wrote.

**ADR 0058's own list came closer and still missed, for a reason in its wording.**
Its first entry is "a third guard's decision needs the network", and it ends
"a new script that mixes the two should be split before it is installed rather
than after somebody notices". It is written forward, at the next script. The
third script was already installed, seventeen minutes old, and sitting in the
same tree while that sentence was typed.

## Decision

**ADR 0058's pattern fits here and is applied. The decision is a set of exported
functions whose facts are arguments; `gh`, the disk and the exit codes live in a
`main()` that runs only when the file is the entry point.**

The judgements above the banner, in the order the script uses them:

- `watchedIn(files, defaultBranch)`, which is the workflow parse. `files` is
  `[{ file, text }]` rather than a directory, so the fixture is the YAML.
- `nothingWatchedReport(defaultBranch)`, the words for a parse that found nothing
  to watch, which is a refusal rather than an empty report.
- `GREEN`, `RED` and `verdictOf(run)`, the three-way sort in which a cancelled
  run is a commit nobody verified rather than a fine one.
- `failedJobNames(jobs)`, which names the red jobs and no others.
- `marker(run)` and `commentBody(run, verdict, jobs, defaultBranch)`, the comment
  and the hidden line that stops it being posted twice.
- `runFinding(run, defaultBranch)`, which is the whole of "is this worth a
  comment": on another branch, not a push, not finished, or green, each with the
  line the log gets.
- `landedPullOf(pulls, defaultBranch)` and `findLandedPull(sha, io)`, the rule
  about which pull request a commit landed through and the retry that waits for
  the API to catch up. `pullsFor` and `wait` are arguments, so the retry is
  exercised without spending thirty seconds.
- `saidAlready(comments, run)`, the duplicate scan.
- `summariseRuns(entries)` and `floorReport(counts, defaultBranch)`, the local
  summary and the number that is labelled a floor.
- `parseArgs(argv)`, because `--post` on a commit summary is a judgement and not
  a parse: there is one comment to write and it is about one finished run.

**The delivering half is still deliberately unfired, and that is not the same
gap.** ADR 0057 decided it and the decision stands: seeding the channel with a
test alarm about a run from yesterday is precisely the cry-wolf failure this
design exists to avoid. **Asking a decision function a question is a different
act from posting.** One reads a value in memory and costs nothing; the other
writes in somebody's inbox and is visible forever on a merged pull request. So
`landedPullOf`, `findLandedPull` and `saidAlready` are asserted, `deliver()` is
not called by anything, and the POST is reached only by the workflow, only on a
real red merge. The first one is still what proves it, and it still proves it
loudly.

**The line between decision and transport is drawn one notch differently from ADR
0058.** The two messages about delivery failing, "nothing to post to" and "could
not comment on #N", stay inside `main()`. They are not judgements about `main`
being red; they are what a failed channel says, and reaching either needs the
channel to fail. `nothingWatchedReport` is above the line because it is a
judgement about the repository, not about a request.

**The first question this parse was ever asked found a defect in it.** ADR 0057
says the parse is generous, so "a push trigger with no branch filter, or one this
cannot read, is watched rather than dropped". The list form honoured that: an
unreadable list yields no items and falls through to watching. The inline form
did not. `branches: *the-usual` was compared as text, does not contain the word
`main`, and the workflow was dropped in silence, which is a watcher that watches
one thing less for a reason nobody would ever see. `notALiteralList` is the fix:
an inline value carrying a YAML alias or a `${{ }}` expression is something this
cannot answer about, and the generous answer to not knowing is to watch.

## Consequences

- **A reason for not testing something is now a thing this repository writes a
  revisit condition about.** The last entry below is the one ADR 0057 needed and
  could not have written for itself, because it is about the record it cites
  rather than about the thing it built.
- **Forty-nine tests, and no measurable time.** `test/guards/broken-on-purpose.test.ts`
  goes from 98 tests to 147. Every new one is a function call on a literal except
  a single `readdir` of `.github/workflows/`, five small files. Measured in a
  worktree on this machine on 2026-09-07, one run each: `npm run check` took
  **55.7s** with these tests in it, against the **54.9s** ADR 0034's appended
  section measured for the same gate earlier the same day. Two runs of anything
  differ by more than that, so the honest claim is that no change is visible
  rather than that it costs 0.8s. The guard file itself ran in 13.8s and 14.3s
  across the two gate runs here, where it was 12.6s before the section was added.
- **ADR 0057's third revisit condition is half an assertion now.** "A fourth
  workflow starts running on `main` and is not watched" was a thing to notice by
  eye. One test reads this repository's real `.github/workflows/` and asserts
  `check`, `model` and `provenance` are watched while `aftermath` and `release`
  are not, which is the only version of the question that can go wrong quietly.
  It asserts containment rather than equality on purpose, so a fourth workflow
  that is correctly watched does not turn it red.
- **The generous parse is behaviour rather than a sentence.** It was a sentence
  in two places and false in one of them for the length of a day.
- **The script's own header now says how it is tested and what is not.** The
  suite's WHAT IS NOT HERE section names it too. That section is the one this
  repository keeps paying for when it presents itself as exhaustive and is not,
  which is what ADR 0058 said about the list that omitted the provenance audit.
- **`main()` can still be wrong in ways nothing sees.** The `gh` invocations, the
  exit codes and the interleaving of the API calls in `judgeCommit` are
  unasserted, and no test can notice GitHub changing the shape of a workflow run,
  a jobs listing or `commits/<sha>/pulls`. Those were checked by hand against the
  live API on the day this landed, including the seventh failure, and they are
  the part a future reader should re-check rather than trust.
- **`judgeCommit` now fetches all three workflows before printing any of them**,
  where it used to print each line as it arrived. That is the cost of having the
  per-workflow reduction be one function on values, and it is three API calls of
  waiting rather than one.
- **Nothing about the mechanism changed except the parse.** The workflow, the
  trigger, the comment's words, the marker, the retry counts and the exit codes
  are what ADR 0057 decided. This record is about reach, not about behaviour.

## Revisit when

- **A record argues something is untestable by pointing at another record.** That
  is a claim with a date on it and a dependency nothing tracks. ADR 0057's lapsed
  in seventeen minutes and stayed lapsed for a day. When one is written, the
  record it cites should carry a line saying it is cited, or the argument should
  stand on its own without the precedent.
- **The POST is fired by anything other than `aftermath.yml` on a real red
  merge.** A test that reaches it, a hand run with `--post` against an old run, a
  second caller: each is the cry-wolf failure arriving by a different door, and
  the paragraph above is the reason this is a condition rather than a preference.
- **`main()` grows a rule.** ADR 0058 says this and it applies here. The two
  delivery-failure messages are the boundary as drawn today, and a branch in
  `main()` that decides something belongs above the banner.
- **The workflow parse gets a third form to read.** A `branches-ignore:`, a
  reusable workflow, a matrix over branches. Every one of them is a shape the
  regexes above do not know, and the generous direction is the answer only for
  as long as somebody keeps checking that generous still means watched.
- **The API answers something different.** `actions/runs/<id>`, its `jobs`
  listing and `commits/<sha>/pulls` are the three shapes these functions are
  written against. A script that passes every test and reads a field that no
  longer exists is the disease ADR 0034 is about, moved from the decision into
  the fetch.
