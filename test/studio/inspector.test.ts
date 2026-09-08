import { describe, expect, it } from 'vitest'
import type { Group, Note, Table } from '../../src/model/types.js'
import {
  endingOf,
  indexKeysText,
  keysAreEditableAsText,
  looksLikeExpressionKey,
  parseIndexColumns,
  parseRef,
  survivesATextarea,
  toModelBody,
} from '../../src/studio/client/fields.js'
import {
  mentionsOf,
  referrersTo,
  referrerText,
  renamePlan,
  withRefsRetargeted,
  type RenamePlan,
} from '../../src/studio/client/model.js'
import {
  conflictSummary,
  createdNotice,
  staleNotice,
  unreadableNotice,
  writeFailureNotice,
} from '../../src/studio/client/write.js'
import type { WireConflict } from '../../src/studio/wire.js'

/**
 * The inspector without a browser.
 *
 * Same split as `canvas.test.ts`, for the same reason (ADR 0015): the DOM and
 * the event handling are proven by driving the studio, because a test double for
 * an input event proves that the double works. What is here is the part a
 * screenshot cannot show, and it is two things.
 *
 * **The line endings**, because the failure is invisible: a prose edit that
 * flattened a CRLF file looks correct in the browser, looks correct in an
 * editor, and shows up as a hundred-line diff in somebody's pull request three
 * days later.
 *
 * **What a rename touches**, because it is the answer the interface gives before
 * it edits other people's files, and being wrong about it is worse than not
 * offering the rename.
 */

function table(name: string, columns: Table['columns'], body = '\n'): Table {
  return {
    kind: 'table',
    name,
    path: `tables/${name}.md`,
    body,
    complete: true,
    columns,
    indexes: [],
  }
}

function note(name: string, body: string): Note {
  return { kind: 'note', name, path: `notes/${name}.md`, body, complete: true }
}

function group(name: string, body: string): Group {
  return { kind: 'group', name, path: `groups/${name}.md`, body, complete: true }
}

/**
 * In the reader's order, which is by name, because that is the order it walks.
 *
 * Every body here is prose-free, which is what keeps the ref sentences the last
 * thing this model's confirmation says. The prose is a fixture of its own below,
 * so a test about refs cannot be moved by a test about paragraphs.
 */
const model = {
  body: '',
  notes: [],
  groups: [],
  tables: [
    table('addresses', [
      { name: 'id', type: 'uuid', pk: true },
      { name: 'customer_id', type: 'uuid', ref: { table: 'customers', column: 'id' } },
      { name: 'superseded_by', type: 'uuid', ref: { table: 'addresses', column: 'id' } },
    ]),
    table('customers', [{ name: 'id', type: 'uuid', pk: true }]),
    table('orders', [
      { name: 'id', type: 'uuid', pk: true },
      { name: 'customer_id', type: 'uuid', ref: { table: 'customers', column: 'id' } },
    ]),
  ],
}

const addresses = model.tables[0]?.columns ?? []

describe('a body through a textarea', () => {
  it('reads the ending off the body, because the body is the only thing that knows', () => {
    expect(endingOf('\nOne row per widget.\n')).toBe('\n')
    expect(endingOf('\r\nOne row per widget.\r\n')).toBe('\r\n')
    // A body with no line break at all is LF, which is what a new one is written
    // as and what `dbmd init` produces.
    expect(endingOf('no newline here')).toBe('\n')
  })

  it('puts CRLF back on what a textarea handed back as LF', () => {
    // This is the whole of the promise. A textarea's API value is LF-normalised
    // by specification, so this is the value the page will actually hold after a
    // CRLF body has been through one.
    const asTheTextareaHandsItBack = '\nOne row per widget.\n\nA second paragraph.\n'
    expect(toModelBody(asTheTextareaHandsItBack, '\r\n')).toBe(
      '\r\nOne row per widget.\r\n\r\nA second paragraph.\r\n',
    )
    expect(toModelBody(asTheTextareaHandsItBack, '\n')).toBe(asTheTextareaHandsItBack)
  })

  it('is byte-exact on a body nobody edited, which is what makes the diff one line', () => {
    for (const body of ['\nOne row.\n', '\r\nOne row.\r\n\r\nAnd another.\r\n', '', '\n\n\n']) {
      const ending = endingOf(body)
      // What the panel does: assign the body, read it back LF-normalised as a
      // textarea would, and convert. Nothing may move.
      const throughTheWidget = body.replace(/\r\n|\r/g, '\n')
      expect(toModelBody(throughTheWidget, ending)).toBe(body)
    }
  })

  it('says a mixed body cannot survive, rather than flattening it quietly', () => {
    expect(survivesATextarea('\r\nboth\r\nkinds\n', '\r\n')).toBe(false)
    expect(survivesATextarea('\rbare carriage return\n', '\n')).toBe(false)
    expect(survivesATextarea('\r\nall CRLF\r\n', '\r\n')).toBe(true)
    expect(survivesATextarea('\nall LF\n', '\n')).toBe(true)
  })
})

