/**
 * What a re-import would change, as a list somebody reads before it happens.
 *
 * `modelFromIntrospection` answers "what does this database look like as a
 * model". This answers the second question, the one that only exists once there
 * is already a model on disk: **what would writing that over this one do**, item
 * by item, in words, before a byte moves. ADR 0050 is the argument.
 *
 * Three things about it are load-bearing and none of them are obvious from the
 * types:
 *
 * **The list is exhaustive, and that is what makes it safe.** A file is written
 * only for a reason that is on the list, and every reason on the list names the
 * file it is about. `Delta.write` is the set handed to `writeModel`'s `only`, so
 * a table nothing was said about is not opened, not rewritten, and cannot lose
 * the paragraph somebody put in it this morning. A change that is not itemised
 * is a change that does not happen, which is why column order is decided here
 * rather than taken from whichever side happened to be handy.
 *
 * **Prose is never edited and never read for meaning.** A body survives every
 * merge byte for byte. The one thing done with it is the narrow backtick scan
 * ADR 0044 established for rename: when a column or a table goes, the bodies
 * that name it in backticks are counted and said out loud, so the reader learns
 * their own sentence is about to become false. Nothing rewrites it for them.
 *
 * **A rename is a drop and an add.** Matching is by table name and then by
 * column name, and there is nothing else to match on: a catalogue reports names
 * and dbmd never saw the old one. Guessing that `total` became `total_amount`
 * because the types agree would be a guess that silently deletes a column's
 * prose the day it is wrong, so it is refused rather than approximated.
 */

import { MODEL_FILE, directoryOfKind } from '../model/paths.js'
import type { Column, Group, Index, IndexKey, Layout, Model, Ref, Table } from '../model/types.js'
import { compareCodeUnits } from './diagnostics.js'
import { GRID, referencesTo } from './model.js'

// --------------------------------------------------------------------------
// What the list is made of
// --------------------------------------------------------------------------

/**
 * What kind of change one item is, in the vocabulary the list prints.
 *
 * Named for what the database did rather than for what dbmd will do about it,
 * because that is what the reader is checking the list against: they know what
 * they changed in the database last week, and the item they are looking for is
 * the one that does not match that memory.
 */
export type DeltaKind =
  | 'table-added'
  | 'table-removed'
  | 'column-added'
  | 'column-removed'
  | 'column-changed'
  | 'index-added'
  | 'index-removed'
  | 'index-changed'
  | 'model-changed'

/** The short form of each kind, which is the line a reader scans for. */
const HEADLINE: Readonly<Record<DeltaKind, string>> = {
  'table-added': 'database table added',
  'table-removed': 'database table removed',
  'column-added': 'database column added',
  'column-removed': 'database column removed',
  'column-changed': 'database column changed',
  'index-added': 'database index added',
  'index-removed': 'database index removed',
  'index-changed': 'database index changed',
  'model-changed': 'database facts changed',
}

/** One line of the itemised list, and the sentences under it. */
export interface DeltaItem {
  readonly kind: DeltaKind
  /** The file it is about: slash-separated and relative to the model directory. */
  readonly path: string
  /** What the list calls it. `database table removed` and its eight siblings. */
  readonly headline: string
  /**
   * The sentences printed under the headline, each one unwrapped, because where
   * a line breaks is the caller's business and asserting on a break is how a
   * test goes red on a rewrap.
   */
  readonly detail: readonly string[]
}

/** What a re-import would do, in full, before any of it is done. */
export interface Delta {
  /** Every change, ordered by the file it touches then by what it is. */
  readonly items: readonly DeltaItem[]
  /**
   * The model to write when this is confirmed: the model on disk with the
   * database's facts merged into it, and every body, layout and group intact.
   */
  readonly model: Model
  /**
   * Exactly the files the items above justify writing, spelled as
   * `WriteResult.written` spells them. This is `writeModel`'s `only` set and it
   * is the whole safety argument: nothing else is opened.
   */
  readonly write: ReadonlySet<string>
  /**
   * Files to delete, sorted. `writeModel` deliberately does not delete (a file
   * it cannot read is missing from the model, and deleting on that basis throws
   * away the file whose problem somebody is trying to see), so a removal is the
   * caller's own act, taken only against this list.
   */
  readonly remove: readonly string[]
}

