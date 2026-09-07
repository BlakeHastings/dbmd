/**
 * What goes over the wire, in both directions.
 *
 * Two jobs, and they are here together because they are the same contract seen
 * from its two ends: turning a `Model` into JSON the page can hold, and turning
 * JSON the page sent into an edit this server is willing to apply.
 *
 * **Outward, the only translation is the maps.** `referencesTo` and
 * `groupMembers` are `ReadonlyMap`s, and `JSON.stringify` renders a Map as `{}`,
 * silently, which would give the client an empty edge list and no error. They
 * become arrays rather than objects so their order is the model's order and a
 * group called `constructor` is a string rather than a surprise. Everything
 * else, tables included, is already JSON-shaped and is passed through as it is:
 * a second copy of the table's fields here would be a second place to edit when
 * the format changes.
 *
 * **Inward, an unknown key is a refusal rather than a shrug.** ADR 0008 has the
 * reader diagnosing rather than guessing, and the same argument is sharper here,
 * because a patch this server half-understood is a file it is about to overwrite
 * with less than the caller meant. A misspelled key that was quietly dropped
 * would show up as an edit that did not stick, and the client would have no way
 * to tell that from a slow disk.
 */

import type {
  Column,
  Diagnostic,
  Group,
  Index,
  IndexKey,
  Layout,
  Model,
  Note,
  RefEdge,
  ReferentialAction,
  Table,
} from '../model/types.js'
import { REFERENTIAL_ACTIONS } from '../model/types.js'

// --------------------------------------------------------------------------
// Outward.
// --------------------------------------------------------------------------

/** When the last write to disk landed, and what it touched. */
export interface WireWrite {
  /** ISO 8601, UTC. The client shows it; nothing here compares two of them. */
  readonly at: string
  /** Slash-separated and relative to the model directory, as diagnostics are. */
  readonly paths: readonly string[]
}

/**
 * A write the studio refused because the file had moved underneath it.
 *
 * ADR 0019. This is not an error and not a diagnostic: the model is fine, the
 * file is fine, and the only thing that went wrong is that two people edited
 * the same table and the studio chose the one on disk. It is on the status
 * rather than in `diagnostics` because a diagnostic is a fact about the model
 * that `dbmd check` would report too, and this is a fact about this session.
 */
export interface WireConflict {
  /** The file, relative and slash-separated, exactly as a write reports one. */
  readonly path: string
  /** ISO 8601, UTC, when the studio noticed. */
  readonly at: string
  /** What happened and what to do about it, in words meant for a person. */
  readonly message: string
}

/** On every response, so the client can say where the model stands (ADR 0004). */
export interface WireStatus {
  readonly lastWrite: WireWrite | null
  /** An edit is in memory and its debounced write has not fired yet. */
  readonly pendingWrite: boolean
  /** The message from the last write that threw, cleared by the next that did not. */
  readonly writeError: string | null
  /**
   * Edits this session dropped rather than write over a change on disk, sorted
   * by path. One entry stands until the studio successfully writes that file
   * again, which is what happens when the developer makes the edit a second
   * time on top of what the file now says.
   */
  readonly conflicts: readonly WireConflict[]
  /**
   * How many times the model changed on disk underneath this session.
   *
   * The client's cue to re-fetch and redraw, and the reason it is a counter
   * rather than a boolean is that a page which missed one update must not have
   * to be told twice: comparing the number it drew with the number it just got
   * answers "am I stale" without any state on the server about who has seen
   * what. It starts at 0 and never goes down for the life of a session.
   *
   * It is also the token every mutation has to name (ADR 0025). A `PATCH` that
   * says which revision it was made against is one the server can refuse before
   * it applies it, which is what a `conflicts` entry arriving at the flush,
   * after the request was answered `200`, could never be.
   */
  readonly revision: number
}

export interface WireModel {
  readonly name?: string
  readonly engine?: string
  readonly body: string
  readonly complete: boolean
  readonly tables: readonly Table[]
  readonly notes: readonly Note[]
  readonly groups: readonly Group[]
  readonly referencesTo: readonly { readonly table: string; readonly edges: readonly RefEdge[] }[]
  readonly groupMembers: readonly { readonly group: string; readonly tables: readonly string[] }[]
}

export function toWireModel(model: Model): WireModel {
  return {
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.engine === undefined ? {} : { engine: model.engine }),
    body: model.body,
    complete: model.complete,
    tables: model.tables,
    notes: model.notes,
    groups: model.groups,
    referencesTo: [...model.referencesTo].map(([table, edges]) => ({ table, edges })),
    groupMembers: [...model.groupMembers].map(([group, tables]) => ({ group, tables })),
  }
}

