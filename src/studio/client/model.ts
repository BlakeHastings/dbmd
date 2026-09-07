/**
 * The model the page holds, and the questions the inspector asks of it.
 *
 * These live here together because they are the same idea: the page has a copy
 * of the model, and it should be able to answer questions about that copy
 * without a round trip. `renamePlan` is the furthest that idea goes, and is
 * where the answers become the sentences the panel says.
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

import { MODEL_FILE } from '../../model/paths.js'
import type { Column, Model, Table } from '../../model/types.js'
import type { WireModel } from '../wire.js'
import { clashFor } from './tables.js'

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

/**
 * The word that agrees with `count`: one of them, or more than one.
 *
 * For the noun *and* for its verb, which is the whole reason this is a function
 * rather than a `${n === 1 ? '' : 's'}` at each site. Written that way, the
 * count pluralises whatever is next to it and nothing else, which is how two
 * confirmations came to say `1 ref point at it`. Here the two choices sit side
 * by side in the template, and one cannot be made without the other in view.
 */
export function agreeing(count: number, one: string, more: string): string {
  return count === 1 ? one : more
}

/**
 * Everything a rename has to look at: the refs it moves, and the prose it does not.
 *
 * Wider than `referrersTo`'s `tables` on purpose. A group's body is prose and a
 * note's body is the whole note (ADR 0005), so a plan built from the tables
 * alone would be quietly right about the files it edits and quietly wrong about
 * the files it leaves saying the old name.
 */
export type RenameSubject = Pick<WireModel, 'body' | 'tables' | 'notes' | 'groups'>

/** One body whose prose names a table inside backticks, and how often. */
export interface Mention {
  /** Where the prose is: slash-separated, relative to the model root. */
  readonly path: string
  /** How many backticked spans in that body name the table. */
  readonly count: number
}

/**
 * A backtick span, and it is the only thing in a body that is read at all.
 *
 * ADR 0036 is the precedent and the reasoning is the same one word along:
 * `orders` in a sentence is an English word, and `` `orders` `` is a claim about
 * a table. Bounded to a single line because a span is, which is also what keeps
 * a fenced block from being read as one enormous span.
 */
