# 0007. Engines are providers, and the introspection JSON is self-describing

## Context

The owner named Postgres and SQL Server as the two engines that matter now, and
asked for a modular approach so a third can be added later without disturbing
either.

Two engines is the number that forces the design. One engine lets you write the
query and the importer as one thing and call it architecture. Three would be a
rewrite of whatever one engine produced. Two, chosen up front, is exactly enough
to find out which parts genuinely vary.

What varies between Postgres and SQL Server, having looked rather than guessed:

- **The catalog is different.** Postgres has `information_schema` plus
  `pg_catalog`, and the useful index metadata is only in the latter. SQL Server
  has `information_schema` for compatibility and `sys.*` for anything real.
- **Producing JSON is different.** Postgres has `json_agg` and
  `jsonb_build_object`. SQL Server has `FOR JSON PATH`, from 2016 onward, and
  nothing before that.
- **Type names are different.** `character varying` against `nvarchar`, and
  `nvarchar(max)` reports its length as -1.
- **Default expressions are different**, and both are engine-native strings that
  mean nothing to the other.
- **Identifier quoting is different.** `"Name"` against `[Name]`, and SQL Server
  is case-insensitive by collation default where Postgres folds to lower case.

What must not vary is the thing `dbmd import` consumes. One importer, many
engines, or the modularity is decorative.

## Decision

**An engine is a provider: one module, registered in one place.**

```ts
interface EngineProvider {
  id: string                                  // 'postgres', 'sqlserver'
  displayName: string
  introspectionQuery(): string                // the SQL a human runs
  parse(raw: unknown): ParseResult            // engine JSON -> canonical, or diagnostics
  normaliseType(native: string): string
  quoteIdentifier(name: string): string
}
```

Adding an engine is a new file under `src/import/providers/` and one line in the
registry. Nothing else in the codebase learns its name. `dbmd query --engine X`
and `dbmd import` both resolve through that registry, and `dbmd query` with no
engine lists the ones that exist rather than guessing.

**The query emits an envelope that says what produced it.**

```json
{ "dbmdIntrospection": 1, "engine": "postgres", "tables": [ ... ] }
```

So `dbmd import` does not need `--engine` and cannot be told the wrong one. A
user who ran the SQL Server query and passes it to import gets the SQL Server
provider because the file says so, not because they remembered. `--engine`
exists to override, and overriding is a diagnostic-worthy thing to do.

**Normalisation is TypeScript, not SQL.**

The query returns something natural for its engine, carrying native type strings
and native default expressions. The provider turns that into the canonical shape.

The alternative, making each engine's SQL emit the canonical shape directly,
keeps the provider thin and was rejected. It puts the contract in N places
written in N dialects, where it can only be tested against a live database of
that engine, and it makes every future change to the contract a rewrite of every
query. In TypeScript the normalisation is a pure function over a JSON fixture,
so it is unit-tested on a laptop with no database at all, and a contract change
is one place per engine in a language that has types.

The cost is that the JSON a user pastes is engine-shaped rather than canonical,
which is why the envelope exists.

## Consequences

- **The SQL stays readable**, which matters more than it sounds. Somebody is
  going to run this against production and should be able to satisfy themselves
  by reading it that it cannot write.
- **A fixture per engine is committed**, and the provider tests run against it.
  That is what makes SQL Server developable by somebody who has only Postgres,
  and it is also the honest limit: a committed fixture proves the normalisation,
  never the query. A query change needs a real database of that engine, and a
  pull request that changes one has to say whether it was run.
- **`dbmdIntrospection: 1` is a version and will earn its keep.** Bumping it is
  how an old pasted file gets a clear message instead of a confusing parse
  failure.
- **The canonical shape has to be the union of what both engines can say**, not
  the intersection and not Postgres with SQL Server bolted on. Composite primary
  keys, multi-column foreign keys and schemas are in it because both have them.
- Two engines will not reveal everything. SQLite has no information schema at
  all and will bend this; that is expected and is why the seam exists.

## Revisit when

- **A third engine needs something the interface cannot express.** Adding a
  method is fine. Adding an `if (engine === ...)` outside a provider is the
  signal the seam is in the wrong place.
- **SQLite is asked for.** It has no information schema and its introspection is
  `pragma` output rather than one query, which is the first real test of whether
  `introspectionQuery(): string` was the right shape.
- **The normalised type vocabulary starts losing information** people care
  about, at which point the model needs to keep the native type alongside the
  normalised one rather than choosing.

## Confirmed by dbmd-7nb, once `dbmd query` was a command rather than a sentence

This record described `dbmd query --engine X` as one of the two callers that
resolve through the registry, and for two waves it was among the only places
that described it: the command did not exist, `introspectionQuery()` was on the
interface with nothing calling it, and `dbmd import` told a user to run a
command the CLI then rejected. dbmd-7nb built it. Nothing above needed changing,
and the two things that would have shown the seam was in the wrong place did not
happen:

- **`EngineProvider` grew no method.** `introspectionQuery(): string` was the
  whole of what the new command needed, which is the first evidence for that
  signature from a caller rather than from the providers that implement it.
- **No engine's name is written in `src/cli/query.ts`.** The engine list in its
  help, the example in its help, and the message for an engine nobody provides
  are all built from a `ProviderRegistry` at the moment they are printed, so a
  third provider makes them right without being mentioned. The test for that
  runs the real command against a registry of test doubles and against an empty
  one.

What it does not confirm is the SQL, and this record already says why: a
committed fixture proves the normalisation and never the query. The pull request
ran the printed Postgres query against a PostgreSQL 16 container, imported what
it returned and checked the result, which is the first end-to-end run of the
journey described here. The SQL Server half was proved against a real server by
dbmd-44 and was printed rather than run again.