export interface WireModelResponse extends WireStatus {
  readonly model: WireModel
  readonly diagnostics: readonly Diagnostic[]
}

// --------------------------------------------------------------------------
// Inward.
// --------------------------------------------------------------------------

/**
 * An edit to a table, as a partial table document.
 *
 * Every key is the whole of that part of the table rather than a delta into it:
 * `columns` replaces the column list, and changing one column's type means
 * sending the list with that type changed. The studio holds the model already
 * (ADR 0004 says the disk does, and the page holds a copy of it), so it has the
 * list to send, and a delta language over an ordered list would need to name
 * positions, which is the thing that goes wrong when two edits race.
 *
 * `null` on `layout` or `group` removes the key. `undefined`, meaning the key
 * was absent, leaves that part of the table alone.
 */
export interface TablePatch {
  readonly columns?: readonly Column[]
  readonly indexes?: readonly Index[]
  readonly layout?: Layout | null
  readonly group?: string | null
  readonly body?: string
}

/**
 * An edit to a note: where it is, what colour it is, and what it says.
 *
 * `null` on `layout` or `color` removes the key, the same as on a table. There
 * is no `label`, because a note has no name but its file name and no title but
 * its first line: the body *is* the note (ADR 0005).
 */
export interface NotePatch {
  readonly layout?: Layout | null
  readonly color?: string | null
  readonly body?: string
}

/**
 * An edit to a group: what it is called, what colour it is, and its prose.
 *
 * **There is deliberately no `layout` here and no `members`.** A group's box is
 * the bounding box of its members plus padding, computed on every render and
 * never stored, and membership is declared by each member in its own file (ADR
 * 0005). Both absences are the merge story the format is arranged around, so
 * they are refused here rather than accepted and dropped: a client that sent
 * either is a client whose author believed something about this format that is
 * not true, and the sentence it gets back is where they find out.
 */
export interface GroupPatch {
  readonly label?: string | null
  readonly color?: string | null
  readonly body?: string
}

/** A refusal, in the words the caller will see. */
export interface PatchError {
  readonly error: string
}

export type Parsed<T> = { readonly value: T } | PatchError

function bad(message: string): PatchError {
  return { error: message }
}

export function isPatchError<T>(parsed: Parsed<T>): parsed is PatchError {
  return 'error' in parsed
}

/**
 * The header a mutation names the revision it was made against in.
 *
 * A header rather than a key in the body, because it is not part of the edit:
 * `TablePatch` stays exactly the shape of a table document, and `DELETE`, which
 * has no body at all, is guarded by the same one line. It is also a second
 * custom header on every mutation, which is the same preflight argument
 * `server.ts` makes about `content-type`.
 */
export const REVISION_HEADER = 'x-dbmd-revision'

/**
 * The revision a request named, or the refusal to guess one for it.
 *
 * Absent is a refusal rather than a default. This server has one client and it
 * is the page this server sent; a mutation from something that has not said
 * what it read is a mutation made against nothing, and letting it through would
 * leave a hole in the guard shaped exactly like the defect the guard exists
 * for. ADR 0025.
 */
export function parseRevision(header: string | undefined): Parsed<number> {
  if (header === undefined) {
    return bad(
      `a mutation has to say which revision of the model it was made against: send \`${REVISION_HEADER}\` ` +
        `with the \`revision\` from the last GET /api/model. Without it this server cannot tell an edit ` +
        `made against what the files say from one made against a version it has already replaced`,
    )
  }
  const revision = Number(header.trim())
  if (!Number.isInteger(revision) || revision < 0) {
    return bad(`\`${REVISION_HEADER}\` takes the \`revision\` from a status, and got \`${header}\``)
  }
  return { value: revision }
}

const PATCH_KEYS = ['columns', 'indexes', 'layout', 'group', 'body'] as const

