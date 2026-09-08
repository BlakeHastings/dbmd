/**
 * `dbmd refs`: what points at this table, and what this table points at.
 *
 * The model has held the answer since the reader was written. ADR 0003 puts a
 * relationship on the referring column, so one edit touches one file, and the
 * table being asked about pays for that: the fact lives somewhere else, and its
 * own file is the one place the answer is not written down. `readModel`
 * computes `referencesTo` for exactly this, the studio's inspector reads it,
 * and until now nothing on the command line did.
 *
 * What this file owns is the four things ADR 0042 argues plus the one ADR 0049
 * adds, and none of them is walking the model, which is `src/model/read.ts`'s
 * job and stays there:
 *
 * 1. **It answers a model that does not validate.** `dbmd export` refuses one,
 *    which is right for a diagram and wrong for a question: half way through a
 *    rename the model has a dangling ref, and that is precisely the minute
 *    somebody wants to ask. So the errors are counted, said out loud first, and
 *    the answer is given anyway. The two kinds are counted apart, because only
 *    a file that did not load takes a ref out of the answer: a dangling ref is
 *    an error and is also one of the rows printed below it.
 * 2. **A name nothing knows is a failure and an empty list is not.** "Nothing
 *    points at customers" and "there is no table called customerz" are the same
 *    shape of sentence and opposite instructions to whoever asked. The first
 *    exits 0. The second exits 1 and says so, because the answer to a typo must
 *    never read as permission to delete.
 * 3. **A table that is gone and still pointed at is an answer, not an error.**
 *    That is the middle of a rename, and it is the state this exists for.
 * 4. **The referring column, not just the referring table.** "Three tables
 *    point here" does not say what to edit. The column does, and the file it is
 *    written in is carried beside it, so a caller does not have to know how the
 *    directory is laid out to go and fix it.
 * 5. **What the file says happens to that row.** This question is asked
 *    immediately before a delete, so "three tables point here" and "three tables
 *    point here and one of them empties" are different answers. The clause is
 *    printed as the file writes it and nothing is printed where the file wrote
 *    nothing, because absent is not `no action`. ADR 0049.
 */

import { parseArgs } from 'node:util'
import { readModel } from '../model/read.js'
import type { Column, Model, RefEdge, Table } from '../model/types.js'
import { validate } from '../model/validate.js'
import { EXIT_FAILURE, UsageError, messageOf, offendingOption, type Command } from './command.js'
import type { JsonValue, Output, Palette } from './output.js'

/** Where a model lives when nobody says otherwise. The same default `dbmd init` writes. */
const DEFAULT_DIRECTORY = 'db-model'

export const refsCommand: Command = {
  name: 'refs',
  summary: 'say which columns point at a table, and which columns it points at',
  help: `Usage: dbmd refs <table> [directory] [options]

Say which columns in the model carry a "ref:" at the named table, which file
each one is written in, whether that ref can simply be emptied, and what the
file says the engine does to that row when this one goes.

  table       the table to ask about
  directory   the model directory, defaulting to ${DEFAULT_DIRECTORY}

The table comes first and the directory second: the table is the question and
the directory is only where it is asked.

Options:
      --incoming   what points at this table. The default
      --outgoing   what this table points at. Give both flags for both

This is the question to ask before a rename, a delete or a column removal, and
it is the one question a model answers badly by hand. A ref is written on the
referring column, so the table being asked about is the one file the answer is
not in, and "grep" cannot stand in for it, because "ref: orders.id" and the word
"orders" in a paragraph are the same string.

Exit codes:
  0   answered, whether or not anything points at it
  1   no table goes by that name and no ref names it either
  2   the command line was wrong

"Nothing points at it" and "there is no such table" are opposite instructions,
so they are not the same exit code. An empty answer about a table that exists is
a success; a name the model has never heard of is a failure, because the answer
to a typo must not read as permission to delete.

A model with an error in it is still answered. The errors are counted and
reported above the answer, and the line says which kind they are. A file that
did not load is missing from the model and may hold a ref this could not count,
so that answer may be short. A model that only disagrees with itself has loaded
every file, so that answer is whole, and a ref at a table that is not there is
one of the rows in it. That is the state a rename is in half way through, and it
is when this is most worth asking.

An "on delete:" or "on update:" beside a row is that ref's own clause, quoted
from the file. A row without one is a ref the file said nothing about, which is
not the same fact as "no action" and is not printed as one.

--json puts the answer on stdout under the usual envelope, with both directions
in it whichever flags were given, the file each ref is written in, each ref's
referential actions where the file wrote them, and the model's error and warning
counts. "readErrors" is the part of "errors" that is a file failing to load,
which is the part that means these lists may be short.
`,
  run: runRefs,
}

