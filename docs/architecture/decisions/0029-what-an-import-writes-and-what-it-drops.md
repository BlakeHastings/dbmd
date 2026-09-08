# 0029. What an import writes, and what it drops

## Context

`dbmd import` is the last unbuilt piece of the original product and it is the
first thing a real team will run. Everything under it was decided somewhere
else: ADR 0007 made an engine a provider and the pasted file self-describing,
ADR 0009 put a native and a normalised name on every column type, ADR 0022 said
where engine SQL may stand, ADR 0012 said a scaffold goes through the writer,
ADR 0026 said a name the writer cannot write is a skip, and ADR 0003 and its
appendices decided the format itself.

What none of them decided is the join: **what a row of a database catalogue
becomes in a markdown file.** That is a set of small decisions, most of which
look like details until you notice that every one of them is visible in the
first `git diff` every user of this tool will ever read. The canonical
introspection document holds strictly more than a model file can, so the join is
not a translation. It is a series of choices about what to keep, what to put
back together, what to drop, and which of the drops is bad enough to be a
diagnostic.

Three of them are decisions rather than details, and the rest follow one rule.

## Decision

### A column's type is the engine's own name with the modifier put back on

`type: character varying(32)`, not `type: string` and not `type: varchar(32)`.

The normalised vocabulary is not written, anywhere. It exists so that code can
switch on a type without knowing the engine, and ADR 0009 says in as many words
that it loses information on the first column of the first import anybody runs:
`timestamp with time zone` and `timestamp without time zone` are one word there,
and which one a column is is usually the most consequential fact about it. A
model file is read by a person who is holding it against a real database, and
`string` is not a type any engine has.

Nothing is tidied either. `character varying` is not shortened to `varchar` and
`((0))` keeps its parentheses, for the reason `docs/import-format.md` already
gives about expressions: dbmd never executes any of it, so a rewrite is a guess
that is safe for one case and not in general. The first thing every user sees is
the diff of their first import, and it should be their catalogue.

**The modifier is put back because `native` does not carry it.** ADR 0009 keeps
`nvarchar` and `length: 32` apart so a provider has one fewer way to be
inconsistent, so writing `native` alone would make `varchar(32)` and
`varchar(255)` the same three words in a file whose whole job is to be diffed.
It goes on the end, mechanically: `length`, else `precision` and `scale`, else a
bare `scale`, which is a fractional-seconds precision.

That rule has one known wart, and it is named here rather than discovered.
Postgres spells an explicit fractional-seconds precision `timestamp(3) with time
zone` and this writes `timestamp with time zone(3)`. Putting it in the right
place means either reading inside `native`, which is ADR 0009's own revisit
condition and the thing that field's shape exists to prevent, or knowing that
Postgres does that and SQL Server does not, which is engine knowledge and ADR
0007 keeps engine knowledge inside `src/import/providers/`. **The way out, when
somebody wants it, is a `formatType(type: ColumnType): string` method on
`EngineProvider`**, which is exactly the move ADR 0007's revisit section
sanctions and which puts the spelling where the spelling belongs. It is not
taken now because it changes an interface, two providers proven against live
databases and their fixtures, to fix a string that is unambiguous and only
appears on a column somebody explicitly declared a precision on.

### The prose body is one line, and it is a prompt

```markdown
Imported from `public.orders`, and nobody has written down what it is for yet.
```

An import could plausibly write a paragraph per table out of what it knows: the
row count of the key, the columns that are foreign keys, what an index is over.
Every one of those sentences is already in the frontmatter directly above it, so
the paragraph would say nothing, and it would say nothing *in the place where
the only thing this format has that a diagram does not is supposed to be*. A
reader who finds filler there once stops reading that part of the file, and the
paragraph somebody did write is then invisible. **One line that says nobody has
done the work is worth more than five that pretend somebody has.**

Two things are carried rather than generated:

- **A table comment is the author's own words** and goes in the body verbatim,
  with the import line after it. Somebody wrote that sentence about their table;
  it is exactly the material this format is for and dropping it would be the
  same mistake in the other direction.
