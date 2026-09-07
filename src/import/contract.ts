// The canonical introspection shape, and the validator that produces it.
//
// ADR 0007: an engine is a provider, the file a user pastes is engine-shaped, and
// the envelope on top of it says what produced it. This module owns two things
// and deliberately not a third:
//
//   readEnvelope()                 the two keys every engine's file must carry
//   validateIntrospectionDocument()the canonical shape a provider must produce
//
// It does not know the name of a single engine. That lives in
// `providers/index.ts` and nowhere else.
//
// The canonical shape is the *union* of what Postgres and SQL Server can say. It
// was written with both catalogs open, and the fields that exist only because of
// SQL Server are marked in `docs/import-format.md` so the next provider author
// can tell design from accident.

import type { Diagnostic, ImportDiagnosticCode, Result } from './diagnostics.js'
import { compareCodeUnits, hasErrors, inDocument } from './diagnostics.js'

/** The version this build reads. Bumping it is how an old pasted file gets a clear message. */
export const INTROSPECTION_VERSION = 1

// ---------------------------------------------------------------------------
// The canonical shape
// ---------------------------------------------------------------------------

/**
 * The normalised type vocabulary: closed, small, and the same for every engine.
 * It exists so the model can switch on a type without knowing the engine. It
 * loses information by construction, which is why `ColumnType.native` is
 * required beside it. ADR 0009.
 *
 * `other` is the honest answer for anything outside the set (a Postgres enum, a
 * SQL Server `geography`, a user-defined type). A provider that guesses is worse
 * than one that says `other` and leaves `native` to speak.
 */
export type NormalisedType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'float'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'interval'
  | 'uuid'
  | 'binary'
  | 'json'
  | 'xml'
  | 'other'

export const NORMALISED_TYPES: readonly NormalisedType[] = [
  'string',
  'boolean',
  'integer',
  'decimal',
  'float',
  'date',
  'time',
  'timestamp',
  'interval',
  'uuid',
  'binary',
  'json',
  'xml',
  'other',
]

/**
 * What happens to the child rows. `restrict` is Postgres only and `setDefault` is
 * rare in Postgres and ordinary in SQL Server, which is what "union, not
 * intersection" means in practice.
 */
export type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'

export const REFERENTIAL_ACTIONS: readonly ReferentialAction[] = [
  'noAction',
  'restrict',
  'cascade',
  'setNull',
  'setDefault',
]

export interface ColumnType {
  /**
   * Exactly what the engine calls it, unmodified: `character varying`,
   * `timestamp with time zone`, `nvarchar`, `datetime2`. Required, never derived.
   */
  readonly native: string
  readonly normalised: NormalisedType
  /**
   * Characters for string types, bytes for binary types, and `'max'` for the SQL
   * Server forms that report `max_length` as -1. A SQL Server provider divides
   * `sys.columns.max_length` by two for `nchar` and `nvarchar` before it gets
   * here, because that column counts bytes and this one counts characters.
   * Absent where length is not a property of the type (`text`, `int`).
   */
  readonly length?: number | 'max'
  /** Present only where the engine's value carries user intent, so not on `int`. */
  readonly precision?: number
  readonly scale?: number
}

export interface ColumnDefault {
  /**
   * The engine's own expression, verbatim. SQL Server really does report `((0))`
   * for zero and this contract keeps it, because dbmd never executes it and
   * unwrapping is a lossy guess in the general case. See docs/import-format.md.
   */
  readonly expression: string
  /** SQL Server names default constraints; Postgres has no name to give. */
  readonly constraintName?: string
}

export interface Identity {
  /** Postgres says this outright; a SQL Server provider maps `IDENTITY` to one of the two. */
  readonly generation: 'always' | 'byDefault'
  readonly seed?: number
  readonly increment?: number
}

export interface GeneratedColumn {
  readonly expression: string
  /**
   * SQL Server computed columns can be persisted or computed on read. Postgres
   * generated columns are always stored, so a Postgres provider passes `true`.
   */
  readonly persisted: boolean
}

export interface Column {
  readonly name: string
  readonly type: ColumnType
  readonly nullable: boolean
  readonly default?: ColumnDefault
  readonly identity?: Identity
  readonly generated?: GeneratedColumn
  readonly collation?: string
  readonly comment?: string
}