/**
 * One ref, as this command reports it: the edge, plus what somebody has to go
 * and edit.
 *
 * The referential actions are not copied out here. `RefEdge.to` is the column's
 * own `Ref` verbatim in both directions, and `Ref` has held `onDelete` and
 * `onUpdate` since ADR 0046, so reading them off the edge means there is one
 * copy of the fact rather than two that can disagree.
 */
interface Reference {
  readonly edge: RefEdge
  /** The file the `ref:` is written in, slash-separated and relative to the model directory. */
  readonly path: string
  /** The referring column is part of its own table's primary key, so it cannot be emptied. */
  readonly inPrimaryKey: boolean
  /** What the referring column's file says about `nullable`. Absent means it did not say. */
  readonly nullable: boolean | undefined
}

async function runRefs(argv: readonly string[], out: Output): Promise<number> {
  const { table, directory, incoming: wantIncoming, outgoing: wantOutgoing } = parseRefsArgs(argv)

  // Both halves, as `dbmd check` runs them, for a different purpose. This
  // command does not stop on an error; it counts them, so that the answer can
  // say how much of the model it is an answer about.
  //
  // The two halves are counted apart rather than added, because they are
  // answers to different questions. A reader error is a file the reader could
  // not build, so its refs are not in the lists below and the answer is short.
  // A validator error is the model disagreeing with itself, which is what a
  // dangling ref is, and that ref is one of the rows the answer prints.
  const { model, diagnostics: read } = await readModel(directory)
  const invalid = validate(model)
  const readErrors = read.filter((d) => d.severity === 'error').length
  const validationErrors = invalid.filter((d) => d.severity === 'error').length
  const errors = readErrors + validationErrors
  const warnings = read.length + invalid.length - errors

  const subject = model.tables.find((candidate) => candidate.name === table)
  const incoming = incomingRefs(model, table)
  const outgoing = subject === undefined ? [] : outgoingRefs(subject)

  // Both directions travel whichever flags were given. The flags choose what a
  // person reads; a caller that asked for the report gets the whole answer, for
  // the same reason `dbmd check --json` prints the severities the model has
  // rather than the ones --strict would make of them.
  const payload = {
    directory,
    table,
    exists: subject !== undefined,
    incoming: incoming.map(asJson),
    outgoing: outgoing.map(asJson),
    model: { errors, warnings, readErrors },
  }

  // Nothing in the model has ever heard this name: no file, no ref. There is no
  // answer to give, and "nothing points at it" would be a true sentence read as
  // the wrong instruction.
  if (subject === undefined && incoming.length === 0) {
    return out.report({
      code: EXIT_FAILURE,
      text:
        `${out.style.bad('dbmd:')} there is no ${out.style.strong(`tables/${table}.md`)} in ` +
        `${out.style.strong(directory)}, and no ref names ${out.style.strong(table)} either.\n` +
        `${tableCount(model)}${orderHint(argv)}\n`,
      json: {
        ...payload,
        error: {
          code: 'no-such-table',
          message: `no table called ${table} in ${directory}, and no ref names it`,
        },
      },
    })
  }

  const sections: string[] = []
  if (wantIncoming) sections.push(incomingText(incoming, table, directory, out.style))
  if (wantOutgoing) sections.push(outgoingText(outgoing, table, directory, out.style))

  return out.report({
    code: 0,
    text:
      preamble(subject, table, directory, { readErrors, validationErrors }, out.style) +
      sections.join('\n'),
    json: payload,
  })
}

