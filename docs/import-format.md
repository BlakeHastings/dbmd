# The introspection format

`dbmd import` never connects to a database. It reads a JSON file that a human
produced by running `dbmd query --engine X` themselves and pasting the result
back. This file describes that JSON: what the file must say about itself, what
the canonical shape underneath it is, and what a person writing the third engine
provider has to do.

If you are adding an engine, read this and then
`docs/architecture/decisions/0007-engines-are-providers.md`, which is why the
seam is shaped this way. The contract was written with the Postgres and the SQL
Server catalogs open at the same time, on purpose, and every rule below that
looks arbitrary is a rule one of the two engines forced.

## The path a file takes

```
the pasted file
  -> readEnvelope()                two keys, and nothing else is understood yet
  -> resolveProvider()             the registry picks the engine by name
  -> provider.parse()              engine-shaped JSON to canonical
  -> validateIntrospectionDocument()  normalise, sort, and complain with a path
  -> a canonical IntrospectionDocument
```

`readIntrospection(raw, options)` in `src/import/read.ts` is that whole path in
one call, and it is the only entry point `dbmd import` needs.

Every stage returns the same thing: either a value, or a list of diagnostics.
Diagnostics carry a `code` a program reads, a `message` a person reads, a
`severity`, and an `at` saying where in the document the problem is. Import
diagnostics are always `at: { in: 'document', jsonPath: '$.tables[3].columns[1]
.name' }`, and never carry a line, because the input is a JSON value dbmd was
handed rather than a file dbmd read. The model reader raises the same type with
`at: { in: 'file', path, line }`, and ADR 0014 says why there is one type and
what a consumer does with the difference. They sort deterministically before
anything prints them, as everything emitted here does. ADR 0006.

## The envelope

Two keys, at the top of the file, and they are the only part of it that means
anything before dbmd knows which engine wrote it.

```json
{ "dbmdIntrospection": 1, "engine": "postgres", "tables": [] }
```

`dbmdIntrospection` is the format version, a whole number. This build reads
version 1 and refuses anything else, in both directions, with a message naming
both numbers:

```
error $.dbmdIntrospection [import/unsupported-version] this file says `dbmdIntrospection` 0 and this build of dbmd reads version 1; it was produced by an older dbmd, so re-run `dbmd query` with this one and import the file it prints
error $.dbmdIntrospection [import/unsupported-version] this file says `dbmdIntrospection` 7 and this build of dbmd reads version 1; it was produced by a newer dbmd, so upgrade dbmd or re-run `dbmd query` with this one
```

`engine` is a provider id: lower case, no spaces, permanent once shipped, since
it appears in files users keep. It is how `dbmd import` avoids a `--engine` flag
and avoids being told the wrong engine. Something the registry does not know
gets a message naming what it does know:

```
error $.engine [import/unknown-engine] no provider claims the engine 'mysql', and this build knows postgres, sqlserver
```

`--engine` exists to override the file, and using it is never silent:

```
warning $.engine [import/engine-overridden] this file says it came from 'postgres' and --engine says 'sqlserver', so it is being read as 'sqlserver'
```

**Everything else in the file belongs to the provider.** The engine's query emits
whatever is natural for that engine, in that engine's spelling, and the provider
is the only thing that reads it. In particular a raw file's `tables` is not the
canonical `tables`: they share a name and nothing else. Normalisation is
TypeScript rather than SQL, and ADR 0007 says why.

## The canonical document

What `parse` produces and what the rest of dbmd consumes. The envelope is carried
through, so a canonical document is still self-describing.

```
IntrospectionDocument
  dbmdIntrospection  number         required
  engine             string         required, the provider id
  source             SourceInfo     optional
  tables             Table[]        required, sorted by schema then name
```

```
SourceInfo
  database           string         optional
  engineVersion      string         optional, free text as the engine reports it
  defaultCollation   string         optional
```

`defaultCollation` is how a file says whether its identifiers are case sensitive
without the contract taking a position on it. See "Case" below.

