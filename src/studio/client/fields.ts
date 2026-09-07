/**
 * The conversions between what a form field holds and what the format holds.
 *
 * A `<textarea>` and an `<input>` deal in strings a browser has already had
 * opinions about, and the format deals in bytes. These are the two places those
 * two disagree, pulled out of `inspector.ts` for the same reason `geometry.ts`
 * is pulled out of `canvas.ts` (ADR 0015): they are functions of strings, they
 * are where the mistakes are, and a test can hold them without a browser.
 */

import type { IndexKey, Ref } from '../../model/types.js'

/** LF or CRLF: which ending a body arrived with, and therefore must leave with. */
export type LineEnding = '\n' | '\r\n'

/**
 * The ending this body is written in.
 *
 * One CRLF is enough to decide it. A body is a person's prose written in one
 * editor on one machine, so a mixture is a file that has been through two of
 * them, and `survivesATextarea` is the function that notices.
 */
export function endingOf(body: string): LineEnding {
  return body.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * What a textarea handed back, as the format wants it.
 *
 * `textarea.value` is the API value, which the HTML specification defines as
 * having every line break normalised to LF whatever was assigned to it. A model
 * body is not normalised: `docs/format.md` says it is carried byte for byte,
 * carriage returns and all, and ADR 0010's writer concatenates it unchanged. So
 * the ending is read off the body once, when the panel is drawn, and put back
 * on every value read out of the field.
 *
 * Without this, opening a CRLF model, typing one word and letting the debounce
 * fire rewrites every line of the file, which is exactly the diff this format
 * exists so that a reviewer does not have to read.
 */
export function toModelBody(text: string, ending: LineEnding): string {
  return ending === '\n' ? text : text.replace(/\n/g, '\r\n')
}

/**
 * Whether this body comes back unchanged from a trip through a textarea.
 *
 * False for a body that mixes endings, or that holds a bare carriage return: a
 * textarea has one normalisation and no memory of what it replaced, so there is
 * nothing to put back. The panel says so rather than either refusing the edit or
 * quietly flattening somebody's file.
 */
export function survivesATextarea(body: string, ending: LineEnding): boolean {
  return toModelBody(body.replace(/\r\n|\r/g, '\n'), ending) === body
}

/**
 * A ref, or why the field does not hold one yet.
 *
 * Split at the **last** dot, which is what `docs/format.md` says and what the
 * reader does, so `sales.orders.id` is the column `id` of the table
 * `sales.orders`. A value with no usable dot is not half a ref to be guessed at:
 * it is a field somebody is still typing in, and the panel says so rather than
 * inventing a table name and writing it to disk.
 */
export function parseRef(text: string): Ref | 'absent' | 'malformed' {
  const trimmed = text.trim()
  if (trimmed === '') return 'absent'
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0 || dot === trimmed.length - 1) return 'malformed'
  return { table: trimmed.slice(0, dot), column: trimmed.slice(dot + 1) }
}

/**
 * An index's columns, from one comma-separated field.
 *
 * One field rather than a list of them because an index's columns are short, in
 * order, and read as a tuple: `[customer_id, placed_at]` is how the format
 * writes them and how a person says them. Empties are dropped so that a trailing
 * comma while typing the next name is not a column called nothing.
 */
export function parseIndexColumns(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

/**
 * Whether one comma-separated field can hold these keys and give them back.
 *
 * It can hold column names and nothing else. An expression key is a mapping in
 * the format (ADR 0022) and there is no text a person could type into this
 * field that would come back as one, so a field that offered to edit it would
 * be offering to replace it with a column called something like
 * `lower(display_name)`, which is a different index and a legal one. The
 * inspector shows such a row and refuses to edit it, which is ADR 0016's
 * "shows rather than refuses" reaching the case where showing is all it can
 * honestly do.
 */
export function keysAreEditableAsText(columns: readonly IndexKey[]): boolean {
  return columns.every((key) => typeof key === 'string')
}

/**
 * The keys as the model file spells them, for a field that shows rather than
 * edits. A column is its name and an expression is the mapping the file holds,
 * so what the field shows is what is on disk.
 */
export function indexKeysText(columns: readonly IndexKey[]): string {
  return columns
    .map((key) => (typeof key === 'string' ? key : `{ expression: ${key.expression} }`))
    .join(', ')
}
