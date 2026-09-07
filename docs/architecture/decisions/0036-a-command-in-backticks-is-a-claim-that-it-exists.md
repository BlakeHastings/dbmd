# 0036. A command in backticks is a claim that it exists

## Context

`dbmd query` was named by four error messages in `src/import/contract.ts`, by
the opening line of `docs/import-format.md`, by ADR 0007 and by `AGENTS.md`. It
did not exist. The CLI answered `unknown command "query"`, which meant the
headline path of this tool, introspect a database and turn what comes back into
a model, could not be run end to end by anybody who followed the documentation.

It survived because every reference agreed with every other one. There was
nothing inconsistent for a reader to notice and nothing for a grep to find. The
only way to notice was to type the command, and everybody who wrote about it had
read the same page rather than run it. It was found by accident, weeks late.

dbmd-7nb wrote the command. A hand sweep afterwards checked every `npm run`,
every `scripts/*.mjs` and every `dbmd` subcommand named anywhere in the tree and
found no second instance. That sweep is the thing worth keeping, because nothing
repeated it, and the defect it was looking for is by construction one that
review does not catch: a wrong reference looks exactly like a right one.

Two things make a mechanical version of it harder than it sounds.

**Prose is full of things shaped like commands.** The hand sweep matched `dbmd
describes`, `dbmd reads`, `dbmd can`, `dbmd never`, `dbmd will`. Thirty-odd
distinct words follow `dbmd` in this tree and six of them are commands. A check
that reads prose has to tell a command from a verb, and there is no honest rule
for that.

**Some references are correct and unreal on purpose.** "A future `dbmd fmt`
will want this" and "that is a `dbmd fix` command" are both true statements
about work not done. Three such sentences exist on `main`. A check that fails
them is a check that gets turned off.

## Decision

**A command written inside backticks is read as a claim that it exists, and the
claim is checked. Prose is not read at all.**

`scripts/check-commands.mjs` runs in `npm run check`, beside `check:adr` and
`check:reviewable`. It resolves three shapes of reference:

| Written                | Resolved against               |
| ---------------------- | ------------------------------ |
| `dbmd <command>`       | the `COMMANDS` array in `src/cli/main.ts` |
| `npm run <script>`     | `scripts` in `package.json`    |
| `node scripts/<file>`  | the filesystem                 |

**The check is inverted, and that is what makes it small.** It never asks
whether a piece of prose is about a command. It takes a reference the author
already marked as code and asks whether it resolves against a list that is
small, closed and generated. `npx dbmd`, `npx --yes dbmd@0.1.0` and
`node dist/cli.js` are the same claim written three other ways and all three are
in this tree, so all three are read.

**The checker is scanned by itself, and that is the first thing it caught.** Its
header explains the false positives it exists to avoid, and it named them in
backticks, so it failed on its own prose the moment it was committed. They are
written bare now, which is the convention explaining itself: prose is prose, and
a claim is a claim.

**A backtick is the marker, because this repository already writes one.** It
costs a writer nothing that they were not already paying: every real reference
on `main` is already in backticks, and every false positive the hand sweep hit
is prose that is not. The signal was there before the check was.

**The bare word `dbmd` has to begin the code, and nothing else does.** `dbmd` is
also the name of this project, so example output inside a fenced block says
"this build of dbmd reads version 1" and a `.prettierignore` comment says
"# dbmd model files". Requiring the bare form to start a code span or a line
inside a fence settles both without looking at the word after it. `npm run`,
`npx dbmd` and `node scripts/` name a runner, nobody writes them by accident,
and they are read wherever they appear.

**A reference that does not exist yet is marked by the author, in one line:**

```
<!-- hypothetical: dbmd fmt -->
```

The marker is the word `hypothetical:` and the reference. Whatever comments it
is the file's own business, so a markdown page writes the HTML comment above and
`src/model/write.ts` writes `hypothetical: dbmd fmt` in the doc comment it was
already in. It holds for the file it is written in.

**The marker is checked in both directions.** It fails when the thing it excuses
starts existing, and it fails when the reference it excuses goes away. The first
half is the one worth having: on the day somebody writes `dbmd fmt`, the build
names every page that has been talking about it in the future tense.

