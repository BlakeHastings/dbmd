import { describe, expect, it } from 'vitest'
import type { Group, Note, Table } from '../../src/model/types.js'
import {
  endingOf,
  indexKeysText,
  keysAreEditableAsText,
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

function lastLine(plan: RenamePlan): string {
  if (plan.kind !== 'confirm') throw new Error('the plan refused, so it has no lines')
  return plan.lines[plan.lines.length - 1] ?? ''
}
