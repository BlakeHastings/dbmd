# 0022. Engine SQL in a format that does not read SQL

## Context

dbmd's format is deliberately not a SQL parser. ADR 0003 says the model is
markdown a person can hand-edit and a reviewer can read in a diff, and
`docs/format.md` says outright that dbmd does not know what types your engine
has. That is a good position and it has a consequence nobody had written down:
there are facts about a real schema that are *only* expressible as engine SQL,
and the format has to decide what it does with them rather than discover, one at
a time, that it cannot say them.

There are three such facts, and they were found separately.

**An expression index.** `create index entry_lower_code on public.entry
(lower(ledger_code))`. Found by running dbmd's own Postgres introspection query
against a live database during the review of dbmd-43. The key came back as a
column named `lower(ledger_code)`:

```json
{ "name": "entry_lower_code", "columns": [{ "name": "lower(ledger_code)" }] }
```

Nothing in that distinguishes it from an index on a column *literally called*
`lower(ledger_code)`, which is a legal identifier in both engines. The query
produced the same bytes for two different schemas, so nothing downstream could
ever tell them apart. That is dbmd-18 and it is why this record exists.

**A `check` constraint.** `check (amount > 0)`. Named as a gap by the dbmd-14
review, which also said it is the same question as an expression index rather
than a neighbour of `unique`, and asked for one answer between them.

**A partial or filtered index predicate.** `where deleted_at is null`. Already
carried by the introspection contract as `filterExpression` and already
unsayable in the markdown.

The introspection contract had already answered this question once, for a
different reason, and that answer is the precedent this record starts from.
`ColumnDefault.expression`, `GeneratedColumn.expression`,
`CheckConstraint.expression` and `Index.filterExpression` all carry the engine's
own text, verbatim, unparsed. `docs/import-format.md` gives the reason under
"Expressions are verbatim": dbmd never executes the string, so unwrapping or
tidying it is a guess that is safe for `((0))` and not safe in general.

That precedent is right and this record follows it. What it does not settle, and
what dbmd-18 is actually about, is where such a string is allowed to *stand*.

## Decision

**Engine SQL is carried verbatim, and it is never a bare string in a slot where
a name could also go.**

Two halves, and the second is the one dbmd-18 needed.

### Verbatim, and the validator has no opinion about it

An expression is stored as the engine reported it or as the author typed it,
character for character. Nothing normalises it, nothing reformats it, nothing
compares it across engines, and no diagnostic is raised about what is inside it.

`src/model/validate.ts` has a rule that an index may only name columns its table
has, and that rule now applies to a key that is a column and stands down for a
key that is an expression. It stands down rather than being loosened. Loosening
it — accepting any string that looks like it has a bracket in it, say — would
stop it catching the typo it exists for, which is the outcome dbmd-18 said had
to be avoided. Standing down is honest: dbmd does not parse SQL, so it cannot
know which columns `lower(ledger_code)` mentions, and the truthful number of
things it has to say about that string is none.

### An expression that stands where a name could stand is a mapping

Wherever engine SQL occupies a slot that could otherwise hold an identifier, it
is written as a mapping with an `expression` key. Wherever the slot can only
ever be SQL, a plain string is enough, because there is nothing for it to be
confused with.

In an index's key list, both are possible, so both are spelled:

```yaml
indexes:
  - name: entry_lower_code
    columns: [tenant_id, { expression: lower(ledger_code) }]
  - name: entry_odd_column
    columns: [lower(ledger_code)]
```

The first names one column and one expression. The second names one column,
which happens to be called `lower(ledger_code)`. They are different schemas and
now they are different files.

In the introspection contract the same key is `IndexKey`, a union of
`{ column }` and `{ expression }`, and a key that says both is
`import/conflicting-fields` rather than one of them winning. Preferring either
would make the other disappear silently, and a distinction disappearing silently
is the bug this record is about.

A `check` constraint's `expression` and a partial index's predicate are the
other case: nothing but SQL can go there, so they are plain strings and need no
wrapper. Neither is built yet — see below — but the spelling is decided so that
whoever builds them does not invent a second convention.

### The markdown says it shorter than the wire format does

In a model file an index key is either a bare string, which is always a column
name, or `{ expression: ... }`. In the introspection contract it is either
`{ column: ... }` or `{ expression: ... }`. The asymmetry is deliberate.

A markdown file is written by a person, most indexes are over plain columns, and
`columns: [customer_id, status]` is what a hand-author types; making them write
`{ column: customer_id }` four times to buy a symmetry with a JSON file they
will never see is a bad trade. A canonical introspection document is written by
a provider and read by a machine, and an unlabelled string in that position is
precisely what caused dbmd-18. The rule is the same in both — a column and an
expression are two shapes, not one shape with a convention — and only the
shorthand differs.

The word is `expression` in both, matching `ColumnDefault.expression` and the
three others already in the contract. dbmd-19 is open about `unique` against
`isUnique` and this record deliberately adds no new pair to it.

## Consequences

- **`docs/format.md` gains an expression index and loses half of "what the
  format does not have".** That page is executable — its tagged blocks are
  assembled into a model that must read and validate silently — so the example
  in it is a test.
- **`Index.columns` is a union in both the contract and the model**, and
  `IndexColumn` is now `IndexKey`. Renaming the type rather than adding a field
  to it is what makes a consumer that assumed `.name` fail to compile instead of
  reading `undefined`. The JSON and YAML key stays `columns`, because that is
  what every engine's DDL calls it and what a hand-author already wrote.
- **The studio does not know about expression keys yet**, and its index editor
  renders a key by joining the list into a text field. A model with an
  expression index is safe to view and safe to edit anywhere else, and editing
  *that table's indexes* in the studio would write the expression back as a
  column name. `src/studio/` is under other work as this lands; the follow-up is
  named in the pull request and `docs/format.md` says so to a user meanwhile.
- **`check` constraints and partial-index predicates are decided here and built
  later.** Both want a new key on a table or an index, every constructor of a
  `Table` would have to grow one, and two of those constructors are in
  `src/studio/` and `src/cli/`, which are being changed by other agents right
  now. Landing a format key that the studio's table-rename path silently drops
  is worse than landing it a week later with the studio taught about it. The
  spelling above is the answer, so the follow-up is typing rather than another
  argument.
- **Two engines still agree.** SQL Server reaches most of this through a
  computed column, which arrives as an ordinary column and needs none of it, and
  through filtered indexes, which are the predicate case. Postgres functional
  indexes are the case that forced it. Neither engine is privileged by the
  shape.

## Revisit when

- **Somebody wants dbmd to compare two expressions.** Verbatim text cannot say
  whether `lower(x)` and `LOWER(x)` are the same index, and the day a `dbmd
  diff` has to answer that is the day this record's first half is the thing in
  the way. The answer is probably a normalised form *beside* the verbatim one,
  never instead of it.
- **A third slot appears where SQL and an identifier compete.** A generated
  column's expression, if the format ever carries one, sits beside a type rather
  than in place of a name, so it is the plain-string case. If something genuinely
  ambiguous turns up, it takes the mapping, and if the mapping starts feeling
  heavy that is the signal the format wants a general "this is engine text"
  wrapper rather than one per site.
- **A hand-author writes `{ expression: ... }` in a place that does not take
  one.** That is the signal the shorthand taught the wrong lesson, and the fix
  is a `superseded-key`-shaped diagnostic naming the place it does belong.