// --------------------------------------------------------------------------
// The two directions. `referencesTo` is the backward half and the reader
// already computes it; the forward half is a walk of one table's own columns,
// which is cheap and not worth a second index in the model.
// --------------------------------------------------------------------------

/**
 * Every ref that lands on this name.
 *
 * `referencesTo` is keyed by the name written in the `ref`, so a table that
 * does not exist still has an entry when something points at it, which is the
 * whole of the mid-rename case. It is sorted already, and `byEdge` is applied
 * anyway so that both directions come out of one comparator.
 */
function incomingRefs(model: Model, table: string): readonly Reference[] {
  const found = (model.referencesTo.get(table) ?? []).flatMap((edge) => {
    const from = model.tables.find((candidate) => candidate.name === edge.from.table)
    const column = from?.columns.find((candidate) => candidate.name === edge.from.column)
    // Every edge in `referencesTo` was built from `model.tables`, so both
    // lookups succeed. Skipping rather than asserting means a model built some
    // other way gets a shorter answer instead of a crash.
    return from === undefined || column === undefined ? [] : [reference(edge, from, column)]
  })
  return found.sort(byEdge)
}

/** Every ref written on this table's own columns. */
function outgoingRefs(table: Table): readonly Reference[] {
  const found = table.columns.flatMap((column) => {
    if (column.ref === undefined) return []
    const edge: RefEdge = { from: { table: table.name, column: column.name }, to: column.ref }
    return [reference(edge, table, column)]
  })
  return found.sort(byEdge)
}

function reference(edge: RefEdge, from: Table, column: Column): Reference {
  return {
    edge,
    path: from.path,
    inPrimaryKey: column.pk === true,
    nullable: column.nullable,
  }
}

/**
 * One order for both directions: where the ref lands, then where it comes from.
 *
 * Sorting on the target first groups the outgoing list by the table it points
 * at, and costs the incoming list nothing, because every edge in that list
 * already shares a target table.
 */
function byEdge(a: Reference, b: Reference): number {
  return (
    byText(a.edge.to.table, b.edge.to.table) ||
    byText(a.edge.to.column, b.edge.to.column) ||
    byText(a.edge.from.table, b.edge.from.table) ||
    byText(a.edge.from.column, b.edge.from.column)
  )
}

/** UTF-16 code-unit order, which is the same in every locale. ADR 0006 rule 4. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * One reference, in the `--json` form.
 *
 * `from` and `to` are the two endpoints and nothing else, so a caller reading
 * them recognises the model's own `Ref`. `inPrimaryKey` and `nullable` are
 * omitted rather than written false, for the reason the format omits them on
 * disk: a key the file did not set is a key that is not there, and `nullable`
 * has three states of which only two are facts (ADR 0008).
 *
 * `onDelete` and `onUpdate` sit beside them rather than inside `to`, because
 * they are facts about this constraint and not about the table it points at,
 * and they are values from a closed vocabulary rather than flags: a caller
 * switches on the word rather than testing a boolean. They are spelled as the
 * file spells them, which is as SQL spells them, and they are omitted when the
 * file said nothing. That omission is the fact ADR 0046 insists on: absent and
 * `no action` are different, so a consumer reading `onDelete === undefined` is
 * reading a file that did not say rather than one that said the default.
 */
