/**
 * A canonical introspection document, as a `Model` the writer can write.
 *
 * This is the join between the two halves of dbmd, and it is a pure function
 * over the canonical document on purpose: no filesystem, no clock, no CLI. The
 * command in `src/cli/import.ts` reads the file, guards the directory and
 * prints; everything about *what a table becomes* is decided here, where it can
 * be tested against a committed fixture. ADR 0029 is the argument for the
 * decisions below, and the three that a reviewer should stop on are:
 *
 * **A column's type is the engine's own name with its modifier put back on.**
 * `character varying` and `length: 32` become `character varying(32)`, not
 * `string` and not `varchar`. The normalised vocabulary exists so code can
 * switch on a type without knowing the engine (ADR 0009) and it is lossy by
 * construction; a model file is read by a person who is comparing it against a
 * real database, and `string` is not a type any engine has.
 *
 * **The prose body is one line and it is a prompt.** An imported model with a
 * generated paragraph per table teaches its reader that the prose is worthless,
 * and the prose is the only thing this format has that a diagram does not. What
 * the catalogue itself holds is carried: a table comment is somebody's own words
 * about their own table rather than dbmd's.
 *
 * **What the format cannot hold is dropped and documented; what would make a
 * broken model is diagnosed.** A check constraint, an index's `INCLUDE` list
 * and a filtered index's predicate have nowhere to go, and `docs/format.md`
 * says so under what the format does not have. A foreign key to a table that is
 * not in the file, two tables that would be written to one file, and a name no
 * file can hold are different: each would leave a model that lies, so each gets
 * a diagnostic naming the table.
 */

import { isFileName } from '../model/paths.js'
import type { Column, Index, IndexKey, Model, Ref, RefEdge, Table } from '../model/types.js'
import type {
  Column as CatalogColumn,
  ColumnType,
  Index as CatalogIndex,
  IndexKey as CatalogIndexKey,
  IntrospectionDocument,
  Table as CatalogTable,
} from './contract.js'
import type { Diagnostic } from './diagnostics.js'
import { compareCodeUnits, inDocument, sortDiagnostics } from './diagnostics.js'

/**
 * The grid an imported table lands on.
 *
 * The numbers are `src/studio/client/place.ts`'s, deliberately: that module
 * already answers "where does a table with no coordinates go" for the canvas,
 * and an import that chose differently would move every box the first time
 * somebody opened the studio on it. They are copied rather than imported
 * because that file is browser code and this is not, and four numbers across
 * that seam is a smaller wrong than a Node module importing the bundle. ADR
 * 0029 names the duplication and the way out.
 *
 * There is no auto layout. Same input, same coordinates, and the developer
 * arranges them once.
 */
const MARGIN = 40
const COLUMN_PITCH = 300
const ROW_PITCH = 260
const PER_ROW = 5

export interface ImportedModel {
  readonly model: Model
  /** Sorted, and pointing into the document that was read. Never a throw. */
  readonly diagnostics: readonly Diagnostic[]
}

/** What the tables that are going to be written need to know about each other. */
interface Context {
  /** Every `schema.name` the file contains, so a ref can tell absent from unwritable. */
  readonly exported: ReadonlySet<string>
  /** The names that will have a file, so a ref never points at one that will not. */
  readonly writable: ReadonlySet<string>
  /** Table to the JSONPath it came from, so a diagnostic points at the file the user pasted. */
  readonly at: ReadonlyMap<CatalogTable, string>
  readonly diagnostics: Diagnostic[]
}

/**
 * Turn a canonical introspection document into a model.
 *
 * The model is complete by construction: every object says `complete: true`
 * because nothing was read from a file that could have held more than the
 * object does. That claim is what lets `writeModel` write it (ADR 0010), and it
 * is made here out loud rather than defaulted.
 */
export function modelFromIntrospection(document: IntrospectionDocument): ImportedModel {
  const diagnostics: Diagnostic[] = []

  const at = new Map<CatalogTable, string>()
  document.tables.forEach((table, index) => at.set(table, `$.tables[${index}]`))

  const kept = withoutCollisions(document.tables, at, diagnostics)

  // Sorted by name, because that is the order `readModel` puts tables in, so
  // slot n on the grid is the same table whatever order the catalogue returned
  // its rows in and whatever schema each came from.
  const ordered = [...kept].sort((a, b) => compareCodeUnits(a.name, b.name))

  const context: Context = {
    exported: new Set(document.tables.map(qualified)),
    // `isFileName` decides which refs may be written, and deliberately does not
    // also produce the message: the table's own report is the `WriteSkip` the
    // writer raises, which names the object, and a caller that asked first and
    // reported it too would leave two sentences about one table. ADR 0026.
    writable: new Set(ordered.filter((table) => isFileName(table.name)).map((t) => t.name)),
    at,
    diagnostics,
  }

  const tables = ordered.map((table, slot) => tableOf(table, slot, context))

  const model: Model = {
    ...(document.source?.database === undefined ? {} : { name: document.source.database }),
    engine: document.engine,
    body: modelBody(document),
    complete: true,
    tables,
    notes: [],
    groups: [],
    referencesTo: referencesTo(tables),
    groupMembers: new Map(),
  }

  return { model, diagnostics: sortDiagnostics(diagnostics) }
}

