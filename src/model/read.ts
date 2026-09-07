/**
 * Reading a `db-model/` directory into a `Model`.
 *
 * Three properties hold everywhere in this file, and they are the reason it is
 * shaped the way it is.
 *
 * **It never throws.** A bad file is a diagnostic carrying the file's path and,
 * where it is honestly derivable, a line. The studio has to show a broken file
 * rather than fail to start, and `dbmd check` has to report every problem in
 * one run rather than the first one.
 *
 * **The body is opaque.** Everything after the closing `---` is sliced out of
 * the file and carried untouched, carriage returns included. It is never parsed
 * as markdown and never normalised. If it were, every save on a Windows
 * checkout would rewrite every line of every file and the format would stop
 * being reviewable, which is the only thing it is for.
 *
 * **YAML is read through nodes, not through values.** `parseDocument` rather
 * than `parse`, because the traps ADR 0003 names are invisible in a plain JS
 * value. A scalar that resolved to a boolean is the only evidence that someone
 * wrote a column of type `on`, and a key whose resolved value is `null` is the
 * only evidence that someone wrote the retired `null:` key rather than a column
 * named `null`. Where a string is expected, this file checks that a string
 * arrived and diagnoses rather than coercing.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml'
// `byText` is `compareCodeUnits` under a name that reads at a sort call. It is
// aliased rather than redefined because the reader and the import contract have
// to agree on byte order forever, not only today. ADR 0014.
import { compareCodeUnits as byText, compareDiagnostics, inFile } from '../diagnostics.js'
import { KIND_DIRECTORIES, MODEL_FILE } from './paths.js'
import type {
  Column,
  Diagnostic,
  Group,
  Index,
  Layout,
  Model,
  ModelDiagnosticCode,
  Note,
  ObjectKind,
  ReadResult,
  Ref,
  RefEdge,
  Severity,
  Table,
} from './types.js'

/**
 * Read a model directory. `dir` is the model root itself, the directory that
 * holds `_model.md` and `tables/`, not the repository root.
 */
export async function readModel(dir: string): Promise<ReadResult> {
  const diagnostics: Diagnostic[] = []
  const tables: Table[] = []
  const notes: Note[] = []
  const groups: Group[] = []
  /** Deferred because a `group:` cannot be checked until every group is read. */
  const declaredGroups: { table: string; path: string; group: string; line?: number }[] = []

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    push(diagnostics, {
      code: 'model-directory-unreadable',
      severity: 'error',
      at: inFile('.'),
      message: `cannot read the model directory: ${messageOf(error)}`,
    })
    return { model: emptyModel(), diagnostics }
  }

  let name: string | undefined
  let engine: string | undefined
  let body = ''
  let complete = true

  const names = entries.map((entry) => entry.name).sort(byText)
  const isDirectory = new Map(entries.map((entry) => [entry.name, entry.isDirectory()]))

  if (isDirectory.get(MODEL_FILE) === false) {
    const text = await readText(join(dir, MODEL_FILE), MODEL_FILE, diagnostics)
    if (text === undefined) {
      // The file is there and unreadable, so what it says is unknown rather
      // than absent, and a save must not put an empty one over the top of it.
      complete = false
    } else {
      const read = readModelFile(text, diagnostics)
      name = read.name
      engine = read.engine
      body = read.body
      complete = read.complete
    }
  } else {
    push(diagnostics, {
      code: 'model-file-missing',
      severity: 'warning',
      at: inFile(MODEL_FILE),
      message: `no ${MODEL_FILE}, so the model has no name and no engine`,
    })
  }

  for (const entryName of names) {
    if (isDirectory.get(entryName) !== true) continue
    const kind = KIND_DIRECTORIES.get(entryName)
    if (kind === undefined) {
      push(diagnostics, {
        code: 'unknown-kind-directory',
        severity: 'warning',
        at: inFile(entryName),
        message: `\`${entryName}/\` is not a kind of object dbmd knows; its files are ignored`,
      })
      continue
    }

    for (const file of await markdownFiles(join(dir, entryName), entryName, diagnostics)) {
      const relative = `${entryName}/${file}`
      const text = await readText(join(dir, entryName, file), relative, diagnostics)
      if (text === undefined) continue
      const object = readObjectFile(kind, relative, file.slice(0, -'.md'.length), text, diagnostics)
      if (object === undefined) continue
      if (object.kind === 'table') {
        tables.push(object)
        if (object.group !== undefined) {
          declaredGroups.push({
            table: object.name,
            path: object.path,
            group: object.group,
            ...(object.groupLine === undefined ? {} : { line: object.groupLine }),
          })
        }
      } else if (object.kind === 'note') {
        notes.push(object)
      } else {
        groups.push(object)
      }
    }
  }

  tables.sort((a, b) => byText(a.name, b.name))
  notes.sort((a, b) => byText(a.name, b.name))
  groups.sort((a, b) => byText(a.name, b.name))

  const groupNames = new Set(groups.map((group) => group.name))
  for (const declared of declaredGroups) {
    if (groupNames.has(declared.group)) continue
    push(diagnostics, {
      code: 'group-unknown',
      severity: 'error',
      at: inFile(declared.path, declared.line),
      message: `\`group: ${declared.group}\` names no file at groups/${declared.group}.md`,
    })
  }

  const model: Model = {
    ...(name === undefined ? {} : { name }),
    ...(engine === undefined ? {} : { engine }),
    body,
    complete,
    tables: tables.map(stripInternals),
    notes,
    groups,
    referencesTo: buildReferencesTo(tables),
    groupMembers: buildGroupMembers(groups, declaredGroups),
  }
  return { model, diagnostics: diagnostics.sort(compareDiagnostics) }
}