export interface PrimaryKey {
  /** Both engines always have one. SQLite does not, which is why this is optional. */
  readonly name?: string
  /** Ordered by key ordinal. A composite key is the ordinary case, not a special one. */
  readonly columns: readonly string[]
  /** SQL Server only: this key's index defines the physical row order. */
  readonly isClustered?: boolean
}

export interface ForeignKey {
  readonly name?: string
  /** Ordered. Positionally paired with `referencedColumns`, which must be the same length. */
  readonly columns: readonly string[]
  /** Required, and never inferred from the referencing table's schema. */
  readonly referencedSchema: string
  readonly referencedTable: string
  readonly referencedColumns: readonly string[]
  readonly onDelete?: ReferentialAction
  readonly onUpdate?: ReferentialAction
}

/**
 * One key of an index: a column of the table, or an expression over it.
 *
 * The two are spelled apart rather than both arriving as a bare string, because
 * a bare string cannot tell them apart and both are legal. An index on
 * `lower(ledger_code)` and an index on a column literally called
 * `lower(ledger_code)` produced byte-identical output until this union existed,
 * which is the whole of dbmd-18. ADR 0022.
 *
 * A key says exactly one of `column` and `expression`. Neither is
 * `import/missing-field`; both is `import/conflicting-fields`, because a key
 * that says both holds no fact dbmd could choose between.
 */
export type IndexKey = IndexKeyColumn | IndexKeyExpression

export interface IndexKeyColumn {
  /** A column of this table, by name. */
  readonly column: string
  /** Absent means ascending. Both engines record direction per key column. */
  readonly descending?: boolean
}

export interface IndexKeyExpression {
  /**
   * Engine-native, verbatim, for the same reason as `ColumnDefault.expression`:
   * dbmd never executes it and cannot parse it, so it is carried and shown and
   * never interpreted. Postgres calls these functional indexes; SQL Server
   * reaches the same place through a computed column, which arrives as a column
   * and needs nothing here.
   */
  readonly expression: string
  readonly descending?: boolean
}

export interface Index {
  readonly name: string
  /** The keys, ordered. At least one, each a column or an expression. */
  readonly columns: readonly IndexKey[]
  /**
   * Payload columns carried in the leaf, not part of the key. SQL Server has had
   * `INCLUDE` since 2005 and Postgres since 11, so this is union rather than a
   * SQL Server bolt-on, but SQL Server is why it was looked for.
   */
  readonly includedColumns?: readonly string[]
  readonly isUnique: boolean
  /** SQL Server only: this index defines the physical row order. */
  readonly isClustered?: boolean
  /** A SQL Server filtered index or a Postgres partial index, engine-native text. */
  readonly filterExpression?: string
  /** True when a `UNIQUE` constraint owns this index rather than `CREATE UNIQUE INDEX`. */
  readonly isUniqueConstraint?: boolean
}

export interface CheckConstraint {
  readonly name?: string
  /** Engine-native, verbatim, and for the same reason as `ColumnDefault.expression`. */
  readonly expression: string
}

export interface Table {
  /**
   * Required and never empty. `dbo` and `public` are schema names like any other:
   * a default schema is not the absence of a schema.
   */
  readonly schema: string
  readonly name: string
  readonly comment?: string
  /** In catalog order, because column order is data. Everything else here is sorted. */
  readonly columns: readonly Column[]
  readonly primaryKey?: PrimaryKey
  /** Sorted. The index backing the primary key is not repeated here. */
  readonly indexes: readonly Index[]
  readonly foreignKeys: readonly ForeignKey[]
  readonly checkConstraints: readonly CheckConstraint[]
}

export interface SourceInfo {
  readonly database?: string
  /** Free text as the engine reports it. Enough to answer "which build produced this". */
  readonly engineVersion?: string
  /**
   * The database default collation. This is how a file says whether its
   * identifiers are case sensitive without the contract taking a position, which
   * it must not: SQL Server is case insensitive by collation and Postgres folds
   * unquoted names to lower case, and neither is a rule about the other.
   */
  readonly defaultCollation?: string
}

/** The canonical document, which is the envelope plus a canonical body. */
export interface IntrospectionDocument {
  readonly dbmdIntrospection: number
  /** The provider id that produced this. Lower case, no spaces. */
  readonly engine: string
  readonly source?: SourceInfo
  /** Sorted by schema then name. */
  readonly tables: readonly Table[]
}

