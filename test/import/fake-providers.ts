// Two test doubles, one shaped like each engine.
//
// They are deliberately fake: `introspectionQuery` returns a sentence rather than
// SQL, and nothing here has ever seen a database. What they do have is the real
// translation problem, because they read fixtures written in each engine's own
// idiom. That is the point. The registry, the envelope dispatch and the contract
// can then be proved before either real engine exists, and the shape of the
// contract gets argued with by SQL Server rather than agreed with by Postgres.
//
// The real providers are dbmd-43 and dbmd-44 and live in `src/import/providers/`.
// These stay afterwards, because a conformance test that depends on no real
// engine is worth having when somebody changes the contract.

import type {
  CheckConstraint,
  Column,
  ColumnType,
  ForeignKey,
  Index,
  IndexKey,
  IntrospectionDocument,
  NormalisedType,
  PrimaryKey,
  ReferentialAction,
  SourceInfo,
  Table,
} from '../../src/import/contract.js'
import { inDocument } from '../../src/import/diagnostics.js'
import type { EngineProvider, ParseResult } from '../../src/import/provider.js'

// ---------------------------------------------------------------------------
// Reading untyped JSON without pretending it is typed
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>

function obj(value: unknown): Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function bool(value: unknown): boolean {
  return value === true
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

/**
 * A list of `{ "name": ... }`, which is how the SQL Server file spells every list
 * of column names. `FOR JSON` has no way to emit an array of bare strings, so
 * the engine's own output is objects all the way down and the Postgres file's
 * plain `["id"]` is the shape SQL Server cannot produce rather than the norm.
 */
function objectNames(value: unknown): string[] {
  return list(value)
    .map((item) => str(obj(item)['name']))
    .filter((item): item is string => item !== undefined)
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const POSTGRES_TYPES: Record<string, NormalisedType> = {
  bigint: 'integer',
  integer: 'integer',
  smallint: 'integer',
  numeric: 'decimal',
  'double precision': 'float',
  real: 'float',
  boolean: 'boolean',
  'character varying': 'string',
  character: 'string',
  text: 'string',
  date: 'date',
  'time without time zone': 'time',
  'timestamp with time zone': 'timestamp',
  'timestamp without time zone': 'timestamp',
  interval: 'interval',
  uuid: 'uuid',
  json: 'json',
  jsonb: 'json',
  xml: 'xml',
  bytea: 'binary',
}

/** `pg_constraint.confdeltype` and `confupdtype` are single characters. */
const POSTGRES_ACTIONS: Record<string, ReferentialAction> = {
  a: 'noAction',
  r: 'restrict',
  c: 'cascade',
  n: 'setNull',
  d: 'setDefault',
}

/** `format_type` includes the modifier, and the modifier is carried in its own fields. */
function bareTypeName(formatType: string): string {
  const open = formatType.indexOf('(')
  return open === -1 ? formatType : formatType.slice(0, open)
}

export const fakePostgresProvider: EngineProvider = {
  id: 'postgres',
  displayName: 'PostgreSQL (test double)',

  introspectionQuery: () => 'no SQL here: this is the test double, and dbmd-43 is the real one',

  normaliseType: (native) => POSTGRES_TYPES[bareTypeName(native)] ?? 'other',

  quoteIdentifier: (name) => `"${name.replaceAll('"', '""')}"`,

  parse(raw: unknown): ParseResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'import/not-an-object',
            severity: 'error',
            at: inDocument('$'),
            message: 'the Postgres query returns one JSON object and this file is not one',
          },
        ],
      }
    }
    const file = obj(raw)
    const source: SourceInfo = {
      ...optional('database', str(file['database'])),
      ...optional('engineVersion', str(file['server_version'])),
      ...optional('defaultCollation', str(file['default_collation'])),
    }
    const document: IntrospectionDocument = {
      dbmdIntrospection: 1,
      engine: 'postgres',
      source,
      tables: list(file['tables']).map((table) => postgresTable(obj(table))),
    }
    return { ok: true, value: document, diagnostics: [] }
  },
}