// --------------------------------------------------------------------------
// One table
// --------------------------------------------------------------------------

function tableOf(table: CatalogTable, slot: number, context: Context): Table {
  const refs = refsOf(table, context)
  const key = table.primaryKey?.columns ?? []
  return {
    kind: 'table',
    name: table.name,
    path: `tables/${table.name}.md`,
    complete: true,
    columns: table.columns.map((column) => columnOf(column, key, refs.get(column.name))),
    indexes: table.indexes.map(indexOf),
    layout: {
      x: MARGIN + (slot % PER_ROW) * COLUMN_PITCH,
      y: MARGIN + Math.floor(slot / PER_ROW) * ROW_PITCH,
    },
    body: tableBody(table),
  }
}

function columnOf(column: CatalogColumn, key: readonly string[], ref: Ref | undefined): Column {
  return {
    name: column.name,
    type: typeText(column.type),
    ...(key.includes(column.name) ? { pk: true } : {}),
    // Written on every column, including the key's, where it is implied. The
    // catalogue reported it and the format can hold it, so leaving it off would
    // be dbmd deciding a fact is obvious enough not to write down.
    nullable: column.nullable,
    ...(column.default === undefined ? {} : { default: column.default.expression }),
    ...(ref === undefined ? {} : { ref }),
  }
}

/**
 * The type as the file spells it: the engine's own name, with the modifier the
 * contract keeps beside it put back on the end.
 *
 * `native` carries no modifier by contract (ADR 0009), so `character varying`
 * and `length: 32` arrive apart and `varchar(32)` and `varchar(255)` would be
 * the same three words if they were not put back together. The modifier goes on
 * the end, always, and nothing here looks inside `native`: reading it would be
 * ADR 0009's own revisit condition, and knowing that Postgres writes
 * `timestamp(3) with time zone` rather than `timestamp with time zone(3)` is
 * engine knowledge, which ADR 0007 keeps inside `providers/`. ADR 0029 names
 * that one wart and the way out, which is a method on the provider.
 */
export function typeText(type: ColumnType): string {
  if (type.length !== undefined) return `${type.native}(${type.length})`
  if (type.precision !== undefined) {
    return type.scale === undefined
      ? `${type.native}(${type.precision})`
      : `${type.native}(${type.precision},${type.scale})`
  }
  // A scale with no precision is a fractional-seconds precision, which both
  // engines write as one number.
  if (type.scale !== undefined) return `${type.native}(${type.scale})`
  return type.native
}

function indexOf(index: CatalogIndex): Index {
  return {
    name: index.name,
    columns: index.columns.map(indexKeyOf),
    // Absent rather than `unique: false`, which is the canonical spelling, and
    // `isUniqueConstraint` is dropped: how the uniqueness was declared is not
    // what is true of the rows. The appendix to ADR 0003 is the argument.
    ...(index.isUnique ? { unique: true } : {}),
  }
}

/** A column by name, or engine text as a mapping. ADR 0022, in both directions. */
function indexKeyOf(key: CatalogIndexKey): IndexKey {
  return 'column' in key ? key.column : { expression: key.expression }
}

// --------------------------------------------------------------------------
// Refs, and the two ways a foreign key does not become one
// --------------------------------------------------------------------------

/**
 * The `ref` for each column of this table, by column name.
 *
 * A foreign key becomes one `ref` per column pair, because ADR 0003 declares a
 * relationship on the referring column and has no registry to put a constraint
 * in. A composite key therefore arrives as two refs and the fact that they are
 * one constraint, and its name, is not carried; `docs/format.md` names that
 * loss beside the others.
 */
function refsOf(table: CatalogTable, context: Context): Map<string, Ref> {
  const refs = new Map<string, Ref>()

  table.foreignKeys.forEach((foreignKey, index) => {
    const target = qualified(foreignKey)
    if (!context.exported.has(target)) {
      context.diagnostics.push({
        code: 'import/reference-not-exported',
        severity: 'warning',
        at: inDocument(`${context.at.get(table) ?? '$'}.foreignKeys[${index}]`),
        message:
          `\`${qualified(table)}\` has a foreign key to \`${target}\`, which this file does ` +
          `not contain, so no \`ref:\` was written for it; re-run the query over the whole ` +
          `database if that table belongs in the model`,
      })
      return
    }
    // In the file but with no file of its own: it collided with another table's
    // name, or its name is one no filesystem accepts. Both are already reported
    // against the table itself, and a second sentence per foreign key pointing
    // at it would bury the one that says what to do.
    if (!context.writable.has(foreignKey.referencedTable)) return

    foreignKey.columns.forEach((column, position) => {
      const referenced = foreignKey.referencedColumns[position]
      if (referenced === undefined) return
      // One `ref:` per column, so a column in two foreign keys keeps the first
      // in name order. The format has one slot and this is the deterministic
      // half of that; `docs/format.md` names the loss.
      if (refs.has(column)) return
      refs.set(column, { table: foreignKey.referencedTable, column: referenced })
    })
  })

  return refs
}