/**
 * The part of a pasted file dbmd understands before it knows which engine wrote
 * it. Everything under `body` beyond these two keys is the provider's shape and
 * means nothing here.
 */
export interface Envelope {
  readonly version: number
  readonly engine: string
  readonly body: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Reading the envelope
// ---------------------------------------------------------------------------

/**
 * Validate the two keys every engine's file carries, and nothing else.
 *
 * Rejecting an unreadable version here rather than inside a provider is the whole
 * point of the field: an old file gets a sentence naming both versions instead of
 * a parse failure three levels down.
 */
export function readEnvelope(raw: unknown): Result<Envelope> {
  const diagnostics: Diagnostic[] = []
  const body = asObject(diagnostics, raw, '$', 'the introspection file')
  if (!body) return { ok: false, diagnostics }

  const version = body['dbmdIntrospection']
  if (version === undefined || version === null) {
    error(
      diagnostics,
      'import/missing-field',
      '$.dbmdIntrospection',
      `this file has no \`dbmdIntrospection\` version, so it is not an introspection file dbmd produced; run \`dbmd query --engine <id>\`, run the SQL it prints against your database, and import the JSON that returns`,
    )
  } else if (typeof version !== 'number' || !Number.isInteger(version)) {
    error(
      diagnostics,
      'import/wrong-type',
      '$.dbmdIntrospection',
      `\`dbmdIntrospection\` must be a whole number, got ${describe(version)}`,
    )
  } else if (version !== INTROSPECTION_VERSION) {
    error(
      diagnostics,
      'import/unsupported-version',
      '$.dbmdIntrospection',
      version < INTROSPECTION_VERSION
        ? `this file says \`dbmdIntrospection\` ${version} and this build of dbmd reads version ${INTROSPECTION_VERSION}; it was produced by an older dbmd, so re-run the query \`dbmd query --engine <id>\` prints with this build and import the JSON that returns`
        : `this file says \`dbmdIntrospection\` ${version} and this build of dbmd reads version ${INTROSPECTION_VERSION}; it was produced by a newer dbmd, so upgrade dbmd, or re-run the query \`dbmd query --engine <id>\` prints with this build`,
    )
  }

  const engine = body['engine']
  if (engine === undefined || engine === null) {
    error(
      diagnostics,
      'import/missing-field',
      '$.engine',
      'this file does not say which engine produced it, so dbmd cannot choose a provider for it; `engine` is written by the query `dbmd query --engine <id>` prints, and should not be removed',
    )
  } else if (typeof engine !== 'string') {
    error(
      diagnostics,
      'import/wrong-type',
      '$.engine',
      `\`engine\` must be a string, got ${describe(engine)}`,
    )
  } else if (engine.length === 0) {
    error(diagnostics, 'import/empty-value', '$.engine', '`engine` is an empty string')
  }

  if (hasErrors(diagnostics)) return { ok: false, diagnostics }
  return {
    ok: true,
    value: { version: version as number, engine: engine as string, body },
    diagnostics,
  }
}

// ---------------------------------------------------------------------------
// Validating a canonical document
// ---------------------------------------------------------------------------

/**
 * Check a canonical document and return a normalised copy of it.
 *
 * Normalising here rather than in each provider is what makes two providers
 * agree: absent and null collapse to the same thing, absent lists become empty
 * lists, and everything whose order is not data comes back sorted. A provider can
 * therefore build a document by hand and let this decide what deterministic
 * means.
 */
export function validateIntrospectionDocument(raw: unknown): Result<IntrospectionDocument> {
  const diagnostics: Diagnostic[] = []
  const envelope = readEnvelope(raw)
  if (!envelope.ok) return envelope
  diagnostics.push(...envelope.diagnostics)

  const body = envelope.value.body
  unknownFields(diagnostics, body, '$', ['dbmdIntrospection', 'engine', 'source', 'tables'])

  const source = readSource(diagnostics, body, '$')
  const tables = readList(diagnostics, body, 'tables', '$', { required: true }).map((item, i) =>
    readTable(diagnostics, item, `$.tables[${i}]`),
  )

  reportDuplicates(
    diagnostics,
    tables.map((t) => `${t.schema}.${t.name}`),
    '$.tables',
    'table',
  )

  if (hasErrors(diagnostics)) return { ok: false, diagnostics }

  const document: IntrospectionDocument = {
    dbmdIntrospection: envelope.value.version,
    engine: envelope.value.engine,
    ...(source ? { source } : {}),
    tables: [...tables].sort(
      (a, b) => compareCodeUnits(a.schema, b.schema) || compareCodeUnits(a.name, b.name),
    ),
  }
  return { ok: true, value: document, diagnostics }
}

function readSource(
  diagnostics: Diagnostic[],
  body: Record<string, unknown>,
  path: string,
): SourceInfo | undefined {
  const raw = present(body['source'])
  if (raw === undefined) return undefined
  const obj = asObject(diagnostics, raw, `${path}.source`, '`source`')
  if (!obj) return undefined
  const at = `${path}.source`
  unknownFields(diagnostics, obj, at, ['database', 'engineVersion', 'defaultCollation'])
  const database = optionalString(diagnostics, obj, 'database', at)
  const engineVersion = optionalString(diagnostics, obj, 'engineVersion', at)
  const defaultCollation = optionalString(diagnostics, obj, 'defaultCollation', at)
  if (database === undefined && engineVersion === undefined && defaultCollation === undefined) {
    // An empty `source` is nothing said, and emitting `"source": {}` would make a
    // file that says nothing differ from a file that omits it.
    return undefined
  }
  return {
    ...(database !== undefined ? { database } : {}),
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    ...(defaultCollation !== undefined ? { defaultCollation } : {}),
  }
}

const TABLE_FIELDS = [
  'schema',
  'name',
  'comment',
  'columns',
  'primaryKey',
  'indexes',
  'foreignKeys',
  'checkConstraints',
]

function readTable(diagnostics: Diagnostic[], raw: unknown, path: string): Table {
  const obj = asObject(diagnostics, raw, path, 'a table') ?? {}
  unknownFields(diagnostics, obj, path, TABLE_FIELDS)

  const schema = requiredString(diagnostics, obj, 'schema', path)
  const name = requiredString(diagnostics, obj, 'name', path)
  const comment = optionalString(diagnostics, obj, 'comment', path)

  const columns = readList(diagnostics, obj, 'columns', path, { required: true }).map((item, i) =>
    readColumn(diagnostics, item, `${path}.columns[${i}]`),
  )
  reportDuplicates(
    diagnostics,
    columns.map((c) => c.name),
    `${path}.columns`,
    'column',
  )

  const primaryKey = readPrimaryKey(diagnostics, obj, path)
  const indexes = readList(diagnostics, obj, 'indexes', path, { required: false }).map((item, i) =>
    readIndex(diagnostics, item, `${path}.indexes[${i}]`),
  )
  reportDuplicates(
    diagnostics,
    indexes.map((i) => i.name),
    `${path}.indexes`,
    'index',
  )
  const foreignKeys = readList(diagnostics, obj, 'foreignKeys', path, { required: false }).map(
    (item, i) => readForeignKey(diagnostics, item, `${path}.foreignKeys[${i}]`),
  )
  const checkConstraints = readList(diagnostics, obj, 'checkConstraints', path, {
    required: false,
  }).map((item, i) => readCheckConstraint(diagnostics, item, `${path}.checkConstraints[${i}]`))

  return {
    schema: schema ?? '',
    name: name ?? '',
    ...(comment !== undefined ? { comment } : {}),
    columns,
    ...(primaryKey ? { primaryKey } : {}),
    indexes: [...indexes].sort((a, b) => compareCodeUnits(a.name, b.name)),
    foreignKeys: [...foreignKeys].sort(compareByNameThenColumns),
    checkConstraints: [...checkConstraints].sort(
      (a, b) =>
        compareCodeUnits(a.name ?? '', b.name ?? '') ||
        compareCodeUnits(a.expression, b.expression),
    ),
  }
}

const COLUMN_FIELDS = [
  'name',
  'type',
  'nullable',
  'default',
  'identity',
  'generated',
  'collation',
  'comment',
]

function readColumn(diagnostics: Diagnostic[], raw: unknown, path: string): Column {
  const obj = asObject(diagnostics, raw, path, 'a column') ?? {}
  unknownFields(diagnostics, obj, path, COLUMN_FIELDS)

  const name = requiredString(diagnostics, obj, 'name', path)
  const type = readColumnType(diagnostics, obj, path)
  const nullable = requiredBoolean(diagnostics, obj, 'nullable', path)
  const columnDefault = readDefault(diagnostics, obj, path)
  const identity = readIdentity(diagnostics, obj, path)
  const generated = readGenerated(diagnostics, obj, path)
  const collation = optionalString(diagnostics, obj, 'collation', path)
  const comment = optionalString(diagnostics, obj, 'comment', path)

  return {
    name: name ?? '',
    type,
    nullable: nullable ?? true,
    ...(columnDefault ? { default: columnDefault } : {}),
    ...(identity ? { identity } : {}),
    ...(generated ? { generated } : {}),
    ...(collation !== undefined ? { collation } : {}),
    ...(comment !== undefined ? { comment } : {}),
  }
}

function readColumnType(
  diagnostics: Diagnostic[],
  column: Record<string, unknown>,
  path: string,
): ColumnType {
  const at = `${path}.type`
  const raw = present(column['type'])
  if (raw === undefined) {
    error(
      diagnostics,
      'import/missing-field',
      at,
      'a column has no `type`; a provider must give both the engine-native name and a normalised one',
    )
    return { native: '', normalised: 'other' }
  }
  const obj = asObject(diagnostics, raw, at, '`type`')
  if (!obj) return { native: '', normalised: 'other' }
  unknownFields(diagnostics, obj, at, ['native', 'normalised', 'length', 'precision', 'scale'])

  const native = requiredString(diagnostics, obj, 'native', at)
  const normalised = requiredEnum<NormalisedType>(
    diagnostics,
    obj,
    'normalised',
    at,
    NORMALISED_TYPES,
  )
  const length = readLength(diagnostics, obj, at)
  const precision = optionalInteger(diagnostics, obj, 'precision', at)
  const scale = optionalInteger(diagnostics, obj, 'scale', at)

  return {
    native: native ?? '',
    normalised: normalised ?? 'other',
    ...(length !== undefined ? { length } : {}),
    ...(precision !== undefined ? { precision } : {}),
    ...(scale !== undefined ? { scale } : {}),
  }
}

function readLength(
  diagnostics: Diagnostic[],
  type: Record<string, unknown>,
  path: string,
): number | 'max' | undefined {
  const raw = present(type['length'])
  if (raw === undefined) return undefined
  if (raw === 'max') return 'max'
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw
  error(
    diagnostics,
    'import/wrong-type',
    `${path}.length`,
    `\`length\` must be a non-negative whole number or the string "max", got ${describe(raw)}; SQL Server reports -1 for the max forms and a provider translates that here`,
  )
  return undefined
}

function readDefault(
  diagnostics: Diagnostic[],
  column: Record<string, unknown>,
  path: string,
): ColumnDefault | undefined {
  const raw = present(column['default'])
  if (raw === undefined) return undefined
  const at = `${path}.default`
  const obj = asObject(diagnostics, raw, at, '`default`')
  if (!obj) return undefined
  unknownFields(diagnostics, obj, at, ['expression', 'constraintName'])
  const expression = requiredString(diagnostics, obj, 'expression', at)
  const constraintName = optionalString(diagnostics, obj, 'constraintName', at)
  if (expression === undefined) return undefined
  return { expression, ...(constraintName !== undefined ? { constraintName } : {}) }
}

function readIdentity(
  diagnostics: Diagnostic[],
  column: Record<string, unknown>,
  path: string,
): Identity | undefined {
  const raw = present(column['identity'])
  if (raw === undefined) return undefined
  const at = `${path}.identity`
  const obj = asObject(diagnostics, raw, at, '`identity`')
  if (!obj) return undefined
  unknownFields(diagnostics, obj, at, ['generation', 'seed', 'increment'])
  const generation = requiredEnum<Identity['generation']>(diagnostics, obj, 'generation', at, [
    'always',
    'byDefault',
  ])
  const seed = optionalInteger(diagnostics, obj, 'seed', at)
  const increment = optionalInteger(diagnostics, obj, 'increment', at)
  if (generation === undefined) return undefined
  return {
    generation,
    ...(seed !== undefined ? { seed } : {}),
    ...(increment !== undefined ? { increment } : {}),
  }
}

function readGenerated(
  diagnostics: Diagnostic[],
  column: Record<string, unknown>,
  path: string,
): GeneratedColumn | undefined {
  const raw = present(column['generated'])
  if (raw === undefined) return undefined
  const at = `${path}.generated`
  const obj = asObject(diagnostics, raw, at, '`generated`')
  if (!obj) return undefined
  unknownFields(diagnostics, obj, at, ['expression', 'persisted'])
  const expression = requiredString(diagnostics, obj, 'expression', at)
  const persisted = requiredBoolean(diagnostics, obj, 'persisted', at)
  if (expression === undefined || persisted === undefined) return undefined
  return { expression, persisted }
}

function readPrimaryKey(
  diagnostics: Diagnostic[],
  table: Record<string, unknown>,
  path: string,
): PrimaryKey | undefined {
  const raw = present(table['primaryKey'])
  if (raw === undefined) return undefined
  const at = `${path}.primaryKey`
  const obj = asObject(diagnostics, raw, at, '`primaryKey`')
  if (!obj) return undefined
  unknownFields(diagnostics, obj, at, ['name', 'columns', 'isClustered'])
  const name = optionalString(diagnostics, obj, 'name', at)
  const columns = readStringList(diagnostics, obj, 'columns', at, { required: true })
  const isClustered = optionalBoolean(diagnostics, obj, 'isClustered', at)
  if (columns.length === 0) {
    error(
      diagnostics,
      'import/empty-value',
      `${at}.columns`,
      'a primary key names no columns; omit `primaryKey` for a table that has none',
    )
  }
  return {
    ...(name !== undefined ? { name } : {}),
    columns,
    ...(isClustered !== undefined ? { isClustered } : {}),
  }
}

function readIndex(diagnostics: Diagnostic[], raw: unknown, path: string): Index {
  const obj = asObject(diagnostics, raw, path, 'an index') ?? {}
  unknownFields(diagnostics, obj, path, [
    'name',
    'columns',
    'includedColumns',
    'isUnique',
    'isClustered',
    'filterExpression',
    'isUniqueConstraint',
  ])
  const name = requiredString(diagnostics, obj, 'name', path)
  const columns = readList(diagnostics, obj, 'columns', path, { required: true }).map((item, i) =>
    readIndexKey(diagnostics, item, `${path}.columns[${i}]`),
  )
  if (columns.length === 0) {
    error(diagnostics, 'import/empty-value', `${path}.columns`, 'an index names no key columns')
  }
  const includedColumns = present(obj['includedColumns'])
    ? readStringList(diagnostics, obj, 'includedColumns', path, { required: false })
    : undefined
  const isUnique = requiredBoolean(diagnostics, obj, 'isUnique', path)
  const isClustered = optionalBoolean(diagnostics, obj, 'isClustered', path)
  const filterExpression = optionalString(diagnostics, obj, 'filterExpression', path)
  const isUniqueConstraint = optionalBoolean(diagnostics, obj, 'isUniqueConstraint', path)

  return {
    name: name ?? '',
    columns,
    ...(includedColumns !== undefined ? { includedColumns } : {}),
    isUnique: isUnique ?? false,
    ...(isClustered !== undefined ? { isClustered } : {}),
    ...(filterExpression !== undefined ? { filterExpression } : {}),
    ...(isUniqueConstraint !== undefined ? { isUniqueConstraint } : {}),
  }
}

/**
 * One index key, which is a column or an expression and never both.
 *
 * A file that says both is rejected rather than resolved in either direction.
 * Preferring one would make the other silently disappear, and the reason this
 * union exists at all is that a silently-disappearing distinction is what a
 * bare string was already doing.
 */
function readIndexKey(diagnostics: Diagnostic[], raw: unknown, path: string): IndexKey {
  const obj = asObject(diagnostics, raw, path, 'an index key') ?? {}
  unknownFields(diagnostics, obj, path, ['column', 'expression', 'descending'])
  const column = optionalString(diagnostics, obj, 'column', path)
  const expression = optionalString(diagnostics, obj, 'expression', path)
  const descending = optionalBoolean(diagnostics, obj, 'descending', path)
  const direction = descending !== undefined ? { descending } : {}

  if (column !== undefined && expression !== undefined) {
    error(
      diagnostics,
      'import/conflicting-fields',
      path,
      'an index key says both `column` and `expression`, and one index key is one or the other',
    )
    return { column, ...direction }
  }
  if (expression !== undefined) return { expression, ...direction }
  if (column === undefined) {
    error(
      diagnostics,
      'import/missing-field',
      path,
      "an index key needs `column`, naming a column of this table, or `expression`, carrying the engine's own text",
    )
  }
  return { column: column ?? '', ...direction }
}

function readForeignKey(diagnostics: Diagnostic[], raw: unknown, path: string): ForeignKey {
  const obj = asObject(diagnostics, raw, path, 'a foreign key') ?? {}
  unknownFields(diagnostics, obj, path, [
    'name',
    'columns',
    'referencedSchema',
    'referencedTable',
    'referencedColumns',
    'onDelete',
    'onUpdate',
  ])
  const name = optionalString(diagnostics, obj, 'name', path)
  const columns = readStringList(diagnostics, obj, 'columns', path, { required: true })
  const referencedSchema = requiredString(diagnostics, obj, 'referencedSchema', path)
  const referencedTable = requiredString(diagnostics, obj, 'referencedTable', path)
  const referencedColumns = readStringList(diagnostics, obj, 'referencedColumns', path, {
    required: true,
  })
  const onDelete = optionalEnum<ReferentialAction>(
    diagnostics,
    obj,
    'onDelete',
    path,
    REFERENTIAL_ACTIONS,
  )
  const onUpdate = optionalEnum<ReferentialAction>(
    diagnostics,
    obj,
    'onUpdate',
    path,
    REFERENTIAL_ACTIONS,
  )

  if (columns.length > 0 && columns.length !== referencedColumns.length) {
    error(
      diagnostics,
      'import/mismatched-columns',
      path,
      `this foreign key has ${columns.length} local column${columns.length === 1 ? '' : 's'} and ${referencedColumns.length} referenced, and the two lists are paired by position`,
    )
  }

  return {
    ...(name !== undefined ? { name } : {}),
    columns,
    referencedSchema: referencedSchema ?? '',
    referencedTable: referencedTable ?? '',
    referencedColumns,
    ...(onDelete !== undefined ? { onDelete } : {}),
    ...(onUpdate !== undefined ? { onUpdate } : {}),
  }
}

function readCheckConstraint(
  diagnostics: Diagnostic[],
  raw: unknown,
  path: string,
): CheckConstraint {
  const obj = asObject(diagnostics, raw, path, 'a check constraint') ?? {}
  unknownFields(diagnostics, obj, path, ['name', 'expression'])
  const name = optionalString(diagnostics, obj, 'name', path)
  const expression = requiredString(diagnostics, obj, 'expression', path)
  return { ...(name !== undefined ? { name } : {}), expression: expression ?? '' }
}

// ---------------------------------------------------------------------------
// Field readers
//
// Every one of these treats null exactly as absent. That is not laxity: SQL
// Server's `FOR JSON` omits null columns unless asked otherwise, so the same
// engine emits a key on one row and no key at all on the next, and a contract
// that distinguished them would fail on data that is not wrong.
// ---------------------------------------------------------------------------

function present(value: unknown): unknown {
  return value === null ? undefined : value
}

function error(
  diagnostics: Diagnostic[],
  code: ImportDiagnosticCode,
  path: string,
  message: string,
): void {
  diagnostics.push({ code, severity: 'error', at: inDocument(path), message })
}

function asObject(
  diagnostics: Diagnostic[],
  value: unknown,
  path: string,
  what: string,
): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  error(
    diagnostics,
    'import/not-an-object',
    path,
    `${what} must be a JSON object, got ${describe(value)}`,
  )
  return undefined
}