```
Table
  schema             string         required, never empty
  name               string         required
  comment            string         optional
  columns            Column[]       required, in catalog order
  primaryKey         PrimaryKey     optional
  indexes            Index[]        required, may be empty, sorted by name
  foreignKeys        ForeignKey[]   required, may be empty, sorted
  checkConstraints   CheckConstraint[]  required, may be empty, sorted
```

```
Column
  name               string         required
  type               ColumnType     required
  nullable           boolean        required
  default            ColumnDefault  optional
  identity           Identity       optional
  generated          GeneratedColumn optional
  collation          string         optional
  comment            string         optional
```

```
ColumnType
  native             string         required, the engine's own name with no modifier
  normalised         NormalisedType required, from the closed list below
  length             number | "max" optional
  precision          number         optional
  scale              number         optional
```

```
NormalisedType is exactly one of:
  string boolean integer decimal float date time timestamp interval
  uuid binary json xml other
```

```
ColumnDefault           Identity                  GeneratedColumn
  expression  string      generation  always|byDefault   expression  string
  constraintName string?   seed        number?           persisted   boolean
                           increment   number?
```

```
PrimaryKey                        ForeignKey
  name         string?              name                string?
  columns      string[]  ordered    columns             string[]  ordered
  isClustered  boolean?             referencedSchema    string    required
                                    referencedTable     string    required
                                    referencedColumns   string[]  ordered
                                    onDelete            action?
                                    onUpdate            action?

action is one of: noAction restrict cascade setNull setDefault
```

```
Index                                 IndexColumn        CheckConstraint
  name               string             name  string       name        string?
  columns            IndexColumn[]      descending bool?   expression  string
  includedColumns    string[]?
  isUnique           boolean
  isClustered        boolean?
  filterExpression   string?
  isUniqueConstraint boolean?
```

The index that backs the primary key is not repeated in `indexes`. The primary
key is the modelling truth and one fact belongs in one place. An index backing a
`UNIQUE` constraint does appear, with `isUniqueConstraint` true, because dropping
it means dropping the constraint and that is worth being able to see.

## Rules that apply everywhere

**Null and absent are the same thing.** SQL Server's `FOR JSON` omits null
columns unless it is asked not to, so the same query emits a key on one row and
no key at all on the next. The validator treats `null` exactly as a missing key,
and an absent list becomes an empty one. Nothing in a canonical document is ever
`null`.

**Composite is the ordinary case.** Primary keys, foreign keys and index keys are
ordered lists of column names. A one-column key is a list of one. There is no
singular form, because a contract with both would grow a bug where they disagree.
A foreign key's `columns` and `referencedColumns` are paired by position and must
be the same length, and a file where they are not gets
`import/mismatched-columns`.

**Expressions are verbatim.** `default.expression`, `generated.expression`,
`checkConstraints[].expression` and `filterExpression` are the engine's own text,
unmodified. SQL Server really does report `((0))` for a default of zero, and this
contract keeps the parentheses. dbmd describes a schema and never generates DDL,
so the string is only ever displayed, and unwrapping it is a guess that is safe
for `((0))` and not safe in general. A provider that wants to tidy them should
argue for it as a change to this document rather than doing it quietly, because
the first thing every user sees is the diff of their first import.

**The native type is kept beside the normalised one.** Both are required. ADR
0009 is the argument. `native` carries no modifier: `nvarchar` rather than
`nvarchar(32)`, `numeric` rather than `numeric(12,2)`, because the modifier is in
`length`, `precision` and `scale` and one fact belongs in one place.

**Length is in characters.** SQL Server's `sys.columns.max_length` counts bytes,
so `nvarchar(32)` reports 64 there and a provider halves it before it reaches
here. Binary types keep bytes, because that is what they are measured in. The
string `"max"` is the only non-numeric value, and it exists because
`nvarchar(max)`, `varchar(max)` and `varbinary(max)` all report `max_length` as
-1. A raw -1 is rejected, since it is what an untranslated file looks like.

**Precision and scale only where a person chose them.** Both engines report a
precision for every numeric type, so `bigint` arrives as precision 64 in Postgres
and 19 in SQL Server. That is true and useless. Carry precision and scale for
decimals, and scale for the temporal types that have fractional seconds, and drop
the rest.

