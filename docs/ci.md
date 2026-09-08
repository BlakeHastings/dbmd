# dbmd in GitHub Actions

Two jobs, and they answer two different questions.

**Is the model still coherent?** `dbmd check` reads it, checks every file
against the format and the files against each other, and exits non-zero on an
error. That is a gate: it belongs on every pull request, and it is the reason
a `ref` at a table somebody deleted is caught by a robot instead of by a
reviewer.

**What does the model look like now?** `dbmd export` draws it as a mermaid
entity-relationship diagram. Uploaded as a build artifact, that lets a pull
request carry the current picture **without anybody committing a generated
file**, which is the half of this that teams argue about.

Neither job needs a database, a container or a secret. `dbmd` describes a
schema and never connects to one.

## Copy this

Two things in it are worth reading before you paste it: which version to pin,
[below](#the-version-in-that-recipe), and why pinning one at all is a decision
rather than a formality, [after that](#why-the-version-is-pinned).

```yaml
name: db-model

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    name: check the model
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npx --yes dbmd@0.1.0 check db-model

  diagram:
    name: draw the diagram
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npx --yes dbmd@0.1.0 export --stdout db-model > "$RUNNER_TEMP/db-model.md"
      - uses: actions/upload-artifact@v7
        with:
          name: db-model-diagram
          path: ${{ runner.temp }}/db-model.md
          if-no-files-found: error
```

`db-model` is the default directory and the argument is there so that a
repository which keeps its model somewhere else changes one word twice.

## The version in that recipe

`0.1.0` is the number chosen for the first release. It used to be a placeholder
standing in for a number nobody had chosen, and
[ADR 0051](architecture/decisions/0051-the-first-release-is-a-tag-a-person-pushes.md)
chose it, partly so that this page would become true rather than become wrong a
second way.

**On this page the number is not free.** `npm run check` reads every version
written after `dbmd@` in this repository and fails unless it is the version in
`package.json`. There are five: the two lines in the block above, the sentence
below about running from a checkout, one in `README.md`, and one in the comment
of the script that does the reading. That is a rule about this repository's own
pages and not about your copy of the recipe, and it is deliberately not a claim
that the version is on the registry, which is the next paragraph's subject and
not something any file here can answer.
[ADR 0080](architecture/decisions/0080-a-version-after-dbmd-names-the-version-this-package-is.md).

**The current version comes from `npm view dbmd versions` and not from this
page.** A list of releases written into prose is a second copy of something
the registry already holds, and the second copy is the one that goes stale
without anybody touching it. So move the number in the recipe when you want a
newer one, and read it from there rather than from here. If `npx` cannot resolve
what the recipe pins, that command is the first place to look: releases are cut
by pushing a tag and
[`.github/workflows/release.yml`](../.github/workflows/release.yml) is the whole
of the mechanism, but the registry is the authority on what has actually shipped.

A checkout of `github.com/BlakeHastings/dbmd`, `npm ci && npm run build`, and
`node dist/cli.js` wherever the recipe says `npx --yes dbmd@0.1.0` does the same
work with no install. That is exactly what
[`.github/workflows/model.yml`](../.github/workflows/model.yml) in this
repository does, against [`examples/shop`](../examples/shop), on every pull
request, which is how this page stays true. It stays a checkout on purpose and
does not become an install: running the published package here would test npm
rather than the code in the pull request, which is backwards. ADR 0028 said so
before it was a choice anybody had.

## Why the version is pinned

`npx dbmd@latest` in a CI job is a supply chain decision made by accident. It
says that whatever is published to npm tomorrow runs inside your build, with
your checkout on disk, and nobody reviewed it because from your side nothing
changed. The same job that was green yesterday can be a different program
today, and the diff that did it is not in your repository.

Pinning turns that into an upgrade you make on purpose, in a pull request
somebody reads, on a day you chose. It costs a line in a renovation bot's
queue and it buys the property that a green build stays green for a reason.

`--yes` is not decoration either: `npx` asks before installing a package it
does not already have. It skips the question when nothing is attached to
stdin, which is true in a runner today, but a recipe whose correctness rests
on that is a recipe that hangs for six hours the first time it is not.

## Why the recipe names Node 24

`node-version: 24` is a claim about **your** runner rather than about `dbmd`.
Two separate things go into it.

`dbmd` needs Node 22 or later; `package.json` says so in `engines`, and that is
the floor rather than the recommendation. So 22 would resolve and run. The
recipe names 24 because it is the Active LTS on the day this was written, and a
recipe people copy into a fresh repository should hand them the version that is
still getting features rather than the oldest one that works.

Change it to whatever your repository already standardises on, as long as it is
22 or later. What is worth not doing is leaving a version in there long after it
stops receiving security fixes, which is how this page had `20` in it: Node 20
reached end of life on 2026-04-30 and nothing in a green build says so.

## Why the diagram job uses `--stdout`

`dbmd export` with no `--stdout` writes the diagram into `db-model/README.md`,
between two markers, and leaves the rest of that file alone. That is the right
thing on a laptop and the wrong thing in a runner: the job finishes holding a
modified file that nobody asked it to modify, and there are only two ways out
of that. Either a bot pushes a commit to your branch, or the job fails because
the tree is dirty. The first is a robot writing to your repository and the
second is a gate about a generated file.

`--stdout` avoids the question. The diagram goes to stdout, the redirect puts
it somewhere outside the checkout, and the artifact carries it to whoever wants
to look. Nothing in the repository changed, so there is nothing to commit and
nothing to fail about.

If you would rather have the diagram in the file and reviewed like any other
change, that is a fair choice and the shape is different: run `dbmd export`
locally, commit `db-model/README.md`, and let CI enforce that it is current with
`dbmd export db-model`, then `git add -N db-model`, then
`git diff --exit-code db-model`. Export does not rewrite a file whose diagram
has not changed, so that stays quiet until the model moves.

**`git add -N` is the line that makes that gate able to fail**, and the shape is
broken without it, because `git diff` does not look at untracked files. A
repository whose `db-model/README.md` was never committed runs the export,
creates the file, shows git a tree with no tracked change in it and exits 0, so
a gate whose whole purpose is to fail on a stale diagram goes green having
proved nothing. `--intent-to-add` records the path in the index with no content,
which is all `git diff` needs in order to see it. A diagram that is genuinely
new and wanted then arrives as a whole file added and the job fails, which is
the right answer rather than a false alarm: what the gate claims is that the
committed diagram is current, an uncommitted one is not, and the fix is the
first half of the recipe. It reaches anything else untracked under that
directory as well, which is the same answer for the same reason.

`test -z "$(git status --porcelain db-model)"` closes the same hole and was not
chosen. It goes red without printing what went stale, and the diff is what
somebody reads out of the job log to find out which table moved.

This repository does not run that shape, because its own model is one a person
has open in the studio. Both of its states were driven by hand in a scratch
repository on 2026-09-08, a `README.md` that was committed and current and one
that had never been committed, and the second exited 0 until `git add -N` was
in it.

## Why the upload cannot be empty

An artifact upload that silently uploads nothing is worse than a failed job,
because it looks like an answer. There are two ways to get one and the recipe
closes both.

The first is subtle and it is in the recipe's own line. `> "$RUNNER_TEMP/…"`
is the shell, not `dbmd`: the file is created and truncated **before** `dbmd`
runs. A model with an error in it is refused rather than drawn (ADR 0023), so
`dbmd export` exits 1 having written nothing, and what is left on disk is a
zero-byte file. What stops it reaching the artifact is that the step failed,
and GitHub runs `run:` under `bash -e`, so nothing after it in that job
happens. This is why the recipe has no `continue-on-error` and no
`if: always()` on the upload: adding either is exactly the change that turns a
refused export into an empty artifact.

The second is ordinary. `actions/upload-artifact` **warns and goes green** when
its path matches nothing, so a path that stopped pointing at the file is a
silent no-op. `if-no-files-found: error` is one line and it is the difference
between a build that tells you and one that does not.

## What it looks like with no terminal

There is no TTY in a runner, and this is where a tool that quietly assumed one
gets found out. `dbmd` is built for it: colour is off when stdout is not a
terminal, nothing prompts, and no command reads stdin
([ADR 0006](architecture/decisions/0006-one-cli-three-callers.md)).

**stdout is data and stderr is narration**, so `dbmd check` writes nothing at
all to stdout and its diagnostics land on stderr, which is where Actions folds
them into the step's log either way:

```
tables/order_items.md
    error  `ref: widgets.id` on column `product_id` names no table; there is no tables/widgets.md (ref-table-unknown)

/home/runner/work/_temp/broken: 1 error across 1 file.
Error: Process completed with exit code 1.
```

That is the whole of the failure. The step goes red on the exit code, not on
anything matched out of the text, so nothing here is a contract and none of it
has to be parsed.

A clean run is one line, and it is on stderr too:

```
examples/shop: 8 tables, 2 notes, 1 group, no problems.
```

`dbmd export --stdout` prints the diagram on stdout and **nothing whatsoever**
on stderr, so the redirect captures the document and only the document. There
is no success line to strip and no quiet flag to remember.

Two things follow from this that are worth knowing before you debug a job:

- `dbmd check > out.txt` captures an empty file. The diagnostics are on stderr.
  `2>&1` is how a script gets the prose, and `--json` is how it gets structure.
- `--json` puts the report on stdout with the **same** exit code as the text
  form. It is the shape to reach for if you want to post a comment on the pull
  request rather than send somebody to the log.

## The report `dbmd export --json` writes

The `check` shape is shown in [`README.md`](../README.md#the-commands). This is
its sibling, and it is on this page because the field worth reading is one only
a pipeline ever asks about.

`--json` puts a report on stdout in place of the `Wrote ...` line, with the same
exit code as the text form:

```json
{
  "schema": 1,
  "ok": true,
  "directory": "examples/shop",
  "format": "mermaid",
  "file": "examples/shop/README.md",
  "written": true,
  "tables": 8,
  "relationships": 11
}
```

**`written` is the field to read.** Export does not rewrite a file whose diagram
has not changed, so the same eight keys come back with `written: false` when the
committed diagram was already current, and `ok` is `true` either way. That is the
question the `git diff --exit-code` shape above asks with a second command and an
exit code, asked once and answered as a value.

`file` is the path that was written, relative to the directory the command ran
in and slash-separated on every platform, so two runners produce the same bytes.
`tables` and `relationships` count what the diagram drew, which is a cheap thing
for a job to assert on when a model is not supposed to be losing tables.

This is the writing form of the command and not the `--stdout` one. Asking for
both is a usage error, exit code 2, because stdout carries one thing per run:

```json
{
  "schema": 1,
  "ok": false,
  "error": {
    "code": "usage",
    "message": "--stdout and --json both write to stdout, so they cannot be used together. Use --stdout for the diagram, or --json for the report."
  }
}
```

So the diagram job in the recipe above cannot have both, and it does not want
both: it wants the document, and there is nothing a report could tell it that the
exit code has not. `--json` belongs in the other shape, the one that commits
`db-model/README.md` and needs to know whether this run changed it.

A model with an error in it is refused rather than drawn, here as everywhere, and
the report says so on exit code 1:

```json
{
  "schema": 1,
  "ok": false,
  "directory": "db-model",
  "counts": {
    "errors": 1,
    "warnings": 0
  },
  "error": {
    "code": "model-has-errors",
    "message": "db-model has 1 error in it"
  }
}
```

The diagnostics themselves are not in there. `dbmd check --json` is what carries
those, which is one of the reasons the recipe runs both jobs rather than treating
a failed export as the report. The other way this command fails writes
`markers-unbalanced` in the same place, for a `db-model/README.md` holding one of
the two generated markers and not the other.

## Making it a required check

Neither job is required by anything on its own. Make the check job required in
your ruleset or branch protection if you want a broken model to block a merge,
which is the point of having it. The diagram job should not be required: it
produces an artifact rather than a verdict, and a diagram that failed to draw
is already reported by the check job it duplicates.