// --------------------------------------------------------------------------
// The computed indexes. ADR 0003 declares a relationship on the foreign key
// column and ADR 0005 declares membership on the member, both so that a change
// touches one file. Both directions then have to be computed, and this is the
// one place that does it.
// --------------------------------------------------------------------------

function buildReferencesTo(tables: readonly Table[]): ReadonlyMap<string, readonly RefEdge[]> {
  const edges = new Map<string, RefEdge[]>()
  for (const table of tables) edges.set(table.name, [])
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.ref === undefined) continue
      const list = edges.get(column.ref.table)
      const edge: RefEdge = { from: { table: table.name, column: column.name }, to: column.ref }
      if (list === undefined) edges.set(column.ref.table, [edge])
      else list.push(edge)
    }
  }
  return sortedMap(edges, (list) =>
    list.sort(
      (a, b) =>
        byText(a.from.table, b.from.table) ||
        byText(a.from.column, b.from.column) ||
        byText(a.to.column, b.to.column),
    ),
  )
}

function buildGroupMembers(
  groups: readonly Group[],
  declared: readonly { table: string; group: string }[],
): ReadonlyMap<string, readonly string[]> {
  const members = new Map<string, string[]>()
  for (const group of groups) members.set(group.name, [])
  for (const entry of declared) members.get(entry.group)?.push(entry.table)
  return sortedMap(members, (list) => list.sort(byText))
}

/** Keys inserted in sorted order, so iterating the map is deterministic. */
function sortedMap<T>(
  source: Map<string, T[]>,
  sortValues: (values: T[]) => T[],
): ReadonlyMap<string, readonly T[]> {
  const out = new Map<string, readonly T[]>()
  for (const key of [...source.keys()].sort(byText)) {
    out.set(key, sortValues(source.get(key) ?? []))
  }
  return out
}

// --------------------------------------------------------------------------
// Frontmatter: finding it, and keeping the body intact.
// --------------------------------------------------------------------------

type Split =
  | { readonly outcome: 'ok'; readonly yaml: string; readonly body: string }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'unterminated' }
  | { readonly outcome: 'empty'; readonly body: string }

const DELIMITER = '---'

/**
 * Split a file into its frontmatter and its body.
 *
 * The body is `text` from the character after the closing delimiter's line
 * break to the end of the file, sliced and not otherwise touched. Nothing is
 * trimmed, including the blank line that conventionally follows the closing
 * `---`, so that a writer can reproduce the file as `--- + yaml + --- + body`
 * and get the original bytes back. A `\r\n` file stays a `\r\n` file.
 *
 * Absent, unterminated and empty are three different answers because they are
 * three different mistakes: a file that is not a dbmd object at all, a file
 * whose delimiter was mistyped, and a file whose frontmatter was emptied.
 */
