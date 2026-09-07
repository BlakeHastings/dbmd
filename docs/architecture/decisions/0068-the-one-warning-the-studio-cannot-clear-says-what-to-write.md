# 0068. The one warning the studio cannot clear says what to write

## Context

**Start the studio on an empty directory and you reach a warning the studio
cannot clear.** Measured on 2026-09-07 against a build of this branch's parent,
by driving it rather than reading it:

| step | result |
| --- | --- |
| `dbmd studio db-model` on an empty directory | starts, serves a model with 0 tables |
| the diagnostic it serves | `model-file-missing`, "no `_model.md`, so the model has no name and no engine" |
| `POST /api/table` | 201, writes `tables/first_table.md` |
| the model afterwards | 1 table, `name: null`, same warning |
| `dbmd check db-model` afterwards | 1 warning across 1 file, exit 0 |

**Starting on an empty directory is good behaviour and is not what this record
changes.** A person can build a model from nothing and that path works. Refusing
to start would be a worse tool.

### The asymmetry

`KIND_ENDPOINTS` in `src/studio/server.ts` has exactly three entries, and
nothing under `src/studio/` writes the model file. So the studio can create
tables, notes and groups, and cannot create `_model.md`. It is the one thing it
warns about that it cannot repair, which is what makes the warning read as a
dead end rather than as a note.

### And the message broke the house style

Every other refusal in this tool says what to do next. A missing directory names
the directory. A file where a directory should be says which file. An unknown
engine lists the engines this build knows. A table with no refs says so and
names the file it looked in. Empty standard input says to run the introspection
query first.

`no _model.md, so the model has no name and no engine` said what was missing and
not what to do about it. It is also the message a first run is most likely to
meet, and it is served in two places: `dbmd check` prints it, and the studio
renders `diagnostic.message` verbatim into its footer list.

### The obvious advice is wrong, and that is the finding

The natural sentence to add is "run `dbmd init`". Measured, in the state above:

```
dbmd: db-model already exists and is not empty, so init has left it alone.
Empty it, move it aside, or give init a different directory.
```

`init` writes into an empty directory only. The moment the studio has written
one table, the command that would have helped refuses, so a diagnostic naming it
would send the reader who most needs help to a refusal. `init` also scaffolds an
example model of two tables and a note, which is not what somebody with a model
already wants.

Writing the file works in both states, and it is three keys.

### The larger answer, and why not now

Letting the studio write `_model.md`, through a fourth `KIND_ENDPOINTS` entry or
a model-level panel with a name and an engine, is a feature. It touches the wire
contract, the inspector and the patch parsers, and `_model.md` is not an object
with a name and a position the way the other three are, so it does not fit the
kind shape it would be bolted onto. Nothing measured says people start this way
often enough to pay that. The README documents `dbmd init` first, which makes
this the undocumented order rather than the broken one.

## Decision

**`model-file-missing` names the file to write, not the command to run.**

```
no _model.md, so the model has no name and no engine; add one with `kind: model`, a `name:` and an `engine:`
```

The clause after the semicolon follows the shape already used by
`object-in-subdirectory` and `kind-not-a-directory`: what happened, a semicolon,
what to do. It names `kind: model` on purpose, which `docs/format.md` calls the
first thing everybody gets wrong.

**The advice is a test rather than a sentence.** `test/model/read.test.ts`
writes exactly the three keys the message asks for and asserts the model reads
with no diagnostics at all, so advice that stops working turns red instead of
sitting on the page.

**`docs/format.md` says why `dbmd init` is not the answer here**, in the row and
in the `_model.md` section, because the row is where somebody looks the code up
and the section is where somebody is already reading.

## Consequences

- **The text changes for `dbmd check` too**, which is where most people meet it.
  That was the argument for the change rather than against it: `check` is the
  larger audience, and it had the same missing sentence.
- **The studio still cannot write `_model.md`.** This record does not close that
  gap, it makes the gap survivable by naming a fix the reader can carry out in
  an editor. Anybody who expected the warning to gain a button will not find one.
- **The message is longer**, and it is served into a footer list in the studio
  that has no width to spare. It is still shorter than
  `object-in-subdirectory`, which that list already carries.
- **One more sentence to keep true.** A `_model.md` that stopped needing
  `kind: model`, or an `engine:` key that was renamed, would make the message
  wrong. The test above is what notices.
- **`docs/format.md` now states a fact about `dbmd init` in a page about the
  file format.** That is a small leak of command behaviour into a format
  reference, taken because the wrong advice is the advice a reader would have
  invented for themselves.

## Revisit when

- **Somebody starts on an empty directory often enough to count.** That is the
  evidence that would settle the larger answer, and it does not exist yet.
  Concretely: reports of people reaching a named model through the studio alone,
  or a first-run flow that does not begin at `dbmd init`. Until then the
  measured cost of the feature outweighs a case nobody has been seen in.
- **`dbmd init` learns to write only the missing pieces** into a directory that
  already has some. Then naming the command becomes right advice, and this
  message should name it.
- **The studio gains a model-level panel** for anything at all, a description or
  a default engine. The name and the engine belong in it the day it exists, and
  the fourth-kind objection above does not apply to a panel.
- **A second diagnostic turns out to be unfixable from the studio.** One is an
  asymmetry worth a sentence. Two would be a pattern, and the answer would
  probably be for the studio to say which of its warnings it cannot act on
  rather than for each message to carry its own repair.
