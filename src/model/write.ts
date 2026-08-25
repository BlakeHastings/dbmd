/**
 * Writing a `Model` back to a `db-model/` directory, canonically.
 *
 * This is the half of the format that decides whether the product works. ADR
 * 0003 says a one-column change must be a one-line diff, and a diff is produced
 * by bytes, not by intentions. Four rules make that true, and every one of them
 * fails silently rather than loudly when it is broken, which is why each is
 * spelled out here and tested rather than assumed.
 *
 * **The frontmatter is emitted by hand, not by a YAML library.** A library is
 * built to be helpful: it reflows, it folds long scalars at a line width, it
 * drops quotes it judges unnecessary and it re-adds them when its heuristics
 * change between releases. Any one of those turns a stable file into one that
 * churns on every save. The set of keys here is fixed and about a dozen wide,
 * so emitting the text directly is cheaper than bending an emitter into
 * determinism. Reading still goes through `yaml`, so there is one parser and
 * one place that knows what a scalar means. ADR 0010.
 *
 * **The body is copied, never regenerated.** Everything after the closing `---`
 * goes back exactly as `splitFrontmatter` handed it over, carriage returns
 * included. The frontmatter this module emits is always LF, because the model
 * does not record which line ending a file arrived with and inventing one would
 * make two machines produce different bytes for the same model. A CRLF file
 * therefore normalises its frontmatter on the first save, keeps its body
 * verbatim forever, and never moves again.
 *
 * **A file that is already right is not written.** The rendered text is
 * compared with what is on disk and a match is skipped. Dragging a group moves
 * every member, and only the members whose coordinates actually changed may
 * appear in `git status`, or the format has lost the reviewability it exists
 * for.
 *
 * **A file that did not load is left alone.** An object the reader could not
 * build entirely from its file carries `complete: false`, and writing the model
 * back over such a file would delete whatever the reader could not understand.
 * The flag is on the object rather than in a list beside it so that there is no
 * way to call the writer without it: a separately carried diagnostics array is
 * the thing that gets dropped on the way through an HTTP layer, and dropping it
 * would turn a broken file into a silently truncated one.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { MODEL_FILE, directoryOfKind } from './paths.js'
import type { CanvasObject, Column, Index, Layout, Model, Table } from './types.js'

// --------------------------------------------------------------------------
// Serialising: a model, or one object on it, as the full text of its file.
// --------------------------------------------------------------------------

/** The full text of `_model.md`: the model's own facts, then its prose. */
export function serialiseModelFile(model: Model): string {
  const keys: string[] = ['kind: model']
  if (model.name !== undefined) keys.push(`name: ${scalar(model.name)}`)
  if (model.engine !== undefined) keys.push(`engine: ${scalar(model.engine)}`)
  return frontmatter(keys, model.body)
}

/** The full text of one object's file, whatever kind of object it is. */
export function serialiseObject(object: CanvasObject): string {
  switch (object.kind) {
    case 'table':
      return frontmatter(tableKeys(object), object.body)
    case 'note':
      return frontmatter(
        [
          'kind: note',
          ...optional(object.layout, (layout) => `layout: ${flowLayout(layout, true)}`),
          ...optional(object.color, (color) => `color: ${scalar(color)}`),
        ],
        object.body,
      )
    case 'group':
      // No `layout`, and no membership list. A group's box is the bounding box
      // of its members and its members declare themselves (ADR 0005). Emitting
      // either would put a shared file back in the path of every layout change,
      // which is the merge conflict the whole format is arranged to avoid.
      return frontmatter(
        [
          'kind: group',
          ...optional(object.label, (label) => `label: ${scalar(label)}`),
          ...optional(object.color, (color) => `color: ${scalar(color)}`),
        ],
        object.body,
      )
  }
}

function tableKeys(table: Table): string[] {
  const keys = ['kind: table', `table: ${scalar(table.name)}`]
  // An empty list is written as no key rather than as `columns: []`, so that
  // there is one canonical spelling of a table that has none.
  if (table.columns.length > 0) keys.push('columns:', ...table.columns.flatMap(columnLines))
  if (table.indexes.length > 0) keys.push('indexes:', ...table.indexes.flatMap(indexLines))
  if (table.group !== undefined) keys.push(`group: ${scalar(table.group)}`)
  // `w` and `h` are a note's: a table's size is a consequence of its columns.
  if (table.layout !== undefined) keys.push(`layout: ${flowLayout(table.layout, false)}`)
  return keys
}