const CODE_SPAN = /`([^`\n]+)`/g

/**
 * Whether one span is a claim about `table`.
 *
 * `subscriptions` is, and so is `subscriptions.plan_id`, because a qualified
 * column is a claim about the table it is qualified by. `subscriptions_due_idx`
 * is not: it is an index, an index is not renamed by a table rename, and it is
 * the case `examples/shop` actually contains. Nothing else counts, and in
 * particular a span is never searched inside: substring matching would make
 * every rename of `order` a warning about `order_items`.
 */
function namesTable(span: string, table: string): boolean {
  return span === table || span.startsWith(`${table}.`)
}

function mentionsIn(body: string, table: string): number {
  let found = 0
  for (const match of body.matchAll(CODE_SPAN)) {
    const span = match[1]
    if (span !== undefined && namesTable(span, table)) found += 1
  }
  return found
}

/**
 * Every body that names `table` in backticks, in the order the reader walks them.
 *
 * **This is not a check over the model and must not become one.** ADR 0003 makes
 * a body opaque to everything, which is what lets the prose be the part of this
 * format a schema dump cannot hold, and dbmd-x82 leaves whether the tool reads
 * prose at all as the owner's question. What this answers is narrower and is a
 * question about one moment: a rename is about to change a name, and these are
 * the files that say the old one.
 */
export function mentionsOf(model: RenameSubject, table: string): Mention[] {
  const bodies: readonly { readonly path: string; readonly body: string }[] = [
    { path: MODEL_FILE, body: model.body },
    ...model.tables,
    ...model.notes,
    ...model.groups,
  ]
  return bodies
    .map(({ path, body }) => ({ path, count: mentionsIn(body, table) }))
    .filter((mention) => mention.count > 0)
}

/** What the panel does about a rename, worked out before it draws anything. */
export type RenamePlan =
  /**
   * There is no confirmation to draw, and this is why.
   *
   * A name the model already holds cannot be renamed to, and the server refuses
   * it as well and has to: a client is not a permission system. What the client
   * can do is not offer a decision that was never available.
   */
  | { readonly kind: 'refused'; readonly said: string }
  /** The paragraphs of the confirmation, in the order they are read. */
  | { readonly kind: 'confirm'; readonly lines: readonly string[] }

/**
 * Everything the rename confirmation says, decided without a DOM.
 *
 * Here rather than in the panel for the reason `fields.ts` and `tables.ts` are
 * (ADR 0016): this is the most carefully worded sentence in the studio, said at
 * the one moment it can still change somebody's mind, and a sentence that
 * important should be provable without a browser. The two things it used to get
 * wrong are both about accuracy at that moment: it offered the decision for a
 * name that was already taken, and it counted the file it is deleting among the
 * other files it would edit.
 *
 * **The last paragraph is about the files this rename will not touch**, and it
 * is here rather than in the line said afterwards because of what the rest of
 * the confirmation is: a list of what a rename does to the directory, read while
 * it can still be declined. Stale prose belongs on that list. A rename is undone
 * with `git checkout` and nothing else, so the moment to learn that three
 * paragraphs are about to start lying is the moment before, not the moment
 * after, and a to-do list posted into the status line would be one sentence
 * competing with the sentence that says whether the rename finished. It is a
 * warning and never a refusal: prose that has gone stale is not a broken model,
 * and a tool that will not write until the paragraphs agree is one people stop
 * writing paragraphs for. dbmd-x82, ADR 0044.
 */
export function renamePlan(model: RenameSubject, from: string, to: string): RenamePlan {
  const others = model.tables.map((table) => table.name).filter((name) => name !== from)
  const clash = clashFor(to, others)
  if (clash?.kind === 'same') {
    return {
      kind: 'refused',
      said: `There is already a table called \`${to}\`, so nothing here can be renamed to it. Pick another name, or rename that one first.`,
    }
  }

  const referrers = referrersTo(model, from)
  // A ref from this table to itself is rewritten inside the file being created,
  // so it is a ref that moves and not a file that is edited. Counting it as one
  // put `tables/addresses.md` in the list of other files a rename of
  // `addresses` would edit, which named the file the same sentence had just
  // said was being deleted.
  const elsewhere = referrers.filter((referrer) => referrer.table !== from)
  const files = [...new Set(elsewhere.map((referrer) => referrer.table))]
  const count = referrers.length

  const mentions = mentionsOf(model, from)
  const said = mentions.reduce((total, mention) => total + mention.count, 0)
  // The renamed table's own body is copied into the new file byte for byte, so
  // the sentence to go and fix is in the file this rename is about to write and
  // not in the one it is about to delete. Naming the old path here would send
  // somebody to a file the line above has just said is going away.
  const renamed = model.tables.find((table) => table.name === from)
  const where = mentions.map((mention) =>
    mention.path === renamed?.path ? `tables/${to}.md` : mention.path,
  )

  return {
    kind: 'confirm',
    lines: [
      `Rename \`${from}\` to \`${to}\`?`,
      `This writes tables/${to}.md and deletes tables/${from}.md.`,
      ...(clash?.kind === 'case'
        ? [
            `\`${clash.held}\` differs from this only in case, which is two tables on Linux and one file on Windows and macOS, where this rename is refused.`,
          ]
        : []),
      count === 0
        ? 'Nothing else in the model refs this table, so no other file changes.'
        : files.length === 0
          ? `${count} ${agreeing(count, 'ref points', 'refs point')} here, from this table itself, and ${agreeing(count, 'moves', 'move')} into the new file with it, so no other file changes (${referrerText(referrers)}).`
          : `${count} ${agreeing(count, 'ref points', 'refs point')} here and will be moved with it, which edits ${files.length} other ${agreeing(files.length, 'file', 'files')}: ${files.map((file) => `tables/${file}.md`).join(', ')} (${referrerText(referrers)}).`,
      ...(said === 0
        ? []
        : [
            `${said} ${agreeing(said, 'mention', 'mentions')} of \`${from}\` in backticks ${agreeing(said, 'stays as it is', 'stay as they are')}, in ${where.join(', ')}. A rename moves refs and never prose, and no check reads a body, so nothing else will tell you.`,
          ]),
    ],
  }
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