describe('a ref typed into a field', () => {
  it('splits at the last dot, so a table name may hold dots', () => {
    expect(parseRef('customers.id')).toEqual({ table: 'customers', column: 'id' })
    expect(parseRef('sales.orders.id')).toEqual({ table: 'sales.orders', column: 'id' })
    expect(parseRef('  customers.id  ')).toEqual({ table: 'customers', column: 'id' })
  })

  it('is absent when empty and malformed when it names no column', () => {
    expect(parseRef('')).toBe('absent')
    expect(parseRef('   ')).toBe('absent')
    // Half-typed rather than half-meant: guessing a column here would write a
    // ref the developer did not ask for.
    expect(parseRef('customers')).toBe('malformed')
    expect(parseRef('customers.')).toBe('malformed')
    expect(parseRef('.id')).toBe('malformed')
  })

  it('does not care whether the target exists, because the validator answers that', () => {
    expect(parseRef('nosuchtable.id')).toEqual({ table: 'nosuchtable', column: 'id' })
  })
})

describe('the columns of an index, typed as one field', () => {
  it('is a comma-separated list, in order, without the empties a person types on the way', () => {
    expect(parseIndexColumns('customer_id, placed_at')).toEqual(['customer_id', 'placed_at'])
    expect(parseIndexColumns('customer_id,')).toEqual(['customer_id'])
    expect(parseIndexColumns('')).toEqual([])
  })

  /**
   * The guard that stops the field corrupting what it cannot hold.
   *
   * Before it, an expression key reached the field as `[object Object]` and
   * touching the row wrote that back, so a hand-written `lower(display_name)`
   * index became an index on a column called `[object Object]`. The field is
   * one comma-separated line and an expression key is a mapping (ADR 0022), so
   * the honest answer is to show it and refuse the edit rather than to accept
   * an edit that means something else.
   */
  it('can be edited as text when every key is a column, and not when one is not', () => {
    expect(keysAreEditableAsText(['customer_id', 'placed_at'])).toBe(true)
    expect(keysAreEditableAsText([{ expression: 'lower(display_name)' }])).toBe(false)
    // One expression among columns is still not editable: the field would have
    // to give back a mixture and there is no text that says so.
    expect(keysAreEditableAsText(['tenant_id', { expression: 'lower(email)' }])).toBe(false)
  })

  it('shows the keys the way the file spells them, never as a stringified object', () => {
    expect(indexKeysText(['tenant_id', { expression: 'lower(email)' }])).toBe(
      'tenant_id, { expression: lower(email) }',
    )
    expect(indexKeysText([{ expression: 'lower(email)' }])).not.toContain('[object Object]')
  })

  /**
   * The panel prints the mapping spelling on the row it will not edit, and the
   * row below it is an ordinary field, so the spelling gets copied. What it
   * produces is a column called `{ expression: lower(email) }` and a validator
   * message offering to wrap it a second time, which is why the row says
   * something before the footer does. ADR 0047.
   */
  it('recognises its own printed spelling of an expression, typed back into the field', () => {
    expect(looksLikeExpressionKey(indexKeysText([{ expression: 'lower(email)' }]))).toBe(true)
    expect(looksLikeExpressionKey('{expression:lower(email)}')).toBe(true)
    // A comma inside the expression reaches `parseIndexColumns` as two keys, so
    // this reads the field rather than a key and still sees it.
    expect(looksLikeExpressionKey("{ expression: date_trunc('day', created_at) }")).toBe(true)
    // Among columns, because that is a mixture somebody meant.
    expect(looksLikeExpressionKey('tenant_id, { expression: lower(email) }')).toBe(true)
  })

  it('says nothing about a name that is merely SQL-shaped, because that one is a legal column', () => {
    // `lower(email)` is a name a table may really have, and the validator's
    // message about it already says the right thing. Treating it as an
    // expression is the guess ADR 0026 refuses.
    expect(looksLikeExpressionKey('lower(email)')).toBe(false)
    expect(looksLikeExpressionKey('customer_id, placed_at')).toBe(false)
    expect(looksLikeExpressionKey('')).toBe(false)
    expect(looksLikeExpressionKey('{ column: email }')).toBe(false)
  })
})

