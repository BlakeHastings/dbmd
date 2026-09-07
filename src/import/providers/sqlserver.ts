// The SQL Server provider. ADR 0007: one file, one registry line, and nothing
// outside this directory learns the word "sqlserver".
//
// Two halves that never meet, the same as `postgres.ts`. `introspectionQuery` is
// SQL a human runs against their own database and reads before they do.
// `parse` is a pure function from what that SQL prints to the canonical shape in
// `../contract.ts`, developed and tested against a committed fixture. The
// fixture proves this half and never the SQL, so a change to the query needs a
// real SQL Server and the pull request has to say whether it got one.
//
// This provider is the one that was supposed to find out whether the seam in ADR
// 0007 was real. It did not need a single change to `../contract.ts`, and the
// three places it came closest are marked below with what they could not say.

import type {
  CheckConstraint,
  Column,
  ColumnType,
  ForeignKey,
  Identity,
  Index,
  IndexKey,
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
 * What `dbmd query --engine sqlserver` prints.
 *
 * The comment block on top is not documentation that happens to be in a string:
 * it is the only place the person about to copy the result out of SSMS is
 * certainly looking. The 2033-character split is this feature's most likely
 * support question and it is answered there rather than in a file nobody opened.
 */
const INTROSPECTION_QUERY = `-- dbmd introspection query for SQL Server 2016 or later.
--
-- READ ONLY, and written to be checked rather than trusted. It is one SELECT
-- over the system catalog views. There is no INSERT, UPDATE, DELETE, MERGE,
-- CREATE, ALTER, DROP, TRUNCATE, GRANT, BACKUP, EXEC or SET anywhere in it; it
-- creates nothing, not even a temporary table; and every relation it reads is a
-- \`sys.\` catalog view, so it never looks at a row of your data.
--
-- One statement and no GO, so it pastes whole into SSMS, Azure Data Studio,
-- sqlcmd or a JDBC console alike. It returns one row of one column,
-- dbmd_introspection, holding the JSON \`dbmd import\` reads. Run it against the
-- database you want to model: it describes the one you are connected to.
--
--
-- BEFORE YOU COPY THE RESULT OUT OF SSMS, READ THIS PARAGRAPH.
--
-- SQL Server hands a FOR JSON result back in 2033-character pieces, one grid row
-- each, and it splits wherever the 2033rd character falls, which is usually the
-- middle of a word. Copying "the row" out of the grid then gives you JSON that
-- looks finished and is not. That is the single most likely thing to go wrong
-- here, so this query wraps its FOR JSON in a scalar subquery on purpose: the
-- server then materialises one value in one row and there is nothing to split.
--
-- What that does not fix is the grid's own display cap. SSMS shows at most 65535
-- characters of a cell (Tools > Options > Query Results > SQL Server > Results
-- to Grid), and Results to Text stops at 256 by default, and neither says it
-- truncated anything. A schema of any size goes past both. So do not copy out of
-- the grid at all:
--
--   * SSMS: Query > Results To > Results to File, or right-click the cell and
--     Save Results As.
--   * sqlcmd: \`sqlcmd -S server -d yourdb -y 0 -Y 0 -i query.sql -o model.json\`.
--     Without -y 0 sqlcmd truncates at 256 characters.
--   * Azure Data Studio: "Save as JSON" on the result grid.
--
-- If dbmd tells you the file is not valid JSON, or that it stops part way
-- through, it is this: the copy was cut short, not the query.
--
--
-- FOR JSON arrived in SQL Server 2016. On 2014 or earlier the parser has never
-- heard of the words and the statement fails to compile, before it reads
-- anything, with
--
--   Msg 102, Level 15, State 1: Incorrect syntax near 'JSON'.
--
-- That error means the server is too old rather than the query being wrong, and
-- there is no older fallback: dbmd cannot import from those versions.
--
-- Identifiers come out exactly as the catalog holds them, brackets, spaces and
-- case included, and nothing here folds any of it. Whether \`Orders\` and
-- \`orders\` could both exist is a question about your collation, and this file
-- answers it by reporting the database collation rather than by taking a side.
--
-- Lengths are \`sys.columns.max_length\` as the catalog states it, which is bytes
-- rather than characters and -1 for the \`(max)\` forms. dbmd translates both on
-- the way in. Nothing is tidied up here, so what you read is what the catalog
-- says.

SELECT (
  SELECT
    1 AS dbmdIntrospection,
    'sqlserver' AS engine,
    DB_NAME() AS [database],
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS productVersion,
    CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS collation,

    -- Every nested list below is a list of objects, including the ones that hold
    -- nothing but a name. FOR JSON has no way to emit an array of bare strings
    -- before SQL Server 2017's STRING_AGG, and a query that builds one by
    -- concatenating text would have to escape the text itself. One shape for
    -- every list is worth more here than matching what a Postgres file happens
    -- to look like: the file is the provider's own, and only the provider reads
    -- it.
    (
      SELECT
        s.name AS [schema],
        t.name AS name,
        (
          SELECT CONVERT(nvarchar(max), ep.value)
          FROM sys.extended_properties ep
          WHERE ep.class = 1 AND ep.major_id = t.object_id AND ep.minor_id = 0
            AND ep.name = 'MS_Description'
        ) AS [description],

        (
          SELECT
            c.name AS name,
            -- The user type is the truthful name of the column's type, and for
            -- an alias type (CREATE TYPE PostCode FROM nvarchar(16)) that is the
            -- alias. The system type underneath it is reported only when it
            -- differs, and only so that the length below can be read in the
            -- right unit: getting that wrong doubles every string column.
            TYPE_NAME(c.user_type_id) AS [type],
            NULLIF(TYPE_NAME(c.system_type_id), TYPE_NAME(c.user_type_id)) AS systemType,
            c.max_length AS maxLength,
            c.[precision] AS [precision],
            c.scale AS scale,
            c.is_nullable AS isNullable,
            c.is_identity AS isIdentity,
            -- seed_value and increment_value are sql_variant, which FOR JSON
            -- renders by its base type. TRY_CONVERT rather than CONVERT so that
            -- one exotic identity cannot fail the whole statement.
            TRY_CONVERT(bigint, idc.seed_value) AS seedValue,
            TRY_CONVERT(bigint, idc.increment_value) AS incrementValue,
            dc.name AS defaultName,
            dc.definition AS defaultDefinition,
            cc.definition AS computedDefinition,
            cc.is_persisted AS isPersisted,
            c.collation_name AS collationName,
            (
              SELECT CONVERT(nvarchar(max), ep.value)
              FROM sys.extended_properties ep
              WHERE ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id
                AND ep.name = 'MS_Description'
            ) AS [description]
          FROM sys.columns c
          LEFT JOIN sys.identity_columns idc
            ON idc.object_id = c.object_id AND idc.column_id = c.column_id
          LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
          LEFT JOIN sys.computed_columns cc
            ON cc.object_id = c.object_id AND cc.column_id = c.column_id
          WHERE c.object_id = t.object_id
          ORDER BY c.column_id
          FOR JSON PATH
        ) AS columns,

        -- JSON_QUERY, and it is load-bearing. A nested FOR JSON subquery is
        -- inlined as JSON only when it produces an array; add
        -- WITHOUT_ARRAY_WRAPPER and the outer query treats the result as an
        -- ordinary string and escapes it, so primaryKey comes back as a quoted
        -- blob of backslashes. JSON_QUERY says "this is already JSON".
        JSON_QUERY((
          SELECT
            kc.name AS name,
            CONVERT(bit, CASE WHEN i.type = 1 THEN 1 ELSE 0 END) AS isClustered,
            (
              SELECT COL_NAME(ic.object_id, ic.column_id) AS name
              FROM sys.index_columns ic
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.is_included_column = 0
              ORDER BY ic.key_ordinal
              FOR JSON PATH
            ) AS columns
          FROM sys.key_constraints kc
          JOIN sys.indexes i
            ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id
          WHERE kc.parent_object_id = t.object_id AND kc.type = 'PK'
          FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        )) AS primaryKey,

        (
          SELECT
            i.name AS name,
            i.is_unique AS isUnique,
            CONVERT(bit, CASE WHEN i.type = 1 THEN 1 ELSE 0 END) AS isClustered,
            -- Whether a UNIQUE constraint owns the index, which is not the same
            -- question as whether the index is unique, and is why the format has
            -- both flags.
            i.is_unique_constraint AS isUniqueConstraint,
            i.filter_definition AS filterDefinition,
            (
              SELECT
                COL_NAME(ic.object_id, ic.column_id) AS name,
                ic.is_descending_key AS isDescending
              FROM sys.index_columns ic
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.is_included_column = 0
              ORDER BY ic.key_ordinal
              FOR JSON PATH
            ) AS keyColumns,
            (
              SELECT COL_NAME(ic.object_id, ic.column_id) AS name
              FROM sys.index_columns ic
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.is_included_column = 1
              ORDER BY ic.index_column_id
              FOR JSON PATH
            ) AS includedColumns
          FROM sys.indexes i
          WHERE i.object_id = t.object_id
            -- The primary key's own index is not repeated: primaryKey above is
            -- the one place that fact lives.
            AND i.is_primary_key = 0
            -- A hypothetical index is a statistics artefact the tuning advisor
            -- left behind, not something anybody modelled.
            AND i.is_hypothetical = 0
            -- Rowstore only. Type 0 is the heap itself, which is a row in
            -- sys.indexes with no name at all; a columnstore, XML, spatial or
            -- hash index has no ordered key list, so the shape it would arrive
            -- in is an index with no key columns. The format has no access
            -- method (docs/import-format.md says why), so there is nothing it
            -- could say about those beyond a name, and it says nothing.
            AND i.type IN (1, 2)
          -- A binary collation on every ORDER BY, so that the bytes of this file
          -- do not depend on the collation of the server that produced it. dbmd
          -- sorts again on the way in; this is so that two runs of the query on
          -- two servers can be diffed against each other.
          ORDER BY i.name COLLATE Latin1_General_BIN2
          FOR JSON PATH
        ) AS indexes,

        (
          SELECT
            fk.name AS name,
            (
              SELECT COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS name
              FROM sys.foreign_key_columns fkc
              WHERE fkc.constraint_object_id = fk.object_id
              ORDER BY fkc.constraint_column_id
              FOR JSON PATH
            ) AS columns,
            rs.name AS referencedSchema,
            rt.name AS referencedTable,
            (
              SELECT COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS name
              FROM sys.foreign_key_columns fkc
              WHERE fkc.constraint_object_id = fk.object_id
              ORDER BY fkc.constraint_column_id
              FOR JSON PATH
            ) AS referencedColumns,
            fk.delete_referential_action_desc AS deleteAction,
            fk.update_referential_action_desc AS updateAction
          FROM sys.foreign_keys fk
          JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
          JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
          WHERE fk.parent_object_id = t.object_id
          ORDER BY fk.name COLLATE Latin1_General_BIN2
          FOR JSON PATH
        ) AS foreignKeys,

        (
          SELECT ck.name AS name, ck.definition AS definition
          FROM sys.check_constraints ck
          WHERE ck.parent_object_id = t.object_id
          ORDER BY ck.name COLLATE Latin1_General_BIN2
          FOR JSON PATH
        ) AS checkConstraints

      -- User tables only. A view is not a table, and is_ms_shipped excludes the
      -- ones the product put there itself.
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.is_ms_shipped = 0 AND t.type = 'U'
      ORDER BY s.name COLLATE Latin1_General_BIN2, t.name COLLATE Latin1_General_BIN2
      FOR JSON PATH
    ) AS tables

  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS dbmd_introspection;
`

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Keyed by what `TYPE_NAME(user_type_id)` prints, lower cased.
 *
 * Anything absent is `other`, on purpose: an alias type, a CLR type, `geography`,
 * `hierarchyid` and `sql_variant` all keep their real name in `ColumnType.native`
 * and a wrong normalisation would be worse than an honest `other`. ADR 0009.
 */
const NORMALISED_BY_NATIVE: Readonly<Record<string, NormalisedType>> = {
  bigint: 'integer',
  int: 'integer',
  smallint: 'integer',
  tinyint: 'integer',
  bit: 'boolean',
  decimal: 'decimal',
  numeric: 'decimal',
  money: 'decimal',
  smallmoney: 'decimal',
  float: 'float',
  real: 'float',
  char: 'string',
  varchar: 'string',
  nchar: 'string',
  nvarchar: 'string',
  text: 'string',
  ntext: 'string',
  // The system alias for nvarchar(128) that the catalog views are made of. It is
  // a fixed definition rather than something a user chose, so naming it is not a
  // guess in the way an alias type would be.
  sysname: 'string',
  date: 'date',
  time: 'time',
  datetime: 'timestamp',
  datetime2: 'timestamp',
  smalldatetime: 'timestamp',
  datetimeoffset: 'timestamp',
  uniqueidentifier: 'uuid',
  binary: 'binary',
  varbinary: 'binary',
  image: 'binary',
  // `rowversion` and `timestamp` are the same type and it is not a time. A
  // rowversion column reports `timestamp` from TYPE_NAME, so leaving this out
  // would normalise the one SQL Server type whose name collides with a
  // normalised name into exactly the wrong one.
  rowversion: 'binary',
  timestamp: 'binary',
  json: 'json',
  xml: 'xml',
}

/**
 * Lengths, keyed by the *system* type, because that is what `max_length` is
 * measured in.
 *
 * `text`, `ntext` and `image` are deliberately absent: `sys.columns` reports 16
 * for all three, which is the size of the pointer to the data rather than of the
 * data, and carrying it would put `length: 16` on a two-gigabyte column. `xml`,
 * `geography` and the other CLR types are absent for the opposite reason: they
 * report -1 and are not sized at all, so translating that to `"max"` would be
 * inventing a fact.
 */
const SIZED_TYPES = new Set(['char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary'])

/** The two whose `max_length` counts bytes at two per character. */
const DOUBLE_BYTE_TYPES = new Set(['nchar', 'nvarchar'])

/** `sys.foreign_keys.delete_referential_action_desc` and its update twin. */
const ACTION_BY_NAME: Readonly<Record<string, ReferentialAction>> = {
  NO_ACTION: 'noAction',
  CASCADE: 'cascade',
  SET_NULL: 'setNull',
  SET_DEFAULT: 'setDefault',
  // No RESTRICT. SQL Server does not have one, which is why the contract's list
  // is longer than either engine's.
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

/** Every list of names in this file's JSON is a list of `{ "name": ... }`. */
function names(value: unknown): string[] {
  return list(value)
    .map((item) => str(obj(item)['name']))
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

/**
 * `sys.columns.max_length` to the contract's `length`.
 *
 * Three separate traps in one small function: -1 is the `(max)` forms rather than
 * a length, `nchar` and `nvarchar` count bytes so `nvarchar(50)` reads as 100,
 * and a type that is not sized at all still has a number in that column.
 */
function columnLength(
  systemType: string,
  maxLength: number | undefined,
): number | 'max' | undefined {
  if (maxLength === undefined || !SIZED_TYPES.has(systemType)) return undefined
  if (maxLength === -1) return 'max'
  return DOUBLE_BYTE_TYPES.has(systemType) ? maxLength / 2 : maxLength
}

function columnType(raw: Raw): ColumnType {
  const native = str(raw['type']) ?? ''
  // Absent means the two agree, which is every column that is not alias typed.
  const systemType = (str(raw['systemType']) ?? native).toLowerCase()
  const normalised = normalise(native)

  // sys.columns gives every column a precision and a scale, so `int` arrives as
  // precision 10 and `nvarchar` as precision 0. Only the ones somebody wrote down
  // survive: decimal(12,2), and the fractional seconds on a temporal type.
  const decimal = normalised === 'decimal'
  const temporal = normalised === 'timestamp' || normalised === 'time'

  return {
    native,
    normalised,
    ...optional('length', columnLength(systemType, num(raw['maxLength']))),
    ...(decimal ? optional('precision', num(raw['precision'])) : {}),
    ...(decimal ? optional('scale', num(raw['scale'])) : {}),
    ...(temporal ? optional('scale', num(raw['scale'])) : {}),
  }
}

function identity(raw: Raw): Identity | undefined {
  if (raw['isIdentity'] !== true) return undefined
  // SQL Server has no BY DEFAULT form. An IDENTITY value is assigned unless
  // somebody turns IDENTITY_INSERT on for the session, so `always` is the closer
  // of the two the contract offers.
  return {
    generation: 'always',
    ...optional('seed', num(raw['seedValue'])),
    ...optional('increment', num(raw['incrementValue'])),
  }
}

function column(raw: Raw): Column {
  const defaultDefinition = str(raw['defaultDefinition'])
  const computed = str(raw['computedDefinition'])

  return {
    name: str(raw['name']) ?? '',
    type: columnType(raw),
    nullable: raw['isNullable'] === true,
    ...optional(
      'default',
      defaultDefinition === undefined
        ? undefined
        : {
            // Verbatim, so `((0))` stays `((0))`. See docs/import-format.md.
            expression: defaultDefinition,
            ...optional('constraintName', str(raw['defaultName'])),
          },
    ),
    ...optional('identity', identity(raw)),
    ...optional(
      'generated',
      computed === undefined
        ? undefined
        : { expression: computed, persisted: raw['isPersisted'] === true },
    ),
    // Reported whenever the catalog reports it, which is on every character
    // column. Unlike Postgres, SQL Server records only the collation in effect
    // and not whether the author asked for it, so suppressing the ones that
    // match the database default would be dbmd inventing a distinction the
    // catalog does not draw. `source.defaultCollation` is there to compare against.
    ...optional('collation', str(raw['collationName'])),
    ...optional('comment', str(raw['description'])),
  }
}

function primaryKey(raw: unknown): PrimaryKey | undefined {
  if (!isObject(raw)) return undefined
  const columns = names(raw['columns'])
  if (columns.length === 0) return undefined
  return {
    ...optional('name', str(raw['name'])),
    columns,
    isClustered: raw['isClustered'] === true,
  }
}

/**
 * One index key, and always a column.
 *
 * SQL Server has no functional index. An index over an expression is an index
 * over a computed column, and that column carries the expression in `generated`,
 * so `IndexKeyExpression` never appears in a SQL Server document. That is not a
 * gap: it is ADR 0022's point that the two engines reach the same place by
 * different routes, and the union in the contract exists for the route Postgres
 * takes.
 */
function indexKey(raw: Raw): IndexKey {
  return {
    column: str(raw['name']) ?? '',
    ...(raw['isDescending'] === true ? { descending: true } : {}),
  }
}

function index(raw: Raw): Index {
  const included = names(raw['includedColumns'])
  return {
    name: str(raw['name']) ?? '',
    columns: list(raw['keyColumns']).map((item) => indexKey(obj(item))),
    ...(included.length > 0 ? { includedColumns: included } : {}),
    isUnique: raw['isUnique'] === true,
    // Both values are information here, unlike in Postgres where the flag of the
    // same name means something else and is not carried at all.
    isClustered: raw['isClustered'] === true,
    ...optional('filterExpression', str(raw['filterDefinition'])),
    ...(raw['isUniqueConstraint'] === true ? { isUniqueConstraint: true } : {}),
  }
}

function foreignKey(raw: Raw): ForeignKey {
  return {
    ...optional('name', str(raw['name'])),
    columns: names(raw['columns']),
    referencedSchema: str(raw['referencedSchema']) ?? '',
    referencedTable: str(raw['referencedTable']) ?? '',
    referencedColumns: names(raw['referencedColumns']),
    ...optional('onDelete', ACTION_BY_NAME[str(raw['deleteAction']) ?? '']),
    ...optional('onUpdate', ACTION_BY_NAME[str(raw['updateAction']) ?? '']),
  }
}

function checkConstraint(raw: Raw): CheckConstraint {
  return {
    ...optional('name', str(raw['name'])),
    expression: str(raw['definition']) ?? '',
  }
}

function table(raw: Raw): Table {
  return {
    // `dbo` arrives as a schema name like any other, because it is one.
    schema: str(raw['schema']) ?? '',
    name: str(raw['name']) ?? '',
    ...optional('comment', str(raw['description'])),
    columns: list(raw['columns']).map((item) => column(obj(item))),
    ...optional('primaryKey', primaryKey(raw['primaryKey'])),
    indexes: list(raw['indexes']).map((item) => index(obj(item))),
    foreignKeys: list(raw['foreignKeys']).map((item) => foreignKey(obj(item))),
    checkConstraints: list(raw['checkConstraints']).map((item) => checkConstraint(obj(item))),
  }
}

function source(raw: Raw): SourceInfo {
  return {
    ...optional('database', str(raw['database'])),
    ...optional('engineVersion', str(raw['productVersion'])),
    // The database collation, which is what says whether this file came from a
    // case-sensitive world. The contract takes no position; this is the fact it
    // takes it from.
    ...optional('defaultCollation', str(raw['collation'])),
  }
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export const sqlserverProvider: EngineProvider = {
  id: 'sqlserver',
  displayName: 'SQL Server',

  introspectionQuery: () => INTROSPECTION_QUERY,

  normaliseType: normalise,

  quoteIdentifier: (name) => `[${name.replaceAll(']', ']]')}]`,

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
              'the SQL Server query returns one JSON object and this file is not one; SQL Server hands a FOR JSON result to the client in 2033-character pieces, so a result copied out of the SSMS grid is very often part of the JSON rather than all of it; save the cell with Results to File or Save Results As instead of copying it',
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
            message:
              '`tables` is not a list, so this is not what the SQL Server query prints; if it is a string of escaped JSON, something re-quoted the result on the way out of the client',
          },
        ],
      }
    }

    // Everything past here is shape rather than structure, and the contract
    // validator says so with a path on it. See `provider.ts`.
    const document: IntrospectionDocument = {
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'sqlserver',
      source: source(raw),
      tables: list(raw['tables']).map((item) => table(obj(item))),
    }
    return { ok: true, value: document, diagnostics: [] }
  },
}