function asJson(reference: Reference): JsonValue {
  return {
    from: { table: reference.edge.from.table, column: reference.edge.from.column },
    to: { table: reference.edge.to.table, column: reference.edge.to.column },
    path: reference.path,
    ...(reference.inPrimaryKey ? { inPrimaryKey: true } : {}),
    ...(reference.nullable === undefined ? {} : { nullable: reference.nullable }),
    ...(reference.edge.to.onDelete === undefined ? {} : { onDelete: reference.edge.to.onDelete }),
    ...(reference.edge.to.onUpdate === undefined ? {} : { onUpdate: reference.edge.to.onUpdate }),
  }
}

// --------------------------------------------------------------------------
// The prose form.
// --------------------------------------------------------------------------

/** The two error counts, kept apart because they mean different things. */
interface ErrorCounts {
  /** Errors the reader raised: a file, or a whole directory, that is not in the model. */
  readonly readErrors: number
  /** Errors the validator raised over a model that was read in full. */
  readonly validationErrors: number
}

/**
 * What has to be said before the answer, or nothing.
 *
 * Two things qualify, and both are the reader being told how far to trust what
 * comes next. Errors in the model say how much of it was read, which
 * `errorBanner` turns into the one sentence that is true of this model. A table
 * that is not there and is still pointed at is the mid-rename state, and saying
 * so first stops the list below from reading as though the table were fine.
 */