describe('what a rename is about to touch', () => {
  it('finds every ref into a table, wherever it is written', () => {
    expect(referrersTo(model, 'customers')).toEqual([
      { table: 'addresses', column: 'customer_id' },
      { table: 'orders', column: 'customer_id' },
    ])
    expect(referrerText(referrersTo(model, 'customers'))).toBe(
      'addresses.customer_id, orders.customer_id',
    )
  })

  it('narrows to one column, which is what a column removal has to warn about', () => {
    expect(referrersTo(model, 'customers', 'id')).toHaveLength(2)
    expect(referrersTo(model, 'customers', 'email')).toEqual([])
  })

  it('counts a self-reference, so the renamed table is not left pointing at its old file', () => {
    expect(referrersTo(model, 'addresses')).toEqual([
      { table: 'addresses', column: 'superseded_by' },
    ])
  })

  it('moves only the refs at the renamed table and leaves the rest alone', () => {
    const moved = withRefsRetargeted(addresses, 'customers', 'clients')
    expect(moved[1]?.ref).toEqual({ table: 'clients', column: 'id' })
    // The ref at `addresses` is untouched by a rename of `customers`, and the
    // column that has no ref at all comes back as the same object.
    expect(moved[2]?.ref).toEqual({ table: 'addresses', column: 'id' })
    expect(moved[0]).toBe(addresses[0])
  })

  it('retargets a self-reference, which is what makes the new file honest at birth', () => {
    const moved = withRefsRetargeted(addresses, 'addresses', 'delivery_points')
    expect(moved[2]?.ref).toEqual({ table: 'delivery_points', column: 'id' })
  })

  it('moves the table name and nothing else about the ref', () => {
    // A rename that rebuilt the ref from its two halves would delete the
    // referential action from every file it touched, and the developer would
    // find out from a diff two days later. ADR 0046.
    const columns = [
      {
        name: 'customer_id',
        type: 'uuid',
        ref: { table: 'customers', column: 'id', onDelete: 'restrict' as const },
      },
    ]
    expect(withRefsRetargeted(columns, 'customers', 'clients')[0]?.ref).toEqual({
      table: 'clients',
      column: 'id',
      onDelete: 'restrict',
    })
  })
})

/**
 * The sentence the panel says at the one moment it can still change a mind.
 *
 * Every case here was a paragraph the studio drew, in full, about files it was
 * never going to write, and then refused after the button was pressed. Nothing
 * was ever written and both refusals were correct; what was wrong was the
 * moment, and the moment is the whole of what a confirmation is.
 */