function postgresTable(raw: Raw): Table {
  const primaryKeyRaw = obj(raw['primary_key'])
  const primaryKey: PrimaryKey | undefined = str(primaryKeyRaw['constraint_name'])
    ? {
        ...optional('name', str(primaryKeyRaw['constraint_name'])),
        columns: list(primaryKeyRaw['columns']).map((c) => String(c)),
      }
    : undefined

  return {
    schema: str(raw['table_schema']) ?? '',
    name: str(raw['table_name']) ?? '',
    ...optional('comment', str(raw['table_comment'])),
    columns: list(raw['columns']).map((c) => postgresColumn(obj(c))),
    ...optional('primaryKey', primaryKey),
    indexes: list(raw['indexes']).map((i) => postgresIndex(obj(i))),
    foreignKeys: list(raw['foreign_keys']).map((f) => postgresForeignKey(obj(f))),
    checkConstraints: list(raw['check_constraints']).map((c) => postgresCheck(obj(c))),
  }
}

function postgresColumn(raw: Raw): Column {
  const formatType = str(raw['format_type']) ?? ''
  const normalised = fakePostgresProvider.normaliseType(formatType)
  const type: ColumnType = {
    native: bareTypeName(formatType),
    normalised,
    ...optional('length', num(raw['character_maximum_length'])),
    // Postgres reports a precision for every numeric type, in bits for the
    // integers. Carrying `bigint` as precision 64 would be true and useless, so
    // only the types where the user chose the precision keep it.
    ...(normalised === 'decimal'
      ? {
          ...optional('precision', num(raw['numeric_precision'])),
          ...optional('scale', num(raw['numeric_scale'])),
        }
      : {}),
  }

  const identityGeneration = str(raw['identity_generation'])
  const generationExpression = str(raw['generation_expression'])

  return {
    name: str(raw['column_name']) ?? '',
    type,
    nullable: raw['not_null'] !== true,
    ...optional(
      'default',
      str(raw['column_default']) === undefined
        ? undefined
        : { expression: str(raw['column_default']) as string },
    ),
    ...optional(
      'identity',
      identityGeneration === undefined
        ? undefined
        : {
            generation:
              identityGeneration === 'ALWAYS' ? ('always' as const) : ('byDefault' as const),
          },
    ),
    ...optional(
      'generated',
      // A Postgres generated column is always stored, so there is nothing to ask.
      generationExpression === undefined
        ? undefined
        : { expression: generationExpression, persisted: true },
    ),
    ...optional('collation', str(raw['collation_name'])),
    ...optional('comment', str(raw['column_comment'])),
  }
}

function postgresIndex(raw: Raw): Index {
  const included = list(raw['included_columns']).map((c) => String(c))
  return {
    name: str(raw['index_name']) ?? '',
    columns: list(raw['key_columns']).map((c): IndexKey => {
      const key = obj(c)
      const direction = bool(key['is_descending']) ? { descending: true } : {}
      const column = str(key['column_name'])
      if (column !== undefined) return { column, ...direction }
      return { expression: str(key['expression']) ?? '', ...direction }
    }),
    ...(included.length > 0 ? { includedColumns: included } : {}),
    isUnique: bool(raw['is_unique']),
    ...optional('filterExpression', str(raw['predicate'])),
    ...(bool(raw['is_constraint']) ? { isUniqueConstraint: true } : {}),
    // No `isClustered`. `pg_index.indisclustered` records which index the table
    // was last physically reordered by, which is a one-off maintenance fact and
    // not the SQL Server property of the same name.
  }
}

