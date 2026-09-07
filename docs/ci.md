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
locally, commit `db-model/README.md`, and let CI enforce that it is current
with `dbmd export db-model` followed by `git diff --exit-code db-model`. Export
does not rewrite a file whose diagram has not changed, so that stays quiet
until the model moves. This repository does not run that shape, because its own
model is one a person has open in the studio, so take it as untested here.

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

## Making it a required check

Neither job is required by anything on its own. Make the check job required in
your ruleset or branch protection if you want a broken model to block a merge,
which is the point of having it. The diagram job should not be required: it
produces an artifact rather than a verdict, and a diagram that failed to draw
is already reported by the check job it duplicates.