// --------------------------------------------------------------------------
// The delta
// --------------------------------------------------------------------------

/**
 * What re-importing `incoming` over `existing` would change.
 *
 * `existing` is a model read off disk and `incoming` is one built from an
 * introspection document. Nothing here touches a filesystem: the whole of the
 * decision is a function of two models, so every case in it is a unit test
 * rather than a temporary directory.
 */
export function deltaOf(existing: Model, incoming: Model): Delta {
  const items: DeltaItem[] = []
  const write = new Set<string>()
  const remove: string[] = []

  const before = new Map(existing.tables.map((table) => [table.name, table]))
  const after = new Map(incoming.tables.map((table) => [table.name, table]))

  // `_model.md` carries two facts the database owns and one thing it does not.
  const model = modelFacts(existing, incoming, items)
  if (items.some((item) => item.kind === 'model-changed')) write.add(MODEL_FILE)

  const tables: Table[] = []
  for (const table of existing.tables) {
    const arrived = after.get(table.name)
    if (arrived === undefined) {
      items.push(tableRemoved(table, existing))
      remove.push(pathOf(table.name))
      continue
    }
    const merged = mergeTable(table, arrived, existing, items)
    tables.push(merged)
    if (merged !== table) write.add(pathOf(table.name))
  }

  // New tables land after the ones already on the canvas, in name order, and
  // nothing already placed moves. Same input, same coordinates.
  const arrivals = incoming.tables.filter((table) => !before.has(table.name))
  const start = firstFreeRow(existing)
  // The arrivals are what is being laid out, so they are what the width is
  // worked out from. Everything already on the canvas keeps the coordinates it
  // has, which is the whole point of this function, so its width is not this
  // block's business. `GRID.columnsFor` is `model.ts`'s own, not a second copy.
  const columns = GRID.columnsFor(arrivals.length)
  arrivals.forEach((table, slot) => {
    tables.push({ ...table, layout: place(start, slot, columns) })
    items.push(tableAdded(table))
    write.add(pathOf(table.name))
  })

  tables.sort((a, b) => compareCodeUnits(a.name, b.name))
  items.sort(byPathThenKind)

  return {
    items,
    model: {
      ...model,
      tables,
      notes: existing.notes,
      groups: existing.groups,
      referencesTo: referencesTo(tables),
      groupMembers: groupMembers(tables, existing.groups),
    },
    write,
    remove: remove.sort(compareCodeUnits),
  }
}

function pathOf(name: string): string {
  return `${directoryOfKind('table')}/${name}.md`
}

// --------------------------------------------------------------------------
// `_model.md`
// --------------------------------------------------------------------------

/**
 * The model file's own facts, merged, and an item when they moved.
 *
 * `engine` and `name` are the database's: the engine is whichever provider read
 * the file, and the name is the database it was read out of. The body is not,
 * and it is the first thing on the list of what this feature exists to protect,
 * so it is carried across untouched along with `complete`.
 *
 * A fact the import does not carry is not a proposal to delete one. A file
 * saved without its database name arrives with `name` absent, which means "this
 * export did not say" rather than "the database has no name", and treating the
 * two the same would drop a line out of `_model.md` on every import from a
 * client that trims that field.
 */
