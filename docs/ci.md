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

**It does not run as written.** `dbmd` is not published to npm, so the two `npx`
lines below cannot resolve a package today. Read [the next
section](#dbmd-is-not-on-npm) before you copy this, because it is the difference
between a workflow that fails on its first run and one that works.

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes dbmd@0.1.0 check db-model

  diagram:
    name: draw the diagram
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes dbmd@0.1.0 export --stdout db-model > "$RUNNER_TEMP/db-model.md"
      - uses: actions/upload-artifact@v4
        with:
          name: db-model-diagram
          path: ${{ runner.temp }}/db-model.md
          if-no-files-found: error
```

`db-model` is the default directory and the argument is there so that a
repository which keeps its model somewhere else changes one word twice.

## `dbmd` is not on npm

`package.json` is `"private": true` at version `0.0.0`. Nothing has been
published, the name is still free, and whether this is ever published is an open
question rather than a date. So the two `npx` lines above are the **shape** the
recipe takes once there is a package, and today they would fail to resolve one.

**`0.1.0` is a placeholder, not a chosen number.** Nobody has decided what the
first published version will be, and this page has no standing to decide it. It
is written as a specific version rather than as `<version>` only because the
point of the line is that a real version goes there rather than `@latest`, and a
recipe with an angle bracket in it teaches the wrong habit. If a first release
happens under some other number, this page is the thing that is wrong and this
paragraph is where to fix it.

What works today is a checkout of `github.com/BlakeHastings/dbmd`,
`npm ci && npm run build`, and `node dist/cli.js` wherever the recipe says
`npx --yes dbmd@0.1.0`. That is exactly what
[`.github/workflows/model.yml`](../.github/workflows/model.yml) in this
repository does, against [`examples/shop`](../examples/shop), on every pull
request, which is how this page stays true.

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
