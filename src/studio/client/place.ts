/**
 * Where a table sits when its file does not say.
 *
 * `layout` is optional (ADR 0003, and `docs/format.md` under Layout), so a model
 * written by hand or produced by an import can have tables with no coordinates
 * at all. They have to go somewhere, and the two obvious answers are both wrong:
 * stacking them at the origin hides them behind each other, and scattering them
 * puts a table in a different place every time the page is reloaded.
 *
 * So they go on a grid, in the model's own order, which the reader sorts by
 * name. The same directory produces the same picture on every machine and after
 * every reload, which is the same property ADR 0006 asks of the CLI's output.
 *
 * **A placed table is not a positioned table.** Nothing here is written to
 * disk. Opening the studio on a fifty-table import must not put fifty files in
 * the developer's `git status`, and ADR 0013 is explicit that the studio writes
 * only the files it was asked to edit. The grid is what the canvas draws until
 * the developer drags the box, and the drag is what writes the line.
 */

import type { Point } from './geometry.js'

/** Just enough of a table to place it. */
export interface Placeable {
  readonly name: string
  readonly layout?: { readonly x: number; readonly y: number }
}

/** Wide enough for a table box plus a gap that an edge can be seen crossing. */
const COLUMN_PITCH = 300
const ROW_PITCH = 260
const PER_ROW = 5
const MARGIN = 40

export function placeTables(tables: readonly Placeable[]): Map<string, Point> {
  const positions = new Map<string, Point>()
  let lowest = MARGIN

  for (const table of tables) {
    if (table.layout === undefined) continue
    positions.set(table.name, { x: table.layout.x, y: table.layout.y })
    lowest = Math.max(lowest, table.layout.y + ROW_PITCH)
  }

  // Below everything the files did place, so a model that is half laid out does
  // not get its remaining tables dropped on top of the ones a person arranged.
  const top = positions.size === 0 ? MARGIN : lowest
  let slot = 0
  for (const table of tables) {
    if (table.layout !== undefined) continue
    positions.set(table.name, {
      x: MARGIN + (slot % PER_ROW) * COLUMN_PITCH,
      y: top + Math.floor(slot / PER_ROW) * ROW_PITCH,
    })
    slot += 1
  }

  return positions
}