- **The schema is in that line**, because `tables/` is flat (ADR 0003) and the
  line is otherwise the last place `public.` or `dbo.` exists.

`_model.md` gets the same treatment one level up: where it came from, and a
short paragraph asking for the two or three facts about the business that
explain the shape. No timestamps anywhere, in that file or any other, because
ADR 0006 rule 4 makes a generated file change only when the model does.

### The layout is a grid, and it is the studio's grid

Tables go at `(40 + n mod 5 × 300, 40 + ⌊n / 5⌋ × 260)`, in name order. There is
no auto layout in this version and the developer arranges the boxes once.

The numbers are `src/studio/client/place.ts`'s, deliberately. That module
already answers "where does a table with no coordinates go" for the canvas, and
an import that chose differently would move every box the first time somebody
opened the studio on what it wrote. They are copied rather than imported because
`place.ts` is browser code and ADR 0011 keeps the two runtimes apart; four
numbers across that seam is a smaller wrong than a Node module importing the
bundle. **The way out is a shared module of layout constants**, and the signal
that it is needed is somebody changing one of the two and not the other.

Name order rather than the document's schema-then-name order, because
`readModel` sorts tables by name and the grid should agree with what the page
will draw.

### One rule for everything else: a loss is documented, an incoherence is diagnosed

The canonical document says more than a model file can hold, and the difference
divides cleanly.

**What the format cannot hold is dropped, and named in `docs/format.md` under
what the format does not have.** Check constraints, an index's `INCLUDE` list, a
filtered index's predicate, `isUniqueConstraint`, `isClustered`, a key column's
direction, a column's identity, generated expression, collation and comment, the
name of a foreign key, and the fact that two refs are one composite constraint.
None of these is a surprise and none of them is a diagnostic: a warning per
dropped fact would put a dozen lines on a clean import of a real schema, would
be identical on every run, and would teach the reader to skip the output.
This follows the appendix to ADR 0003, which decided exactly this for
`isUniqueConstraint` and said the loss belongs in `docs/format.md`.

**What would leave a model that lies is a diagnostic naming the table.** There
are three, and they are the codes this record adds to `ImportDiagnosticCode`:

- **`import/reference-not-exported`**, a warning. A foreign key whose referenced
  table is not in the file is a partial export rather than a broken model, and
  it is common and legitimate: somebody imported one schema. The ref is *not*
  written. Writing it would put a `ref-table-unknown` error in the user's first
  `dbmd check`, blaming them at the moment they have done nothing wrong, and
  ADR 0008's line about diagnosing rather than guessing cuts the other way here:
  the guess would be that the missing table is coming later.
- **`import/name-collision`**, an error. `tables/` is flat, so `dbo.Order` and
  `sales.Order` are one file. The first in the document's order is kept and the
  second is reported. Writing both would leave whichever went last, in a
  directory that reads as complete, which is the quietest way this command could
  lose a table.
- **`import/unsafe-name`**, an error. ADR 0026 gave `unsafe-name` no diagnostic
  code and said why: a *reader* can never raise one, because the filesystem
  refuses such a name before dbmd is involved, so no model on disk can contain
  one. It also named the caller that can. A database catalogue has no such rule,
  and dbmd-44 imported a table called `Ledger [Entry]` while looking for exactly
  this. The report is the `WriteSkip`, translated: the writer is the one thing
  that knows what it can write, and asking it rather than predicting it is what
  stops the two answers drifting.

A ref *is* asked about before the write, with the same `isFileName` the writer
uses, so that a ref never points at a table that will have no file. That is a
decision and not a second report: there is one message per unwritable table and
it comes from the skip.

### The parse belongs to the command, and it names truncation

A provider is handed a value and never the characters, so it cannot own its own
most likely failure, which is a paste that stopped early. `src/cli/import.ts` is
the call site that has the text, so a `JSON.parse` that throws is reported there
with truncation named as the usual cause.

