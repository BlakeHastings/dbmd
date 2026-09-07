/**
 * Validating a `Model`: the questions that are about the model rather than
 * about any one file.
 *
 * `readModel` answers "did this file say what it claims to say". This answers
 * "do the files agree with each other": a `ref` that resolves, an index whose
 * columns exist, a group somebody is in. ADR 0008 said the reader diagnoses
 * rather than guesses, and this is that principle one level up. ADR 0017 is the
 * three rules that shape everything below.
 *
 * **It says nothing the reader already said.** `group-unknown` and
 * `kind-mismatch` are on the item this file came from and are deliberately not
 * here: the reader raises the first with a line number this file could not
 * derive, and the second describes a file that never became an object, so there
 * is nothing in the model left to look at. Two complaints about one mistake is
 * how a check stops being read.
 *
 * **An incomplete object's absences are not evidence; its presences are.**
 * `complete: false` means the reader raised an error building the object, so a
 * column it does not have may be one the reader dropped. Every rule below whose
 * conclusion is "this is missing" stands down for such an object. Every rule
 * whose conclusion is "these two both exist" does not, because dropping
 * something cannot invent a duplicate.
 *
 * **It reads declarations and never the reader's derived indexes.**
 * `referencesTo` and `groupMembers` are computed from the same `ref:` and
 * `group:` keys this file walks, so validating against them would be checking a
 * cache against itself, and would miss a model an importer built wrong.
 *
 * Every diagnostic here carries a path and no line. That is the honest answer
 * rather than a gap: a `Model` holds no offsets, and the one way to get a line
 * from here would be to reopen the file and search it for a column name, which
 * finds the fortieth `id` as readily as the right one.
 */

import { compareCodeUnits as byText, inFile, sortDiagnostics } from '../diagnostics.js'
import type { Diagnostic, Model, ModelDiagnosticCode, Severity, Table } from './types.js'

/**
 * Every way this model disagrees with itself, sorted (ADR 0006 rule 4).
 *
 * Severity is a fact about the diagnostic and stopping is a decision about the
 * run, so this returns both severities and applies no policy to either.
 * `hasErrors` is the default policy and `--strict` is dbmd-21's.
 */
export function validate(model: Model): readonly Diagnostic[] {
  const out: Diagnostic[] = []
  const tables = tablesByName(model, out)

  for (const table of model.tables) {
    duplicateColumns(table, out)
    duplicateIndexes(table, out)
    indexColumns(table, out)
    primaryKey(table, out)
    refs(table, tables, out)
  }
  emptyGroups(model, out)

  return sortDiagnostics(out)
}

/**
 * The tables by name, first declaration winning, complaining about the rest.
 *
 * A directory cannot produce this, since one directory holds one `orders.md`,
 * so the rule is about the other ways a `Model` is built. `dbmd import` is the
 * live one: the format has no schemas (`docs/format.md` says so), so a database
 * with `sales.orders` and `web.orders` arrives as two tables called `orders`,
 * and silently keeping one of them is the worst available outcome.
 */
function tablesByName(model: Model, out: Diagnostic[]): ReadonlyMap<string, Table> {
  const tables = new Map<string, Table>()
  for (const table of model.tables) {
    const first = tables.get(table.name)
    if (first === undefined) {
      tables.set(table.name, table)
      continue
    }
    push(
      out,
      'duplicate-table',
      'error',
      table.path,
      `a second table called \`${table.name}\` is declared here; the first is ${first.path}`,
    )
  }
  return tables
}

function duplicateColumns(table: Table, out: Diagnostic[]): void {
  for (const name of repeated(table.columns.map((column) => column.name))) {
    push(
      out,
      'duplicate-column',
      'error',
      table.path,
      `\`${table.name}\` declares more than one column called \`${name}\``,
    )
  }
}

function duplicateIndexes(table: Table, out: Diagnostic[]): void {
  for (const name of repeated(table.indexes.map((index) => index.name))) {
    push(
      out,
      'duplicate-index',
      'error',
      table.path,
      `\`${table.name}\` declares more than one index called \`${name}\``,
    )
  }
}

/**
 * An index key naming a column its own table does not have.
 *
 * An expression key is skipped, and skipped rather than parsed. dbmd does not
 * read SQL, so it cannot say which columns `lower(ledger_code)` mentions, and a
 * rule that guessed would either miss the typo it exists for or invent one. The
 * expression is carried and shown and nothing here has an opinion about it.
 * ADR 0022.
 *
 * The message names the other spelling. Somebody who meant an expression and
 * wrote it as a bare string lands exactly here, and this diagnostic is the only
 * place they will be told which of the two they wrote.
 */