**`docs/architecture/decisions/` is not scanned.** A record says what was true
when it was decided and this repository never edits one. Failing a build over a
record that names something since renamed would be asking an author to falsify
history, and a check that cannot tell a stale record from a stale instruction
should not be pointed at records. This is written here rather than left as a
quiet line in a script, because it is a real hole: ADR 0007 was one of the seven
places that named `dbmd query`, and this check would not have found it.

`.beads/` is not scanned either, for the opposite reason: an item that names a
command that does not exist yet is an item doing its job.

`test/guards/` is the third and it is the interesting one. That directory holds
this check's own fixtures: a page naming `dbmd fmt`, an `npm run bogus`, a
marker for a command that does exist. Every one of them is a case the check
refuses, which is the point of writing them down, and scanning them is asking
the check to fail on the evidence that it works. `guard-merge.mjs` shipped with
the same false positive and it fired within seconds: a comment quoting the
blocked command was refused, so recording that the guard worked was the first
thing it would not allow. Writing about the thing is not doing the thing.

### Inferring the hypothetical was considered and rejected

The alternative is to read the words around the reference: "future", "would",
"will want", "does not exist yet". It costs a writer nothing, which is its whole
appeal.

It was rejected because it guesses at intent and it is wrong in both directions
on the day it is wrong. "A future release will make `dbmd chekc` faster" is
excused by the word `future` and is a typo. "`dbmd fmt` normalises a directory"
is failed for having no hedge in it, and the author's fix is to add a word to a
sentence that did not want one. An explicit marker is a sentence the author
writes on purpose, and it can be read back later and disagreed with. An inferred
one cannot.

### The cost, stated plainly

**A writer who means a command that does not exist has to say so.** That is one
line, and it is the only cost. Three sentences on `main` needed one.

**A writer who did not know the convention gets a red build.** The failure names
the file, the line and the marker to write, which is the difference between a
rule you learn once and a rule you resent.

## Consequences

- **`npm run check` grows about 0.2s**, measured at 0.16s. It reads 161 tracked
  files once. There
  is no build and no network in it, which is why it sits with the other cheap
  checks rather than after the build.
- **A reference this check does not understand passes.** It reads three shapes,
  not every way a command can be spelled. A reference inside a fenced YAML block
  that is not at the start of its line, for instance, is found only when it names
  a runner. The check is a floor rather than a proof, and the sweep in
  `docs/process/handoff.md` is what it replaces rather than what it equals.
- **The command list is derived, not copied.** `cliCommands()` reads the
  `COMMANDS` array in `src/cli/main.ts` and each command module's `name`. A
  second hand-written list of commands inside the checker would be exactly the
  kind of fact that can silently disagree with the truth, which is the defect
  this record is about. The cost is that the check parses TypeScript with regular
  expressions, and it throws with a sentence naming what it could not read rather
  than quietly finding no commands.
- **`src/` is scanned as well as `docs/`.** Four of the seven places that named
  `dbmd query` were error strings, so a check that read only the documentation
  would have missed most of the thing it exists for.
- **It is broken on purpose in `test/guards/broken-on-purpose.test.ts`**, which
  ADR 0034 requires of any guard added to `scripts/`.

## Revisit when

- **A hypothetical marker outlives two waves.** A marker is a promise to write
  something. If `dbmd fmt` is still marked in six months, the honest move is to
  delete the sentences rather than keep excusing them.
- **A reference is found that this check cannot see.** That is the case worth
  writing down rather than fixing quietly: it says which shape to add, and the
  list above is meant to grow from evidence rather than from imagination.
- **`docs/architecture/decisions/` starts carrying instructions.** The exclusion
  is safe only while a record is history. A record that tells somebody what to
  run is an instruction in the wrong file, and the fix is to move it rather than
  to scan records.
- **The CLI stops declaring its commands in one array.** `cliCommands()` reads a
  shape rather than an interface. If `src/cli/main.ts` is restructured, this
  check throws rather than passing empty, but the reader of that failure should
  come here.
