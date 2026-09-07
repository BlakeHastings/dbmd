// The PostgreSQL provider. ADR 0007: one file, one registry line, and nothing
// outside this directory learns the word "postgres".
//
// Two halves that never meet. `introspectionQuery` is SQL a human runs against
// their own database and reads before they do, so it is written to be read.
// `parse` is a pure function from what that SQL prints to the canonical shape in
// `../contract.ts`, so it is developed and tested against a committed fixture on
// a laptop with no server on it. ADR 0007 is also honest about the limit: the
// fixture proves this half and never the SQL, so a change to the query needs a
// real Postgres and the pull request has to say whether it got one.

import type {
  CheckConstraint,
  Column,
  ColumnType,
  ForeignKey,
  Identity,
  Index,
  IndexColumn,
  IntrospectionDocument,
  NormalisedType,
  PrimaryKey,
  ReferentialAction,
  SourceInfo,
  Table,
} from '../contract.js'
import { INTROSPECTION_VERSION } from '../contract.js'
import { inDocument } from '../diagnostics.js'
import type { EngineProvider, ParseResult } from '../provider.js'

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * What `dbmd query --engine postgres` prints.
 *
 * Kept as one string rather than assembled from parts, because the thing being
 * reviewed is the text a user pastes, and a query stitched together at runtime
 * cannot be read in the file that holds it.
 */
