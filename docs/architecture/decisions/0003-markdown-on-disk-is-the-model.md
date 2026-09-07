# 0003. One markdown file per table, and it is the model

## Context

The premise of this tool is that a team's database model belongs in their
repository, reviewable in a pull request, rather than in a hosted diagram that
drifts from the schema and from the code. Everything about the format follows
from what a pull request needs, which is not the same as what a diagram editor
needs.

Four requirements, in the order they bind:

1. **A one-column change is a one-line diff.** If it is not, review stops
   happening, and the format has failed at the only thing it was for.
2. **Layout noise must not read as a schema change.** Somebody dragging boxes to
   tidy a diagram must not produce a diff that looks like a migration.
3. **A hand edit must be as good as a studio edit.** Half the value is that a
   developer can fix a type in their editor without launching anything.
4. **The prose survives.** The *why* behind a table is the part no database
   introspection can recover, and it is why this is markdown rather than JSON.

The reference tool this came from stores the model in a hosted database and
treats documentation as a field. Reversing both is the whole point.

## Decision

**One markdown file per table**, under `db-model/` by default:

```
db-model/
  _model.md          model-wide facts: name, engine, and prose about the whole
  orders.md
  customers.md
  order_items.md
```

Each file is YAML frontmatter followed by free markdown:

```markdown
---
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    null: false
    ref: customers.id
  - name: status
    type: text
    null: false
    default: "'pending'"
indexes:
  - name: orders_customer_status_idx
    columns: [customer_id, status]
layout: { x: 480, y: 120 }
---

One row per customer order. Rows are never deleted: a cancelled order keeps its
row with `status = 'cancelled'` so the finance export stays reproducible.
```

Four decisions inside that, each answering one requirement above:

**A file per table, not one file for the model.** Requirement 1. Two developers
editing different tables do not conflict, and a table's history is `git log` on
one path. The cost is that the model is a directory rather than a document, and
`_model.md` exists so there is still one place for what is true of all of it.

**A relationship is declared on the foreign key column, as `ref: table.column`.**
There is no relationship registry. A registry is a second place to forget, and
its diff shows a change nowhere near the column that changed. The cost is that
the reverse direction has to be computed, which is a load-time index and not a
format problem.

**Layout lives in the table's own frontmatter.** Requirement 2, and it is the
choice that will look wrong at a glance. A side-car layout file keeps schema
diffs perfectly clean but makes moving one box touch a file shared by everyone,
which is the conflict this format exists to avoid. In frontmatter, moving three
boxes touches exactly the three files whose boxes moved, and `git diff` shows a
single `layout:` line per file. A reviewer learns to skip that line in a week.

**The prose body is preserved byte for byte.** Requirement 4. The studio parses
frontmatter and treats everything after it as an opaque string. It is never
reflowed, never reformatted, never round-tripped through a markdown AST.

## Consequences

- **Canonical serialisation is load-bearing and must be tested, not assumed.**
  The studio writes frontmatter in a fixed key order with fixed quoting, so a
  hand-written file normalises once and then produces no diff on later saves.
  The invariant to hold in code is `serialise(parse(f)) === f` for any canonical
  file, and `parse(serialise(m))` deep-equal `m` for any model. The item that
  builds the parser owns those tests; until it lands, this paragraph describes
  an intention and not a property of this repository.
- **YAML brings YAML's traps.** `null: false` is a key named `null`, and a
  default of `'pending'` needs quoting to survive as SQL text rather than
  becoming the string `pending`. The parser rejects ambiguity loudly instead of
  guessing, because a silently-wrong default is worse than a failed parse.
- **This is a model, not a migration.** dbmd describes what the schema should
  look like and does not generate or apply DDL. Anything claiming otherwise is
  a bigger product with a different risk profile.
- Table files are flat, so two schemas with a table of the same name collide.
  Accepted for the MVP; a `schema:` key and subdirectories are the way out and
  the format leaves room for both.

## Revisit when

- **A single-table diff stops being readable**, most likely because column
  definitions grew past a line each. That is the signal the format is drifting
  toward a serialisation rather than a document.