export function splitFrontmatter(text: string): Split {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const firstBreak = source.indexOf('\n')
  const firstLine = firstBreak === -1 ? source : source.slice(0, firstBreak)
  if (firstLine.trimEnd() !== DELIMITER) return { outcome: 'absent' }
  if (firstBreak === -1) return { outcome: 'unterminated' }

  const yamlStart = firstBreak + 1
  let cursor = yamlStart
  while (cursor <= source.length) {
    const nextBreak = source.indexOf('\n', cursor)
    const lineEnd = nextBreak === -1 ? source.length : nextBreak
    if (source.slice(cursor, lineEnd).trimEnd() === DELIMITER) {
      const yaml = source.slice(yamlStart, cursor)
      const body = nextBreak === -1 ? '' : source.slice(nextBreak + 1)
      return yaml.trim() === '' ? { outcome: 'empty', body } : { outcome: 'ok', yaml, body }
    }
    if (nextBreak === -1) break
    cursor = nextBreak + 1
  }
  return { outcome: 'unterminated' }
}

// --------------------------------------------------------------------------
// Reading one file.
// --------------------------------------------------------------------------

/**
 * A table plus the line its `group:` key was on, which is needed later to point
 * at the right line when the group turns out not to exist. It is stripped
 * before the table reaches the model.
 */
type TableInProgress = Table & { readonly groupLine?: number }

function stripInternals(table: TableInProgress): Table {
  const { groupLine: _groupLine, ...rest } = table
  return rest
}

/** Everything one file's diagnostics need to know about where they are. */
interface Ctx {
  readonly path: string
  readonly yaml: string
  readonly out: Diagnostic[]
}

/**
 * The file line for an offset into the frontmatter YAML. The YAML always starts
 * on file line 2, because line 1 is the opening delimiter.
 */
function lineAt(ctx: Ctx, offset: number | null | undefined): number | undefined {
  if (offset === null || offset === undefined) return undefined
  let line = 2
  for (let i = 0; i < offset && i < ctx.yaml.length; i++) {
    if (ctx.yaml.charCodeAt(i) === 10) line++
  }
  return line
}

function report(
  ctx: Ctx,
  code: ModelDiagnosticCode,
  severity: Severity,
  message: string,
  offset?: number | null,
): void {
  const line = lineAt(ctx, offset)
  push(ctx.out, {
    code,
    severity,
    at: inFile(ctx.path, line),
    message,
  })
}

function readModelFile(
  text: string,
  out: Diagnostic[],
): { name?: string; engine?: string; body: string; complete: boolean } {
  // Diagnostics land in a sink of this file's own, so that "did reading this
  // file lose anything" is a question the reader answers rather than one the
  // caller has to reconstruct from a shared list.
  const raised: Diagnostic[] = []
  try {
    const split = splitFrontmatter(text)
    // `_model.md` is allowed to be prose only: it is the one file whose whole
    // reason to exist can be the paragraph about the model.
    if (split.outcome === 'absent') return { body: text, complete: true }
    if (split.outcome === 'unterminated') {
      reportSplit(raised, MODEL_FILE, split.outcome)
      return { body: '', complete: false }
    }
    if (split.outcome === 'empty') {
      reportSplit(raised, MODEL_FILE, split.outcome)
      return { body: split.body, complete: false }
    }

    const ctx: Ctx = { path: MODEL_FILE, yaml: split.yaml, out: raised }
    const map = parseFrontmatter(ctx)
    if (map === undefined) return { body: split.body, complete: false }

    const fields = fieldsOf(ctx, map)
    checkKind(ctx, fields, 'model')
    const name = takeString(ctx, fields, 'name')
    const engine = takeString(ctx, fields, 'engine')
    fields.reportUnknown('the model')
    return {
      ...(name === undefined ? {} : { name }),
      ...(engine === undefined ? {} : { engine }),
      body: split.body,
      complete: intact(raised),
    }
  } finally {
    out.push(...raised)
  }
}

