# 0090. A diagnostic says what the model knows, not what the disk says

## Context

Three diagnostics learned something from the model and reported it as a fact
about the disk. A `Model` holds what loaded, so "there is no table called
`customers`" is a thing it can say. "There is no `tables/customers.md`" is a
different sentence about a different thing, and the two disagree in exactly one
state: a file that is on disk and did not load. That state is what a rename
looks like half way through, which is the hour a person most needs the tool to
be exact.

Measured on 2026-09-08, driving the built CLI. `db-model/tables/customers.md`
holding one line of prose and no frontmatter, `db-model/tables/orders.md` with
`ref: customers.id` on a column:

```
$ dbmd check db-model
tables/customers.md
    error    no frontmatter: the file does not start with a `---` line (frontmatter-absent)

tables/orders.md
    error    `ref: customers.id` on column `customer_id` names no table; there is no tables/customers.md (ref-table-unknown)

db-model: 2 errors across 2 files.
exit 1
```

The file exists. It is 42 bytes. It is the heading four lines above the sentence
denying it, and the half a reader acts on is the false half: they go and write a
file that is already there.

`group-unknown` did the same thing from the reader, with `groups/billing.md`
present and unloadable, and `group-empty` did it inside out: a valid
`groups/billing.md` beside a `tables/orders.md` that carries `group: billing`
and is refused for a reason of its own produced

```
groups/billing.md
     warning  no table declares `group: billing`; an empty group is usually a rename that missed a file (group-empty)

tables/orders.md
  2  error    `kind: note` in a directory of tables; the directory decides, so this file is not loaded (kind-mismatch)
```

where both clauses are false and the advice points at a file on the screen.

**This is the same defect [ADR 0086](0086-a-diagnostic-says-whether-it-is-at-a-file-or-a-directory.md)
removed from the summary sentence**, one layer along. There it was a count that
called two directories two files; here it is a message that calls a file that is
there a file that is not.

**`src/model/validate.ts` already had the rule that answers this**, stated in
its own header since dbmd-12: *an incomplete object's absences are not evidence;
its presences are*. `indexColumns`, `primaryKey` and `refs` each honour it and
say nothing about a `complete: false` table, which was verified in the sweep
that found these three. The rule could not reach these cases. A file that
produced no object at all is invisible to a rule that walks `model.tables`, and
`emptyGroups` reads every table at once, so it was blind twice over.

## Decision

**A `Model` carries the object files that are on disk and are not objects in it.**
`Model.refused` is a sorted list of `RefusedFile`: the `kind`, the `name` the
object would have had, and the path. It holds a file the reader listed and did
not build, whatever stopped it: the file would not open, it is a directory
wearing an object's name, or its frontmatter said something the reader refuses.
Every one of them raised a diagnostic naming that same path in the same run.

**The three rules stand down for a path something is at**, and say what they
always said for a path nothing is at.

- `refs` says nothing about a ref into a refused table. That is the same move as
  `if (!target.complete) continue` three lines below it, reached from the other
  side: there the target lost a column, here it lost everything.
- The reader raises no `group-unknown` for a `group:` naming a refused group
  file, which is the rule it already applies to `_model.md`, where
  `unknown-kind-directory` stands down because `model-file-not-a-file` has
  named the same path and the fix.
- `emptyGroups` stands down for the whole model while any table is refused *or*
  incomplete. Membership is declared by the member, so its evidence is every
  table at once, and one table whose `group:` this process could not read is
  enough to make its conclusion a guess.

**Nothing is stat'd to find this out.** The reader knew the answer at the moment
it complained, because it had just listed the directory. ADR 0086 rejected a
second look at the filesystem for the neighbouring question and the argument is
the same one: a `stat` at validation time is a second source of truth racing the
read that produced the diagnostic.

### What was rejected, and why

**A second message for the broken case**, saying the file is there and did not
load. It is true, and it is a second sentence about one mistake, which is what
`validate.ts`'s header calls "how a check stops being read". The run already
carries the reader's error under that file's own name, and that error is both
the one to fix and the one that names the fix. A pointer at it adds a hop.

**A new diagnostic code, or two codes per rule.** Same objection, plus a code is
a public contract (ADR 0006) and this needs no new fact, only the absence of a
false one. The severity does not move either: in all three cases the run already
has the reader's error, so no exit code changes.

**Asking the filesystem from the validator.** Rejected above, and it is ADR
0086's rejection verbatim.

**Carrying the fact beside the model rather than on it**, as a second return
value of `readModel` passed into `validate`. `CanvasObject.complete` documents
where that ends: a fact carried separately is the thing that gets dropped
through the studio's HTTP layer, and the studio runs this validator on its own
copy of the model. On the model, it crosses the wire with everything else and
the page says the same thing the command line does.

**Scoping `group-empty`'s stand-down to something narrower.** There is nothing
to scope it to. A refused file's `group:` line is unread by definition, so any
one of them may be the missing member, and a rule that guessed which would be
the same defect wearing a smaller hat. The cost is stated below and it is real.

## Consequences

- **One broken table file silences every `group-empty` in the model** until it
  is fixed, and the run says which file to fix. That is the price of the
  rejection above and it is paid knowingly: a warning that is right most of the
  time and points away from the truth the rest of it is worse than none.
  `test/cli/check.test.ts` had a four-problem fixture whose broken file was a
  table, which is now a note, and the comment there says why.
- **`Model` gains a required field**, so every constructor of one says out loud
  that it refused nothing. That is `complete`'s argument and it is why the field
  is not optional: an importer builds tables out of a catalogue and refuses no
  files, and saying so is a sentence rather than a silence. Six constructors
  outside `src/model/` say `refused: []`; `src/import/delta.ts` carries the
  existing model's list across, as it already does with `body` and `complete`.
- **The wire carries it.** `WireModel` gains the field, passed through rather
  than translated, because it is already JSON-shaped. The page runs
  `validate` too and would otherwise print the sentence this record removes.
- **The JSON contract is unchanged.** No diagnostic payload's shape moves.
  Three codes are raised in fewer situations, all of them situations where they
  were false, and `schema` stays 1.

## Revisit when

- **A kind directory that cannot be listed is the same falsehood one level up.**
  `tables/` that will not open raises `file-unreadable` and leaves the model
  with no tables, so every `ref:` in the model is told there is no
  `tables/<name>.md`. Nothing here fixes that, because the names are exactly
  what an unlistable directory does not give up. The honest fix is a fact about
  the *directory* rather than about a file, and it is not written until
  somebody meets it.
- **Something wants to know why a file was refused, rather than that it was.**
  `RefusedFile` deliberately carries no code and no message: the diagnostic
  beside it has both, and a copy here would be a second place for them to be
  right in.
