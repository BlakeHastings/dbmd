# 0046. A key may say what the engine does, and the file still never tells it to

## Context

`ref: customers.id` says where a foreign key points and nothing at all about
what happens to this row when the row it points at is deleted. `ON DELETE
CASCADE`, `ON DELETE SET NULL` and `ON DELETE RESTRICT` are three different
promises about a child row, and the markdown could not tell them apart.

The wire already could. `ForeignKey.onDelete` and `ForeignKey.onUpdate` have
been in `src/import/contract.ts` since it was written, both providers populate
both, and both are asserted against fixtures captured from real databases. So
every import has been reading these two facts off a live catalogue and dropping
them on the floor.

That is the shape of gap dbmd-14 closed for `unique`, and it would be an
afternoon, except for what the key would say. A unique constraint is a fact
about what the data *is*. A referential action is a fact about what the engine
*does when something happens*, and ADR 0003's own consequence reads: "This is a
model, not a migration. dbmd describes what the schema should look like and does
not generate or apply DDL." Its appendix, written while the format was being
used by hand for the first time, deferred this key in as many words:

> `on delete` is a bigger question than a key. `on delete cascade` says what the
> database *does*, not what it looks like, and this record's own line, "this is a
> model, not a migration", is the thing that would have to be revisited to accept
> it. That is an ADR, not a field.

This is that record. The answer turns out to be short, and it is still worth
writing down, because the next key of this kind will cite it and the argument
should not have to be had again from the beginning by somebody with less time.

## Decision

**The format records referential actions, as `on delete:` and `on update:`
beside the `ref:` they are about. ADR 0003's line is not moved by it, because
the line was never where the deferral assumed.**

### The line is not at "behaviour", and reading it that way makes `default:` illegal

The tempting reading of "a model, not a migration" is that the file may describe
*structure* and never *behaviour*. That reading does not survive contact with
the format as it already is.

A `default:` and a nullability key are both in ADR 0003's own worked example,
spelled there `default: "'pending'"` and `null: false`. Five tables in
`examples/shop` carry a `timestamptz` column that is `nullable: false` with
`default: now()`. A default is not a shape. It is an expression the engine
*executes*, on an insert, when a column is not supplied. `nullable: false` is
not a shape either: it is a rejection the engine performs at write time, on rows
that do not exist yet. Both are behaviour by any test that makes
`on delete cascade` behaviour, both have been in the format from the first day
(dbmd-16 renamed `null:` to `nullable:`, which changed the spelling and not the
fact), and nobody has ever suggested they made dbmd a migration tool.

A rule that admits those two and refuses this one is not a rule. It is a
preference about which behaviour sounds frightening, and `cascade` sounds
frightening because of what it does to *rows*, not because of what it does to
dbmd.

So the line is somewhere else, and the honest place to put it is where the risk
actually is.

### Where the line is: dbmd writes facts down, it never writes statements out

**A key is on the safe side when carrying it is the whole of what dbmd does with
it.** The database is asked, a person reads and edits, the file is diffed in a
pull request. The arrow runs from a catalogue into the file and from a
developer's editor into the file. It never runs from the file into a database.

**A key is over the line when holding it obliges dbmd to produce something a
database will execute.** DDL, a migration, an order to apply changes in, a diff
between two models resolved into statements. That is a different product with a
different risk profile: it has to know an engine's dialect, the current state of
a live database, and what is safe to do to a table that already has rows in it,
and being wrong about the third one destroys somebody's data. ADR 0003 refused
it, and nothing here reopens it.

Recording that a constraint says `ON DELETE CASCADE` is a fact about the schema
in precisely the way that recording that a column is `not null` is a fact about
the schema. Neither obliges dbmd to do anything but write it down.

### The three questions the next key of this kind should ask

Whoever proposes the next key that describes engine behaviour, and there will be
one, should be able to answer these without inventing anything.

1. **Can a catalogue be asked for it?** If no engine can report it, the file
   would be the only place the fact exists, so there is nothing to round trip and
   nothing to check the file against. That is a different sort of key and it wants
   its own argument.