function readObjectFile(
  kind: ObjectKind,
  path: string,
  name: string,
  text: string,
  out: Diagnostic[],
): TableInProgress | Note | Group | undefined {
  const raised: Diagnostic[] = []
  try {
    return buildObject(kind, path, name, text, raised)
  } finally {
    out.push(...raised)
  }
}

/**
 * An error raised while building an object from its file means the file holds
 * something the object does not, so the object is not complete and the writer
 * leaves the file alone. Errors raised anywhere else, such as a `group:` naming
 * no group file, are about the model rather than about this file: nothing in
 * the file was lost, and saving it back is safe.
 */
function intact(raised: readonly Diagnostic[]): boolean {
  return !raised.some((diagnostic) => diagnostic.severity === 'error')
}

function buildObject(
  kind: ObjectKind,
  path: string,
  name: string,
  text: string,
  out: Diagnostic[],
): TableInProgress | Note | Group | undefined {
  const split = splitFrontmatter(text)
  if (split.outcome !== 'ok') {
    // A file in `tables/` with no frontmatter is a plain markdown file that
    // happens to be in the directory, and that is exactly the problem: the
    // directory says it is a table and it says nothing at all. It contributes
    // no object, because inventing a nameless table from a file name would put
    // a phantom box on the canvas and in every export.
    reportSplit(out, path, split.outcome)
    return undefined
  }

  const ctx: Ctx = { path, yaml: split.yaml, out }
  const map = parseFrontmatter(ctx)
  if (map === undefined) return undefined

  const fields = fieldsOf(ctx, map)
  if (!checkKind(ctx, fields, kind)) return undefined

  switch (kind) {
    case 'table':
      return readTable(ctx, fields, path, name, split.body)
    case 'note':
      return readNote(ctx, fields, path, name, split.body)
    case 'group':
      return readGroup(ctx, fields, path, name, split.body)
  }
}

function reportSplit(
  out: Diagnostic[],
  path: string,
  outcome: 'absent' | 'unterminated' | 'empty',
) {
  const messages = {
    absent: 'no frontmatter: the file does not start with a `---` line',
    unterminated: 'the frontmatter opens with `---` and is never closed by a `---` line',
    empty: 'the frontmatter is empty, so the file declares nothing',
  } as const
  const codes = {
    absent: 'frontmatter-absent',
    unterminated: 'frontmatter-unterminated',
    empty: 'frontmatter-empty',
  } as const
  push(out, {
    code: codes[outcome],
    severity: 'error',
    at: inFile(path),
    message: messages[outcome],
  })
}

function parseFrontmatter(ctx: Ctx): YAMLMap<unknown, unknown> | undefined {
  // `prettyErrors: false` keeps the message a single line: the source excerpt a
  // pretty error carries is a terminal convenience, and it would be noise in
  // `--json`. The position is recovered from `pos` instead, which is what makes
  // the line number the file's rather than the frontmatter's.
  const doc = parseDocument(ctx.yaml, { prettyErrors: false })
  for (const error of doc.errors) {
    report(ctx, 'frontmatter-invalid', 'error', error.message, error.pos[0])
  }
  for (const warning of doc.warnings) {
    report(ctx, 'frontmatter-invalid', 'warning', warning.message, warning.pos[0])
  }
  if (doc.errors.length > 0) return undefined

  if (doc.contents === null) {
    push(ctx.out, {
      code: 'frontmatter-empty',
      severity: 'error',
      at: inFile(ctx.path),
      message: 'the frontmatter is empty, so the file declares nothing',
    })
    return undefined
  }
  if (!isMap(doc.contents)) {
    report(
      ctx,
      'frontmatter-not-a-map',
      'error',
      'the frontmatter must be a mapping of keys to values',
      offsetOf(doc.contents),
    )
    return undefined
  }
  return doc.contents
}

/**
 * The directory already decided the kind. This checks what the file says
 * against it. A disagreement stops the file loading rather than reinterpreting
 * it as the directory's kind, because a table's keys read as a note produce a
 * page of secondary complaints that bury the one-line fix.
 */