**Case.** Identifiers are carried exactly as the catalog reports them, and are
compared byte for byte. Postgres folds unquoted identifiers to lower case, so
`Orders` created unquoted is really `orders`. SQL Server is case insensitive by
collation, so two tables differing only in case usually cannot both exist. The
contract takes neither position: it does not lower-case anything, and it does not
treat `Orders` and `orders` as a duplicate. `source.defaultCollation` is where a
file says which world it came from.

**Order.** Tables sort by schema then name, and indexes, foreign keys and check
constraints sort by name, all by code unit rather than by locale. Columns keep
catalog order, and so do the column lists inside a key or an index, because there
the order is data. The same file therefore produces the same bytes on any machine,
whatever order the engine happened to return its rows in. ADR 0006.

**A field nothing reads is a warning, not an error.** It is dropped, and the
warning names it. Rejecting the file instead would make every additive change to
the format a breaking one.

## A worked example

The SQL Server fixture in `test/import/fixtures/sqlserver-raw.json` contains,
among other things, this column, in the shape `FOR JSON PATH` produces:

```json
{
  "name": "Code",
  "type": "nvarchar",
  "maxLength": 64,
  "precision": 0,
  "scale": 0,
  "isNullable": false,
  "isIdentity": false,
  "collationName": "SQL_Latin1_General_CP1_CI_AS",
  "description": "Human-facing order reference."
}
```

and the provider turns it into:

```json
{
  "name": "Code",
  "type": { "native": "nvarchar", "normalised": "string", "length": 32 },
  "nullable": false,
  "collation": "SQL_Latin1_General_CP1_CI_AS",
  "comment": "Human-facing order reference."
}
```

64 became 32 because `sys.columns` counts bytes. `precision` and `scale` were
dropped because SQL Server reports 0 for both on every string type and nobody
wrote them down. `isIdentity: false` disappeared rather than becoming
`"identity": false`, because absence is how this contract says no.

A whole table, with the composite key, the multi-column foreign key across
schemas, the included column and the filtered index:

```json
{
  "schema": "sales",
  "name": "OrderLine",
  "columns": [
    { "name": "OrderId", "type": { "native": "bigint", "normalised": "integer" }, "nullable": false },
    { "name": "LineNo", "type": { "native": "int", "normalised": "integer" }, "nullable": false },
    { "name": "TenantId", "type": { "native": "int", "normalised": "integer" }, "nullable": false },
    { "name": "OrderCode", "type": { "native": "nvarchar", "normalised": "string", "length": 32 }, "nullable": false, "collation": "Latin1_General_BIN2" },
    {
      "name": "Quantity",
      "type": { "native": "int", "normalised": "integer" },
      "nullable": false,
      "default": { "expression": "((0))", "constraintName": "DF_OrderLine_Quantity" }
    },
    { "name": "UnitPrice", "type": { "native": "decimal", "normalised": "decimal", "precision": 12, "scale": 2 }, "nullable": false },
    {
      "name": "LineTotal",
      "type": { "native": "decimal", "normalised": "decimal", "precision": 12, "scale": 2 },
      "nullable": false,
      "generated": { "expression": "([Quantity]*[UnitPrice])", "persisted": true }
    },
    { "name": "Notes", "type": { "native": "nvarchar", "normalised": "string", "length": "max" }, "nullable": true, "collation": "SQL_Latin1_General_CP1_CI_AS" }
  ],
  "primaryKey": { "name": "PK_OrderLine", "columns": ["OrderId", "LineNo"], "isClustered": true },
  "indexes": [
    {
      "name": "IX_OrderLine_Open",
      "columns": [{ "name": "OrderId" }, { "name": "LineNo", "descending": true }],
      "includedColumns": ["Quantity"],
      "isUnique": false,
      "isClustered": false,
      "filterExpression": "([Quantity]>(0))"
    }
  ],
  "foreignKeys": [
    {
      "name": "FK_OrderLine_Order",
      "columns": ["TenantId", "OrderCode"],
      "referencedSchema": "dbo",
      "referencedTable": "Order",
      "referencedColumns": ["TenantId", "Code"],
      "onDelete": "cascade",
      "onUpdate": "noAction"
    },
    {
      "name": "FK_OrderLine_OrderId",
      "columns": ["OrderId"],
      "referencedSchema": "dbo",
      "referencedTable": "Order",
      "referencedColumns": ["Id"],
      "onDelete": "noAction",
      "onUpdate": "noAction"
    }
  ],
  "checkConstraints": []
}
```