function requiredString(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = present(obj[key])
  if (value === undefined) {
    error(diagnostics, 'import/missing-field', `${path}.${key}`, `\`${key}\` is required`)
    return undefined
  }
  if (typeof value !== 'string') {
    error(
      diagnostics,
      'import/wrong-type',
      `${path}.${key}`,
      `\`${key}\` must be a string, got ${describe(value)}`,
    )
    return undefined
  }
  if (value.length === 0) {
    error(diagnostics, 'import/empty-value', `${path}.${key}`, `\`${key}\` is an empty string`)
    return undefined
  }
  return value
}

function optionalString(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = present(obj[key])
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    error(
      diagnostics,
      'import/wrong-type',
      `${path}.${key}`,
      `\`${key}\` must be a string, got ${describe(value)}`,
    )
    return undefined
  }
  return value
}

function requiredBoolean(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = present(obj[key])
  if (value === undefined) {
    error(diagnostics, 'import/missing-field', `${path}.${key}`, `\`${key}\` is required`)
    return undefined
  }
  return checkBoolean(diagnostics, value, key, path)
}

function optionalBoolean(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  const value = present(obj[key])
  if (value === undefined) return undefined
  return checkBoolean(diagnostics, value, key, path)
}

function checkBoolean(
  diagnostics: Diagnostic[],
  value: unknown,
  key: string,
  path: string,
): boolean | undefined {
  if (typeof value === 'boolean') return value
  error(
    diagnostics,
    'import/wrong-type',
    `${path}.${key}`,
    `\`${key}\` must be true or false, got ${describe(value)}; a provider translates its engine's 0 and 1 before this point`,
  )
  return undefined
}