function checkKind(ctx: Ctx, fields: FieldSet, expected: ObjectKind | 'model'): boolean {
  const field = fields.take('kind')
  if (field === undefined) {
    push(ctx.out, {
      code: 'kind-missing',
      severity: 'error',
      at: inFile(ctx.path),
      message: `no \`kind:\` key; the directory says this is a ${expected}`,
    })
    return true
  }
  const declared = stringValue(field.node)
  if (declared === expected) return true
  report(
    ctx,
    'kind-mismatch',
    'error',
    `\`kind: ${rawOf(ctx, field.node)}\` in a directory of ${expected}s; the directory decides, so this file is not loaded`,
    field.valueOffset,
  )
  return false
}

function readTable(
  ctx: Ctx,
  fields: FieldSet,
  path: string,
  name: string,
  body: string,
): TableInProgress {
  const declaredName = fields.take('table')
  if (declaredName === undefined) {
    push(ctx.out, {
      code: 'name-missing',
      severity: 'error',
      at: inFile(ctx.path),
      message: `no \`table:\` key; the file name says this table is \`${name}\``,
    })
  } else {
    const declared = stringValue(declaredName.node)
    if (declared !== name) {
      report(
        ctx,
        'name-mismatch',
        'error',
        `\`table: ${rawOf(ctx, declaredName.node)}\` in a file named ${name}.md; the file name is the table's identity, because that is what a \`ref\` resolves against`,
        declaredName.valueOffset,
      )
    }
  }

  const columns: Column[] = []
  const columnsField = fields.take('columns')
  if (columnsField !== undefined) {
    for (const item of seqItems(ctx, 'columns', columnsField)) {
      const column = readColumn(ctx, item)
      if (column !== undefined) columns.push(column)
    }
  }

  const indexes: Index[] = []
  const indexesField = fields.take('indexes')
  if (indexesField !== undefined) {
    for (const item of seqItems(ctx, 'indexes', indexesField)) {
      const index = readIndex(ctx, item)
      if (index !== undefined) indexes.push(index)
    }
  }

  const layout = takeLayout(ctx, fields, false)
  const groupField = fields.take('group')
  const group = groupField === undefined ? undefined : stringOf(ctx, 'group', groupField)
  const groupLine = groupField === undefined ? undefined : lineAt(ctx, groupField.valueOffset)
  fields.reportUnknown('a table')

  return {
    kind: 'table',
    name,
    path,
    body,
    columns,
    indexes,
    complete: intact(ctx.out),
    ...(layout === undefined ? {} : { layout }),
    ...(group === undefined ? {} : { group }),
    ...(group === undefined || groupLine === undefined ? {} : { groupLine }),
  }
}

function readColumn(ctx: Ctx, node: unknown): Column | undefined {
  if (!isMap(node)) {
    report(ctx, 'field-wrong-type', 'error', 'a column must be a mapping', offsetOf(node))
    return undefined
  }
  const fields = fieldsOf(ctx, node)
  const name = requiredString(ctx, fields, 'name', offsetOf(node))
  const type = requiredString(ctx, fields, 'type', offsetOf(node))
  const pk = takeBoolean(ctx, fields, 'pk')
  const nullable = takeBoolean(ctx, fields, 'nullable')
  fields.reject(
    'null',
    '`null` is now `nullable` and means the same thing: write `nullable: false`',
  )
  fields.reject(
    'unique',
    `\`unique\` is declared on an index and not on a column, because a unique constraint has a name and a column has nowhere to put one; write it as an \`indexes:\` entry with \`columns: [${name ?? 'this column'}]\` and \`unique: true\``,
  )
  const defaultField = fields.take('default')
  const columnDefault =
    defaultField === undefined
      ? undefined
      : stringOf(
          ctx,
          'default',
          defaultField,
          'quote it so that it survives as SQL text, and quote it twice if it is a SQL string literal: `default: "\'pending\'"`',
        )
  const refField = fields.take('ref')
  const ref = refField === undefined ? undefined : readRef(ctx, refField)
  fields.reportUnknown('a column')

  if (name === undefined || type === undefined) return undefined
  return {
    name,
    type,
    ...(pk === undefined ? {} : { pk }),
    ...(nullable === undefined ? {} : { nullable }),
    ...(columnDefault === undefined ? {} : { default: columnDefault }),
    ...(ref === undefined ? {} : { ref }),
  }
}

