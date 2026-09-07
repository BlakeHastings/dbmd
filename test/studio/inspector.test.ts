import { describe, expect, it } from 'vitest'
import type { Table } from '../../src/model/types.js'
import {
  endingOf,
  indexKeysText,
  keysAreEditableAsText,
  parseIndexColumns,
  parseRef,
  survivesATextarea,
  toModelBody,
} from '../../src/studio/client/fields.js'
import { referrersTo, referrerText, withRefsRetargeted } from '../../src/studio/client/model.js'

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

function table(name: string, columns: Table['columns']): Table {
  return {
    kind: 'table',
    name,
    path: `tables/${name}.md`,
    body: '\n',
    complete: true,
    columns,
    indexes: [],
  }
}

/** In the reader's order, which is by name, because that is the order it walks. */
const model = {
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