const INTROSPECTION_QUERY = `-- dbmd introspection query for PostgreSQL 12 or later.
--
-- READ ONLY, and written to be checked rather than trusted. It is one SELECT
-- over the system catalogs. There is no INSERT, UPDATE, DELETE, MERGE, CREATE,
-- ALTER, DROP, TRUNCATE, COPY, GRANT or SET anywhere in it; it creates nothing,
-- not even a temporary table; and every relation it reads lives in pg_catalog,
-- so it never looks at a row of your data.
--
-- One statement and no psql meta-commands, so it pastes whole into pgAdmin,
-- DBeaver, a JDBC console or \`docker exec ... psql\` alike. It returns one row
-- of one column: the JSON \`dbmd import\` reads. Save that value to a file.
--
-- Identifiers come out exactly as the catalog holds them. Postgres folds an
-- unquoted name to lower case, so a table created as "Orders" and one created as
-- Orders are two different tables, and each is reported as it really is.
--
-- json_strip_nulls at the end is deliberate: in this format an absent key and a
-- null one mean the same thing, so the file says nothing once rather than saying
-- "nothing" several thousand times.

SELECT json_strip_nulls(json_build_object(
  'dbmdIntrospection', 1,
  'engine', 'postgres',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'default_collation', (
    SELECT d.datcollate
    FROM pg_catalog.pg_database d
    WHERE d.datname = current_database()
  ),

  -- Ordinary and partitioned tables only. Views, sequences, foreign tables and
  -- materialised views are not tables, and an individual partition is physical
  -- detail rather than something somebody modelled.
  --
  -- Every ORDER BY below is over a \`name\` column, which Postgres sorts in the C
  -- collation, so the same catalog produces the same bytes on any machine.
  'tables', COALESCE((
    SELECT json_agg(json_build_object(
      'table_schema', n.nspname,
      'table_name', c.relname,
      'table_comment', pg_catalog.obj_description(c.oid, 'pg_class'),

      -- Columns keep catalog order, because with columns the order is data.
      'columns', COALESCE((
        SELECT json_agg(json_build_object(
          'column_name', a.attname,

          -- format_type with a null modifier is the bare name the format wants:
          -- \`character varying\`, not \`character varying(32)\`. The modifier goes
          -- in the three fields below instead, so the two cannot disagree. A
          -- type outside the current search_path comes back schema-qualified,
          -- which is format_type telling the truth about what is visible.
          'format_type', pg_catalog.format_type(a.atttypid, NULL),
          'not_null', a.attnotnull,

          -- atttypmod is the declared modifier, encoded per type family, and -1
          -- means the user did not choose one.
          'character_maximum_length', CASE
            WHEN a.atttypmod < 0 THEN NULL
            WHEN t.typname IN ('bpchar', 'varchar') THEN a.atttypmod - 4
            WHEN t.typname IN ('bit', 'varbit') THEN a.atttypmod
          END,
          'numeric_precision', CASE
            WHEN t.typname = 'numeric' AND a.atttypmod >= 0
            THEN ((a.atttypmod - 4) >> 16) & 65535
          END,
          'numeric_scale', CASE
            WHEN t.typname = 'numeric' AND a.atttypmod >= 0
            THEN (a.atttypmod - 4) & 65535
          END,
          -- Fractional seconds, where the user asked for a particular number.
          'datetime_precision', CASE
            WHEN t.typname IN ('time', 'timetz', 'timestamp', 'timestamptz')
             AND a.atttypmod >= 0
            THEN a.atttypmod
          END,

          -- pg_attrdef holds the DEFAULT expression of an ordinary column and
          -- the GENERATED ALWAYS AS expression of a generated one. attgenerated
          -- says which of the two this row is.
          'column_default', CASE
            WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
          END,
          'generation_expression', CASE
            WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
          END,

          -- Only GENERATED ... AS IDENTITY is an identity column. A \`serial\` is
          -- an ordinary integer with a nextval() default, and is reported as
          -- that default rather than being guessed into an identity.
          'identity_generation', CASE a.attidentity
            WHEN 'a' THEN 'ALWAYS'
            WHEN 'd' THEN 'BY DEFAULT'
          END,

          -- Only a collation the column was actually given. Every collatable
          -- column has one, and repeating the type's own default on all of them
          -- would be noise rather than information.
          'collation_name', CASE
            WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation THEN (
              SELECT co.collname
              FROM pg_catalog.pg_collation co
              WHERE co.oid = a.attcollation
            )
          END,
          'column_comment', pg_catalog.col_description(c.oid, a.attnum)
        ) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_catalog.pg_attrdef ad
          ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE a.attrelid = c.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
      ), '[]'::json),

      'primary_key', (
        SELECT json_build_object(
          'constraint_name', pk.conname,
          'columns', (
            SELECT json_agg(pa.attname ORDER BY k.ord)
            FROM generate_subscripts(pk.conkey, 1) AS k(ord)
            JOIN pg_catalog.pg_attribute pa
              ON pa.attrelid = pk.conrelid AND pa.attnum = pk.conkey[k.ord]
          )
        )
        FROM pg_catalog.pg_constraint pk
        WHERE pk.conrelid = c.oid AND pk.contype = 'p'
      ),

      -- The index behind the primary key is not repeated here: the primary key
      -- above is the one place that fact lives.
      'indexes', COALESCE((
        SELECT json_agg(json_build_object(
          'index_name', ic.relname,
          'is_unique', i.indisunique,
          'is_constraint', uc.conname IS NOT NULL,
          'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid),
          'key_columns', (
            SELECT json_agg(json_build_object(
              -- An expression index has no attribute behind the key column, so
              -- the expression itself stands in for a name.
              'column_name', COALESCE(
                ia.attname,
                pg_catalog.pg_get_indexdef(i.indexrelid, k.ord, true)
              ),
              'is_descending', (i.indoption[k.ord - 1] & 1) = 1
            ) ORDER BY k.ord)
            FROM generate_series(1, i.indnkeyatts::int) AS k(ord)
            LEFT JOIN pg_catalog.pg_attribute ia
              ON ia.attrelid = i.indrelid AND ia.attnum = i.indkey[k.ord - 1]
          ),
          -- INCLUDE columns sit after the key columns in indkey.
          'included_columns', COALESCE((
            SELECT json_agg(ia.attname ORDER BY k.ord)
            FROM generate_series(i.indnkeyatts::int + 1, i.indnatts::int) AS k(ord)
            JOIN pg_catalog.pg_attribute ia
              ON ia.attrelid = i.indrelid AND ia.attnum = i.indkey[k.ord - 1]
          ), '[]'::json)
        ) ORDER BY ic.relname)
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
        LEFT JOIN pg_catalog.pg_constraint uc
          ON uc.conindid = i.indexrelid AND uc.contype = 'u'
        WHERE i.indrelid = c.oid AND NOT i.indisprimary
      ), '[]'::json),

      -- confdeltype and confupdtype are single characters: a no action,
      -- r restrict, c cascade, n set null, d set default.
      'foreign_keys', COALESCE((
        SELECT json_agg(json_build_object(
          'constraint_name', fk.conname,
          'columns', (
            SELECT json_agg(fa.attname ORDER BY k.ord)
            FROM generate_subscripts(fk.conkey, 1) AS k(ord)
            JOIN pg_catalog.pg_attribute fa
              ON fa.attrelid = fk.conrelid AND fa.attnum = fk.conkey[k.ord]
          ),
          'referenced_schema', fn.nspname,
          'referenced_table', fc.relname,
          'referenced_columns', (
            SELECT json_agg(ra.attname ORDER BY k.ord)
            FROM generate_subscripts(fk.confkey, 1) AS k(ord)
            JOIN pg_catalog.pg_attribute ra
              ON ra.attrelid = fk.confrelid AND ra.attnum = fk.confkey[k.ord]
          ),
          'on_delete', fk.confdeltype,
          'on_update', fk.confupdtype
        ) ORDER BY fk.conname)
        FROM pg_catalog.pg_constraint fk
        JOIN pg_catalog.pg_class fc ON fc.oid = fk.confrelid
        JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
        WHERE fk.conrelid = c.oid AND fk.contype = 'f'
      ), '[]'::json),

      'check_constraints', COALESCE((
        SELECT json_agg(json_build_object(
          'constraint_name', ck.conname,
          'expression', pg_catalog.pg_get_expr(ck.conbin, ck.conrelid)
        ) ORDER BY ck.conname)
        FROM pg_catalog.pg_constraint ck
        WHERE ck.conrelid = c.oid AND ck.contype = 'c'
      ), '[]'::json)
    ) ORDER BY n.nspname, c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
  ), '[]'::json)
)) AS dbmd_introspection;
`

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Keyed by what `format_type(oid, NULL)` prints, which is the SQL standard
 * spelling rather than the internal one: `character varying`, not `varchar`.
 *
 * Anything absent is `other`, on purpose. An array, an enum, a domain, `inet`,
 * `tsvector` and a PostGIS `geography` all keep their real name in
 * `ColumnType.native`, and a wrong normalisation would be worse than an honest
 * `other`. ADR 0009.
 */
