# 0060. A guard that can fail two ways says which one happened

## Context

[ADR 0051](0051-the-first-release-is-a-tag-a-person-pushes.md) put the whole of
publishing behind a tag a person pushes, and its **Revisit when** opens with the
condition this record is written under: "the first tag is pushed. Every path here
has been reasoned about and none of it has run."

One of those paths is worse than merely unrun.
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml) has
three steps between the tag and the upload: the version comparison, the ancestry
check, and `npm publish`. The ancestry check was one line.

```sh
if ! git merge-base --is-ancestor "${GITHUB_SHA}" origin/main; then
```

It is the only thing in the whole of `.github/workflows/` that reads
`origin/anything`. Everything else in CI works from the checkout it was handed.
So it is also the only step whose success depends on `actions/checkout@v7` having
populated `refs/remotes/origin/main`, and whether it does that **on a tag push**
is a question this repository has no run that could answer, because no tag has
ever been pushed to it.

### Two failures, one sentence

`git merge-base --is-ancestor` reports the two outcomes differently, and `if !`
flattens them. Measured on 2026-09-07, and again on a throwaway clone while
writing this record:

| what happened | exit |
| --- | --- |
| the commit is genuinely not an ancestor | `1` |
| the ref does not resolve | `128`, `fatal: Not a valid object name` |

**The safety of this was never in doubt.** 128 is not 0, so `if !` catches a
missing ref and nothing is published. The guard errs closed, which is the right
direction and is why this was not urgent.

What was wrong is that both exits printed the same thing:

```
::error::<sha> is not an ancestor of origin/main
Nothing was published. A release is cut from a commit that went
through the check gate on a pull request; tag one on main instead.
```

The owner would push a correct tag from `main`, on the one day this path has ever
been asked to work, and be told their tag was not on `main`. They would then go
looking at the tag, the branch and the history, and **none of it would be wrong**.
The cost of that is an afternoon spent where the answer is not, on the step that
was supposed to be the last one.

This repository has already decided this question once, for the other message a
user is most likely to meet first.
[ADR 0045](0045-the-file-says-which-way-it-is-wrong.md) took a single sentence
that `dbmd import` printed for four different broken files and made it say which
of the four had happened, for the same reason: a message that is true and
undiscriminating sends the reader to the wrong place, and being sent to the wrong
place costs more than being told nothing.

## Decision

**The step resolves `origin/main` before comparing anything against it, and a
failure to resolve it is reported as a problem with the checkout rather than with
the tag.**

```sh
if ! git rev-parse --verify --quiet origin/main >/dev/null; then
```

The message that follows names `fetch-depth` and says in its first line that the
ancestry check did not run, so the reader is not left to infer a verdict from a
step that never reached one.

**The ref is verified under the same name it is compared under.** `origin/main`
rather than `refs/remotes/origin/main`, so what resolves in the first line is
exactly the string `merge-base` is handed in the second. A check that verifies a
different spelling of the ref is a check that can pass while the thing it is
guarding still fails.

**The order of the steps does not change.** The version comparison stays first.
It is the cheap check and it is the likely mistake, and a ref check in front of it
would report a mismatched version, which has nothing to do with the checkout, as
a checkout problem. That would be this record's own error committed in the other
direction.

**`git fetch origin main` is rejected, though it would work.** It would make the
step pass in the case this record is about, and that is the objection: it would
make the step pass without anybody learning whether the checkout had done its job.
`fetch-depth: 0` is in the checkout step for exactly this one consumer, and the
comment there says so. Fetching the ref inside the step would leave that comment
describing a dependency the workflow no longer had, which is the shape of stale
comment this repository keeps paying for.

**Nothing here is a claim about what `actions/checkout` does on a tag push.** The
question is still open and this record does not close it. What changes is that the
day it is answered, the answer arrives as a sentence about the checkout instead of
as a false accusation about the tag.

## Consequences

- **The step is two checks rather than one, and the comment above it is longer
  than both.** That is the correct ratio here. The mechanism is four lines of
  shell that any reader could have written; what is not obvious is why two
  failures that both mean "not published" are worth separating, and that is what
  the comment carries.
- **This guard has still never run in CI, and cannot be made to.** Running it
  means pushing a tag, and pushing a tag publishes, and a publish cannot be taken
  back. [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
  asks that a guard be seen to fail before it is believed, and this is the one
  place in the repository where paying that price is not available at any
  reasonable cost. What was done instead: the `run:` body was extracted verbatim
  and driven under `bash -e`, the shell GitHub Actions uses, against throwaway
  clones in three states. A clone whose `HEAD` is on `origin/main` exits 0. A
  commit on a side branch prints the ancestry message and exits 1. A clone with
  `refs/remotes/origin/main` deleted prints the checkout message and exits 1.
  That proves the branching, and it does not prove that a real tag push reaches
  this step in either state.
- **A third failure is still undifferentiated.** If `origin/main` resolves but
  the tagged commit's object is missing, `merge-base` exits 128 and prints the
  ancestry message. That cannot happen with `GITHUB_SHA` in a job that has just
  checked that commit out, and inventing a branch for it would be adding a case
  nobody has produced a way to reach.
- **`npm publish` failing is still not distinguished from anything.** It runs
  `prepublishOnly`, so a red publish step is usually the check suite and not the
  tag, and it takes minutes to say so. That is dbmd-056 and this record does not
  touch it. The messages written here are careful not to imply otherwise: neither
  of them says the publish would have succeeded.

## Revisit when

- **The first tag is pushed.** This is the run that answers whether
  `actions/checkout@v7` with `fetch-depth: 0` gives a tag push
  `refs/remotes/origin/main`. If the checkout message is the one that appears, the
  answer is no and the fix is a decision about the checkout, made with the
  evidence in hand rather than in advance of it. If the step simply passes, the
  new branch was dead code and worth keeping anyway, because what it costs is four
  lines and what it insures against is the first release.
- **Something else in CI starts reading a remote-tracking ref.** This step is
  currently alone in that, which is why the dependency is easy to state. A second
  consumer makes `fetch-depth: 0` a shared requirement and the comment on the
  checkout step needs to stop naming one caller.
- **`npm publish` is preceded by anything.** The order argument above assumes
  three steps, cheapest first. A fourth changes what "the likely mistake" means
  and the ordering should be re-argued rather than inherited.
