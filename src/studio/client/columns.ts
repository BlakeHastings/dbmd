/**
 * What a column's row on the canvas says, as strings.
 *
 * Nothing here has a DOM, for the reason `geometry.ts` does not (ADR 0015) and
 * `fields.ts` does not (ADR 0016): the shape of the row is the stylesheet's and
 * `canvas.ts`'s, and both are proven by looking at the page, but the words are
 * a function of a column and a test can hold them without a browser.
 *
 * There is one word here that matters more than the rest. A `ref` is this
 * tool's argument for itself: it points at a *column*, not at a table, and the
 * canvas is where somebody is looking when they ask which one (ADR 0055).
 */

import type { Column, Ref } from '../../model/types.js'

/**
 * A ref as the canvas draws it: an arrow, then the column it lands on.
 *
 * The arrow leads rather than trails so that the line reads as a continuation
 * of the column above it rather than as a second column name. `→` rather than
 * `->` because this is drawn for a person and never parsed; `dbmd refs` and the
 * file itself are where the machine-readable spelling lives.
 */
export function refLabel(ref: Ref): string {
  return `→ ${ref.table}.${ref.column}`
}

/**
 * Everything the row says, on one line, for the row's `title`.
 *
 * The canvas draws a column in a box 220 pixels wide, and a name and a type and
 * a ref do not always fit in it however they are arranged. Whatever the layout
 * does with the overflow, this is the string that is always reachable by
 * hovering, which is the floor ADR 0055 puts under the rendering: a tooltip is
 * not something anybody reads while scanning, but somebody who is unsure has to
 * have somewhere to go.
 *
 * Exactly the two spans' text and nothing else, so the tooltip and the row
 * cannot come to disagree. The key badge is deliberately not in it: `PK` is
 * drawn by the stylesheet, is two characters, and has never been the part that
 * ran out of room.
 *
 * An empty type is dropped rather than described. A new table's `id` is typed
 * later on purpose (`tables.ts`), the row shows nothing there, and a tooltip
 * saying "id (no type)" would be this file having an opinion the panel already
 * has a better place to put.
 */
export function columnTitle(column: Column): string {
  const parts = [column.name]
  if (column.type !== '') parts.push(column.type)
  if (column.ref !== undefined) parts.push(refLabel(column.ref))
  return parts.join(' ')
}