function columnLines(column: Column): string[] {
  const lines = [`  - name: ${scalar(column.name)}`, `    type: ${scalar(column.type)}`]
  if (column.pk !== undefined) lines.push(`    pk: ${column.pk}`)
  // The nullability key is spelled `null`, per ADR 0003. It is a key we emit
  // rather than one an author typed, and the reader reads plain keys from their
  // source text, so it needs no quoting to survive as those four characters.
  if (column.nullable !== undefined) lines.push(`    null: ${column.nullable}`)
  if (column.default !== undefined) lines.push(`    default: ${scalar(column.default)}`)
  if (column.ref !== undefined) {
    lines.push(`    ref: ${scalar(`${column.ref.table}.${column.ref.column}`)}`)
  }
  return lines
}

function indexLines(index: Index): string[] {
  const columns = index.columns.map((column) => scalar(column, 'flow')).join(', ')
  return [`  - name: ${scalar(index.name)}`, `    columns: [${columns}]`]
}

/**
 * `{ x: 480, y: 120 }`, the one place this format uses flow style.
 *
 * A layout is the line a reviewer learns to skip (ADR 0003), and it only earns
 * that if it is one line. Block style would spend four lines on two numbers and
 * put a schema change and a drag on the same footing in a diff.
 */
function flowLayout(layout: Layout, withSize: boolean): string {
  const parts = [`x: ${number(layout.x)}`, `y: ${number(layout.y)}`]
  if (withSize && layout.w !== undefined) parts.push(`w: ${number(layout.w)}`)
  if (withSize && layout.h !== undefined) parts.push(`h: ${number(layout.h)}`)
  return `{ ${parts.join(', ')} }`
}

/**
 * Delimiters, the keys, delimiter, then the body untouched.
 *
 * The body already carries the blank line that conventionally follows the
 * closing `---`, because `splitFrontmatter` starts it at the character after
 * that line's break and trims nothing. Concatenation is therefore the whole
 * job, and it is what makes the round trip byte-exact.
 */
function frontmatter(keys: readonly string[], body: string): string {
  return `---\n${keys.map((key) => `${key}\n`).join('')}---\n${body}`
}

function optional<T>(value: T | undefined, render: (value: T) => string): string[] {
  return value === undefined ? [] : [render(value)]
}

// --------------------------------------------------------------------------
// Scalars. The canonical quoting rule, which is the decision the reader
// deliberately did not take (ADR 0008 records the raw text; this decides how it
// goes back).
// --------------------------------------------------------------------------

type Context = 'block' | 'flow'

/**
 * A string as a YAML scalar: plain when plain is unambiguous, double-quoted
 * otherwise.
 *
 * The rule is conservative on purpose. A plain scalar is only emitted when
 * nothing about YAML's resolution can turn it into something other than the
 * characters it is made of, so `text` stays `text` while `null`, `1`, `on` and
 * `'pending'` are quoted. Quoting is always double, never single: it is the one
 * style with an escape for every character, so there is never a second question
 * about how a value should have been written.
 */
export function scalar(value: string, context: Context = 'block'): string {
  return isPlain(value, context) ? value : quoted(value)
}

/** Anything YAML gives its own meaning to at the start of a plain scalar. */
const LEADING_INDICATOR = /^[-?,[\]{}&*!|>'"%@`~]/
/** A digit, a dot or a plus opens an int, a float, a date or a sexagesimal. */
const LEADING_NUMBER = /^[0-9.+]/
/** Line breaks, control characters, and the punctuation that opens a mapping or a comment. */
const FORBIDDEN_ANYWHERE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff:#]/
/** Legal in a plain scalar in block context, but not inside `[ ... ]`. */
const FLOW_INDICATOR = /[,[\]{}]/
/**
 * Words a YAML reader may resolve to something that is not a string. `true` and
 * `null` are YAML 1.2 core; `y`, `on` and their friends are YAML 1.1, which
 * this project does not emit but other people's tools still read. Quoting all
 * of them costs one pair of quotes on a column nobody has and buys a file that
 * means the same thing to every reader of it.
 */
const RESOLVES_TO_A_VALUE = new Set([
  'true',
  'false',
  'null',
  'yes',
  'no',
  'on',
  'off',
  'y',
  'n',
  '=',
])

function isPlain(value: string, context: Context): boolean {
  if (value === '') return false
  if (FORBIDDEN_ANYWHERE.test(value)) return false
  if (/^\s|\s$/.test(value)) return false
  if (LEADING_INDICATOR.test(value)) return false
  if (LEADING_NUMBER.test(value)) return false
  if (RESOLVES_TO_A_VALUE.has(value.toLowerCase())) return false
  if (context === 'flow' && FLOW_INDICATOR.test(value)) return false
  return true
}

function quoted(value: string): string {
  let out = '"'
  for (const character of value) {
    switch (character) {
      case '\\':
        out += '\\\\'
        break
      case '"':
        out += '\\"'
        break
      case '\n':
        out += '\\n'
        break
      case '\r':
        out += '\\r'
        break
      case '\t':
        out += '\\t'
        break
      default: {
        const code = character.codePointAt(0) ?? 0
        out += mustEscape(code) ? `\\u${code.toString(16).padStart(4, '0')}` : character
      }
    }
  }
  return `${out}"`
}

/**
 * A character that has to become an escape to survive the trip.
 *
 * Control characters and the exotic line separators because YAML says so, and
 * an unpaired surrogate because it is not encodable as UTF-8: an import
 * provider reading somebody's JSON can produce one, and writing it raw would
 * put a replacement character in a file the author never touched.
 */
function mustEscape(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  )
}