describe('what the rename confirmation says', () => {
  it('does not offer the decision at all when the name is already taken', () => {
    const plan = renamePlan(model, 'orders', 'customers')
    expect(plan.kind).toBe('refused')
    // The server refuses this too and still has to. The point is that nobody is
    // asked to agree to `This writes tables/customers.md` first.
    if (plan.kind === 'refused') expect(plan.said).toContain('already a table called `customers`')
  })

  it('still offers a rename that only changes case, and says what it costs', () => {
    const plan = renamePlan(model, 'orders', 'Customers')
    expect(plan.kind).toBe('confirm')
    if (plan.kind !== 'confirm') return
    expect(plan.lines.join(' ')).toContain('differs from this only in case')
  })

  it('counts the renamed table itself as a ref that moves, not as another file', () => {
    // `addresses.superseded_by` refs `addresses.id`. It is rewritten inside the
    // file being created, so it is one of the refs that move; naming
    // tables/addresses.md as a file that gets edited names the file the line
    // above has just said is being deleted.
    const plan = renamePlan(model, 'addresses', 'postal_addresses')
    expect(plan.kind).toBe('confirm')
    if (plan.kind !== 'confirm') return
    const said = plan.lines.join(' ')
    expect(said).toContain('This writes tables/postal_addresses.md and deletes tables/addresses.md')
    expect(said).toContain('so no other file changes')
    expect(said).toContain('addresses.superseded_by')
    expect(said).not.toContain('other file: tables/addresses.md')
  })

  it('agrees the verb with the count, which one ref did not', () => {
    const one = renamePlan(model, 'customers', 'clients')
    const alone = renamePlan(model, 'addresses', 'postal_addresses')
    expect(lastLine(one)).toContain('2 refs point here')
    expect(lastLine(one)).toContain('2 other files')
    expect(lastLine(alone)).toContain('1 ref points here')
    // The shape that produced `1 ref point at it`: a plural noun and a bare verb.
    for (const plan of [one, alone]) expect(lastLine(plan)).not.toMatch(/\b1 refs?\s+point\b/)
  })

  it('says nothing about other files when nothing refs the table', () => {
    const plan = renamePlan({ body: '', tables: [], notes: [], groups: [] }, 'orders', 'purchases')
    expect(lastLine(plan)).toBe(
      'Nothing else in the model refs this table, so no other file changes.',
    )
  })
})

/**
 * The prose a rename leaves behind, said before the button rather than after.
 *
 * dbmd-x82. A rename edits every file that **refs** the old table and leaves
 * every sentence that **mentions** it, and no check will ever say so: ADR 0003
 * makes a body opaque, so a model whose paragraphs have started lying reads
 * `no problems` and exits 0. The narrow answer, and the only one ADR 0044 takes,
 * is to say it at the one moment the mistake is being made.
 *
 * The fixture is `examples/shop` at the two names that matter. `_model.md` names
 * `subscriptions` in backticks and never names `addresses` at all, so one rename
 * has something to say and the other must say nothing.
 */
describe('what the rename confirmation says about prose', () => {
  const shop = {
    body: '\nThat gap is why `orders.status` is not a warehouse state, and why\n`subscriptions` has no `product_id`.\n',
    tables: [
      table('addresses', [{ name: 'id', type: 'uuid', pk: true }]),
      table(
        'subscriptions',
        [{ name: 'id', type: 'uuid', pk: true }],
        // Two spans, and only one of them is a claim about the table. An index
        // is not renamed by a table rename, and `subscriptions_due_idx` is the
        // span in `examples/shop` that a substring match would have called a
        // mention.
        '\n`subscriptions_due_idx` exists for the roast job. A row in `subscriptions` is never deleted.\n',
      ),
    ],
    notes: [note('there-is-no-stock-column', '\nStock is derived, never stored.\n')],
    groups: [group('warehouse', '\nWhat `subscriptions` renews is picked here.\n')],
  }

  it('names the files whose sentences will still say the old name', () => {
    const said = lastLine(renamePlan(shop, 'subscriptions', 'plans'))
    expect(said).toContain('3 mentions of `subscriptions` in backticks stay as they are')
    // `_model.md` and the group's prose are left alone; the renamed table's own
    // body is copied into the file this rename is about to write, so that is the
    // file to go and fix rather than the one being deleted.
    expect(said).toContain('in _model.md, tables/plans.md, groups/warehouse.md.')
    expect(said).not.toContain('tables/subscriptions.md')
  })

  it('says nothing at all when nothing names the table, which is most renames', () => {
    // A warning that fires when there is nothing to fix is worse than no
    // warning: it is the one that gets read past.
    const plan = renamePlan(shop, 'addresses', 'postal_addresses')
    expect(plan.kind).toBe('confirm')
    if (plan.kind !== 'confirm') return
    for (const line of plan.lines) expect(line).not.toContain('in backticks')
  })

  it('does not block the rename, because stale prose is not a broken model', () => {
    const plan = renamePlan(shop, 'subscriptions', 'plans')
    // A refusal is the shape reserved for a decision that was never available.
    // This one is available, and the paragraph is the last thing said before it.
    expect(plan.kind).toBe('confirm')
  })

  it('agrees the verb with the count, the way the ref sentence had to learn to', () => {
    const one = lastLine(renamePlan({ ...shop, groups: [] }, 'subscriptions', 'plans'))
    expect(one).toContain('2 mentions of `subscriptions` in backticks stay as they are')
    const alone = lastLine(renamePlan({ ...shop, body: '', groups: [] }, 'subscriptions', 'plans'))
    expect(alone).toContain('1 mention of `subscriptions` in backticks stays as it is')
    expect(alone).not.toMatch(/\b1 mentions\b/)
  })
})