It names it **without knowing the engine**, and that is the constraint that
shapes the sentence. dbmd has not chosen a provider at that point and could only
guess at one from the characters, which would put an engine's name outside
`src/import/providers/` and break ADR 0007's seam over a heuristic. So the
message points at the comment block on top of the query the user ran, which is
where the engine-specific reason already lives. `sqlserver.ts` explains the
2033-character split there, three times over, on purpose, and this points at it
rather than repeating one engine's version of it. That stays true for the engines that do not exist
yet.

A byte-order mark on the front is stripped first, because more than one client's
"save the result" leaves one and `JSON.parse` reports it as a problem at
position 0 with no mention of a character nobody can see.

### It refuses a directory that is not empty, and the refusal names dbmd-42

Re-importing over a model without losing the prose and the layout somebody put
there is a separate item, and it is separate because the merge rules are a
conversation rather than a derivation. Until it exists this command refuses, and
the message says **dbmd-42** by name, because "not built yet" and "not allowed"
call for completely different next actions and a user cannot tell them apart
from a refusal alone.

The check happens before anything is read, so nobody pastes a schema and is then
told it was never going to be written.

## Consequences

- **A composite foreign key becomes two refs and two warnings.** ADR 0003
  declares a relationship on the referring column and has no registry, so a
  two-column foreign key is two `ref:` lines. `dbmd check` then says
  `ref-target-not-unique` about each, correctly: neither column identifies one
  row, and the format has no way to say that the pair does. It is a warning, so
  the run is still green, but it is warning noise on every import of a schema
  that has one, and `--strict` fails on it. The honest answers are a composite
  ref in the format or a validator that understands a pair, and both are items
  rather than a line in this one.
- **A model imported from a database checks clean of errors and not of
  warnings.** `primary-key-missing` on a table that really has no primary key is
  the tool working. Nothing here suppresses a warning that is true.
- **`nullable:` is written on every column, including the key's**, where it is
  implied. The catalogue reported it and the format can hold it, and leaving it
  off would be dbmd deciding which facts are obvious enough not to write down.
- **The three new diagnostic codes are public API** from this commit, per ADR
  0006, and are documented in `docs/import-format.md` beside the contract's own.
- **`docs/format.md` grows two entries under what the format does not have** and
  gains the sentence that an import writes the engine's spelling.
- **There is no `--strict` on this command**, and no `--force`. The first has
  nothing to promote that matters yet; the second is dbmd-42 wearing a disguise.

## Revisit when

- **Somebody wants the normalised type in the file.** That is a second key
  rather than a replacement, and the argument for it is a consumer that wants to
  reason about a model without knowing the engine, which is the studio's
  argument, not a user's, and the studio has the import contract available to it.
- **The `timestamp with time zone(3)` wart shows up in a real diff.** Then
  `EngineProvider` grows `formatType`, and this record's paragraph about it is
  the design.
- **A composite foreign key's warnings annoy somebody enough to file it.** That
  is the evidence that the format needs a composite ref, and it is a bigger
  change than it looks: the studio draws one edge per ref.
- **An import is asked to write into a directory that already has a model.**
  That is dbmd-42, and this record's refusal is the placeholder it replaces.
- **Two schemas with the same table name stops being rare.** `import/name-collision`
  is a report about a limitation rather than about the user, and the way out is
  subdirectories under `tables/`, which ADR 0003 already names.

## Two revisit entries have fired: the refusal is replaced, and the warnings are gone

Appended rather than edited, because everything decided here about what an
import writes is unchanged, including the one-line prompt body, the engine's own
spelling of a type, and the grid. Two conditions under **Revisit when** describe
work that has since happened, and one consequence stopped being true along with
one of them.

**"An import is asked to write into a directory that already has a model."** That
was dbmd-42, and it landed on 2026-09-07 in #119 as
[ADR 0050](0050-a-re-import-is-a-delta-somebody-confirmed.md). The refusal this
record calls a placeholder has been replaced, so the paragraph above headed "It
refuses a directory that is not empty" reads as history: a re-import now computes
a delta, itemises it, and writes nothing until somebody has confirmed it with
`--confirm`. The message that named dbmd-42 by name, so a user could tell "not
built yet" from "not allowed", did the job it was written for and is gone with
the refusal. The last consequence above is spent with it: there is a `--confirm`
now, and it is the thing this record called "dbmd-42 wearing a disguise" arriving
with the conversation it was waiting for rather than as a flag.