function readIndex(ctx: Ctx, node: unknown): Index | undefined {
  if (!isMap(node)) {
    report(ctx, 'field-wrong-type', 'error', 'an index must be a mapping', offsetOf(node))
    return undefined
  }
  const fields = fieldsOf(ctx, node)
  const name = requiredString(ctx, fields, 'name', offsetOf(node))
  const columnsField = fields.take('columns')
  const columns: string[] = []
  if (columnsField === undefined) {
    report(ctx, 'field-missing', 'error', 'an index needs a `columns` key', offsetOf(node))
  } else {
    for (const item of seqItems(ctx, 'columns', columnsField)) {
      const column = stringValue(item)
      if (column === undefined) {
        report(
          ctx,
          'field-wrong-type',
          'error',
          `an index column must be a string, but YAML read \`${rawOf(ctx, item)}\` as ${describe(item)}`,
          offsetOf(item),
        )
        continue
      }
      columns.push(column)
    }
  }
  const unique = takeBoolean(ctx, fields, 'unique')
  fields.reportUnknown('an index')
  if (name === undefined || columnsField === undefined) return undefined
  return { name, columns, ...(unique === undefined ? {} : { unique }) }
}

function readRef(ctx: Ctx, field: Field): Ref | undefined {
  const raw = stringOf(ctx, 'ref', field)
  if (raw === undefined) return undefined
  // The last dot separates the column, so a future `schema.table.column` needs
  // no change here. Whether the target exists is dbmd-12's question.
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) {
    report(
      ctx,
      'ref-malformed',
      'error',
      `\`ref: ${raw}\` is not \`table.column\``,
      field.valueOffset,
    )
    return undefined
  }
  return { table: raw.slice(0, dot), column: raw.slice(dot + 1) }
}

function readNote(ctx: Ctx, fields: FieldSet, path: string, name: string, body: string): Note {
  const layout = takeLayout(ctx, fields, true)
  const color = takeString(ctx, fields, 'color')
  fields.reportUnknown('a note')
  return {
    kind: 'note',
    name,
    path,
    body,
    complete: intact(ctx.out),
    ...(layout === undefined ? {} : { layout }),
    ...(color === undefined ? {} : { color }),
  }
}

function readGroup(ctx: Ctx, fields: FieldSet, path: string, name: string, body: string): Group {
  const label = takeString(ctx, fields, 'label')
  const color = takeString(ctx, fields, 'color')
  const layoutField = fields.take('layout')
  if (layoutField !== undefined) {
    report(
      ctx,
      'unknown-key',
      'warning',
      'a group has no coordinates: its box is the bounding box of its members plus padding, computed at render time (ADR 0005). This `layout` is ignored',
      layoutField.keyOffset,
    )
  }
  fields.reportUnknown('a group')
  return {
    kind: 'group',
    name,
    path,
    body,
    complete: intact(ctx.out),
    ...(label === undefined ? {} : { label }),
    ...(color === undefined ? {} : { color }),
  }
}

/** `allowSize` is false for a table: `w` and `h` belong to a note (ADR 0005). */
function takeLayout(ctx: Ctx, fields: FieldSet, allowSize: boolean): Layout | undefined {
  const field = fields.take('layout')
  if (field === undefined) return undefined
  if (!isMap(field.node)) {
    report(
      ctx,
      'field-wrong-type',
      'error',
      '`layout` must be a mapping such as `{ x: 480, y: 120 }`',
      field.valueOffset,
    )
    return undefined
  }
  const inner = fieldsOf(ctx, field.node)
  const x = requiredNumber(ctx, inner, 'x', field.valueOffset)
  const y = requiredNumber(ctx, inner, 'y', field.valueOffset)
  const w = takeNumber(ctx, inner, 'w')
  const h = takeNumber(ctx, inner, 'h')
  if (!allowSize && (w !== undefined || h !== undefined)) {
    report(
      ctx,
      'unknown-key',
      'warning',
      "`w` and `h` belong to a note, not to a table: a note's size is a design choice and a table's is a consequence of its columns (ADR 0005). They are ignored",
      field.valueOffset,
    )
  }
  inner.reportUnknown('a layout')
  if (x === undefined || y === undefined) return undefined
  return {
    x,
    y,
    ...(allowSize && w !== undefined ? { w } : {}),
    ...(allowSize && h !== undefined ? { h } : {}),
  }
}

