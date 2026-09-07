/**
 * The model the page holds, and the questions the inspector asks of it.
 *
 * Three small things live here together because they are the same idea: the
 * page has a copy of the model, and it should be able to answer questions about
 * that copy without a round trip.
 *
 * **`fromWireModel` is the inverse of `toWireModel`, and it exists so the page
 * can run the validator.** `src/model/validate.ts` takes a `Model` and nothing
 * else: no directory, no file handles, no reader diagnostics (ADR 0017). That
 * makes it a pure function over a value the page is already holding, so the page
 * runs it. The only thing to undo is the map flattening the wire does, because
 * `JSON.stringify` renders a `Map` as `{}`.
 *
 * **`referrersTo` walks declarations and never `Model.referencesTo`.** That is
 * ADR 0017's third rule, and here it buys something the validator only gets a
 * principle from: `referencesTo` is computed by the reader on the server, so it
 * describes the model as the last read found it, and the page has been editing
 * refs since. Walking `table.columns[].ref` is right the instant a keystroke
 * lands, which is when the inspector needs to say what a rename is about to
 * break.
 */

import type { Column, Model, Table } from '../../model/types.js'
import type { WireModel } from '../wire.js'

export function fromWireModel(wire: WireModel): Model {
  return {
    ...(wire.name === undefined ? {} : { name: wire.name }),
    ...(wire.engine === undefined ? {} : { engine: wire.engine }),
    body: wire.body,
    complete: wire.complete,
    tables: wire.tables,
    notes: wire.notes,
    groups: wire.groups,
    referencesTo: new Map(wire.referencesTo.map(({ table, edges }) => [table, edges])),
    groupMembers: new Map(wire.groupMembers.map(({ group, tables }) => [group, tables])),
  }
}

/** One column, somewhere in the model, whose `ref:` points at what was asked about. */
export interface Referrer {
  readonly table: string
  readonly column: string
}

/**
 * Every `ref:` in the model pointing at `table`, or at one column of it.
 *
 * This is what the interface says out loud before a rename or a removal: the
 * files that are about to gain a dangling ref, named, so the developer decides
 * rather than discovers.
 */
export function referrersTo(
  model: Pick<WireModel, 'tables'>,
  table: string,
  column?: string,
): Referrer[] {
  const found: Referrer[] = []
  for (const other of model.tables) {
    for (const held of other.columns) {
      if (held.ref === undefined || held.ref.table !== table) continue
      if (column !== undefined && held.ref.column !== column) continue
      found.push({ table: other.name, column: held.name })
    }
  }
  return found
}

/** `orders.customer_id, addresses.customer_id`, for a sentence about them. */
export function referrerText(referrers: readonly Referrer[]): string {
  return referrers.map((referrer) => `${referrer.table}.${referrer.column}`).join(', ')
}

/** The same columns, with every `ref` at `from` moved to `to`. Used by a rename. */
export function withRefsRetargeted(
  columns: readonly Column[],
  from: string,
  to: string,
): readonly Column[] {
  return columns.map((column) =>
    column.ref === undefined || column.ref.table !== from
      ? column
      : { ...column, ref: { table: to, column: column.ref.column } },
  )
}

/** The model with one table replaced, so the page's copy keeps up with its own edit. */
export function withTable(model: WireModel, next: Table): WireModel {
  return {
    ...model,
    tables: model.tables.map((table) => (table.name === next.name ? next : table)),
  }
}