/**
 * The one string a body is read for, and the four ways it is not read.
 *
 * ADR 0036's reasoning one word along: a backtick is the marker an author has
 * already written, and everything outside one is prose that this tool does not
 * read. The cases below are the ones that decide whether that rule is honest.
 */
describe('which backticked spans name a table', () => {
  const of = (body: string, table: string): number =>
    mentionsOf({ body, tables: [], notes: [], groups: [] }, table)[0]?.count ?? 0

  it('reads a span that is the name, and a column qualified by it', () => {
    expect(of('The `orders` table.\n', 'orders')).toBe(1)
    expect(of('`orders.status` is not a warehouse state.\n', 'orders')).toBe(1)
    expect(of('Both `orders` and `orders.status`.\n', 'orders')).toBe(2)
  })

  it('does not read the bare word, because a bare word is English', () => {
    // The whole reason this is narrow. "orders" is a noun, and warning about it
    // would make every rename of a table with an ordinary name unreadable.
    expect(of('Rows in orders are append-only.\n', 'orders')).toBe(0)
  })

  it('does not read a span the name is merely inside', () => {
    expect(of('`subscriptions_due_idx` exists for that job.\n', 'subscriptions')).toBe(0)
    expect(of('`order_items` is a different table.\n', 'order')).toBe(0)
    expect(of('`orders_archive.id` is somewhere else.\n', 'orders')).toBe(0)
  })

  it('does not read across a line break, so a fence is not one enormous span', () => {
    expect(of('```sql\nselect * from orders\n```\n', 'orders')).toBe(0)
    expect(of('A ` that opens nothing,\nand `orders` on the next line.\n', 'orders')).toBe(1)
  })
})

/**
 * The sentence a developer reads at the moment they think they have lost work.
 *
 * Not the inspector, and here anyway, because it is the same kind of thing as
 * everything above it: a string the interface says out loud, which no
 * typechecker reads and which was wrong for as long as nobody read it aloud.
 * The defect was that the page rendered the server's prose. That prose is the
 * right answer to a script and the wrong one to a person: it names two revision
 * numbers and tells the reader to fetch a URL, and then the page appended the
 * same advice again in words that actually said who does the fetching.
 *
 * So the assertions are mostly about what is *absent*. There is no type that
 * can hold "this sentence is for a person", and the two things that made it not
 * one are both greppable.
 */
describe('what the page says when the model moved underneath it', () => {
  it('gives the instruction once, and says nothing was lost', () => {
    const notice = staleNotice('The edit to table `products`')
    expect(notice).toContain('The edit to table `products` was refused')
    expect(notice).toContain('Nothing was written')
    expect(notice).toContain('the change on disk is intact')
    // Once. The page used to append its own copy of the server's last sentence.
    expect(notice.match(/again/g)).toHaveLength(1)
  })

  it('names no endpoint, because the person reading it cannot call one', () => {
    expect(staleNotice('The delete of tables/orders.md')).not.toContain('/api/')
  })

  it('names no revision number, because two of them answer a question nobody asked', () => {
    // The numbers are not thrown away: `sayStale` in `main.ts` puts the
    // server's whole sentence on the console, which is where they are worth
    // having and where they are not the first thing read.
    expect(staleNotice('The edit to note `stock`')).not.toMatch(/revision \d/)
  })

  it('is the same sentence whichever path met the refusal', () => {
    // One function and two callers: an edit refused by the writer and a delete
    // refused by the server. A developer who meets this twice in a minute
    // should not have to work out whether the two are the same thing.
    const edit = staleNotice('The edit to table `orders`')
    const removal = staleNotice('The delete of tables/orders.md')
    expect(edit.replace('The edit to table `orders`', '')).toBe(
      removal.replace('The delete of tables/orders.md', ''),
    )
  })
})