export function parseTablePatch(input: unknown): Parsed<TablePatch> {
  const map = asMap(input, 'the request body')
  if (isPatchError(map)) return map
  const object = map.value

  for (const key of Object.keys(object)) {
    if (!(PATCH_KEYS as readonly string[]).includes(key)) {
      return bad(`unknown key \`${key}\`; a table patch takes ${PATCH_KEYS.join(', ')}`)
    }
  }

  const patch: {
    columns?: readonly Column[]
    indexes?: readonly Index[]
    layout?: Layout | null
    group?: string | null
    body?: string
  } = {}

  if (object['columns'] !== undefined) {
    const columns = parseList(object['columns'], 'columns', parseColumn)
    if (isPatchError(columns)) return columns
    patch.columns = columns.value
  }
  if (object['indexes'] !== undefined) {
    const indexes = parseList(object['indexes'], 'indexes', parseIndex)
    if (isPatchError(indexes)) return indexes
    patch.indexes = indexes.value
  }
  if (object['layout'] !== undefined) {
    if (object['layout'] === null) patch.layout = null
    else {
      const layout = parseLayout(object['layout'], 'layout')
      if (isPatchError(layout)) return layout
      patch.layout = layout.value
    }
  }
  if (object['group'] !== undefined) {
    if (object['group'] === null) patch.group = null
    else {
      const group = asString(object['group'], 'group')
      if (isPatchError(group)) return group
      patch.group = group.value
    }
  }
  if (object['body'] !== undefined) {
    const body = asString(object['body'], 'body')
    if (isPatchError(body)) return body
    patch.body = body.value
  }

  return { value: patch }
}

const NOTE_KEYS = ['layout', 'color', 'body'] as const

export function parseNotePatch(input: unknown): Parsed<NotePatch> {
  const map = asMap(input, 'the request body')
  if (isPatchError(map)) return map
  const object = map.value

  for (const key of Object.keys(object)) {
    if (!(NOTE_KEYS as readonly string[]).includes(key)) {
      return bad(`unknown key \`${key}\`; a note patch takes ${NOTE_KEYS.join(', ')}`)
    }
  }

  const patch: { layout?: Layout | null; color?: string | null; body?: string } = {}
  if (object['layout'] !== undefined) {
    if (object['layout'] === null) patch.layout = null
    else {
      const layout = parseLayout(object['layout'], 'layout')
      if (isPatchError(layout)) return layout
      patch.layout = layout.value
    }
  }
  const color = parseColor(object['color'])
  if (isPatchError(color)) return color
  if (color.value !== undefined) patch.color = color.value
  if (object['body'] !== undefined) {
    const body = asString(object['body'], 'body')
    if (isPatchError(body)) return body
    patch.body = body.value
  }
  return { value: patch }
}

const GROUP_KEYS = ['label', 'color', 'body'] as const

export function parseGroupPatch(input: unknown): Parsed<GroupPatch> {
  const map = asMap(input, 'the request body')
  if (isPatchError(map)) return map
  const object = map.value

  for (const key of Object.keys(object)) {
    if ((GROUP_KEYS as readonly string[]).includes(key)) continue
    // Named rather than lumped in with the general refusal, because these two
    // are the mistakes somebody actually makes, and "unknown key `layout`" is
    // the answer that sends them looking for a typo instead of reading ADR
    // 0005. dbmd-34's whole trap is a group that acquires coordinates.
    if (key === 'layout') {
      return bad(
        'a group has no coordinates: its box is the bounding box of its members plus padding, ' +
          'computed on every render and never stored (ADR 0005). Move its members instead',
      )
    }
    if (key === 'members' || key === 'tables') {
      return bad(
        `a group never lists its members: a table joins one with \`group: <name>\` in its own file, ` +
          `which is what makes two branches adding to the same group two files rather than one line (ADR 0005). ` +
          `Send \`{ "group": "<name>" }\` to PATCH /api/table/<table> instead`,
      )
    }
    return bad(`unknown key \`${key}\`; a group patch takes ${GROUP_KEYS.join(', ')}`)
  }

  const patch: { label?: string | null; color?: string | null; body?: string } = {}
  if (object['label'] !== undefined) {
    if (object['label'] === null) patch.label = null
    else {
      const label = asString(object['label'], 'label')
      if (isPatchError(label)) return label
      patch.label = label.value
    }
  }
  const color = parseColor(object['color'])
  if (isPatchError(color)) return color
  if (color.value !== undefined) patch.color = color.value
  if (object['body'] !== undefined) {
    const body = asString(object['body'], 'body')
    if (isPatchError(body)) return body
    patch.body = body.value
  }
  return { value: patch }
}

/**
 * `color`, which is a name and not a hex value, or `null` to remove the key.
 *
 * The set of names is deliberately not checked here. `docs/format.md` says the
 * value is carried through and not validated, so a model that says
 * `color: seafoam` reads, writes and round-trips; the studio draws an unknown
 * name plainly and says so in the panel rather than refusing an edit to a file
 * it can read. A server that had an opinion here would be a second, narrower
 * format than the one the reader implements.
 */
