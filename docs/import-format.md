# The introspection format

`dbmd import` never connects to a database. It reads a JSON file that a human
produced by running `dbmd query --engine X` themselves and pasting the result
back. This file describes that JSON: what the file must say about itself, what
the canonical shape underneath it is, and what a person writing the third engine
provider has to do.

The whole journey, which is four commands and one of them is not dbmd's:

```bash
dbmd query --engine postgres > introspect.sql   # the SQL, on stdout, to read
# run introspect.sql with your own client and save the one value it returns
dbmd import --file introspection.json           # the model directory
dbmd check db-model                             # what it says about itself
```

`dbmd query --engine <id>` prints one engine's introspection query and stops.
It connects to nothing, asks for no credential, and takes no model directory:
[ADR 0007](architecture/decisions/0007-engines-are-providers.md). `--engine` is
required there and optional on `dbmd import`, because the file import reads says
which engine produced it and at query time there is no file yet.

The SQL it prints carries a comment block, and that block is the instructions
rather than decoration: it says what the query reads, that it cannot write, and
how to save its result. The SQL Server one explains the 2033-character split,
which is the way this feature most often goes wrong.

A client can also make the file too long rather than too short, by writing
something of its own round the value: a row count, a column header, a rule of
dashes, alignment padding. The JSON in the middle is byte-for-byte correct and
the file still does not parse. That is why the SQL Server block's sqlcmd route
runs `SET NOCOUNT ON` from a second input file rather than putting it in the
query, and why the query itself carries no client-specific statement:
[ADR 0041](architecture/decisions/0041-a-client-footer-is-the-clients-to-remove.md).

The Postgres block gives `psql` the same treatment. Its default output puts a
column header and a rule of dashes above the value, pads the value into the
column and writes a `(1 row)` footer under it, so the file fails on the header
before the parser has reached any JSON at all:

```bash
psql -X -t -A -d yourdb -f introspect.sql -o introspection.json
```

`-t` drops the header, the dashes and the row count; `-A` stops the padding; and
`-X` stops `~/.psqlrc` from putting either back, because psql reads that file
after the command line rather than before. Measured on PostgreSQL 16.15, and the
same as for sqlcmd, none of it goes in the SQL: those flags belong to one client
and the query has to paste whole into the others.

For pgAdmin, DBeaver and the other grids, the block gives the shape of a correct
file rather than an invocation, because no invocation for them has been measured.
The file holds the one value and nothing else: one line beginning `{` and ending
`}`.

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

```json dbmd-import:envelope
{ "dbmdIntrospection": 1, "engine": "postgres", "tables": [] }
```

`dbmdIntrospection` is the format version, a whole number. This build reads
version 1 and refuses anything else, in both directions, with a message naming
both numbers:

```
error $.dbmdIntrospection [import/unsupported-version] this file says `dbmdIntrospection` 0 and this build of dbmd reads version 1; it was produced by an older dbmd, so re-run the query `dbmd query --engine <id>` prints with this build and import the JSON that returns
error $.dbmdIntrospection [import/unsupported-version] this file says `dbmdIntrospection` 7 and this build of dbmd reads version 1; it was produced by a newer dbmd, so upgrade dbmd, or re-run the query `dbmd query --engine <id>` prints with this build
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

How natural that is differs more than you would guess. The Postgres file spells a
list of column names `["tenant_id", "code"]`, and the SQL Server file spells the
same list `[{ "name": "TenantId" }, { "name": "Code" }]`, because `FOR JSON` has
no way to emit an array of bare strings and a query that built one by
concatenating text would have to escape the text itself. Neither shape is the
format. Both providers hand the canonical validator a list of strings, and that
is the only place the two files have to agree.

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
Index                                 IndexKey            CheckConstraint
  name               string              column      string?  name       string?
  columns            IndexKey[]          expression  string?  expression string
  includedColumns    string[]?           descending  bool?
  isUnique           boolean
  isClustered        boolean?
  filterExpression   string?
  isUniqueConstraint boolean?
```

The index that backs the primary key is not repeated in `indexes`. The primary
key is the modelling truth and one fact belongs in one place. An index backing a
`UNIQUE` constraint does appear, with `isUniqueConstraint` true, because dropping
it means dropping the constraint and that is worth being able to see.

**A model file has no room for that distinction and an import drops it.**
`unique: true` is written from `isUnique` alone, and omitted when it is false.
Whether a `UNIQUE` constraint or a `CREATE UNIQUE INDEX` put the index there is
how the uniqueness was *declared* rather than what is true of the rows, and
nothing in dbmd reads it. The appendix to
[ADR 0003](architecture/decisions/0003-markdown-on-disk-is-the-model.md) is the
argument, and `docs/format.md` names the loss under what the format does not
have.