function number(value: number): string {
  if (Number.isNaN(value)) return '.nan'
  if (value === Number.POSITIVE_INFINITY) return '.inf'
  if (value === Number.NEGATIVE_INFINITY) return '-.inf'
  return String(value)
}

// --------------------------------------------------------------------------
// Writing.
// --------------------------------------------------------------------------

export type SkipReason =
  /** The file on disk is already byte-identical to what the model renders to. */
  | 'unchanged'
  /** The object says the reader could not build all of it from its file. */
  | 'incomplete'
  /** The object's name cannot be a file name, so it has nowhere to be written. */
  | 'unsafe-name'

export interface WriteSkip {
  /** Relative to the model directory and slash-separated, as diagnostics are. */
  readonly path: string
  readonly reason: SkipReason
}

export interface WriteResult {
  /** Paths actually written, sorted, so two runs over the same model agree. */
  readonly written: readonly string[]
  readonly skipped: readonly WriteSkip[]
}

/**
 * Write a model to a model directory.
 *
 * `dir` is the model root, the directory that holds `_model.md` and `tables/`.
 * Every file is written atomically and only when its content would change, so
 * calling this after a drag that moved one box touches one file.
 *
 * There is nothing to remember and nothing to pass. An object that came from a
 * file the reader could not fully understand says so, and this leaves that file
 * alone; a model built from scratch says `complete: true` on every object, out
 * loud, because that is a claim its author is making.
 *
 * It does not delete. A file that failed to parse is missing from the model
 * (ADR 0008), so "in the directory but not in the model" cannot be told apart
 * from "broken", and deleting on that basis would throw away the file whose
 * problem the user is trying to see. Removing an object is a separate,
 * deliberate act.
 *
 * Unlike `readModel`, this throws: a filesystem that will not accept a write is
 * not a diagnostic about the model, and a caller that carries on regardless has
 * told the user their work is saved when it is not.
 */
export async function writeModel(dir: string, model: Model): Promise<WriteResult> {
  const written: string[] = []
  const skipped: WriteSkip[] = []
  const objects: readonly CanvasObject[] = [...model.tables, ...model.notes, ...model.groups]

  const jobs: { path: string; text: string; complete: boolean }[] = [
    { path: MODEL_FILE, text: serialiseModelFile(model), complete: model.complete },
  ]
  for (const object of objects) {
    if (!isFileName(object.name)) {
      skipped.push({
        path: `${directoryOfKind(object.kind)}/${object.name}`,
        reason: 'unsafe-name',
      })
      continue
    }
    // The path is derived from the name rather than read off `object.path`,
    // because ADR 0008 makes the file name the identity: a `ref: customers.id`
    // resolves to `tables/customers.md` and nothing else, so an object whose
    // stored path disagreed with its name would be unreachable where it landed.
    jobs.push({
      path: `${directoryOfKind(object.kind)}/${object.name}.md`,
      text: serialiseObject(object),
      complete: object.complete,
    })
  }
  jobs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  for (const job of jobs) {
    if (!job.complete) {
      skipped.push({ path: job.path, reason: 'incomplete' })
      continue
    }
    const target = join(dir, ...job.path.split('/'))
    if ((await currentText(target)) === job.text) {
      skipped.push({ path: job.path, reason: 'unchanged' })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeAtomically(target, job.text)
    written.push(job.path)
  }

  return { written, skipped }
}

/**
 * A name that is exactly one path segment, and not one of the two that mean a
 * directory. Names that came from the reader are file names already; names that
 * came from an import are whatever the database called the table.
 */
function isFileName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name)
}

async function currentText(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Write via a temporary file in the same directory and rename over the target.
 *
 * The studio saves on every drag, and a plain `writeFile` that is interrupted
 * halfway leaves a truncated model file whose only backup is a git commit that
 * has not happened yet. A rename within a directory is atomic, so a reader
 * sees either the old file or the new one and never half of either; the sync
 * before it is what makes that survive losing power rather than only losing the
 * process.
 *
 * The temporary name starts with a dot and does not end in `.md`, so a read
 * racing a write ignores it twice over.
 */
async function writeAtomically(target: string, text: string): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