function optionalInteger(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = present(obj[key])
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    error(
      diagnostics,
      'import/wrong-type',
      `${path}.${key}`,
      `\`${key}\` must be a whole number, got ${describe(value)}`,
    )
    return undefined
  }
  return value
}

function requiredEnum<T extends string>(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const value = present(obj[key])
  if (value === undefined) {
    error(diagnostics, 'import/missing-field', `${path}.${key}`, `\`${key}\` is required`)
    return undefined
  }
  return checkEnum(diagnostics, value, key, path, allowed)
}

function optionalEnum<T extends string>(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const value = present(obj[key])
  if (value === undefined) return undefined
  return checkEnum(diagnostics, value, key, path, allowed)
}

function checkEnum<T extends string>(
  diagnostics: Diagnostic[],
  value: unknown,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  error(
    diagnostics,
    'import/not-in-vocabulary',
    `${path}.${key}`,
    `\`${key}\` is ${describe(value)}, and the contract allows only ${allowed.join(', ')}`,
  )
  return undefined
}

/** Absent, null and `[]` are the same thing unless the list is required to exist. */
function readList(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
  options: { required: boolean },
): unknown[] {
  const value = present(obj[key])
  if (value === undefined) {
    if (options.required) {
      error(diagnostics, 'import/missing-field', `${path}.${key}`, `\`${key}\` is required`)
    }
    return []
  }
  if (!Array.isArray(value)) {
    error(
      diagnostics,
      'import/wrong-type',
      `${path}.${key}`,
      `\`${key}\` must be a list, got ${describe(value)}`,
    )
    return []
  }
  return value
}

