# Contributing to dbmd

This file is how to work on **this repository**: what to install, what to run,
what to read before you change anything, and what this project will turn down.

It is not a description of what `dbmd` does. That is [`README.md`](README.md)
and, if you are writing a model rather than changing the code,
[`docs/format.md`](docs/format.md).

## Before you write anything

Two things this project does not do, and both are decisions rather than gaps.
Learning them in review is expensive for everybody.

- **It does not generate or apply DDL.** It describes a schema. A `default:` in
  a model file is text the format carries; nothing ever executes it.
  [ADR 0003](docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md)
  is the argument.
- **It does not connect to a database.** The import path reads a JSON file that
  a human produced by running a query themselves, and the query is something
  `dbmd` hands you to run rather than something it runs.
  [ADR 0007](docs/architecture/decisions/0007-engines-are-providers.md) is the
  argument, and [`docs/import-format.md`](docs/import-format.md) is the shape of
  that file.

A pull request that adds either is not a small pull request. It is a proposal to
reverse a recorded decision, and it wants an amendment to the record first. See
[Decision records](#decision-records) below.

One more, from [`AGENTS.md`](AGENTS.md), because it surprises people: **no
dependency is added without a line in the pull request saying what it replaces
or what it makes possible.** This is a tool people run with `npx`, and install
time is a feature.

## From a clone to a picture

You need [Node](https://nodejs.org) 20 or later, npm, and git. Nothing else: no
database, no Docker, no global installs. CI builds and tests on Node 20 on Linux
for every pull request, and this is developed on Node 24 on Windows, so both
ends of that range are exercised rather than promised.

```bash
git clone https://github.com/BlakeHastings/dbmd.git
cd dbmd
npm ci
npm run studio
```

On npm 11 or later, `npm ci` ends with a warning that `esbuild`'s install script
was not run. Ignore it. esbuild ships its platform binary as an optional
dependency, npm installs that either way, and the build works: the warning is
npm telling you about a script it declined to run, not about something missing.

`npm run studio` builds and then opens this repository's own example model,
[`examples/shop`](examples/shop), in your browser. It is eight tables of a
coffee roastery's order book, and it is a real model in the real format rather
than a fixture. Your first successful command is a picture rather than a passing
test, which is deliberate: this is a tool for looking at things.

It prints the URL it bound to **on stderr**, and that line is the only way to
learn the port, because the default port is `0` and the operating system picks
one. Do not discard stderr when a script starts this.

Two flags worth knowing on day one:

```bash
npm run studio -- --no-open      # bind and print the URL, do not open a browser
npm run studio -- --port 8080    # a port you choose, rather than one you are given
```

The bare `--` is npm's separator: everything after it goes to `dbmd` instead of
to npm. It is the same in bash, in PowerShell and in `cmd.exe`; all three were
checked, because a shell eating a `--` is the kind of thing that is only ever
found by somebody on the other operating system.

**Stop it with Ctrl-C.** The studio writes edits back to disk on a debounce, and
Ctrl-C flushes a write that has not fired yet before it stops listening. Killing
the process another way can lose the last thing you did.

Anything you change in the page is written straight into `examples/shop`, so it
shows up in `git status` like any other edit, and dragging one table's box is
one changed line in that table's file. `git checkout examples/shop` puts it back,
which is the undo.

## The one command you have to remember

```bash
npm run check
```

Typecheck, format check, decision-record numbering, the reviewable-diff check,
tests, and a build, in that order. It is the only mechanical gate, and it is
exactly what CI runs, so green here and green there mean the same thing. There
is no second list of things to remember.

The pieces run on their own when you want a faster loop: `npm run typecheck`,
`npm run format` (which writes; `npm run format:check` only complains),
`npm run test`, `npm run build`.

Prettier owns formatting and there is nothing to argue about in review. Note
which trees it is kept out of, in `.prettierignore`: `docs/` and `examples/` are
prose and are human-owned, so a docs change is yours to line-break. Markdown at
the repository root, this file included, **is** formatted by Prettier. If
`npm run check` fails on a file you only wrote English into, that is why, and
`npm run format` fixes it.

## What to read, in what order

Read for the job you are doing rather than end to end.

**Changing the code:**

1. [`AGENTS.md`](AGENTS.md) first. The invariants, the conventions, and the
   gotchas. It is the file this one deliberately does not repeat, so if the two
   ever disagree, `AGENTS.md` is right.
2. [`docs/process/review.md`](docs/process/review.md) for what "done" means
   here. Three lenses, and mechanical checks are not one of them.
3. [`docs/process/working-an-issue.md`](docs/process/working-an-issue.md) for
   the mechanics: branch names, commit messages, and how a change lands.
4. [`docs/architecture/decisions/`](docs/architecture/decisions/) for whichever
   decision covers the area you are touching. They are short and they are
   numbered, and the one that names your area is usually the whole briefing.

**Writing a model, or working out what the format allows:**
[`docs/format.md`](docs/format.md). Every key, every diagnostic, and the handful
of things that are load-bearing and easy to guess wrong. It is written for
somebody typing a model into a text editor with nothing installed. That is a
different reader from the one `AGENTS.md` is written for, and the two files are
not substitutes for each other.

The backlog is beads, not GitHub issues. `AGENTS.md` says how to read it,
including how to read it with `node` when `bd` is not installed, and
[ADR 0002](docs/architecture/decisions/0002-initialisation-answers.md) says why.
Branches are `<area>/<number>-<slug>`, where the number is the numeric part of a
`dbmd-N` id.

## Decision records

Three sentences, and all three matter.

**Numbers are handed out, not taken.** Work runs in parallel here, so the next
free number on your branch is usually already claimed on somebody else's; ask
for yours rather than counting.

**`npm run check` fails a collision**, through `scripts/check-adr-numbers.mjs`,
and CI runs it on the merge commit, so a collision that does not exist on your
branch yet still turns your pull request red.

**A record that turns out to be wrong is appended to, never edited**, so the
reasoning that did not survive is still readable next to what replaced it. Two
worked examples: [ADR 0003 was amended][adr3-amend] once the format had been
written by hand, and [ADR 0006 was amended][adr6-amend] once `dbmd studio` was
something a script could call.

Not every change needs one. A new pattern does, and
[`docs/process/review.md`](docs/process/review.md) is where that judgment is
described. Three sentences is a fine record.

## Opening a pull request

Run `npm ci` and `npm run check` first, and if you touched the CLI or the
studio, bring it up and drive it. Do not open a pull request you have not run.

The body is the three lenses from
[`docs/process/review.md`](docs/process/review.md), and
[`.github/pull_request_template.md`](.github/pull_request_template.md) has them.
An empty section reads as a skipped lens: write "not applicable, docs only"
instead of leaving it blank. Name the work item, `dbmd-N`, in the title or the
first line of the body. Commit subjects say **why**, because the diff already
says what.

Squash merge only, and a green `check` is required. **If you are an agent
working an issue, you do not merge**, ever, including when your checks are green
and the change is one line.
[`docs/process/working-an-issue.md`](docs/process/working-an-issue.md) lists the
prohibited commands, and `scripts/guard-merge.mjs` refuses several of them
before they run.

## Windows, macOS and Linux

This is developed on Windows and most contributors will not be. Everything above
is plain `npm` and plain `node`, and none of it needs a POSIX shell: the commands
in this file were run on Windows 11 in PowerShell, and they are the same commands
elsewhere.

Two differences that are real and have already bitten:

- **File names differ in case on Linux and do not on Windows or macOS.** A model
  with a table called `Orders` and a table called `orders` is two tables on Linux
  and one on the machine that checks it out next, with the survivor decided by
  the order the files arrived in. Lowercase is the habit that makes this go away,
  and [`docs/format.md`](docs/format.md) has the measurement.
- **Line endings are normalised by `.gitattributes`**, to LF in the repository,
  with `test/fixtures/**` deliberately exempt because those bytes are what those
  tests are testing. If a fresh clone shows you a tree full of modified files and
  no changes you made, that is a local `core.autocrlf` fighting `.gitattributes`
  rather than anything you did.

If a command in this file does not work on your platform, that is a bug in this
file. Say so in an issue and quote what you got.

[adr3-amend]: docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md
[adr6-amend]: docs/architecture/decisions/0006-one-cli-three-callers.md