That appendix called this the same question as `on delete` and it is not, which
[ADR 0046](architecture/decisions/0046-a-key-may-say-what-the-engine-does.md)
settles: a referential action changes what happens to rows and is carried, while
a unique index and a unique constraint are one fact about the rows under two
names.

**An index key is a column or an expression, and exactly one of the two.** An
`IndexKey` carries `column`, naming a column of the table, or `expression`,
carrying the engine's own text for a functional or computed key. Neither is
`import/missing-field`, both is `import/conflicting-fields`, and nothing
prefers one over the other when a file says both.

The two are separate fields rather than one string because a column can legally
be *called* `lower(ledger_code)`. A key that reported the expression under
`name` was byte-identical to a key naming that column, which is dbmd-18: the
same output for two different schemas, with no way back. ADR 0022 is
the argument, and it holds for the markdown format too.

Only one of the two engines ever emits `expression`. SQL Server has no functional
index: an index over an expression there is an index over a computed column, so
the key is a column and the expression sits on the column in `generated`. That is
not a hole in the SQL Server provider. It is the same fact reached by the other
route, and the pair of indexes in
`test/import/fixtures/sqlserver-provider-raw.json`, one over a computed column
and one over a column literally named `lower(ledger_code)`, is where it is
checked.

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
`checkConstraints[].expression`, `indexes[].columns[].expression` and
`filterExpression` are the engine's own text, unmodified. SQL Server really does report `((0))` for a default of zero, and this
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

**Length is absent where the engine's number is not a length.** The same
`max_length` column says 16 for `text`, `ntext` and `image`, which is the size of
the pointer rather than of the data, and -1 for `xml`, `geography` and the other
types that are not sized at all. Neither is a length and neither is `"max"`, so
neither is carried: the column has a `native` type that says what it is, and a
number that means something else would be worse than no number.

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

**A key here is not always spelled the way a model file spells it.** The
markdown's `unique:` is this document's `isUnique`, and its `columns: [email]`
is this document's `columns: [{ "column": "email" }]`. Both differences are
deliberate and both have one reason: this is written by a provider and read by a
machine, where an unlabelled string is ambiguous and a boolean reads as the
accessor it is, and a model file is written by a person. What must never differ
is the *sense* of a fact, which is why `Column.nullable` and the markdown's
`nullable:` are the same word: a rename is a mapping a compiler checks, and a
negation is one somebody gets backwards. ADR 0022 settled the index key and the
appendix to ADR 0003 settled the boolean, after dbmd-19 asked whether they
contradicted each other.

## A worked example

The SQL Server fixture in `test/import/fixtures/sqlserver-raw.json` contains,
among other things, this column, in the shape `FOR JSON PATH` produces:

```json dbmd-import:raw-column
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

```json dbmd-import:canonical-column
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