function readStringList(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  key: string,
  path: string,
  options: { required: boolean },
): string[] {
  const items = readList(diagnostics, obj, key, path, options)
  const out: string[] = []
  items.forEach((item, i) => {
    if (typeof item === 'string' && item.length > 0) {
      out.push(item)
      return
    }
    error(
      diagnostics,
      typeof item === 'string' ? 'import/empty-value' : 'import/wrong-type',
      `${path}.${key}[${i}]`,
      `a column name must be a non-empty string, got ${describe(item)}`,
    )
  })
  return out
}

function unknownFields(
  diagnostics: Diagnostic[],
  obj: Record<string, unknown>,
  path: string,
  known: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (known.includes(key)) continue
    diagnostics.push({
      code: 'import/unknown-field',
      severity: 'warning',
      at: inDocument(`${path}.${key}`),
      message: `nothing in introspection version ${INTROSPECTION_VERSION} reads \`${key}\`, so it was dropped`,
    })
  }
}

/**
 * Names are compared byte for byte and never case-insensitively. Whether
 * `Orders` and `orders` are the same object is a question about the engine and
 * its collation, and the contract refuses to answer it in either direction.
 */
function reportDuplicates(
  diagnostics: Diagnostic[],
  keys: readonly string[],
  path: string,
  what: string,
): void {
  const seen = new Set<string>()
  const reported = new Set<string>()
  for (const key of keys) {
    if (seen.has(key) && !reported.has(key)) {
      error(diagnostics, 'import/duplicate', path, `two ${what}s are both named \`${key}\``)
      reported.add(key)
    }
    seen.add(key)
  }
}

function compareByNameThenColumns(a: ForeignKey, b: ForeignKey): number {
  return (
    compareCodeUnits(a.name ?? '', b.name ?? '') ||
    compareCodeUnits(a.columns.join(','), b.columns.join(',')) ||
    compareCodeUnits(a.referencedTable, b.referencedTable)
  )
}

/** A short, stable description of a bad value, for a message a human reads. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  switch (typeof value) {
    case 'undefined':
      return 'nothing'
    case 'string':
      return JSON.stringify(value)
    case 'number':
    case 'boolean':
      return String(value)
    case 'object':
      return 'an object'
    default:
      return typeof value
  }
}