/**
 * The sentence beside that one, for the file nothing could open.
 *
 * Same kind of thing and the same reason it is here: prose the interface says
 * out loud, which no typechecker reads. The defect was that a file another
 * program had open arrived at `staleNotice` and was described as a file
 * somebody else had edited, which is the opposite fact about the developer's
 * disk. dbmd-e6e.
 */
describe('what the page says when it could not read the file', () => {
  it('says nothing was written and nothing on disk changed', () => {
    const notice = unreadableNotice('The delete of tables/orders.md')
    expect(notice).toContain('could not read the file')
    expect(notice).toContain('Nothing was written')
    expect(notice).toContain('the file is exactly as it was')
  })

  it('does not say the files changed, which is the sentence it replaces', () => {
    const notice = unreadableNotice('The edit to table `orders`')
    expect(notice).not.toContain('changed on disk')
    expect(notice).not.toContain('the change on disk is intact')
  })

  it('names no cause, because a lock and a permission look the same from here', () => {
    expect(unreadableNotice('The edit to table `orders`')).not.toMatch(
      /lock|another program|antivirus|OneDrive/i,
    )
  })

  it('points at the diagnostics, where the reader has already said what it saw', () => {
    // The whole defect was two messages two inches apart, one of which had not
    // happened. This is the line that joins them rather than competing.
    expect(unreadableNotice('The edit to table `orders`')).toContain('The diagnostics below')
  })

  it('waits for the file rather than telling a person to try again now', () => {
    // `staleNotice` says make the change again on top of what the page shows,
    // because there is something to make it on top of. Here there is not, and
    // the advice that ignored that is what looped.
    expect(unreadableNotice('The edit to table `orders`')).toContain('once the file can be read')
  })
})

/**
 * The sentence a create leaves behind, which used to be no sentence at all.
 *
 * A create is the only edit that does not go through `ObjectWriter`, which is
 * the only place the page clears its standing sentence, so `Creating
 * tables/x.md.` stood for as long as the tab did over a file that had already
 * landed. Measured unchanged at three seconds and at fifteen.
 *
 * **This is the weaker half of the evidence and is here for the wording only.**
 * That the sentence is now reached at all was proved by driving the studio in
 * Chromium, which is where ADR 0015 puts the DOM and the event handling, and no
 * assertion in this file could have caught the defect it fixes. ADR 0074.
 */
describe('what the page says once a create has landed', () => {
  it('names the file, in the past tense the standing sentence was waiting for', () => {
    expect(createdNotice('tables/cupping_notes.md')).toContain('Created tables/cupping_notes.md')
    expect(createdNotice('notes/roast-log.md')).toContain('Created notes/roast-log.md')
  })

  it('does not offer git checkout, which does not undo a file that is not tracked', () => {
    // The reason this is a sentence of its own rather than a `standing = null`
    // that lets the ordinary `Wrote ... at ...` line render: that line ends in
    // `Undo is git checkout`, and a file created a second ago is untracked.
    const notice = createdNotice('tables/cupping_notes.md')
    expect(notice).toContain('deleting the file')
    expect(notice).not.toMatch(/Undo is git checkout\.?$/)
  })

  it('does not say it is still doing it', () => {
    expect(createdNotice('groups/roasting.md')).not.toContain('Creating')
  })
})

/**
 * The one message in the studio that is the operating system talking.
 *
 * Every other refusal here is the studio's own and says what happened and what
 * to do. This one arrived as `Last write failed:` followed by the raw error,
 * and measured on 2026-09-08 against a studio on a copy of `examples/shop` with
 * one table file made read-only, that read:
 *
 * > Last write failed: EPERM: operation not permitted, rename
 * > 'C:\...\tables\.orders.md.63ea8eb5-....tmp' -> 'C:\...\tables\orders.md'
 *
 * The behaviour behind it was right and is untouched: the write really failed,
 * the edit stayed in memory, the next flush retried it and nothing was lost.
 * What was wrong was that it opened with `.orders.md.<uuid>.tmp`, a file the
 * person never created and cannot find, put `tables/orders.md` at the far end
 * of a long line after an arrow, and told them nothing to try. ADR 0083.
 */