const NORMALISED_BY_NATIVE: Readonly<Record<string, NormalisedType>> = {
  smallint: 'integer',
  integer: 'integer',
  bigint: 'integer',
  numeric: 'decimal',
  money: 'decimal',
  real: 'float',
  'double precision': 'float',
  boolean: 'boolean',
  'character varying': 'string',
  character: 'string',
  text: 'string',
  citext: 'string',
  date: 'date',
  'time without time zone': 'time',
  'time with time zone': 'time',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamp',
  interval: 'interval',
  uuid: 'uuid',
  bytea: 'binary',
  json: 'json',
  jsonb: 'json',
  xml: 'xml',
}

/** `pg_constraint.confdeltype` and `confupdtype`, which are single characters. */
const ACTION_BY_CODE: Readonly<Record<string, ReferentialAction>> = {
  a: 'noAction',
  r: 'restrict',
  c: 'cascade',
  n: 'setNull',
  d: 'setDefault',
}

// ---------------------------------------------------------------------------
// Reading untyped JSON without pretending it is typed
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function obj(value: unknown): Raw {
  return isObject(value) ? value : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** An empty string is treated as absent, because no catalog name is ever empty. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function names(value: unknown): string[] {
  return list(value)
    .map((item) => str(item))
    .filter((item): item is string => item !== undefined)
}

/** Spreadable optional field, so `exactOptionalPropertyTypes` stays honest. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

// ---------------------------------------------------------------------------
// Raw to canonical
// ---------------------------------------------------------------------------

function normalise(native: string): NormalisedType {
  return NORMALISED_BY_NATIVE[native.toLowerCase()] ?? 'other'
}

function columnType(raw: Raw): ColumnType {
  const native = str(raw['format_type']) ?? ''
  const normalised = normalise(native)

  // Precision only where a person chose it. The query already drops the
  // precision Postgres invents for the integer types, so what arrives here is
  // either a numeric(p,s) or a fractional-seconds precision, and which of the
  // two it is follows from the normalised type.
  const decimal = normalised === 'decimal'
  const temporal = normalised === 'timestamp' || normalised === 'time'

  return {
    native,
    normalised,
    ...optional('length', num(raw['character_maximum_length'])),
    ...(decimal ? optional('precision', num(raw['numeric_precision'])) : {}),
    ...(decimal ? optional('scale', num(raw['numeric_scale'])) : {}),
    ...(temporal ? optional('scale', num(raw['datetime_precision'])) : {}),
  }
}

function identity(raw: Raw): Identity | undefined {
  const generation = str(raw['identity_generation'])
  if (generation === undefined) return undefined
  // No seed or increment. Postgres keeps them on the owned sequence rather than
  // on the column, and the format has them because SQL Server puts them where
  // the column is. Reaching for them is a fair follow-up, not a silent one.
  return { generation: generation === 'ALWAYS' ? 'always' : 'byDefault' }
}

function column(raw: Raw): Column {
  const columnDefault = str(raw['column_default'])
  const generated = str(raw['generation_expression'])

  return {
    name: str(raw['column_name']) ?? '',
    type: columnType(raw),
    nullable: raw['not_null'] !== true,
    // No `constraintName`: Postgres does not name a default, so there is nothing
    // truthful to put there.
    ...optional('default', columnDefault === undefined ? undefined : { expression: columnDefault }),
    ...optional('identity', identity(raw)),
    // A Postgres generated column is always stored, so there is nothing to ask.
    ...optional(
      'generated',
      generated === undefined ? undefined : { expression: generated, persisted: true },
    ),
    ...optional('collation', str(raw['collation_name'])),
    ...optional('comment', str(raw['column_comment'])),
  }
}

function primaryKey(raw: unknown): PrimaryKey | undefined {
  if (!isObject(raw)) return undefined
  const columns = names(raw['columns'])
  if (columns.length === 0) return undefined
  // No `isClustered`. `pg_index.indisclustered` records which index the table was
  // last physically reordered by, which is a one-off maintenance fact and not the
  // SQL Server property that shares the name.
  return { ...optional('name', str(raw['constraint_name'])), columns }
}

function indexColumn(raw: Raw): IndexColumn {
  return {
    name: str(raw['column_name']) ?? '',
    ...(raw['is_descending'] === true ? { descending: true } : {}),
  }
}

function index(raw: Raw): Index {
  const included = names(raw['included_columns'])
  return {
    name: str(raw['index_name']) ?? '',
    columns: list(raw['key_columns']).map((item) => indexColumn(obj(item))),
    ...(included.length > 0 ? { includedColumns: included } : {}),
    isUnique: raw['is_unique'] === true,
    ...optional('filterExpression', str(raw['predicate'])),
    ...(raw['is_constraint'] === true ? { isUniqueConstraint: true } : {}),
  }
}

function foreignKey(raw: Raw): ForeignKey {
  return {
    ...optional('name', str(raw['constraint_name'])),
    columns: names(raw['columns']),
    referencedSchema: str(raw['referenced_schema']) ?? '',
    referencedTable: str(raw['referenced_table']) ?? '',
    referencedColumns: names(raw['referenced_columns']),
    ...optional('onDelete', ACTION_BY_CODE[str(raw['on_delete']) ?? '']),
    ...optional('onUpdate', ACTION_BY_CODE[str(raw['on_update']) ?? '']),
  }
}

function checkConstraint(raw: Raw): CheckConstraint {
  return {
    ...optional('name', str(raw['constraint_name'])),
    expression: str(raw['expression']) ?? '',
  }
}

function table(raw: Raw): Table {
  return {
    schema: str(raw['table_schema']) ?? '',
    name: str(raw['table_name']) ?? '',
    ...optional('comment', str(raw['table_comment'])),
    columns: list(raw['columns']).map((item) => column(obj(item))),
    ...optional('primaryKey', primaryKey(raw['primary_key'])),
    indexes: list(raw['indexes']).map((item) => index(obj(item))),
    foreignKeys: list(raw['foreign_keys']).map((item) => foreignKey(obj(item))),
    checkConstraints: list(raw['check_constraints']).map((item) => checkConstraint(obj(item))),
  }
}

function source(raw: Raw): SourceInfo {
  return {
    ...optional('database', str(raw['database'])),
    ...optional('engineVersion', str(raw['server_version'])),
    // datcollate, which is the closest Postgres has to the question SQL Server
    // answers with a collation name: it is what says whether this file came from
    // a case-sensitive world.
    ...optional('defaultCollation', str(raw['default_collation'])),
  }
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export const postgresProvider: EngineProvider = {
  id: 'postgres',
  displayName: 'PostgreSQL',

  introspectionQuery: () => INTROSPECTION_QUERY,

  normaliseType: normalise,

  quoteIdentifier: (name) => `"${name.replaceAll('"', '""')}"`,

  parse(raw: unknown): ParseResult {
    if (!isObject(raw)) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'import/not-an-object',
            severity: 'error',
            at: inDocument('$'),
            message:
              'the Postgres query returns one JSON object and this file is not one; save the whole value of the single result cell, without the table frame a client draws around it',
          },
        ],
      }
    }

    if (raw['tables'] !== undefined && raw['tables'] !== null && !Array.isArray(raw['tables'])) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'import/wrong-type',
            severity: 'error',
            at: inDocument('$.tables'),
            message: '`tables` is not a list, so this is not what the Postgres query prints',
          },
        ],
      }
    }

    // Everything past here is shape rather than structure, and the contract
    // validator says so with a path on it. See `provider.ts`.
    const document: IntrospectionDocument = {
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'postgres',
      source: source(raw),
      tables: list(raw['tables']).map((item) => table(obj(item))),
    }
    return { ok: true, value: document, diagnostics: [] }
  },
}