2. **Can dbmd carry it without interpreting it?** If holding it usefully means
   dbmd has to know what it *means*, by evaluating an expression, ordering
   operations or comparing two schemas, then the key is the visible end of a
   larger tool. `check` constraints are the live example: they are reported, but
   as opaque engine SQL, which makes them ADR 0022's question about carrying text
   dbmd cannot read rather than this one's.
3. **What is the sentence after "and then"?** If it is "and then a person reads
   it, and the next diff shows it changed", it is a key. If it is "and then we
   could emit the `ALTER TABLE`", stop: that is the product ADR 0003 refused, and
   the key was never the problem.

`on delete` answers all three. Recording it is the answer.

### `on update` is answered in the same breath, and the answer is also yes

The item that produced this record asked for `on update` to be decided here even
if the decision was that nobody uses it. It is the same fact about the same
constraint, reported by the same catalogue column, taking the same five values,
and every argument above applies to it unchanged.

Frequency is the only thing that separates them, and frequency is an argument
about a key's usefulness rather than about where the line is. It also cuts the
other way at the one place it is paid: both engines report `onUpdate` on every
constraint, so a format that could hold one clause and not the other would leave
every import dropping half of what it was already holding, and would invite this
same question a third time. Two keys, one vocabulary, one code path.

`examples/shop` has no `on update` anywhere, and that is the honest outcome
rather than an omission: none of its keys is ever updated, so writing the clause
would be putting a fact in an example that is not true of it. The key is
exercised by `docs/format.md`, by the tests, and by a real import, which is what
it is for.

### The vocabulary is closed, and it is the format's first

`no action`, `restrict`, `cascade`, `set null` and `set default`, spelled as SQL
spells them. Anything else is a `not-in-vocabulary` error and no action is
recorded.

That is the opposite of how a `type:` is treated, and the difference is the
point rather than an inconsistency. `docs/format.md` says dbmd does not check a
type against an engine, because the set of types belongs to the engine and the
day dbmd thinks it knows it is the day it is wrong about one. These five belong
to the SQL standard, are the same five in both catalogues, and are exactly the
five `ReferentialAction` in the introspection contract already carries. A sixth
is therefore not a spelling dbmd has not heard of. It is a fact that nothing
downstream could map, and carrying it would break the trip back through the
contract that is the only reason the key exists.

It is an error and not a warning for `superseded-key`'s reason: the author meant
something real, dbmd cannot hold it, and a warning would leave the object
complete, so the next save would write the file back with the line deleted.

**Absent is not `no action`.** No key means the file has not said; `no action`
means somebody said, and a real catalogue reports both. Defaulting one to the
other would be the reader guessing, which ADR 0008 exists to refuse, and it
would make an import's output disagree with the database it came from.

### What is deliberately not built: dbmd has no opinion on whether an action makes sense

`on delete: set null` on a `nullable: false` column is a database that fails at
the first delete. A check for that pair was written while this item was being
built, as a reader warning, and it was deleted before it landed. Two reasons,
and the second one is the record.

The first is evidence. `test/import/fixtures/postgres-provider-raw.json`, a
committed fixture that is this provider's own query printed by PostgreSQL 16.15,
carries a composite foreign key with `ON DELETE SET NULL` over two `NOT NULL`
columns, because Postgres accepts exactly that and only fails when a delete
arrives. The check's first act was to call a realistic catalogue wrong, and to
make the model an import writes stop reading back clean. ADR 0017's revisit list
names this outcome: a rule that fires on a correct model is too eager.

The second is that deciding whether a constraint would work is reasoning about
what an engine would do, which is the half of a migration tool that is
dangerous, arriving under a friendlier name. dbmd never applies the DDL, so it
never finds out whether it was right, and a confident warning about somebody's
real database is worse than silence. dbmd carries `type: banana` without a word
for the same reason, and this is that rule reaching a neighbour.

The distinction is worth stating plainly, because it is the one a future reader
will need: **checking that the file holds a fact the format can carry is a
question about the format. Checking that the fact is a good idea is a question
about the database, and dbmd does not answer those.**