function indexColumns(table: Table, out: Diagnostic[]): void {
  if (!table.complete) return
  const columns = columnNames(table)
  for (const index of table.indexes) {
    for (const key of index.columns) {
      if (typeof key !== 'string' || columns.has(key)) continue
      push(
        out,
        'index-column-unknown',
        'error',
        table.path,
        `the index \`${index.name}\` names the column \`${key}\`, which \`${table.name}\` does not have; if it is an expression rather than a column, write it as \`{ expression: ${key} }\``,
      )
    }
  }
}

/**
 * A table with columns and no `pk: true` on any of them.
 *
 * A table with no columns at all is exempt, and not as a special case: the
 * format writes an empty list as no key, so a table nobody has filled in yet
 * has no `columns:` line, and telling that person their primary key is missing
 * is telling them their table is empty in the least useful available words.
 */
function primaryKey(table: Table, out: Diagnostic[]): void {
  if (!table.complete || table.columns.length === 0) return
  if (table.columns.some((column) => column.pk === true)) return
  push(
    out,
    'primary-key-missing',
    'warning',
    table.path,
    `\`${table.name}\` has no primary key; put \`pk: true\` on the column or columns that identify one row`,
  )
}

function refs(table: Table, tables: ReadonlyMap<string, Table>, out: Diagnostic[]): void {
  for (const column of table.columns) {
    const ref = column.ref
    if (ref === undefined) continue
    // What the author wrote, plus the column it is written on. The ref is
    // rebuilt from what the reader kept, and since the value is split at the
    // last dot that is the original text for every ref that parsed,
    // `schema.table.column` included. The column name is there because this
    // diagnostic carries no line, and it is how you find the one to change.
    const about = `\`ref: ${ref.table}.${ref.column}\` on column \`${column.name}\``

    const target = tables.get(ref.table)
    if (target === undefined) {
      push(
        out,
        'ref-table-unknown',
        'error',
        table.path,
        `${about} names no table; there is no tables/${ref.table}.md`,
      )
      continue
    }
    // The target lost something on the way in, so its column list is not
    // evidence that a column is absent, and neither is its index list evidence
    // that nothing declares the column unique.
    if (!target.complete) continue

    if (!columnNames(target).has(ref.column)) {
      push(
        out,
        'ref-column-unknown',
        'error',
        table.path,
        `${about} names no column of \`${target.name}\``,
      )
      continue
    }
    if (identifiesOneRow(target).has(ref.column)) continue
    push(
      out,
      'ref-target-not-unique',
      'warning',
      table.path,
      `${about} points at a column that is neither \`${target.name}\`'s whole primary key nor covered by a single-column unique index, so it does not identify one row`,
    )
  }
}

/**
 * The columns of `table` that identify at most one row on their own.
 *
 * Both halves are deliberately narrow, and the narrowness is the rule. One
 * column of a composite primary key identifies a set of rows and not a row, and
 * `unique` on `(a, b)` says nothing whatever about `a`. Widening either would
 * turn a warning that catches a typo into one that fires on nothing.
 *
 * The second half was unwritable before dbmd-14, because until `unique: true`
 * was sayable on an index there was no way for a model to declare a non-key
 * column unique, and a rule that warned about every such ref would have been
 * noise on every correct model that had one.
 */
function identifiesOneRow(table: Table): ReadonlySet<string> {
  const keys = new Set<string>()
  const primary = table.columns.filter((column) => column.pk === true)
  const only = primary[0]
  if (primary.length === 1 && only !== undefined) keys.add(only.name)
  for (const index of table.indexes) {
    const key = index.columns[0]
    // An expression key is not a column, so a unique index over one makes no
    // column of this table unique: `unique (lower(email))` constrains the
    // lower-cased value and leaves `email` free to repeat in other cases.
    if (index.unique !== true || index.columns.length !== 1 || typeof key !== 'string') continue
    keys.add(key)
  }
  return keys
}

/**
 * A group file nothing joined.
 *
 * Membership is computed from each table's own `group:` key rather than from
 * `Model.groupMembers`, which is the same thing the reader computed. The point
 * of a validator is to be a second opinion, and a second opinion that reads the
 * first one's notes is one opinion.
 */
function emptyGroups(model: Model, out: Diagnostic[]): void {
  const joined = new Set(
    model.tables
      .map((table) => table.group)
      .filter((group): group is string => group !== undefined),
  )
  for (const group of model.groups) {
    if (joined.has(group.name)) continue
    push(
      out,
      'group-empty',
      'warning',
      group.path,
      `no table declares \`group: ${group.name}\`; an empty group is usually a rename that missed a file`,
    )
  }
}

/** Every name that appears more than once, in byte order, once each. */
function repeated(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) twice.add(name)
    seen.add(name)
  }
  return [...twice].sort(byText)
}

function columnNames(table: Table): ReadonlySet<string> {
  return new Set(table.columns.map((column) => column.name))
}

function push(
  out: Diagnostic[],
  code: ModelDiagnosticCode,
  severity: Severity,
  path: string,
  message: string,
): void {
  out.push({ code, severity, at: inFile(path), message })
}