describe('what the page says when the disk refused the write', () => {
  const orders = { path: 'tables/orders.md', viaTemporary: true }
  const said =
    "EPERM: operation not permitted, rename 'C:\\m\\tables\\.orders.md.89184c47.tmp' -> " +
    "'C:\\m\\tables\\orders.md'"

  it('opens with the file the person was editing', () => {
    const notice = writeFailureNotice(orders, said)
    expect(notice.startsWith('Could not write tables/orders.md.')).toBe(true)
    // The temporary file is still in the sentence, because it is in the words
    // the system said and those are kept. It is just no longer the first thing
    // read.
    expect(notice.indexOf('tables/orders.md')).toBeLessThan(notice.indexOf('.tmp'))
  })

  it('keeps the system’s words rather than replacing them', () => {
    expect(writeFailureNotice(orders, said)).toContain(said)
  })

  it('guesses no cause, because every guess available is wrong most of the time', () => {
    // Read-only attribute, ACL, a lock another program holds, antivirus, a full
    // disk, a network share. The message the system gave is the only thing in
    // the exchange that knows which, and it is quoted whole.
    const notice = writeFailureNotice(orders, said).replace(said, '')
    expect(notice).not.toMatch(/read-only|permission|locked|another program|disk is full/i)
  })

  it('says what to try, and that nothing has been lost', () => {
    const notice = writeFailureNotice(orders, said)
    expect(notice).toContain('The edit is still here')
    expect(notice).toContain('rides out with the next write')
    expect(notice).toContain('clearing whatever the system is refusing')
  })

  it('explains the temporary file only when the write got as far as making one', () => {
    expect(writeFailureNotice(orders, said)).toContain('temporary file in the same folder')
    const early = writeFailureNotice({ path: 'tables/orders.md', viaTemporary: false }, 'EISDIR')
    expect(early).toContain('Could not write tables/orders.md.')
    // Nothing about a temporary file, because there is not one and pointing at
    // a file that never existed is the defect this whole sentence is fixing,
    // wearing the other hat.
    expect(early).not.toContain('temporary')
  })

  it('falls back to the system’s words alone when the throw named no file', () => {
    // Anything that goes wrong before the writer reaches a file. There is no
    // path to lead with, so it does not invent one.
    expect(writeFailureNotice(null, 'ENOSPC: no space left on device')).toBe(
      'The last write failed. ENOSPC: no space left on device',
    )
  })
})

/**
 * The line above the list of refused writes, which has to be true of all of
 * them.
 *
 * It used to say every one of them was dropped rather than written over a
 * change on disk, standing two lines above a list entry saying the file could
 * not be read.
 */
describe('the line that counts the refused writes', () => {
  const conflict = (reason: 'changed' | 'unreadable'): WireConflict => ({
    path: `tables/${reason}.md`,
    at: '2026-09-07T00:00:00.000Z',
    reason,
    message: 'whatever the server said',
  })

  it('says a change on disk when that is what all of them were', () => {
    expect(conflictSummary([conflict('changed')])).toBe(
      '1 edit was dropped rather than written over a change on disk.',
    )
  })

  it('says the studio could not read the file when that is what all of them were', () => {
    expect(conflictSummary([conflict('unreadable'), conflict('unreadable')])).toBe(
      '2 edits were dropped rather than written over a file the studio could not read.',
    )
  })

  it('claims neither when it is holding one of each', () => {
    const mixed = conflictSummary([conflict('changed'), conflict('unreadable')])
    expect(mixed).toBe('2 edits were dropped rather than written. Each line below says why.')
  })

  it('counts in words that agree with the number', () => {
    expect(conflictSummary([conflict('changed')])).toContain('1 edit was')
    expect(conflictSummary([conflict('changed'), conflict('changed')])).toContain('2 edits were')
  })
})

function lastLine(plan: RenamePlan): string {
  if (plan.kind !== 'confirm') throw new Error('the plan refused, so it has no lines')
  return plan.lines[plan.lines.length - 1] ?? ''
}