- **Somebody wants two schemas, or two databases, in one repository.** Flat
  files answer neither.
- **Layout in frontmatter is observed causing a real review problem**, rather
  than an anticipated one. Then the side-car returns, with the conflict cost
  accepted knowingly.

## Extended by 0005, on the same day

Appended rather than edited, because the reasoning that turned out to be
incomplete is still worth reading.

This record assumed the only thing on the canvas was a table, and the owner named
sticky notes and grouping boxes on the day it was written. ADR 0005 extends the
format to hold them, and two things above are superseded by it:

- **Table files move to `db-model/tables/`.** The layout in this record is flat;
  0005 puts a directory per kind under the model root and requires a `kind:` key
  in every file as a cross-check.
- **"Table files are flat, so two schemas collide" is unchanged as a limitation**
  but the way out has moved: it is now a subdirectory question inside
  `tables/` rather than at the model root.

Everything else here stands, and 0005 is built on it rather than around it. In
particular, membership in a group is declared by the member for exactly the
reason a relationship is declared by the foreign key column: a registry is a
shared file, and a shared file is a merge conflict.

## Amended by dbmd-14 and dbmd-16, once the format had been written by hand

Appended rather than edited, because one of the two paragraphs corrected below
was the reasoning for a trap that no longer exists, and the reasoning is still
worth reading.

Both changes came out of writing `examples/shop` by hand (dbmd-61). Neither is a
new pattern. They are two keys, decided together because they are in the same
files and the example had to be migrated once rather than twice.

### `null:` is now `nullable:`

The "YAML brings YAML's traps" bullet above says a key named `null` needs care
because a parser hands it back as the null value rather than as four characters.
All of that was true. It was also self-inflicted: nothing about YAML forced the
key to be called `null`, and the reader's own field has been called `nullable`
since the day it was written. **The name a reader chose for itself, without being
asked, is the honest evidence of what the key should have been called.**

`nullable: false` needs no special case, no paragraph, and no `NULL_KEY`
constant. `required: true` was the other candidate and reads the way people
speak, but it inverts the sense against SQL's `NOT NULL`, against `is_nullable`
in both engines' catalogues, and against `Column.nullable` in
`src/import/contract.ts`, so every trip between a database and a file would be a
negation somebody has to get right. The rename is the change that makes the
markdown key and the introspection field the same word.

The claim that `null: false` mirrored SQL does not survive being looked at. SQL
says `NOT NULL`. `null: false` mirrors nothing except the decision to spell it
that way.

**`null:` is an error, not an alias.** A `superseded-key` diagnostic names
`nullable`, and no nullability is loaded from the retired key. It is an error
rather than a warning because the file states a fact the model would then not
hold, and an object that loaded incompletely is one the writer refuses to write
(ADR 0010): a warning would leave the object complete and the next save would put
the file back with the constraint deleted. There is no alias period, because
there is nothing yet to be compatible with.

### `unique:` goes on an index entry and never on a column

An index entry takes `unique: true`. It was previously unsayable anywhere, so
four indexes in `examples/shop` recorded their uniqueness in a prose sentence,
which is precisely the failure the fourth requirement above exists to prevent.

A single-column shorthand on the column itself was considered and refused. It is
how every hand-author expects to say it, and it is how SQL says it, and it still
loses: **a unique constraint has a name, and that name is what the engine prints
when the constraint fires.** `duplicate key value violates unique constraint
"customers_email_key"` is the string an operator greps for, and a column has
nowhere to put it. A shorthand would either invent the name on the way out or
drop it, and both are worse than one more line. The second reason is the one this
record already gives for having no relationship registry: two places to write the
same fact are two places to forget it, plus a contradiction between a column's
`unique: true` and an index over the same column that nobody can adjudicate.

The cost is real and it is paid where it should be. A hand-author who writes
`unique: true` on a column gets the same `superseded-key` diagnostic, naming the
`indexes:` entry to write and the column to put in it. That is the whole
mitigation, and it is a branch in the reader rather than a second spelling in the
format.

`unique` also makes the validator rule dbmd-12 already planned mean something. A
`ref` whose target is neither a primary key nor unique could never be anything
but noise while nothing could declare a target unique.