function modelFacts(existing: Model, incoming: Model, items: DeltaItem[]): Model {
  const changes: string[] = []
  const name = incoming.name ?? existing.name
  const engine = incoming.engine ?? existing.engine

  if (name !== existing.name) {
    changes.push(
      `the database is named ${value(incoming.name)} and ${MODEL_FILE} says ${value(existing.name)}`,
    )
  }
  if (engine !== existing.engine) {
    changes.push(
      `the import is from ${value(incoming.engine)} and ${MODEL_FILE} says ${value(existing.engine)}`,
    )
  }

  if (changes.length > 0) {
    items.push({
      kind: 'model-changed',
      path: MODEL_FILE,
      headline: HEADLINE['model-changed'],
      detail: [
        ...changes.map((change) => `${change}, and the import's answer is taken.`),
        `The prose in ${MODEL_FILE} is not touched.`,
      ],
    })
  }

  return {
    ...(name === undefined ? {} : { name }),
    ...(engine === undefined ? {} : { engine }),
    body: existing.body,
    complete: existing.complete,
    tables: [],
    notes: [],
    groups: [],
    referencesTo: new Map(),
    groupMembers: new Map(),
    // A fact about the directory this delta is proposed against, so it is
    // carried across for the same reason `body` and `complete` are: the files
    // are still there, and the import did not read them either.
    refused: existing.refused,
  }
}

// --------------------------------------------------------------------------
// A table that is in both
// --------------------------------------------------------------------------

/**
 * The table on disk with the database's columns and indexes merged into it.
 *
 * Returns the object it was handed, identically, when nothing differs. That
 * identity is what `deltaOf` branches on to decide whether the file belongs in
 * the write set, so "no change" and "not written" are one fact rather than two
 * that can drift apart.
 *
 * `body`, `layout` and `group` come from disk and are never consulted for
 * anything: they are the prose, the coordinates and the membership, which are
 * the three things a database has no opinion about.
 */
function mergeTable(existing: Table, incoming: Table, model: Model, items: DeltaItem[]): Table {
  const columns = mergeColumns(existing, incoming, model, items)
  const indexes = mergeIndexes(existing, incoming, items)
  if (columns === existing.columns && indexes === existing.indexes) return existing
  return { ...existing, columns, indexes }
}

/**
 * The columns, and the decision about their order.
 *
 * **A column that is in both keeps the position the file has it in, and a new
 * column is appended.** The order a catalogue reports is not a fact the format
 * claims to hold: `docs/format.md` says the keys are listed in the order dbmd
 * writes them and that you may write them in any order, and a column dropped
 * and re-added in the database comes back last however long it has been there.
 * Taking the catalogue's order would rewrite whole `columns:` blocks for a
 * schema that had not changed, and a re-import that looks enormous is one
 * nobody reads. So a reorder is not a change, it is never itemised, and it is
 * never written.
 *
 * The cost is real and is named in ADR 0050: after a drop and an add, the file
 * lists columns in an order the database does not use. Nothing downstream reads
 * the order for meaning, and `dbmd export` sorts its own output.
 */
function mergeColumns(
  existing: Table,
  incoming: Table,
  model: Model,
  items: DeltaItem[],
): readonly Column[] {
  const after = new Map(incoming.columns.map((column) => [column.name, column]))
  const before = new Set(existing.columns.map((column) => column.name))
  let changed = false

  const columns: Column[] = []
  for (const column of existing.columns) {
    const arrived = after.get(column.name)
    if (arrived === undefined) {
      items.push(columnRemoved(existing, column, model))
      changed = true
      continue
    }
    const differences = columnDifferences(column, arrived)
    if (differences.length === 0) {
      columns.push(column)
      continue
    }
    items.push({
      kind: 'column-changed',
      path: existing.path,
      headline: HEADLINE['column-changed'],
      detail: [
        `\`${existing.name}.${column.name}\`: ${differences.join(', ')}.`,
        `The database's answer is taken, and nothing else about the column is touched.`,
      ],
    })
    // The whole column, not the one key that differs. A column carries no prose
    // and nothing about one is hand-written that the catalogue does not also
    // report, so "take the database's type and nothing else" and "take the
    // database's column" are the same write; the itemised list is where the
    // difference is spelled out, because that is what the reader is checking.
    columns.push(arrived)
    changed = true
  }

  for (const column of incoming.columns) {
    if (before.has(column.name)) continue
    columns.push(column)
    items.push({
      kind: 'column-added',
      path: existing.path,
      headline: HEADLINE['column-added'],
      detail: [
        `\`${existing.name}.${column.name}\` is ${column.type} in the database and is not in the file, so it is added at the end of \`columns:\`.`,
      ],
    })
    changed = true
  }

  return changed ? columns : existing.columns
}

