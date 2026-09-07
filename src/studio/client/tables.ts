/**
 * What a new table is called, and the one thing about a name the server cannot
 * decide for us.
 *
 * `safe-path.ts` is the authority on whether a name can be a file name, and the
 * page deliberately does not have a second copy of it: a name it refuses comes
 * back from `POST /api/table` as a sentence written for a person, and the form
 * shows that sentence. One rule lives here instead, because it is the one whose
 * answer depends on the machine the model is checked out on rather than on the
 * name:
 *
 * **Two names differing only in case are one file on Windows and macOS, and two
 * on Linux.** `docs/format.md` has the measurement: creating `Orders.md` and
 * then `orders.md` on Windows 11 leaves one file, still called `Orders.md`,
 * holding what was written second. So a model with both has two tables on the
 * machine that made it and one on the machine that checks it out, with the
 * survivor decided by the order the files arrived in. A server cannot answer
 * that question for anybody else's checkout, and by the time the reader could,
 * one of the two files is already gone.
 *
 * Nothing here has a DOM, for the same reason `fields.ts` does not (ADR 0016):
 * these are the two sentences the form is about to say, and a test can hold
 * them without a browser.
 */

import type { Column } from '../../model/types.js'

/**
 * The starting shape of a table nobody has filled in yet.
 *
 * One column, called `id`, marked as the key, with no type. The name and the
 * key are the two things every table in every example has, so filling them in
 * saves two clicks and guesses nothing. The type is left empty on purpose: it
 * is the one part of a column that depends on the engine, so `uuid` here would
 * be this file deciding something about somebody's database. The inspector says
 * an empty type is empty, `git diff` shows `type: ""`, and neither is a
 * surprise.
 */
export const NEW_TABLE_COLUMNS: readonly Column[] = [{ name: 'id', type: '', pk: true }]

/**
 * That shape in a sentence, beside it, so the form and the file cannot disagree.
 *
 * The panel says what it is about to write before it writes it, which means
 * somebody has to describe this list in words. Describing it here is one line to
 * change when the shape changes; describing it in the panel is a sentence that
 * goes quietly wrong the first time somebody edits the list.
 */
export const NEW_TABLE_SHAPE = 'one column, `id`, marked as the key and typed later'

/** The stem every suggested name is built from. */
const STEM = 'new_table'

/**
 * A name no table in this model has, for a table the developer has not named.
 *
 * `new_table`, then `new_table_2`. Deliberately not a word from the model's own
 * vocabulary: a suggestion that looks like a real table name is one somebody
 * keeps, and a model with a table called `table` in it is worse than one with a
 * table called `new_table` that got renamed on the spot.
 */
export function suggestTableName(taken: readonly string[]): string {
  return suggestName(STEM, taken, '_')
}

/**
 * A name nothing of that kind in this model has, built from a stem.
 *
 * The same argument as `suggestTableName` and the same function, because a note
 * called `new-note` that somebody kept is exactly as unhelpful as a table
 * called `new_table` that somebody kept, and the answer is the same: a
 * suggestion that obviously wants replacing. The separator differs because the
 * conventions do: a table is named like a database table and a note or a group
 * is named like a file somebody will read in a list (`docs/format.md` asks for
 * `why-invoices-are-never-deleted.md`, not `note-3.md`).
 */
export function suggestName(stem: string, taken: readonly string[], separator = '-'): string {
  const held = new Set(taken.map(folded))
  if (!held.has(folded(stem))) return stem
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}${separator}${n}`
    if (!held.has(folded(candidate))) return candidate
  }
}

/** A table already in the model that this name cannot live beside. */
export type NameClash =
  /** The same name. This create cannot happen; the server refuses it too. */
  | { readonly kind: 'same'; readonly held: string }
  /** The same name but for its case, which is one file on some machines. */
  | { readonly kind: 'case'; readonly held: string }

/**
 * Which table already in the model `name` clashes with, if any.
 *
 * Only the page can ask this before the file exists. The exact match is asked
 * here as well as by the server, not to second-guess it but to say so while the
 * developer is still typing, which is the same reason the validator runs in the
 * browser (ADR 0016): what the page has is an earlier copy of the same answer.
 */
export function clashFor(name: string, taken: readonly string[]): NameClash | undefined {
  for (const held of taken) {
    if (held === name) return { kind: 'same', held }
  }
  for (const held of taken) {
    if (folded(held) === folded(name)) return { kind: 'case', held }
  }
  return undefined
}

/**
 * A name as a filesystem that ignores case sees it.
 *
 * `toLowerCase` rather than a locale-aware fold, because this is an
 * approximation of NTFS and APFS rather than of a language, and the two
 * disagree only about names no developer is choosing for a table.
 */
function folded(name: string): string {
  return name.toLowerCase()
}