// --------------------------------------------------------------------------
// Typed access to YAML nodes. Every accessor here answers "is this the sort of
// value the format says it is", and diagnoses rather than coercing when it is
// not, because a coerced value is a wrong model that looks right.
// --------------------------------------------------------------------------

interface Field {
  readonly node: unknown
  readonly keyOffset: number | undefined
  readonly valueOffset: number | undefined
}

interface FieldSet {
  take(key: string): Field | undefined
  /**
   * A key the format understands well enough to say what to write instead.
   *
   * It is taken out of the mapping without joining the list of known keys that
   * `reportUnknown` offers, because the answer to `null:` is `nullable:` and
   * offering `null` back would be worse than the generic warning it replaces.
   */
  reject(key: string, message: string): void
  /** Every key not taken, as a warning. `what` names the thing, for the text. */
  reportUnknown(what: string): void
}

function fieldsOf(ctx: Ctx, map: YAMLMap<unknown, unknown>): FieldSet {
  const entries = new Map<string, Field>()
  for (const pair of map.items) {
    const key = keyText(ctx, pair.key)
    if (key === undefined) {
      report(ctx, 'field-wrong-type', 'error', 'a key must be a plain name', offsetOf(pair.key))
      continue
    }
    if (entries.has(key)) {
      report(
        ctx,
        'duplicate-key',
        'error',
        `\`${key}\` is given twice; the first one is used`,
        offsetOf(pair.key),
      )
      continue
    }
    entries.set(key, {
      node: pair.value,
      keyOffset: offsetOf(pair.key),
      valueOffset: offsetOf(pair.value) ?? offsetOf(pair.key),
    })
  }

  const taken = new Set<string>()
  return {
    take(key) {
      taken.add(key)
      return entries.get(key)
    },
    reject(key, message) {
      const field = entries.get(key)
      if (field === undefined) return
      entries.delete(key)
      report(ctx, 'superseded-key', 'error', message, field.keyOffset)
    },
    reportUnknown(what) {
      const known = [...taken].sort(byText).join(', ')
      for (const [key, field] of [...entries].sort(([a], [b]) => byText(a, b))) {
        if (taken.has(key)) continue
        report(
          ctx,
          'unknown-key',
          'warning',
          `\`${key}\` means nothing on ${what}; known keys are ${known}`,
          field.keyOffset,
        )
      }
    },
  }
}

/**
 * The name a key was written as.
 *
 * A quoted key is its resolved string. A plain key is its source text, which is
 * the whole point: `null:` resolves to the null value and `on:` resolves, under
 * a `%YAML 1.1` directive, to a boolean, and in both cases the four or two
 * characters the author typed are the name they meant.
 */
function keyText(ctx: Ctx, node: unknown): string | undefined {
  if (!isScalar(node)) return undefined
  if (typeof node.value === 'string') return node.value
  const raw = rawOf(ctx, node)
  return raw === '' ? undefined : raw
}

function stringValue(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined
  return typeof node.value === 'string' ? node.value : undefined
}

/**
 * `hint` is a clause and not a sentence: a diagnostic message is one sentence,
 * lower case, with no trailing full stop, so that a caller can paste it after a
 * location. `src/diagnostics.ts` states that convention once for all of dbmd.
 */
function stringOf(ctx: Ctx, key: string, field: Field, hint?: string): string | undefined {
  const value = stringValue(field.node)
  if (value !== undefined) return value
  report(
    ctx,
    'field-wrong-type',
    'error',
    `\`${key}\` must be a string, but YAML read \`${rawOf(ctx, field.node)}\` as ${describe(field.node)}; ${hint ?? 'quote it'}`,
    field.valueOffset,
  )
  return undefined
}

function takeString(ctx: Ctx, fields: FieldSet, key: string): string | undefined {
  const field = fields.take(key)
  return field === undefined ? undefined : stringOf(ctx, key, field)
}

function requiredString(
  ctx: Ctx,
  fields: FieldSet,
  key: string,
  fallbackOffset: number | undefined,
): string | undefined {
  const field = fields.take(key)
  if (field === undefined) {
    report(ctx, 'field-missing', 'error', `\`${key}\` is required`, fallbackOffset)
    return undefined
  }
  return stringOf(ctx, key, field)
}