/** Every fact about one column that the two sides disagree about, in file order. */
function columnDifferences(before: Column, after: Column): string[] {
  const differences: string[] = []
  const say = (key: string, a: unknown, b: unknown): void => {
    if (a === b) return
    differences.push(`${key} ${value(a)} in the file and ${value(b)} in the database`)
  }
  say('type', before.type, after.type)
  say('pk', before.pk, after.pk)
  say('nullable', before.nullable, after.nullable)
  say('default', before.default, after.default)
  const a = refText(before.ref)
  const b = refText(after.ref)
  if (a !== b) differences.push(`ref ${value(a)} in the file and ${value(b)} in the database`)
  return differences
}

/** A `ref:` and its two actions as one comparable string, or nothing at all. */
function refText(ref: Ref | undefined): string | undefined {
  if (ref === undefined) return undefined
  const actions = [
    ...(ref.onDelete === undefined ? [] : [`on delete ${ref.onDelete}`]),
    ...(ref.onUpdate === undefined ? [] : [`on update ${ref.onUpdate}`]),
  ]
  return [`${ref.table}.${ref.column}`, ...actions].join(', ')
}

/**
 * The indexes, on the same rule as the columns: what is in both keeps its
 * place, what is new is appended, and what is gone is itemised.
 *
 * Matched by name, because an index has one and it is the name the engine
 * prints when a unique index refuses a row. Two indexes over the same columns
 * under different names are two indexes here, which is what they are in the
 * database.
 */
function mergeIndexes(existing: Table, incoming: Table, items: DeltaItem[]): readonly Index[] {
  const after = new Map(incoming.indexes.map((index) => [index.name, index]))
  const before = new Set(existing.indexes.map((index) => index.name))
  let changed = false

  const indexes: Index[] = []
  for (const index of existing.indexes) {
    const arrived = after.get(index.name)
    if (arrived === undefined) {
      items.push({
        kind: 'index-removed',
        path: existing.path,
        headline: HEADLINE['index-removed'],
        detail: [
          `\`${index.name}\` is in the file and not in the database, so the entry is removed from \`indexes:\`.`,
        ],
      })
      changed = true
      continue
    }
    if (indexText(index) === indexText(arrived)) {
      indexes.push(index)
      continue
    }
    items.push({
      kind: 'index-changed',
      path: existing.path,
      headline: HEADLINE['index-changed'],
      detail: [
        `\`${index.name}\` is ${indexText(index)} in the file and ${indexText(arrived)} in the database.`,
        `The database's answer is taken.`,
      ],
    })
    indexes.push(arrived)
    changed = true
  }

  for (const index of incoming.indexes) {
    if (before.has(index.name)) continue
    indexes.push(index)
    items.push({
      kind: 'index-added',
      path: existing.path,
      headline: HEADLINE['index-added'],
      detail: [
        `\`${index.name}\` is ${indexText(index)} in the database and is not in the file, so it is added at the end of \`indexes:\`.`,
      ],
    })
    changed = true
  }

  return changed ? indexes : existing.indexes
}

/** One index as the sentence a difference is stated in, and as its own identity. */
function indexText(index: Index): string {
  const columns = index.columns.map(keyText).join(', ')
  return `${index.unique === true ? 'unique ' : ''}(${columns})`
}

function keyText(key: IndexKey): string {
  return typeof key === 'string' ? key : key.expression
}

// --------------------------------------------------------------------------
// The two removals, and the sentences they leave behind
// --------------------------------------------------------------------------

/**
 * A table the import does not contain.
 *
 * The owner's own words are the headline. Under it are the two things a person
 * about to confirm this needs and cannot get anywhere else: what happens to the
 * prose in that file, and the likeliest reason a table they never dropped is on
 * this list, which is an import that covered fewer schemas than the last one.
 */