function postgresForeignKey(raw: Raw): ForeignKey {
  return {
    ...optional('name', str(raw['constraint_name'])),
    columns: list(raw['columns']).map((c) => String(c)),
    referencedSchema: str(raw['referenced_schema']) ?? '',
    referencedTable: str(raw['referenced_table']) ?? '',
    referencedColumns: list(raw['referenced_columns']).map((c) => String(c)),
    ...optional('onDelete', POSTGRES_ACTIONS[str(raw['on_delete']) ?? '']),
    ...optional('onUpdate', POSTGRES_ACTIONS[str(raw['on_update']) ?? '']),
  }
}

function postgresCheck(raw: Raw): CheckConstraint {
  return {
    ...optional('name', str(raw['constraint_name'])),
    expression: str(raw['expression']) ?? '',
  }
}

// ---------------------------------------------------------------------------
// SQL Server
// ---------------------------------------------------------------------------

const SQLSERVER_TYPES: Record<string, NormalisedType> = {
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
  rowversion: 'binary',
  xml: 'xml',
}

/** Two bytes per character, and the same length column says -1 for the max forms. */
const DOUBLE_BYTE_TYPES = new Set(['nchar', 'nvarchar', 'ntext'])
// `text`, `ntext` and `image` are not here: sys.columns reports 16 for all three,
// which is the size of the pointer rather than of the data.
const SIZED_TYPES = new Set(['char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary'])

const SQLSERVER_ACTIONS: Record<string, ReferentialAction> = {
  NO_ACTION: 'noAction',
  CASCADE: 'cascade',
  SET_NULL: 'setNull',
  SET_DEFAULT: 'setDefault',
  // No RESTRICT. SQL Server does not have one, which is why the contract's list
  // is longer than either engine's.
}

function sqlServerLength(type: string, maxLength: number | undefined): number | 'max' | undefined {
  if (maxLength === undefined || !SIZED_TYPES.has(type)) return undefined
  if (maxLength === -1) return 'max'
  return DOUBLE_BYTE_TYPES.has(type) ? maxLength / 2 : maxLength
}

export const fakeSqlServerProvider: EngineProvider = {
  id: 'sqlserver',
  displayName: 'SQL Server (test double)',

  introspectionQuery: () => 'no SQL here: this is the test double, and dbmd-44 is the real one',

  normaliseType: (native) => SQLSERVER_TYPES[native.toLowerCase()] ?? 'other',

  quoteIdentifier: (name) => `[${name.replaceAll(']', ']]')}]`,

  parse(raw: unknown): ParseResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        ok: false,
        diagnostics: [
          {
            code: 'import/not-an-object',
            severity: 'error',
            at: inDocument('$'),
            message:
              'this is not one JSON object; SSMS splits FOR JSON output across rows at about 2000 characters, and a partial copy out of the grid looks like this',
          },
        ],
      }
    }
    const file = obj(raw)
    const source: SourceInfo = {
      ...optional('database', str(file['database'])),
      ...optional('engineVersion', str(file['productVersion'])),
      ...optional('defaultCollation', str(file['collation'])),
    }
    const document: IntrospectionDocument = {
      dbmdIntrospection: 1,
      engine: 'sqlserver',
      source,
      tables: list(file['tables']).map((table) => sqlServerTable(obj(table))),
    }
    return { ok: true, value: document, diagnostics: [] }
  },
}

function sqlServerTable(raw: Raw): Table {
  const primaryKeyRaw = obj(raw['primaryKey'])
  const primaryKey: PrimaryKey | undefined = str(primaryKeyRaw['name'])
    ? {
        ...optional('name', str(primaryKeyRaw['name'])),
        columns: objectNames(primaryKeyRaw['columns']),
        isClustered: bool(primaryKeyRaw['isClustered']),
      }
    : undefined

  return {
    // `dbo` arrives as a schema name like any other, because it is one.
    schema: str(raw['schema']) ?? '',
    name: str(raw['name']) ?? '',
    ...optional('comment', str(raw['description'])),
    columns: list(raw['columns']).map((c) => sqlServerColumn(obj(c))),
    ...optional('primaryKey', primaryKey),
    indexes: list(raw['indexes']).map((i) => sqlServerIndex(obj(i))),
    foreignKeys: list(raw['foreignKeys']).map((f) => sqlServerForeignKey(obj(f))),
    checkConstraints: list(raw['checkConstraints']).map((c) => sqlServerCheck(obj(c))),
  }
}

