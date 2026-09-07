# 0028. The CI recipe is pinned, and this repository runs it

## Context

ADR 0006 named three callers and said a GitHub Actions step is one of them:
it wants an exit code, stable text in a log, and an artifact it can upload,
and it has no TTY. `dbmd check` (ADR 0020) and `dbmd export` (ADR 0023) each
made their exit code a contract on the strength of that sentence. Nothing had
yet run either of them in a runner.

Writing the recipe down turns out to be four decisions rather than a paste of
two commands, and three of them have a wrong answer that looks fine in a diff.

**A version in somebody else's CI is a supply chain decision.**
`npx dbmd@latest` says that whatever is published tomorrow runs inside their
build, next to their checkout, with nobody reviewing it, because from their
side nothing changed. It is the most copied line in every tool's README and it
is the one that has no diff when it goes wrong.

**This package is not published.** `package.json` is `"private": true` at
`0.0.0`. A recipe telling somebody to run `npx dbmd@0.1.0` today is telling
them to run something that does not exist, and a recipe nobody can run is
indistinguishable from a recipe that is wrong.

**A recipe demonstrated in prose rots the first time a flag changes.** The
work item's evidence bar said so: a YAML file that has never executed is a
guess. But this repository's own model, `examples/shop`, is a real model that
people open in the studio, and a job that writes to it is a job that puts a
diff on somebody's laptop.

**An artifact upload that uploads nothing is worse than a failure**, because
it looks like an answer. There are two ways to produce one and neither is
visible in the YAML that produces it.

## Decision

**The published recipe pins an exact version, and the prose says why rather
than assuming.** `npx --yes dbmd@0.1.0`, not `@latest` and not a range.
`--yes` is spelled out for the same class of reason: `npx` asks before
installing, it happens to skip the question when nothing is on stdin, and a
recipe whose correctness rests on that is one that hangs for six hours the
first time it does not hold.

**`docs/ci.md` says plainly, before the block anybody copies, that those two
lines do not work yet**, and gives the form that does: a checkout of this
repository, `npm ci`, `npm run build`, and `node dist/cli.js` where the recipe
says `npx`. Shipping a recipe that cannot be run, without saying so, is the
failure this is avoiding; shipping no recipe until publishing happens is the
other one.

**`0.1.0` is a placeholder and the page says so where it names it.** Nothing
here decides what the first published version is, or whether there is one; that
belongs to whoever publishes, and this record has no standing to pre-empt it. A
specific number is written rather than `<version>` because the whole point of
the line is that a real version goes there rather than `@latest`, and a recipe
with an angle bracket in it teaches the habit this decision exists to prevent.

**This repository runs the recipe, on `examples/shop`, in
`.github/workflows/model.yml`.** It is the same two jobs with that one
substitution, and it runs on every pull request, so a flag that changes turns
this repository red rather than somebody else's. The gap between the recipe
and the workflow is one line in each job and it is named in both files, which
is the honest amount of drift to carry rather than pretending to none.

**The export job uses `--stdout` and redirects outside the checkout.** Writing
into `db-model/README.md` in a runner leaves the job holding a modified file
nobody asked it to modify, and the only two ways out are a bot that pushes a
commit to somebody's branch or a job that fails because the tree is dirty. The
whole point of the artifact is that a pull request can carry the current
diagram without either. `docs/ci.md` describes the committed-diagram shape,
`dbmd export` then `git diff --exit-code`, as a fair alternative and says it
is not exercised here.

**Nothing in the recipe lets an empty artifact through, and both belts are
there because they catch different things.** The first is that
`> "$RUNNER_TEMP/…"` is the shell rather than `dbmd`: the file is created and
truncated before `dbmd` runs, so a model with an error in it, refused by ADR
0023, leaves a zero-byte file on disk. What stops it reaching the artifact is
that the step failed and GitHub runs `run:` under `bash -e`. So the recipe has
no `continue-on-error` and no `if: always()` on the upload, and both files say
that adding one is the change that produces the empty artifact. The second is
`if-no-files-found: error`, because `actions/upload-artifact` warns and goes
green when its path matches nothing, which is the one failure the exit code
cannot catch.

**The check job carries a step that is not part of the recipe**: it breaks a
copy of `examples/shop`, runs `dbmd check` on it, prints what that looks like
in a log, and fails unless the exit code is exactly 1. A gate nobody has
watched fail is indistinguishable from one with nothing to catch, and this is
the cheapest way to keep watching. It works on a copy in `RUNNER_TEMP`,
because the model in the repository is somebody's.

## Consequences

- **A version number now appears in the tree before anybody chose one.** That is
  a real cost even with the placeholder said out loud, because a number in a
  document is a number somebody can read as a decision. It is written in exactly
  one place, `docs/ci.md`, so the fix is one edit, and whoever publishes should
  make that edit rather than feel bound by it.
- **`model.yml` is not the merge gate and must not become one.** `check.yml`
  runs `npm run check` and is the only required status check. A model job that
  is required is a job whose failure blocks a merge for a reason unrelated to
  the change, and this repository's model is an example rather than a
  dependency.
- **Two jobs each pay for `npm ci` and a build.** They could share through an
  artifact and they do not, because the published recipe has the same two
  independent jobs and a workflow that is shaped differently from the recipe it
  demonstrates demonstrates less.
- **The gate-proof step depends on a string in `examples/shop`.** If the
  `products.id` ref it breaks is renamed, the `sed` matches nothing, the copy
  stays valid, and the step fails saying so rather than passing quietly. That
  is deliberate: a proof that stops proving anything should be loud.
- **Nothing here tests the `npx` form**, because there is nothing to install.
  The first publish is when that line is first run by anybody, and it is worth
  running it deliberately that day rather than finding out from a user.

## Revisit when

- **`dbmd` is published, if it ever is.** The "not on npm" section of
  `docs/ci.md` comes out, the placeholder becomes whatever the real first
  version turned out to be, and the workflow in this repository should be
  reconsidered rather than converted: running the published package here would
  test npm instead of the code in the pull request, which is backwards.
- **It is decided that it will not be published.** Then the two `npx` lines are
  not a recipe waiting on a date, they are a recipe for something that will not
  exist, and the checkout form stops being the temporary half of that page and
  becomes the whole of it.
- **Somebody asks for the diagram to be committed by CI.** That is a bot with
  write access to a branch, and it is a decision about who may write to a
  repository rather than about this tool. `--stdout` plus a human running
  `dbmd export` is the answer until the cost of that is measured rather than
  assumed.
- **A team wants the check job's diagnostics as a pull request comment.**
  `--json` on stdout with the same exit code is already the shape for it, and
  the thing to resist is anything that parses the text form, because ADR 0006
  leaves that free to be reworded in a patch release.
- **The recipe grows a third job.** Two is the number that fits the two
  questions. A third is evidence that a command grew a use this page has not
  thought about, and it is worth asking what it is before adding it.