### The spelling, and why it is on the column

Two keys on the column, beside the `ref:`, and not fields inside it. `ref:` is a
one-line scalar (`ref: invoices.id`) and turning it into a mapping to hold two
optional keys would rewrite every ref in every model that exists, for nothing: a
sibling key is one line, diffs on its own, and reads in the order SQL says it.

They are keys of the reference all the same, so `Ref` in `src/model/types.ts` is
where they live in memory. An action on a column with no `ref:` is about
nothing, and the reader raises `field-missing` rather than dropping the line,
which is an error and therefore a file the writer will not save over: exactly
what should happen to a file holding a fact the model does not.

The words are SQL's rather than the contract's `noAction` and `setNull`. That is
ADR 0022's asymmetry, stated there for an index key and true here for the same
reason: a wire format is written by a provider and a model file is written by a
person. `src/import/model.ts` holds the one mapping between them, as a
`Record` over both unions, so adding an action to either without adding it there
does not compile.

## Consequences

- **A clean import of a real schema now writes two more lines per referencing
  column.** Both catalogues report `NO ACTION` for a constraint whose DDL never
  mentioned a referential action, so most refs an import writes carry
  `on delete: no action` and `on update: no action`. That is noise in exchange
  for honesty, and it is the same trade `nullable` already made when ADR 0029
  chose to write it on every column including the key's. The alternative is dbmd
  deciding that some of the catalogue's answers are too boring to record, which
  is how a tool starts being wrong about the one database where it mattered.
- **The studio shows both keys**, as two selects that appear on a column once its
  `ref:` field holds a ref, with an "unsaid" option that is not `no action`. The
  alternative was carrying the fact invisibly through a patch, and a panel that
  holds a fact it does not show is a panel that deletes it the first time
  somebody retypes the ref, with the developer finding out from a diff. ADR 0016
  shows rather than refuses, and this is that.
- **A rename is a spread and not a rebuild.** `withRefsRetargeted` used to build
  `{ table: to, column: ref.column }`, which would silently drop an action from
  every ref into a renamed table. This class of bug arrives with every optional
  key a ref grows, and the fix is the one applied here: rebuild nothing that was
  not renamed.
- **The format now has a closed vocabulary, and should be slow to take a
  second.** The reason this one is safe is that the set is the standard's rather
  than an engine's. A key whose values vary by engine, or grow, must not be
  spelled this way: it would fail on the first database that had a sixth.
- **`check` constraints are still not this question.** They are opaque engine
  SQL, which is ADR 0022's, and the appendix to ADR 0003 that filed them beside
  `on delete` was wrong to pair them. This record separates the two: a
  referential action is a closed vocabulary dbmd can read, and a check
  constraint is text it cannot.
- **`isUniqueConstraint` is not reopened, and the dbmd-19 section of ADR 0003,
  which called it "the same question as the `on delete` gap named above", is
  corrected by this.** It is not the same question. A unique index and a unique
  constraint are the same fact about the rows under two names, so nothing in the
  model or in a diff changes when you learn which one it was; `cascade` and
  `restrict` are different things happening to real rows. The first is a fact
  about how a schema was *written*, and the second is a fact about what the
  schema *is*.

## Revisit when

- **Somebody proposes a key whose value dbmd would have to evaluate rather than
  carry.** That is question 2 above failing, and it is the signal that what is
  being asked for is a bigger tool wearing a key's clothes.
- **Somebody asks dbmd to emit DDL, a migration or a schema diff.** Then this
  record is not the one to revisit: ADR 0003 is, and this one only says that
  none of the keys added under it moved that decision an inch.
- **A referential action turns out not to be five values in some engine dbmd
  grows a provider for.** Then the closed vocabulary above is wrong in the way
  this record says a closed vocabulary can be wrong, and the way out is the
  contract's, not the format's.
- **The `no action` lines an import writes are observed to be read as noise**,
  by somebody skipping a real `cascade` because it sat in a wall of `no action`.
  That is the anticipated cost arriving, and the answer would be an import
  option rather than a rule about which facts are worth writing.