function preamble(
  subject: Table | undefined,
  table: string,
  directory: string,
  counts: ErrorCounts,
  style: Palette,
): string {
  const lines: string[] = []
  const banner = errorBanner(directory, counts, style)
  if (banner !== '') lines.push(banner)
  if (subject === undefined) {
    lines.push(
      `There is no ${style.strong(`tables/${table}.md`)} in ${style.strong(directory)}, and ` +
        `something still points at that name.\n`,
    )
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * How far to trust the list, in the one sentence that is true of this model.
 *
 * There are three states and one banner, rather than a paragraph per kind of
 * error, because the reader is asking one question and the two paragraphs would
 * answer it in opposite directions: "what follows may be short" and "nothing is
 * missing from what follows" cannot both stand over one list, and printing both
 * would leave the reader to work out which one wins.
 *
 * The read-error sentence is unchanged, and is the reason this exists: it was
 * printed over every error, including a dangling `ref:` that the answer below
 * it had found and printed. The validation sentence says the opposite thing on
 * purpose. It is not silence, because a model that fails `dbmd check` is worth
 * knowing about immediately before a rename or a delete, and it is not a
 * warning about length, because the length is right.
 *
 * With both kinds present the read half decides the wording, since a short
 * answer is the fact that changes what the reader does next, and the count is
 * split so that "1 of them in the reading" says how much of the model is
 * missing rather than how much of it is wrong.
 */
function errorBanner(directory: string, counts: ErrorCounts, style: Palette): string {
  const { readErrors, validationErrors } = counts
  const total = plural(readErrors + validationErrors, 'error')
  const run = `Run "dbmd check ${directory}".`
  if (readErrors > 0 && validationErrors > 0) {
    return (
      `${style.strong(directory)} has ${total} in it, ${readErrors} of them in the reading. ` +
      `A file that did not load is missing from the\nmodel along with every ref written in it, ` +
      `so what follows may be short. ${run}\n`
    )
  }
  if (readErrors > 0) {
    return (
      `${style.strong(directory)} has ${total} in it. A file that did not load is missing from ` +
      `the model along with every ref\nwritten in it, so what follows may be short. ${run}\n`
    )
  }
  if (validationErrors > 0) {
    return (
      `${style.strong(directory)} has ${total} in it, and every file in it loaded. Nothing is ` +
      `missing from what follows: the\nmodel disagrees with itself rather than failing to read. ` +
      `${run}\n`
    )
  }
  return ''
}

function incomingText(
  references: readonly Reference[],
  table: string,
  directory: string,
  style: Palette,
): string {
  if (references.length === 0) {
    return `Nothing points at ${style.strong(table)} in ${style.strong(directory)}.\n`
  }
  const verb = references.length === 1 ? 'points' : 'point'
  return (
    `${plural(references.length, 'ref')} ${verb} at ${style.strong(table)} in ` +
    `${style.strong(directory)}:\n\n${rows(references, true, style)}`
  )
}

function outgoingText(
  references: readonly Reference[],
  table: string,
  directory: string,
  style: Palette,
): string {
  if (references.length === 0) {
    return `${style.strong(table)} points at nothing in ${style.strong(directory)}.\n`
  }
  return (
    // No file column going this way. Every one of these refs is written on the
    // subject's own columns, so the path is the same string on every row and
    // the reader is already looking at the table it names.
    `${style.strong(table)} holds ${plural(references.length, 'ref')} in ` +
    `${style.strong(directory)}:\n\n${rows(references, false, style)}`
  )
}

/**
 * The list, and the sentence that explains whichever marks it used.
 *
 * The columns are as wide as the widest thing in this list rather than in the
 * whole run, which is the opposite of `dbmd check`'s rule and is right here for
 * the opposite reason: two sections are two answers to two questions, and
 * lining the second one up with the first would suggest they are one table.
 */
function rows(references: readonly Reference[], withPath: boolean, style: Palette): string {
  const from = references.map((r) => `${r.edge.from.table}.${r.edge.from.column}`)
  const to = references.map((r) => `${r.edge.to.table}.${r.edge.to.column}`)
  const fromWidth = Math.max(...from.map((text) => text.length))
  const toWidth = Math.max(...to.map((text) => text.length))
  const pathWidth = withPath ? Math.max(...references.map((r) => r.path.length)) : 0

  const used = new Set<string>()
  const lines = references.map((reference, index) => {
    const marks = annotations(reference)
    for (const mark of marks) used.add(legendKey(mark))
    const edge = `${(from[index] ?? '').padEnd(fromWidth)} -> ${(to[index] ?? '').padEnd(toWidth)}`
    // Padded before styling: an escape code is characters that take no width
    // and `padEnd` cannot know that. A row with no mark after it keeps no
    // trailing run of spaces, because nothing has to line up after nothing.
    const file = withPath ? `  ${style.faint(reference.path)}` : ''
    const pad = withPath ? ' '.repeat(pathWidth - reference.path.length) : ''
    // Two spaces between marks rather than one, because a mark is no longer
    // always one word: "key on delete: cascade" reads as a phrase and
    // "key  on delete: cascade" reads as two facts, which is what it is.
    const tail = marks.length === 0 ? '' : `${pad}  ${marks.join('  ')}`
    return `  ${edge}${file}${tail}`
  })

  return `${lines.join('\n')}\n${legend(used)}`
}

/**
 * What the marks mean, for the marks that appeared.
 *
 * Explaining "key" under a list with no key in it is a paragraph about
 * something the reader cannot see, and this list is short enough that the
 * legend would then be most of it.
 */
function legend(used: ReadonlySet<string>): string {
  const said: string[] = []
  if (used.has('key')) {
    said.push(
      `"key": the referring column is part of its own table's primary key, so that row cannot ` +
        `outlive this one.`,
    )
  }
  if (used.has('required')) {
    said.push(`"required": the file says nullable: false, so the ref cannot be emptied.`)
  }
  if (used.has('action')) {
    // One sentence for both clauses, and worded from the arrow rather than from
    // a direction, so it is the same sentence in the incoming section and in
    // the outgoing one. The left of the arrow is always the referring row.
    said.push(
      `"on delete", "on update": the clause the file writes beside that ref, saying what the ` +
        `engine does to the row on the left\nwhen the row on the right is deleted or its key ` +
        `changes. A row without one is a ref the file said nothing about.`,
    )
  }
  return said.length === 0 ? '' : `\n${said.join('\n')}\n`
}

/**
 * Which legend line a mark asks for.
 *
 * The two flags are their own text. Every action mark asks for one sentence
 * between them, because printing the same paragraph twice under a list that
 * used both clauses would be most of the answer.
 */
function legendKey(mark: string): string {
  return mark.startsWith('on ') ? 'action' : mark
}

/**
 * What a caller wants beyond the two names: whether this ref can be let go of,
 * and what happens to its row if it is not.
 *
 * The flags come first because they are one word each, and because they are
 * facts about the column while the clauses are facts about the constraint.
 *
 * An action is printed whenever the file wrote one, `no action` included, and
 * nothing is printed when the file wrote nothing. That is one rule rather than
 * two, and the reason it is not "print only the interesting ones" is ADR 0046:
 * it names the wall of `no action` an import writes as a real cost and names
 * the answer as an option on the import, not a reader that decides some of the
 * catalogue's answers are too boring to repeat. ADR 0049.
 */
function annotations(reference: Reference): readonly string[] {
  const marks: string[] = []
  if (reference.inPrimaryKey) marks.push('key')
  if (reference.nullable === false) marks.push('required')
  if (reference.edge.to.onDelete !== undefined)
    marks.push(`on delete: ${reference.edge.to.onDelete}`)
  if (reference.edge.to.onUpdate !== undefined)
    marks.push(`on update: ${reference.edge.to.onUpdate}`)
  return marks
}

/** So that "no such table" says how big the thing it looked in was. */
function tableCount(model: Model): string {
  return model.tables.length === 0
    ? 'There are no tables in it at all.'
    : `It has ${plural(model.tables.length, 'table')} and none of them is called that.`
}

/**
 * The one mistake this argument order invites, named only where it was possible
 * to make it.
 *
 * Every other command takes the model directory as its first bare word, so
 * somebody who has typed four of them will type the directory first here too.
 * The hint goes out when a second positional was given, because that is the
 * shape the mistake has. Guessing at it from the words themselves is not
 * something this knows enough to do.
 */
function orderHint(argv: readonly string[]): string {
  const positionals = argv.filter((token) => !token.startsWith('-'))
  return positionals.length > 1
    ? `\nThe table comes first and the directory second: dbmd refs <table> [directory].`
    : ''
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * One required positional, one optional one, and two flags. `parseArgs` with
 * `strict` rejects the rest.
 *
 * Neither flag means the default, which is the question this command is named
 * after. Both flags means both sections, which is the whole picture of one
 * table's edges, so there is no third flag name to remember for it.
 */
function parseRefsArgs(argv: readonly string[]): {
  readonly table: string
  readonly directory: string
  readonly incoming: boolean
  readonly outgoing: boolean
} {
  let values: { incoming?: boolean; outgoing?: boolean }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options: { incoming: { type: 'boolean' }, outgoing: { type: 'boolean' } },
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${offendingOption(argv, ['incoming', 'outgoing']) ?? messageOf(error)}. "dbmd refs" takes a table, an optional ` +
        `directory, --incoming and --outgoing; run "dbmd refs --help".`,
    )
  }

  if (positionals.length > 2) {
    throw new UsageError(
      `"dbmd refs" takes a table and at most one directory, and got ${positionals.length} ` +
        `words: ${positionals.join(' ')}. The table comes first.`,
    )
  }

  const table = positionals[0]
  if (table === undefined) {
    throw new UsageError(
      `"dbmd refs" asks about one table, so it needs that table's name: ` +
        `dbmd refs <table> [directory].`,
    )
  }
  if (table === '') {
    throw new UsageError(`"dbmd refs" was given an empty table name, so there is nothing to ask.`)
  }

  const outgoing = values.outgoing === true
  const incoming = values.incoming === true || !outgoing
  return { table, directory: positionals[1] ?? DEFAULT_DIRECTORY, incoming, outgoing }
}