function tableRemoved(table: Table, model: Model): DeltaItem {
  const bodies = mentions(
    model,
    (span) => span === table.name || span.startsWith(`${table.name}.`),
  ).filter((mention) => mention.path !== table.path)
  return {
    kind: 'table-removed',
    path: table.path,
    headline: HEADLINE['table-removed'],
    detail: [
      `\`${table.name}\` is in the model and not in this import, so ${table.path} is deleted.`,
      ...(table.body.trim() === ''
        ? []
        : [`Its prose goes with it, and the last commit is where that survives.`]),
      ...sentenceAbout(
        bodies,
        (said) =>
          `${said} ${plural(said, 'mention', 'mentions')} of \`${table.name}\` in backticks elsewhere ${plural(said, 'stays', 'stay')} as written, in ${paths(bodies)}, so ${plural(said, 'that sentence', 'those sentences')} will name a table that is not there.`,
      ),
      `A table nobody dropped on this list usually means an import over fewer schemas than the last one.`,
    ],
  }
}

/**
 * A column the import does not contain, and the paragraphs that name it.
 *
 * ADR 0044's rule, one level down. A backticked span is a claim about the
 * schema and a bare word is English, so `\`status\`` in this table's own body
 * counts and `\`orders.status\`` counts in any body at all. **The paragraph is
 * not edited.** The list says the sentence is about to be false and a person
 * decides what it should say instead, which is the whole of what a machine is
 * allowed to do to prose in this format.
 */
function columnRemoved(table: Table, column: Column, model: Model): DeltaItem {
  const qualified = `${table.name}.${column.name}`
  const bodies = mentions(
    model,
    (span, path) => span === qualified || (path === table.path && span === column.name),
  )
  return {
    kind: 'column-removed',
    path: table.path,
    headline: HEADLINE['column-removed'],
    detail: [
      `\`${qualified}\` is in the file and not in the database, so the entry is removed from \`columns:\`.`,
      ...sentenceAbout(
        bodies,
        (said) =>
          `${said} ${plural(said, 'mention', 'mentions')} of it in backticks ${plural(said, 'stays', 'stay')} exactly as written, in ${paths(bodies)}, so the prose will name a column that is not there. No check reads a body, so nothing else will tell you.`,
      ),
    ],
  }
}

/** A table the model does not have yet. Its own body is the import's one line. */
function tableAdded(table: Table): DeltaItem {
  return {
    kind: 'table-added',
    path: table.path,
    headline: HEADLINE['table-added'],
    detail: [
      `\`${table.name}\` is in the database and not in the model, so ${table.path} is written, with ${table.columns.length} ${plural(table.columns.length, 'column', 'columns')} and the one line of prose an import is allowed to write.`,
      `It lands below everything already on the canvas and moves nothing that is placed.`,
    ],
  }
}

// --------------------------------------------------------------------------
// Reading a body, and the only thing that is read out of one
// --------------------------------------------------------------------------

/** One body that names the subject in backticks, and how often. */
interface Mention {
  readonly path: string
  readonly count: number
}

/**
 * A code span, bounded to one line because that is what a span is, which is also
 * what stops a fenced block being read as one enormous span. ADR 0044's regular
 * expression, and this is a second copy of it on purpose: the first lives in
 * `src/studio/client/model.ts`, which is browser code built by a different
 * tsconfig, and four lines across that seam is a smaller wrong than a Node
 * module importing the bundle. ADR 0050 names the duplication.
 */
const CODE_SPAN = /`([^`\n]+)`/g

/**
 * Every body in the model that holds a span the predicate accepts.
 *
 * The predicate is given the span and the path, because what counts as a claim
 * about a column depends on which file the sentence is in: a bare `\`status\``
 * is about this table inside this table's own file and is an English word
 * anywhere else.
 *
 * **This is not a check over the model and must not become one.** ADR 0003
 * makes a body opaque to everything, and what this answers is a question about
 * one moment rather than about the model: something is about to be deleted, and
 * these are the paragraphs that say it is there.
 */
