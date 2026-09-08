# 0093. A model directory refuses a name a clone could not keep

## Context

`dbmd import` writes one file per table into a flat `tables/` directory
([ADR 0003](0003-markdown-on-disk-is-the-model.md)), so two tables whose names produce one
path cannot both be written. `src/import/model.ts` has had a check for that
since [ADR 0029](0029-what-an-import-writes-and-what-it-drops.md): the first
table in the document's order is kept, the second is dropped, and
`import/name-collision` says which was which and why.

The check compared names with `Map.get(table.name)`, which is case-sensitive,
and the filesystem it was protecting is not. On Windows and on macOS
`tables/Orders.md` and `tables/orders.md` are one file. So a payload holding
`public.Orders` and `public.orders`, which is two tables in PostgreSQL and which
the introspection query reports separately on purpose, went through the check
untouched and through the writer twice. Driven on Windows, on 2026-09-08:

```
Imported 2 tables from postgres into db-model, 3 files:
  _model.md
  tables/Orders.md
  tables/orders.md
```

Exit 0, one file on disk, one table gone, and a reader told about a file that is
not there. The check that exists to stop exactly this could not fire on the one
platform where the loss happens.

The comparison has to change. What it changes to is the decision, because the
right answer is not the same on every machine:

- On **Windows and macOS** the two tables are one file and one of them is lost.
- On **Linux** they are two files, both are written, both are read back, and the
  current behaviour is correct.

A model directory is committed and cloned. The same directory is on the owner's
laptop, on a colleague's, and in CI, and CI here runs on Linux.

## Decision

**Names are folded before they are compared, on every platform, and a pair that
collides folded is refused everywhere.** `public.Orders` and `public.orders` are
an `import/name-collision` on Linux exactly as they are on Windows, and the same
table is the one kept, because the document is sorted before any of this
happens.

Three reasons, in the order they carried the argument:

**The output of a pure function should not depend on the disk under it.**
`modelFromIntrospection` is a pure function over a document, deliberately
(ADR 0029), and `dbmd import` is a command whose output is meant to be
deterministic ([ADR 0006](0006-one-cli-three-callers.md)). A platform test
inside it would make the same payload produce two different model directories
and two different exit codes depending on who ran it, which is a thing nobody
can reason about and CI on Linux could never see.

**The artefact is a repository, not a directory on this machine.** Permitting a
pair that works here writes a `db-model/` that fails on the next `git clone` on
a colleague's Mac, where one of the two files quietly wins the checkout. The
loss is the same loss, moved to somebody who did not run the import and has no
diagnostic to read. Refusing here refuses it once, in front of the person
holding the export.

**A refusal is recoverable and a silent loss is not.** The reader is told, in a
message naming both tables, and the file that was written. Somebody who really
does want two tables that differ only in case has two model directories
available and a decision to make; somebody who did not notice has lost a table
and does not know.

The folding is `String.prototype.toLowerCase`, not `toLocaleLowerCase`: the
second folds by the machine's locale, and a Turkish laptop would answer
differently from CI about `I` and `i`. This is a decision about a directory both
of them clone.

**The contract's own comparison is unchanged.** `import/duplicate` in
`src/import/contract.ts` still compares `schema.name` byte for byte, so a
document holding `public.Orders` and `public.orders` is a document about two
tables, which is what the database says it is. Folding is a fact about
filesystems and it belongs where the filenames are decided, not where the
catalogue is read.

**The message says which of the two collisions it is**, because the sentence
that fits one does not fit the other. The existing wording is kept for two
schemas holding one name, and its advice, to import one schema at a time, is
kept with it. A case-only pair gets its own: the reader on Linux has two
perfectly good file names in front of them and has to be told that the machine
this model is cloned onto has one, and "import one schema at a time" is no
advice at all for two tables that are already in one schema, which is the shape
this arrives in.

**Every message names the file that was written**, and no other. This is the
half of the defect that was wrong on every platform: the report listed
`tables/Orders.md` and `tables/orders.md` when one of them did not exist. The
list a report prints comes from what the writer wrote, so refusing the second
table fixes that list, and the collision message now names the kept table's path
rather than the dropped table's, which for two schemas holding one name is the
same string it always was.

## Consequences

- **A payload that imported on Linux and lost a table on Windows now fails on
  both**, with an error and a non-zero exit. That is a behaviour change for
  Linux, and it is the point: the previous behaviour was correct about the
  machine and wrong about the artefact.
- **A pair of tables differing only in case cannot be imported into one model
  directory at all.** dbmd has nowhere to put the second one. The way out is
  subdirectories under `tables/`, which ADR 0003 already names and ADR 0029
  already lists as the revisit for the same code.
- **No test in this repository is conditional on the platform**, which is what
  the alternative would have cost: a fix that behaved differently per
  filesystem would need both behaviours pinned, and one of the two legs would
  only ever run on a developer's machine.
- **Two normalisations are not covered**, and both are deliberate. Unicode
  normal form, where a macOS checkout can hold `é` as one code point or two, is
  a second fold and nobody has hit it here. And trailing dots and spaces, which
  Windows strips from a filename, are `isFileName`'s business rather than this
  comparison's. Neither is pretended at: this folds case, and says so.

## Revisit when

- **Somebody has two tables differing only in case that both belong in one
  model.** That is the evidence for subdirectories under `tables/`, and it is
  the same evidence ADR 0029 asks for about two schemas.
- **A name collides after a Unicode normalisation but not after a case fold.**
  Then this comparison grows a second step, and the argument above is already
  the argument for it: the question is what a clone can hold, not what this
  machine can.
- **A model directory stops being a thing that is cloned.** The whole of the
  reasoning above rests on that, and nothing else in this project makes sense
  without it either.