`test/import/fixtures/postgres-raw.json` is the same logical schema in Postgres
spelling, and the canonical documents differ only where the engines do: the
names, the native types, `restrict` on a foreign key that SQL Server could not
express, and no `isClustered` anywhere.

## What is in here only because of SQL Server

Worth knowing, if you are wondering whether a rule is design or accident:

- `length: "max"`, and the rule that -1 is not it
- the rule that length is characters, which only bites where the engine counts
  bytes
- `default.constraintName`, since Postgres has no name to give
- `generated.persisted`, since Postgres generated columns are always stored
- `isClustered`, on both a primary key and an index
- `identity.seed` and `identity.increment`
- the rule that null and absent are the same, which is `FOR JSON` behaviour
- `schema` being required and never empty, because `dbo` is a schema name and not
  the absence of one
- `setDefault` being an ordinary referential action rather than an oddity

And, the other way round, `restrict` and `interval` are in the contract because
Postgres has them and SQL Server does not. The shape is the union of what the two
engines can say. It is not the intersection, and it is not Postgres with room
bolted on the side.

## What is deliberately not in here

Not oversights. A provider that needs one of these should say so, and ADR 0007's
revisit condition covers adding it.

- **Views, sequences, routines and user-defined types.** dbmd models tables.
- **The index access method** (`btree`, `gin`, columnstore). It is physical, it
  has no cross-engine meaning, and nothing in the model would read it.
- **Whether a constraint is trusted, enabled or validated.** Postgres `NOT VALID`
  and SQL Server `is_not_trusted` are close but not the same, and mapping them
  onto one field would be a claim neither engine makes.
- **Enum members.** A Postgres enum type normalises to `other` and keeps its type
  name in `native`. Carrying the members is a real gap and a fair thing to ask
  for.
- **Three-part names.** A table is a schema and a name. Cross-database references
  are a SQL Server feature this does not model.
- **Row counts, sizes and anything else that changes without the schema
  changing.** A model file that changes when nothing was edited is worse than
  useless.

## Writing a provider

One file in `src/import/providers/`, and one line in `src/import/providers/index.ts`.
Nothing else in the codebase learns your engine's name, and an `if (engine === ...)`
anywhere outside that directory means this seam is in the wrong place.

```ts
interface EngineProvider {
  id: string
  displayName: string
  introspectionQuery(): string
  parse(raw: unknown): ParseResult
  normaliseType(native: string): NormalisedType
  quoteIdentifier(name: string): string
}
```

- `introspectionQuery` returns **one statement** that a person can paste into
  whatever client they already trust, and that returns one JSON value in the
  envelope shape. It is going to be run against production by somebody who wants
  to satisfy themselves by reading it that it cannot write, so it is read more
  often than it is executed.
- `parse` is pure: no I/O, no clock, no database. That is what lets your provider
  be developed and tested against a committed fixture by somebody who has never
  run your engine. It is also the honest limit: a fixture proves the
  normalisation and never the query, so a pull request that changes the SQL has
  to say whether it was run against a real instance of that engine.
- `parse` does not have to validate what it builds. `readIntrospection` puts the
  result through the contract validator, so a mistake surfaces as a diagnostic
  with a path on it rather than as a crash somewhere downstream. It also does not
  have to sort anything, for the same reason.
- `normaliseType` returns a member of the closed vocabulary. Return `other`
  rather than guessing: `native` is still there, and a wrong normalisation is
  worse than an honest `other`.
- `quoteIdentifier` escapes the engine's own quote character. `"` doubles for
  Postgres, `]` doubles for SQL Server.

`test/import/fake-providers.ts` holds two test doubles, one shaped like each
engine, with no SQL in either. They exist so the registry, the envelope dispatch
and this contract can be exercised without a real engine in the build, and they
are a reasonable thing to read before writing a real one.