/**
 * The tables, minus any that would be written over another.
 *
 * `tables/` is flat (ADR 0003), so `dbo.Order` and `sales.Order` are one file.
 * Writing both would leave whichever was written last, in a directory that
 * reads as complete, which is the quietest way this command could lose a table.
 * The first in the document's own order is kept, and the document is sorted by
 * schema then name, so which one that is does not depend on the machine.
 */
function withoutCollisions(
  tables: readonly CatalogTable[],
  at: ReadonlyMap<CatalogTable, string>,
  diagnostics: Diagnostic[],
): CatalogTable[] {
  const kept = new Map<string, CatalogTable>()
  const out: CatalogTable[] = []

  for (const table of tables) {
    const first = kept.get(table.name)
    if (first === undefined) {
      kept.set(table.name, table)
      out.push(table)
      continue
    }
    diagnostics.push({
      code: 'import/name-collision',
      severity: 'error',
      at: inDocument(`${at.get(table) ?? '$'}.name`),
      message:
        `\`${qualified(table)}\` and \`${qualified(first)}\` would both be written to ` +
        `tables/${table.name}.md, and a model directory is flat, so only ` +
        `\`${qualified(first)}\` was written; import one schema at a time until the format ` +
        `has somewhere to put the other`,
    })
  }

  return out
}

/** `schema.name`, for a table or for the far end of a foreign key. */
function qualified(subject: CatalogTable | { referencedSchema: string; referencedTable: string }) {
  return 'referencedSchema' in subject
    ? `${subject.referencedSchema}.${subject.referencedTable}`
    : `${subject.schema}.${subject.name}`
}

// --------------------------------------------------------------------------
// Prose. One line, and it is a prompt.
// --------------------------------------------------------------------------

/**
 * The body of a table's file.
 *
 * A table comment is the author's own sentence about the table and is carried
 * verbatim. Everything else is one line saying where the table came from and
 * that nobody has documented it, which is the whole of what an import is
 * allowed to write: a generated paragraph per table would teach the reader that
 * the prose in this format is filler, and then nobody would read the paragraph
 * somebody did write.
 *
 * The schema is in that line because it is the one place the fact survives.
 * `tables/` is flat, so `public.` and `dbo.` are gone from everywhere else.
 */
function tableBody(table: CatalogTable): string {
  const source = `\`${table.schema}.${table.name}\``
  const comment = table.comment?.trim()
  if (comment !== undefined && comment !== '') {
    return `\n${comment}\n\nImported from ${source}.\n`
  }
  return `\nImported from ${source}, and nobody has written down what it is for yet.\n`
}

/** The body of `_model.md`: where it came from, and the ask. */
function modelBody(document: IntrospectionDocument): string {
  const database = document.source?.database
  return (
    `\nImported${database === undefined ? '' : ` from \`${database}\``}.\n\n` +
    `Nothing here has been written down yet. What this database is for, and the two or\n` +
    `three facts about the business that explain the shape of it, are the part no\n` +
    `schema dump could have told you and the reason this model is markdown.\n`
  )
}

// --------------------------------------------------------------------------
// The computed index
// --------------------------------------------------------------------------

/**
 * The reverse of `ref`, which ADR 0003 deliberately leaves uncomputed on disk.
 *
 * `readModel` builds the same map from files and this builds it from a document,
 * because `Model` requires it and there is no file to read yet. The two agreeing
 * is not asserted in prose: `test/import/model.test.ts` writes this model, reads
 * the directory back and compares, so a change to either side that broke the
 * pairing fails there.
 */
function referencesTo(tables: readonly Table[]): ReadonlyMap<string, readonly RefEdge[]> {
  const edges = new Map<string, RefEdge[]>()
  for (const table of tables) edges.set(table.name, [])
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.ref === undefined) continue
      const edge: RefEdge = { from: { table: table.name, column: column.name }, to: column.ref }
      const list = edges.get(column.ref.table)
      if (list === undefined) edges.set(column.ref.table, [edge])
      else list.push(edge)
    }
  }

  const sorted = new Map<string, readonly RefEdge[]>()
  for (const name of [...edges.keys()].sort(compareCodeUnits)) {
    sorted.set(
      name,
      (edges.get(name) ?? []).sort(
        (a, b) =>
          compareCodeUnits(a.from.table, b.from.table) ||
          compareCodeUnits(a.from.column, b.from.column) ||
          compareCodeUnits(a.to.column, b.to.column),
      ),
    )
  }
  return sorted
}