function mentions(
  model: Model,
  names: (span: string, path: string) => boolean,
): readonly Mention[] {
  const bodies: readonly { readonly path: string; readonly body: string }[] = [
    { path: MODEL_FILE, body: model.body },
    ...model.tables,
    ...model.notes,
    ...model.groups,
  ]
  const found: Mention[] = []
  for (const { path, body } of bodies) {
    let hits = 0
    for (const match of body.matchAll(CODE_SPAN)) {
      const span = match[1]
      if (span !== undefined && names(span, path)) hits += 1
    }
    if (hits > 0) found.push({ path, count: hits })
  }
  return found
}

/**
 * The sentence about the paragraphs that are about to go stale, or no sentence.
 *
 * The count is spans and not files, because a paragraph that names the thing
 * three times is three sentences to reread, and the file list is what says
 * where to go. Nothing at all is said when there is nothing, rather than "0
 * mentions": a line that fires on every item is a line people stop reading, and
 * this one is the whole reason a removal is safe to confirm.
 */
function sentenceAbout(
  bodies: readonly Mention[],
  say: (said: number) => string,
): readonly string[] {
  const said = bodies.reduce((sum, mention) => sum + mention.count, 0)
  return said === 0 ? [] : [say(said)]
}

/** The files, in the order the reader walks them, as one clause. */
function paths(bodies: readonly Mention[]): string {
  return bodies.map((mention) => mention.path).join(', ')
}

// --------------------------------------------------------------------------
// Where a new table lands
// --------------------------------------------------------------------------

/**
 * The first grid row below everything that already has coordinates.
 *
 * Notes count as well as tables. Landing a new table on top of a note somebody
 * placed is exactly the thing "disturbs nothing already placed" is about, and a
 * note is the object most likely to be sitting under the bottom row.
 */
function firstFreeRow(model: Model): number {
  const placed: readonly (Layout | undefined)[] = [
    ...model.tables.map((table) => table.layout),
    ...model.notes.map((note) => note.layout),
  ]
  const bottoms = placed.filter((layout) => layout !== undefined).map((layout) => layout.y)
  return bottoms.length === 0 ? GRID.margin : Math.max(...bottoms) + GRID.rowPitch
}

function place(startY: number, slot: number, columns: number): Layout {
  return {
    x: GRID.margin + (slot % columns) * GRID.columnPitch,
    y: startY + Math.floor(slot / columns) * GRID.rowPitch,
  }
}

// --------------------------------------------------------------------------
// Odds and ends
// --------------------------------------------------------------------------

/**
 * Group name to its members, rebuilt over the merged tables.
 *
 * The same rule `readModel` uses, because a caller holding this model must not
 * be able to tell it apart from one that was read: every group file gets an
 * entry, possibly empty, and a `group:` naming no group file gets none, since a
 * missing group is a diagnostic rather than a reason to invent one.
 */
function groupMembers(
  tables: readonly Table[],
  groups: readonly Group[],
): ReadonlyMap<string, readonly string[]> {
  const members = new Map<string, string[]>()
  for (const group of groups) members.set(group.name, [])
  for (const table of tables) {
    if (table.group === undefined) continue
    members.get(table.group)?.push(table.name)
  }
  const sorted = new Map<string, readonly string[]>()
  for (const name of [...members.keys()].sort(compareCodeUnits)) {
    sorted.set(name, (members.get(name) ?? []).sort(compareCodeUnits))
  }
  return sorted
}

/** A value as the list spells it, so an absent one reads as a sentence and not as a gap. */
function value(subject: unknown): string {
  if (subject === undefined) return 'not said'
  if (typeof subject === 'string') return `\`${subject}\``
  return `\`${String(subject)}\``
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** Files in the order a reader walks them, and one file's items in a fixed order. */
const ORDER: readonly DeltaKind[] = [
  'model-changed',
  'table-removed',
  'table-added',
  'column-removed',
  'column-changed',
  'column-added',
  'index-removed',
  'index-changed',
  'index-added',
]

function byPathThenKind(a: DeltaItem, b: DeltaItem): number {
  return compareCodeUnits(a.path, b.path) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
}