function parseColor(input: unknown): Parsed<string | null | undefined> {
  if (input === undefined) return { value: undefined }
  if (input === null) return { value: null }
  const color = asString(input, 'color')
  if (isPatchError(color)) return color
  return { value: color.value }
}

/** A new table: the same patch, plus the name the file will be called. */
export function parseNewTable(input: unknown): Parsed<{ name: string; patch: TablePatch }> {
  return parseNew(input, 'table', parseTablePatch)
}

/** A new note: a name, and everything a note patch can say. */
export function parseNewNote(input: unknown): Parsed<{ name: string; patch: NotePatch }> {
  return parseNew(input, 'note', parseNotePatch)
}

/** A new group: a name, a label and a colour. Never a position (ADR 0005). */
export function parseNewGroup(input: unknown): Parsed<{ name: string; patch: GroupPatch }> {
  return parseNew(input, 'group', parseGroupPatch)
}

function parseNew<T>(
  input: unknown,
  kind: string,
  parsePatch: (rest: unknown) => Parsed<T>,
): Parsed<{ name: string; patch: T }> {
  const map = asMap(input, 'the request body')
  if (isPatchError(map)) return map
  const { name: rawName, ...rest } = map.value
  if (rawName === undefined) return bad(`a new ${kind} needs a \`name\``)
  const name = asString(rawName, 'name')
  if (isPatchError(name)) return name
  const patch = parsePatch(rest)
  if (isPatchError(patch)) return patch
  return { value: { name: name.value, patch: patch.value } }
}

/**
 * The one place that knows what keys a column has.
 *
 * The format is still moving, so when a key is renamed or added this is the
 * function that changes, and the type checker points at it rather than at six
 * scattered literals.
 */
const COLUMN_KEYS = ['name', 'type', 'pk', 'nullable', 'default', 'ref'] as const

function parseColumn(input: unknown, where: string): Parsed<Column> {
  const map = asMap(input, where)
  if (isPatchError(map)) return map
  const object = map.value
  const unknown = Object.keys(object).find(
    (key) => !(COLUMN_KEYS as readonly string[]).includes(key),
  )
  if (unknown !== undefined) {
    return bad(`unknown key \`${unknown}\` on ${where}; a column takes ${COLUMN_KEYS.join(', ')}`)
  }

  const name = asString(object['name'], `${where}.name`)
  if (isPatchError(name)) return name
  const type = asString(object['type'], `${where}.type`)
  if (isPatchError(type)) return type

  const column: {
    name: string
    type: string
    pk?: boolean
    nullable?: boolean
    default?: string
    ref?: { table: string; column: string }
  } = { name: name.value, type: type.value }

  if (object['pk'] !== undefined) {
    const pk = asBoolean(object['pk'], `${where}.pk`)
    if (isPatchError(pk)) return pk
    column.pk = pk.value
  }
  if (object['nullable'] !== undefined) {
    const nullable = asBoolean(object['nullable'], `${where}.nullable`)
    if (isPatchError(nullable)) return nullable
    column.nullable = nullable.value
  }
  if (object['default'] !== undefined) {
    const value = asString(object['default'], `${where}.default`)
    if (isPatchError(value)) return value
    column.default = value.value
  }
  if (object['ref'] !== undefined) {
    const ref = asMap(object['ref'], `${where}.ref`)
    if (isPatchError(ref)) return ref
    const table = asString(ref.value['table'], `${where}.ref.table`)
    if (isPatchError(table)) return table
    const target = asString(ref.value['column'], `${where}.ref.column`)
    if (isPatchError(target)) return target
    const parsed: {
      table: string
      column: string
      onDelete?: ReferentialAction
      onUpdate?: ReferentialAction
    } = { table: table.value, column: target.value }
    for (const key of ['onDelete', 'onUpdate'] as const) {
      if (ref.value[key] === undefined) continue
      const action = asAction(ref.value[key], `${where}.ref.${key}`)
      if (isPatchError(action)) return action
      parsed[key] = action.value
    }
    column.ref = parsed
  }

  return { value: column }
}

/** The one place that knows what keys an index has, for the same reason. */
const INDEX_KEYS = ['name', 'columns', 'unique'] as const

/**
 * One index key: a column name, or `{ expression }` carried through unchanged.
 *
 * The inspector cannot edit an expression key and does not try (ADR 0022); it
 * sends back the one it was given. This has to accept that, or replacing the
 * index list to rename a neighbouring index would be refused, and the table's
 * indexes would stop being editable because one of them holds SQL.
 */
