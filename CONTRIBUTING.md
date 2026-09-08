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

You need [Node](https://nodejs.org) 22 or later, npm, and git. Nothing else: no
database, no Docker, no global installs. CI builds and tests on Node 22 **and**
Node 24 on Linux for every pull request, so both ends of the supported range are
exercised rather than promised, and this is developed on Node 24 on Windows.
[ADR 0032](docs/architecture/decisions/0032-what-ci-builds-on-and-what-the-package-promises.md)
is why 22 is the floor and why the matrix has two entries rather than one.

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

### Pointing at the page instead of describing it

```bash
npm run studio:dev
```

The same studio, with a feedback toolbar in the bottom-right corner. Click it to
activate, then click anything on the page, write a sentence, and copy: it gives
you markdown naming the element and its selector, which is what an agent needs
to find the code you mean. It takes the same arguments as `npm run studio`, so
`npm run studio:dev -- --no-open` and `npm run studio:dev -- ../my-model` both
work.

**For an annotation to reach an agent rather than only your clipboard, the
companion server has to be running:** `agentation-mcp server` listens on
`http://127.0.0.1:4747`, keeps the annotations, and offers them over MCP.
`npm run studio:dev` posts to that address and says on startup whether anything
answered:

```
dbmd studio  http://127.0.0.1:57818/
  model      examples/shop
  overlay    agentation 3.0.2, from .studio-dev, which never ships
  annotate   http://127.0.0.1:4747, which answered
  read back  npm run annotations
```

If that last line says it is not answering, `agentation-mcp doctor` is what
checks the setup. Nothing breaks either way: with no server the toolbar still
annotates, still copies markdown and still keeps everything in the browser.
Point it somewhere else with `DBMD_AGENTATION_ENDPOINT`, or set that to an empty
string for clipboard only.

### Reading the feedback back, and answering it

```bash
npm run annotations
```

What you wrote on the page, as text an agent can act on: the sentence, the
element, and the selector that names it. It reads the studio the last
`npm run studio:dev` opened, because the studio takes whatever port is free and
the annotation store on this machine is shared with everything else you have
ever annotated. The summary line says how many sessions it left out, so an empty
answer is never ambiguous. `npm run annotations -- --all` reads all of them, and
`npm run annotations -- --url http://127.0.0.1:57818/` reads a page you name.

With no server it says so and exits zero, for the reason above: the annotations
are still in your browser and nothing is wrong.

Answering is the other half, and it is what stops the toolbar's thread looking
broken:

```bash
npm run annotations -- --acknowledge <id>
npm run annotations -- --reply <id> "which of the two boxes do you mean?"
npm run annotations -- --resolve <id> "made it the same height as orders"
```

Those change what you see in the toolbar, so a reply is a question you can
answer without leaving the page. There is no dismiss, on purpose:
[ADR 0070](docs/architecture/decisions/0070-the-reading-half-answers-as-well-as-reads.md)
is which of the server's nine tools are here and why the rest are not.

Registering the MCP server with your agent is a separate step and a decision
about your machine rather than about this repository, so nothing here does it
for you. `agentation-mcp init` is the wizard, and nothing above needs it: the
script talks to the server over HTTP without being registered anywhere.

The toolbar is [`agentation`](https://www.npmjs.com/package/agentation), it is a
devDependency, and **it never ships**. It is built from its own entry point into
`.studio-dev/`, which is outside `dist/` and so outside what `npm pack` carries;
the released bundle has no import path to it, and `npm run check` fails if any
of it reaches the tarball.
[ADR 0064](docs/architecture/decisions/0064-the-feedback-overlay-is-a-second-entry-point.md)
is the arrangement and the guard. Its licence is PolyForm Shield, which is not
an open source licence; that is fine for a package nobody distributes, and it is
why nobody distributes this one.

Stop it with Ctrl-C, the same way and for the same reason as `npm run studio`.

## The one command you have to remember

```bash
npm run check
```

Typecheck, format check, decision-record numbering, the reviewable-diff check,
the check that every command named here exists, tests, a build, and a smoke test
over the packed tarball, in that order. It is
the only mechanical gate, and it is exactly what CI runs, so green here and
green there mean the same thing. There is no second list of things to remember.

CI runs it twice, on Node 22 and on Node 24, and your local run covers whichever
of those you are on. So a failure that only one leg of that matrix shows is a
real failure and not a flake, and the run page names the version.

The last one packs the package, installs it into a temporary directory outside
this repository and runs the installed `dbmd`. It takes about six seconds and it
is the only thing here that looks at what a user would actually get;
[ADR 0024](docs/architecture/decisions/0024-the-tarball-is-what-ships.md) says
why that is worth six seconds on every run.

**`npm run check` is not `dbmd check`.** They are a keystroke apart and you will
meet both. This one is this repository's gate over this repository's source.
`dbmd check` is a command the tool ships, and it reads somebody's model
directory and reports what is wrong with it; `dbmd check --help` is the whole
story on that one.

**A command you write in backticks has to exist.** `dbmd query` was named by
four error messages, a documentation page, a decision record and `AGENTS.md`
before anybody wrote it, and every reference agreed with every other, so there
was nothing to notice. `npm run check:commands` resolves every `dbmd <command>`,
`npm run <script>`, `node scripts/<file>` and bare `scripts/<file>` written
inside backticks anywhere in the tree. Prose is not read at all, so "dbmd reads
the model" is none of its business, and a bare path counts only where it begins
the code, so naming a file in the middle of a sentence is still free. If you mean
something that does not exist yet, say so on the line you wrote it:

```
A future `dbmd fmt` will tidy a whole directory. <!-- hypothetical: dbmd fmt -->
```

[ADR 0036](docs/architecture/decisions/0036-a-command-in-backticks-is-a-claim-that-it-exists.md)
says why that marker is written rather than guessed at, and why decision records
are not scanned.

**A command that exists has to be in `README.md`.** The same check reads the
registry the other way: adding a command to `src/cli/main.ts` and stopping there
turns the build red, naming the command. An entry is a paragraph under "The
commands" opening with the command in bold code, saying what it does and showing
real output, the way the entries beside it do. `dbmd import` shipped over a
README still calling the import path unfinished, and `dbmd query` shipped under
a heading counting five while the CLI had six, which is why the heading no
longer counts anything.
[ADR 0043](docs/architecture/decisions/0043-a-command-owes-the-readme-an-entry.md)
says why `README.md` is the only file this applies to.

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
Branches are named for what changed rather than for the item, because beads ids
are short random suffixes with no number to take. `docs/process/working-an-issue.md`
has the detail.

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

## Releasing

Releases are cut by the owner and by nobody else. `npm publish` is not run by
hand, and it does not happen on a merge:
[`.github/workflows/release.yml`](.github/workflows/release.yml) publishes when a
tag matching `v*` is pushed, and the npm token it uses is a repository secret
that nothing on a pull request can read. The job refuses a tag whose version
disagrees with `package.json`, and a tag on a commit that is not on `main`, so
the sequence is the ordinary one: land the version bump through a pull request
like any other change, then tag the commit it landed as.

**If you are an agent working an issue, you do not push tags and you do not
publish**, for the same reason you do not merge.
[ADR 0051](docs/architecture/decisions/0051-the-first-release-is-a-tag-a-person-pushes.md)
is the argument, and it is also where the version number was chosen.

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