```json dbmd-import:canonical-table
{
  "schema": "sales",
  "name": "OrderLine",
  "columns": [
    { "name": "OrderId", "type": { "native": "bigint", "normalised": "integer" }, "nullable": false },
    { "name": "LineNo", "type": { "native": "int", "normalised": "integer" }, "nullable": false },
    { "name": "TenantId", "type": { "native": "int", "normalised": "integer" }, "nullable": false },
    { "name": "OrderCode", "type": { "native": "nvarchar", "normalised": "string", "length": 32 }, "nullable": false, "collation": "SQL_Latin1_General_CP1_CI_AS" },
    {
      "name": "Quantity",
      "type": { "native": "int", "normalised": "integer" },
      "nullable": false,
      "default": { "expression": "((0))", "constraintName": "DF_OrderLine_Quantity" }
    },
    { "name": "UnitPrice", "type": { "native": "decimal", "normalised": "decimal", "precision": 12, "scale": 2 }, "nullable": false },
    {
      "name": "LineTotal",
      "type": { "native": "decimal", "normalised": "decimal", "precision": 23, "scale": 2 },
      "nullable": true,
      "generated": { "expression": "([Quantity]*[UnitPrice])", "persisted": true }
    },
    { "name": "Notes", "type": { "native": "nvarchar", "normalised": "string", "length": "max" }, "nullable": true, "collation": "Latin1_General_BIN2" }
  ],
  "primaryKey": { "name": "PK_OrderLine", "columns": ["OrderId", "LineNo"], "isClustered": true },
  "indexes": [
    {
      "name": "IX_OrderLine_Open",
      "columns": [{ "column": "OrderId" }, { "column": "LineNo", "descending": true }],
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

Two values in there are worth stopping on, because both look like mistakes and
neither is. `LineTotal` was declared `AS ([Quantity]*[UnitPrice]) PERSISTED` over
an `int` and a `decimal(12,2)`, and the catalog reports it as `decimal(23,2)` and
as nullable: SQL Server derives the type of a computed column itself, and will
not promise the multiplication cannot overflow. A provider reports what the
catalog says rather than what the DDL looked like, so a person reading a diff of
their first import is looking at their database rather than at dbmd's opinion of
it.

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
  has no cross-engine meaning, and nothing in the model would read it. The
  consequence, found by the SQL Server provider rather than designed: an index
  whose access method has no ordered key list (a columnstore, spatial, XML or
  hash index) has nothing this format can say about it beyond its name, so the
  query does not report it at all. Reporting it would produce an index with no
  key columns, which is `import/empty-value` and would fail the whole file over
  an index the model could not hold either way. A provider whose engine has such
  a thing should leave it out and say so in a comment where the filter is.
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

## What `dbmd import` does with it

The document above is what a provider produces. Turning it into a model
directory is `src/import/model.ts`, and it is a pure function over this shape, so
it can be tested against a committed fixture with no filesystem in the way.
[ADR 0029](architecture/decisions/0029-what-an-import-writes-and-what-it-drops.md)
is the whole argument. Four things are worth knowing here.

**A column's type is written as the engine's own name with its modifier put back
on.** `native: "character varying"` with `length: 32` becomes
`type: character varying(32)`. The normalised name is never written: it is lossy
by construction (ADR 0009) and `string` is not a type any engine has. Nothing is
tidied, so `character varying` stays that and `((0))` keeps its parentheses,
which is the rule this page already states for expressions applied to a type.

**A foreign key becomes one `ref:` per column pair.** A model file declares a
relationship on the referring column and has no registry to put a constraint in,
so a composite key arrives as two refs, paired by position. The constraint's name
and the fact that the two refs are one constraint are not carried.

**`onDelete` and `onUpdate` are carried, onto every ref the key produces.**
`noAction` becomes `on delete: no action` and is written rather than assumed,
because a field the contract omits and a field reporting `NO ACTION` are
different facts and both catalogues report the second one on every constraint.
So a clean import of a real schema carries two extra lines per referencing
column, which is the cost
[ADR 0046](architecture/decisions/0046-a-key-may-say-what-the-engine-does.md)
accepts on purpose.

**The document says strictly more than a model file can hold, and the surplus is
dropped rather than diagnosed.** `checkConstraints`, `includedColumns`,
`filterExpression`, `isUniqueConstraint`, `isClustered`, a key column's
`descending`, and a column's `identity`, `generated`, `collation` and `comment`
all have nowhere to go. `docs/format.md` names those losses under what the format
does not have, and a warning for each would put a dozen identical lines on every
clean import of a real schema.

**Three things are diagnosed, because each would otherwise leave a model that
lies.** They are raised by the import command rather than by the contract, since
each is about the model the document became rather than about the document:

```
warning $.tables[0].foreignKeys[0] [import/reference-not-exported] `public.orders` has a foreign key to `public.customers`, which this file does not contain, so no `ref:` was written for it; re-run the query over the whole database if that table belongs in the model
error $.tables[0].name [import/unsafe-name] the table `Ledger: Entry` has no file it can be written to, because no filesystem accepts that name and a checkout could not hold it; rename it in the database or leave it out of the query
error $.tables[1].name [import/name-collision] `sales.Order` and `dbo.Order` would both be written to tables/Order.md, and a model directory is flat, so only `dbo.Order` was written; import one schema at a time until the format has somewhere to put the other
```

A ref that is dropped is dropped rather than written and left for `dbmd check` to
find, because a partial export is a normal thing to have and a `ref-table-unknown`
error on somebody's first check would blame them for it.

`import/unsafe-name` is the one to read
[ADR 0026](architecture/decisions/0026-a-name-the-writer-cannot-write-is-a-skip.md)
about. A *reader* can never raise it, because a filesystem refuses such a name
before dbmd is involved, so no model on disk can hold one. A catalogue has no
such rule, which makes an import the one caller that can, and the report is the
writer's own `WriteSkip` translated rather than a second opinion about names.

## Every diagnostic

Everything on this page that can go wrong goes wrong as a diagnostic rather than
as an exception, and every stage reports all of them in one pass. A diagnostic
carries a stable `code`, a `severity`, a `message` a person reads, and an `at`
that is a JSONPath into the document. `dbmd import` prints them under what it
wrote, and `dbmd import --json` prints them as objects whose `code` and
`severity` are the two columns below.

The model reader has its own table, in
[`docs/format.md`](format.md#every-diagnostic), and the two lists share no
member. The `import/` prefix is what tells them apart when they arrive in one
array, which is the case `dbmd check --json` produces and
[ADR 0014](architecture/decisions/0014-one-diagnostic-and-where-it-points.md)
is the argument for.

**`error` means it did not make it into the model.** **`warning` means it did,
and is worth a look anyway.** An error found while reading the document stops
the import before a single file is written, and the directory is left exactly as
it was. The three in the second table are found after the model is built, so
those write every table that can be written and name the ones that could not.

`test/import/docs.test.ts` reads `ImportDiagnosticCode` out of
`src/diagnostics.ts` and fails when a code has no row here, or a row here names
no code, so adding a code without adding a row is a red build rather than a gap
somebody finds a year later.

One failure is not in the table, because it happens before there is a document
to point into. Text that is not JSON at all never reaches a provider, so
`dbmd import` says so itself, with no code and no path.

**The file you import is one value that begins `{` and ends `}`**, with no column
header above it, no row count under it and no padding round it. Almost every way
this fails is a client writing something of its own round a value that is
byte-for-byte correct, so the message compares your file against that shape and
says which of four things happened. It reads the file rather than the parser's
position, because the position is not always there to read:
[ADR 0045](architecture/decisions/0045-the-file-says-which-way-it-is-wrong.md).

**Something in front of the JSON**, which is what psql writes without `-t`. Note
that the parser names no position at all here, because it stopped on the first
character:

```
dbmd: model.json is not JSON: Unexpected token 'd', " dbmd_intro"... is not valid JSON
The file to import is one value that begins { and ends }, with no header above
it, no row count under it and no padding round it.
This one does not begin with {, so the parse stopped in front of your schema
rather than inside it and nothing in it was truncated. What is above the JSON is
your client's own: a column header, a rule of dashes, or a frame round the value.
The comment above the query you ran says how to save it from your client.
```

**Something after the JSON**, which is sqlcmd's `(1 rows affected)` line written
after a value that is correct. `SET NOCOUNT ON` removes it, from a second input
file rather than from the query:
[ADR 0041](architecture/decisions/0041-a-client-footer-is-the-clients-to-remove.md).

```
dbmd: model.json is not JSON: Unexpected non-whitespace character after JSON at position 2333
...
This one holds a whole JSON value and then more, so it is too long rather than
too short and nothing in it was truncated. What follows the last } is your
client's own footer, usually a row count.
```

**A copy that stopped early**, which is still what it usually is when the file
begins `{` and does not end `}`: a client that hands a long result back in
pieces, or a grid with a display cap of its own.

```
dbmd: trunc.json is not JSON: Expected double-quoted property name in JSON at position 900
...
This one begins { and does not end }, so the likeliest cause is a paste that
stopped early: a client that hands a long result back in pieces, or a grid with a
display cap of its own, gives you JSON that looks finished and is not.
```

**Both ends right and the middle wrong**, which is the one it cannot name. A
client that breaks a long value across lines writes a continuation character into
every break, and a copy that lost a piece in the middle looks the same from here,
so the message says where to look instead of picking one.

`dbmd import --json` reports all four as `input-not-json`, with the case in
`likelyCause`: `a header in front of the JSON`, `a footer after the JSON`,
`the paste stopped early` or `a break inside the JSON`. A file that could not be
read is `file-unreadable`. Both are failures of the command rather than
diagnostics about a document, which is why neither carries the `import/` prefix
and neither is in the table.

### Reading the file

Raised by the envelope, the registry, a provider's `parse`, or the contract
validator. All of them are about the document, and none of them has seen a model
directory yet.

| code | severity | what happened | what to do |
| --- | --- | --- | --- |
| `import/not-an-object` | error | The file is JSON and is not a JSON object, or the value at that path is not one. Nearly always the whole file: a client that saved the grid it drew rather than the cell the grid was drawn from. | Save the single result cell whole, with no table frame around it. |
| `import/missing-field` | error | A required field is absent, or present and `null`. The path names it. | Check the path against the shapes above. In a file you did not edit, it is a provider that did not fill the field in. |
| `import/wrong-type` | error | The field is there and is the wrong sort of JSON value: a string where a list belongs, a number where an object does. | The same. `null` is never this code, because null and absent are the same thing here. |
| `import/empty-value` | error | A required string or list is there and says nothing: `schema: ""`, a `name` that is the empty string, a primary key or an index whose `columns` is `[]`. | Emptiness is never a fact this contract can keep, so fill it in or leave the object out: omit `primaryKey` for a table that has none. An index with no key columns is one this format cannot describe at all, which is why the SQL Server query leaves those out rather than reporting them. |
| `import/unsupported-version` | error | `dbmdIntrospection` names a version this build does not read. The message names both numbers and says which of the two is the newer. | Re-run the query `dbmd query --engine X` prints with this build of dbmd if the file is older, and upgrade dbmd if the file is newer. |
| `import/unknown-engine` | error | `engine` names no provider in this build. The message lists the ones it has. | Check the spelling. A provider id never changes once shipped, so a name that used to work is a dbmd that is too old. |
| `import/engine-overridden` | warning | `--engine` disagreed with the file and won. Never silent: [ADR 0007](architecture/decisions/0007-engines-are-providers.md). | Nothing, if you meant it. Drop the flag if you did not: the file knows which engine wrote it, and reading it as the wrong one usually fails a hundred lines later instead. |
| `import/unknown-field` | warning | A field nothing in this version of the format reads. It is dropped and the import carries on. | Nothing, unless it is your provider and the key is a typo. This is a warning rather than an error so that adding a field to the format is not a breaking change. |
| `import/duplicate` | error | Two things that have to be told apart are byte-identical: two tables with one `schema` and `name`, two columns of one table, or two indexes of one table. Names are compared byte for byte and never folded, so `Orders` and `orders` are two things, not one. | Fix the query. A duplicate here usually means the catalogue was joined without a filter and every row came back twice. |
| `import/mismatched-columns` | error | A foreign key's `columns` and `referencedColumns` are different lengths, so the pairs do not pair and no `ref:` can be written from them. | A provider bug rather than a database that can exist. Report it against the provider. |
| `import/not-in-vocabulary` | error | A value outside a closed list this page defines: a `normalised` that is not one of the fourteen, an `onDelete` that is not one of the five actions, an `identity.generation` that is neither `always` nor `byDefault`. | In a provider, return `other` rather than guessing: `native` still says what the type really was. |
| `import/conflicting-fields` | error | Both halves of an either/or are given, so there is no single fact to keep. An index key saying both `column` and `expression` is the case it exists for. | Send one. Nothing prefers one over the other, deliberately, because a key naming a column called `lower(code)` and a key over the expression `lower(code)` are different schemas. |

### Building the model

Raised by `dbmd import` rather than by the contract, because each is about the
model the document became rather than about the document.
[ADR 0029](architecture/decisions/0029-what-an-import-writes-and-what-it-drops.md)
is why these three are diagnosed and the other losses are not.

| code | severity | what happened | what to do |
| --- | --- | --- | --- |
| `import/unsafe-name` | error | A catalogue handed dbmd a table name that no file can be called, so the table has nowhere to be written. `Ledger: Entry` is a name a database takes and a checkout cannot hold. The rule is `isFileName` in `src/model/paths.ts`: either slash, a control character, a vertical bar, one of `< > : " ? *`, or a name too long to be one path component. | Rename it in the database, or leave it out of the query. Every other table is still written. [ADR 0026](architecture/decisions/0026-a-name-the-writer-cannot-write-is-a-skip.md) is why this code exists on the import side and has no counterpart in the model reader. |
| `import/reference-not-exported` | warning | A foreign key whose referenced table is not in the file. No `ref:` was written for it, and the column is written without one. | Nothing, if you meant to export part of the database. Otherwise re-run the query over the whole of it. The ref is dropped rather than written and left dangling, so `dbmd check` does not blame you for a partial export. |
| `import/name-collision` | error | Two tables that would be written to one file. `tables/` is flat (ADR 0003), so `dbo.Order` and `sales.Order` are one path, and writing both would silently keep whichever went last. The first in the document's order is the one kept, and the document is sorted, so which one that is does not depend on the machine. | Import one schema at a time until the format has somewhere to put the other. |

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
- **Whatever your engine's clients do to a long result, say it above the SQL.**
  The comment block on top of the query is the only text you can be sure the
  person about to copy a result out of a grid has in front of them, and a note in
  this file is not. SQL Server hands a `FOR JSON` result back in 2033-character
  pieces, one grid row each, splitting mid-word, and a paste of "the row" is then
  JSON that looks finished and is not, so `sqlserver.ts` wraps its `FOR JSON` in
  a scalar subquery to stop the splitting, says in the header why not to copy
  from the grid anyway, says what an engine too old for the feature does instead
  of leaving a bare syntax error, and repeats the cause in the diagnostic its
  `parse` raises. That is one trap answered in three places on purpose, and it is
  the shape to copy.
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