function sqlServerColumn(raw: Raw): Column {
  const native = str(raw['type']) ?? ''
  const normalised = fakeSqlServerProvider.normaliseType(native)
  const type: ColumnType = {
    native,
    normalised,
    ...optional('length', sqlServerLength(native.toLowerCase(), num(raw['maxLength']))),
    // sys.columns gives every type a precision and a scale. Only the ones the
    // user wrote down survive: decimal(12,2), and the fractional seconds on the
    // temporal types.
    ...(normalised === 'decimal'
      ? {
          ...optional('precision', num(raw['precision'])),
          ...optional('scale', num(raw['scale'])),
        }
      : {}),
    ...(normalised === 'timestamp' || normalised === 'time'
      ? { ...optional('scale', num(raw['scale'])) }
      : {}),
  }

  const defaultDefinition = str(raw['defaultDefinition'])
  const computed = str(raw['computedDefinition'])

  return {
    name: str(raw['name']) ?? '',
    type,
    nullable: raw['isNullable'] === true,
    ...optional(
      'default',
      defaultDefinition === undefined
        ? undefined
        : {
            // Verbatim, parentheses and all. See docs/import-format.md.
            expression: defaultDefinition,
            ...optional('constraintName', str(raw['defaultName'])),
          },
    ),
    ...optional(
      'identity',
      bool(raw['isIdentity'])
        ? {
            // SQL Server has no BY DEFAULT form: IDENTITY is assigned unless
            // somebody sets IDENTITY_INSERT, so `always` is the closer of the two.
            generation: 'always' as const,
            ...optional('seed', num(raw['seedValue'])),
            ...optional('increment', num(raw['incrementValue'])),
          }
        : undefined,
    ),
    ...optional(
      'generated',
      computed === undefined
        ? undefined
        : { expression: computed, persisted: bool(raw['isPersisted']) },
    ),
    ...optional('collation', str(raw['collationName'])),
    ...optional('comment', str(raw['description'])),
  }
}

function sqlServerIndex(raw: Raw): Index {
  const included = objectNames(raw['includedColumns'])
  return {
    name: str(raw['name']) ?? '',
    columns: list(raw['keyColumns']).map((c): IndexKey => {
      const key = obj(c)
      return {
        column: str(key['name']) ?? '',
        ...(bool(key['isDescending']) ? { descending: true } : {}),
      }
    }),
    ...(included.length > 0 ? { includedColumns: included } : {}),
    isUnique: bool(raw['isUnique']),
    isClustered: bool(raw['isClustered']),
    ...optional('filterExpression', str(raw['filterDefinition'])),
    ...(bool(raw['isUniqueConstraint']) ? { isUniqueConstraint: true } : {}),
  }
}

function sqlServerForeignKey(raw: Raw): ForeignKey {
  return {
    ...optional('name', str(raw['name'])),
    columns: objectNames(raw['columns']),
    referencedSchema: str(raw['referencedSchema']) ?? '',
    referencedTable: str(raw['referencedTable']) ?? '',
    referencedColumns: objectNames(raw['referencedColumns']),
    ...optional('onDelete', SQLSERVER_ACTIONS[str(raw['deleteAction']) ?? '']),
    ...optional('onUpdate', SQLSERVER_ACTIONS[str(raw['updateAction']) ?? '']),
  }
}

function sqlServerCheck(raw: Raw): CheckConstraint {
  return {
    ...optional('name', str(raw['name'])),
    expression: str(raw['definition']) ?? '',
  }
}