### Two neighbouring gaps, named here so they are not found a third time

`check` constraints and `on delete` behaviour on a `ref` were found by the same
agent at the same time and are deliberately **not** decided here.

A `check` constraint is engine-native SQL that dbmd can carry but cannot read,
render or compare, which makes it the same question as dbmd-18's expression
indexes rather than a neighbour of `unique`. Both want one answer about opaque
engine text in the markdown, and answering them in two places is how a format
ends up with two conventions for the same thing.

`on delete` is a bigger question than a key. `on delete cascade` says what the
database *does*, not what it looks like, and this record's own line, "this is a
model, not a migration", is the thing that would have to be revisited to accept
it. That is an ADR, not a field.

### What did not change

The canonical spelling of an index entry is `name`, `columns`, `unique`, and
`unique` is absent rather than `false` on a plain index, for the same reason an
empty list is no key. `examples/shop` is now byte-canonical: reading it and
writing it back produces no diff at all.

## Not amended by dbmd-19, and why, so it is not asked a third time

Appended because the section above appears to settle a question it does not, and
the next reader would file it again.

That section says the `nullable:` rename "makes the markdown key and the
introspection field the same word". `src/import/contract.ts` calls uniqueness
`Index.isUnique`, and the markdown key added in the same pull request is
`unique`, so the same reasoning applied to the same diff looks like it produced
two answers. It did not. Neither key moves.

**The argument that settled `nullable` was about polarity, not spelling.**
`required: true` lost because it inverts the sense against `NOT NULL`, against
`is_nullable` in both catalogues and against `Column.nullable`, so every trip
between a database and a file would have been a negation somebody has to get
right. The same word was the result of choosing correctly, not the reason.
`unique` and `isUnique` already share a polarity, so mapping one to the other is
a rename a compiler checks and never a negation a person can get backwards.
There is nothing here of the kind that argument was about.

Three things follow, and they are worth as much as the sentence:

- **The contract is a wire format and a model file is written by a person.**
  ADR 0022 made exactly this asymmetry deliberate for an index key, where the
  markdown's `columns: [email]` is the contract's `{ column: 'email' }`, and
  gave the reason: an unlabelled string is a bug in a document a machine writes
  and the obvious spelling in one a person writes. `isUnique` reads as a boolean
  accessor because it is one, and a frontmatter key should not.
- **The contract would have to move as a set or not at all.** It also has
  `Index.isClustered`, `Index.isUniqueConstraint` and `PrimaryKey.isClustered`,
  so renaming only the field the item names leaves the wire format with two
  spellings for its own booleans: the same entropy, relocated. Renaming all four
  also rewrites the SQL Server query, which aliases `i.is_unique AS isUnique`,
  and a query's proof is a run against a real database (ADR 0007) rather than a
  fixture.
- **It would buy nothing at the one place it is paid.** dbmd-41 maps two
  contract fields onto one markdown key, so the mapping is a decision whichever
  spelling is used. Identical words would have made it *look* like a rename
  while still being a decision, which is worse than the mismatch.

### What an import writes, decided here so it is not decided twice

`unique: true` when `isUnique` is true, and no key at all when it is false,
which is the canonical spelling this record already fixed.

**`isUniqueConstraint` is dropped, and the format keeps no room for it.** A
unique constraint and a unique index are different objects in both engines, and
dbmd-44 confirmed SQL Server reports them apart. The difference is in how the
uniqueness was *declared*, not in what is true of the rows, which makes it the
same question as the `on delete` gap named above and it gets the same answer:
the line "this is a model, not a migration" is the thing that would have to be
revisited to carry it. Nothing in dbmd reads it either. The validator's
`ref-target-not-unique` asks only whether something makes the column unique, so
the key would be a fact written, diffed and reviewed by people in exchange for
nothing at all that reads it.

The cost is real and is named in `docs/format.md` under what the format does not
have: a model imported from a database cannot tell you whether dropping an index
would drop a constraint with it. If somebody wants it, the way out is a second
key on the index entry, never a second meaning for `unique`.