**"A composite foreign key's warnings annoy somebody enough to file it."** They
did, and the answer went the other way from the one predicted here. This entry
says the annoyance is evidence that the format needs a composite ref.
[ADR 0033](0033-a-composite-foreign-key-is-judged-as-a-set.md) weighed that
against a validator that reads the refs into one target table as a set, and took
the validator: the format does not change, `ref-target-not-unique` now asks
whether the whole key a column sits in is referenced from this table, and a
covering pair is silent. So the prediction in this entry is wrong, and it is left
standing because the reasoning that produced it is the reasoning ADR 0033 had to
answer, and answering it is most of that record.

**The consequence above, "a composite foreign key becomes two refs and two
warnings", is half wrong from ADR 0033 onwards.** It is still two refs, because
this record is right that the format has no way to write one constraint. It is
no longer two warnings when the pair covers a whole key of the target, which is
the case the paragraph was written about, and `dbmd check --strict` no longer
fails a freshly imported model for it. The two honest answers that paragraph
named, a composite ref in the format or a validator that understands a pair, are
still the two answers; the second one was taken.

**The rest of the list was read at the same time and none of it has fired.**
Nobody has asked for the normalised type in the file. The
`timestamp with time zone(3)` wart has not shown up in a real diff, so
`EngineProvider` still has no `formatType`. Two schemas with the same table name
is still rare, and `tables/` is still flat.

## The grid paragraph is superseded by 0075, and the five is the only part that goes

Appended rather than edited, because the paragraph corrected below is the
argument ADR 0075 had to answer and it should still be readable as it was
argued. The agent that wrote 0075 left this alone deliberately, because this
directory was held by the sweep of the revisit lists; this is that sweep picking
it up rather than a second opinion about the layout.

**What is superseded is one number.** The section above headed *The layout is a
grid, and it is the studio's grid* says tables go at
`(40 + n mod 5 x 300, 40 + floor(n / 5) x 260)`.
[ADR 0075](0075-the-grid-is-shaped-like-the-window-and-a-fit-that-cannot-fit-says-so.md)
replaces the five with a width derived from the count and aimed at the window's
shape, so four tables land two wide, sixteen land five wide, a hundred land
twelve wide and six hundred land thirty wide.

**Everything else in that paragraph holds and is worth saying so.** Name order,
because `readModel` sorts by name and the grid should agree with what the page
draws. The studio's own pitches, 300 and 260, unchanged. The copy across the
browser seam rather than an import of the bundle, for the reason ADR 0011 gives.
And no auto layout: 0075 turns the choice of width into arithmetic on a count
and changes nothing about a position being the developer's to arrange once.

**Why the five was wrong is not that it was five.** It is that it was fixed while
the thing it had to suit was not. Nothing had ever pointed this command at more
than eight tables when the number was chosen, and at eight tables five is fine.
The measurement that overturned it is in 0075 and in `docs/process/verified.md`
and is not restated here.

**The way out this paragraph names has not been taken and its signal has not
fired.** The paragraph says the way out is a shared module of layout constants,
and that the signal it is needed is "somebody changing one of the two and not the
other". The two were changed together: `src/import/model.ts` and
`src/studio/client/place.ts` both gained `columnsFor`, and
`test/import/model.test.ts` imports both and drives them against each other at
thirteen sizes, so drifting apart is a red test rather than a picture that moves
the first time somebody opens the studio on an import. So this is a duplicated
function now rather than four duplicated numbers, which is more to keep in step
and is held in step by something rather than by memory. ADR 0075 carries the
trigger for taking the way out: a third copy.

**No revisit entry of this record has fired with 0075**, which was checked at the
same time. Nobody has asked for the normalised type in the file, the
`timestamp with time zone(3)` wart has not appeared in a real diff, two schemas
with the same table name is still rare, and the two entries that had already
fired are recorded in the section above this one.