function takeBoolean(ctx: Ctx, fields: FieldSet, key: string): boolean | undefined {
  const field = fields.take(key)
  if (field === undefined) return undefined
  if (isScalar(field.node) && typeof field.node.value === 'boolean') return field.node.value
  report(
    ctx,
    'field-wrong-type',
    'error',
    `\`${key}\` must be true or false, but YAML read \`${rawOf(ctx, field.node)}\` as ${describe(field.node)}`,
    field.valueOffset,
  )
  return undefined
}

function takeNumber(ctx: Ctx, fields: FieldSet, key: string): number | undefined {
  const field = fields.take(key)
  if (field === undefined) return undefined
  return numberOf(ctx, key, field)
}

function requiredNumber(
  ctx: Ctx,
  fields: FieldSet,
  key: string,
  fallbackOffset: number | undefined,
): number | undefined {
  const field = fields.take(key)
  if (field === undefined) {
    report(ctx, 'field-missing', 'error', `\`layout\` needs \`${key}\``, fallbackOffset)
    return undefined
  }
  return numberOf(ctx, key, field)
}

function numberOf(ctx: Ctx, key: string, field: Field): number | undefined {
  if (isScalar(field.node) && typeof field.node.value === 'number') return field.node.value
  report(
    ctx,
    'field-wrong-type',
    'error',
    `\`${key}\` must be a number, but YAML read \`${rawOf(ctx, field.node)}\` as ${describe(field.node)}`,
    field.valueOffset,
  )
  return undefined
}

function seqItems(ctx: Ctx, key: string, field: Field): readonly unknown[] {
  if (isSeq(field.node)) return field.node.items
  report(ctx, 'field-wrong-type', 'error', `\`${key}\` must be a list`, field.valueOffset)
  return []
}

/** What YAML made of a node, for a message that explains rather than accuses. */
function describe(node: unknown): string {
  if (isSeq(node)) return 'a list'
  if (isMap(node)) return 'a mapping'
  if (!isScalar(node)) return 'nothing'
  const value = node.value
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'a boolean'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'string') return 'a string'
  return typeof value
}

/** The characters the author actually typed, which is often the only clue. */
function rawOf(ctx: Ctx, node: unknown): string {
  if (node === null || typeof node !== 'object' || !('range' in node)) return ''
  const range = (node as { range?: readonly number[] }).range
  const start = range?.[0]
  const end = range?.[1]
  if (start === undefined || end === undefined) return ''
  return ctx.yaml.slice(start, end).trim()
}

function offsetOf(node: unknown): number | undefined {
  if (node === null || typeof node !== 'object' || !('range' in node)) return undefined
  return (node as { range?: readonly number[] }).range?.[0]
}

// --------------------------------------------------------------------------
// Odds and ends.
// --------------------------------------------------------------------------

async function markdownFiles(
  dir: string,
  relative: string,
  out: Diagnostic[],
): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'),
      )
      .map((entry) => entry.name)
      .sort(byText)
  } catch (error) {
    push(out, {
      code: 'file-unreadable',
      severity: 'error',
      at: inFile(relative),
      message: `cannot list the directory: ${messageOf(error)}`,
    })
    return []
  }
}

async function readText(
  file: string,
  relative: string,
  out: Diagnostic[],
): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    push(out, {
      code: 'file-unreadable',
      severity: 'error',
      at: inFile(relative),
      message: `cannot read the file: ${messageOf(error)}`,
    })
    return undefined
  }
}

function messageOf(error: unknown): string {
  // The system message carries the absolute path, which ADR 0006 forbids in
  // output because it makes two machines disagree about identical input.
  return error instanceof Error && 'code' in error ? String(error.code) : 'unknown error'
}

function push(out: Diagnostic[], diagnostic: Diagnostic): void {
  out.push(diagnostic)
}

function emptyModel(): Model {
  return {
    body: '',
    complete: true,
    tables: [],
    notes: [],
    groups: [],
    referencesTo: new Map(),
    groupMembers: new Map(),
  }
}