function parseIndexKey(input: unknown, where: string): Parsed<IndexKey> {
  if (typeof input === 'string') return { value: input }
  const map = asMap(input, where)
  if (isPatchError(map)) return map
  const unknown = Object.keys(map.value).find((key) => key !== 'expression')
  if (unknown !== undefined) {
    return bad(`unknown key \`${unknown}\` on ${where}; an index key takes expression`)
  }
  const expression = asString(map.value['expression'], `${where}.expression`)
  if (isPatchError(expression)) return expression
  return { value: { expression: expression.value } }
}

function parseIndex(input: unknown, where: string): Parsed<Index> {
  const map = asMap(input, where)
  if (isPatchError(map)) return map
  const unknown = Object.keys(map.value).find(
    (key) => !(INDEX_KEYS as readonly string[]).includes(key),
  )
  if (unknown !== undefined) {
    return bad(`unknown key \`${unknown}\` on ${where}; an index takes ${INDEX_KEYS.join(', ')}`)
  }
  const name = asString(map.value['name'], `${where}.name`)
  if (isPatchError(name)) return name
  const columns = parseList(map.value['columns'], `${where}.columns`, parseIndexKey)
  if (isPatchError(columns)) return columns
  const index: { name: string; columns: readonly IndexKey[]; unique?: boolean } = {
    name: name.value,
    columns: columns.value,
  }
  if (map.value['unique'] !== undefined) {
    // Uniqueness is an index's property and never a column's. A patch that
    // replaces the index list has to be able to carry it, or editing a table's
    // indexes would quietly drop the constraint that made one of them matter.
    const unique = asBoolean(map.value['unique'], `${where}.unique`)
    if (isPatchError(unique)) return unique
    index.unique = unique.value
  }
  return { value: index }
}

function parseLayout(input: unknown, where: string): Parsed<Layout> {
  const map = asMap(input, where)
  if (isPatchError(map)) return map
  const x = asFiniteNumber(map.value['x'], `${where}.x`)
  if (isPatchError(x)) return x
  const y = asFiniteNumber(map.value['y'], `${where}.y`)
  if (isPatchError(y)) return y
  const layout: { x: number; y: number; w?: number; h?: number } = { x: x.value, y: y.value }
  if (map.value['w'] !== undefined) {
    const w = asFiniteNumber(map.value['w'], `${where}.w`)
    if (isPatchError(w)) return w
    layout.w = w.value
  }
  if (map.value['h'] !== undefined) {
    const h = asFiniteNumber(map.value['h'], `${where}.h`)
    if (isPatchError(h)) return h
    layout.h = h.value
  }
  return { value: layout }
}

function parseList<T>(
  input: unknown,
  where: string,
  parseOne: (item: unknown, where: string) => Parsed<T>,
): Parsed<readonly T[]> {
  if (!Array.isArray(input)) return bad(`${where} must be a list`)
  const items: T[] = []
  for (const [position, item] of input.entries()) {
    const parsed = parseOne(item, `${where}[${position}]`)
    if (isPatchError(parsed)) return parsed
    items.push(parsed.value)
  }
  return { value: items }
}

function asMap(input: unknown, where: string): Parsed<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return bad(`${where} must be an object`)
  }
  return { value: input as Record<string, unknown> }
}

function asString(input: unknown, where: string): Parsed<string> {
  if (typeof input !== 'string') return bad(`${where} must be a string`)
  return { value: input }
}

/**
 * One of the five referential actions, spelled as the file spells them.
 *
 * Refused rather than dropped, for this module's own reason: an edit that is
 * quietly accepted with less than the caller meant looks like a slow disk from
 * the client. ADR 0046.
 */
function asAction(input: unknown, where: string): Parsed<ReferentialAction> {
  const known = REFERENTIAL_ACTIONS.find((action) => action === input)
  if (known === undefined) {
    return bad(`${where} must be one of ${REFERENTIAL_ACTIONS.map((a) => `\`${a}\``).join(', ')}`)
  }
  return { value: known }
}

function asBoolean(input: unknown, where: string): Parsed<boolean> {
  if (typeof input !== 'boolean') return bad(`${where} must be true or false`)
  return { value: input }
}

function asFiniteNumber(input: unknown, where: string): Parsed<number> {
  // A layout carries coordinates that get written into a file and read back, so
  // an infinity or a NaN here becomes `.inf` in somebody's frontmatter.
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return bad(`${where} must be a finite number`)
  }
  return { value: input }
}
