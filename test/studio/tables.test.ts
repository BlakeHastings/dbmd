import { describe, expect, it } from 'vitest'
import { clashFor, NEW_TABLE_COLUMNS, suggestTableName } from '../../src/studio/client/tables.js'

/**
 * Creating a table, without a browser.
 *
 * The same split as `inspector.test.ts` and for the same reason (ADR 0015): the
 * form and the pointer are proven by driving the studio, and what is here is the
 * part a screenshot cannot show.
 *
 * The case clash is the whole reason this module exists. It is the one thing
 * about a name that the server cannot answer, because the answer depends on the
 * filesystem the model is checked out on rather than on the name, and by the
 * time a reader could tell you, one of the two files has already replaced the
 * other. `docs/format.md` has the measurement.
 */

const shop = ['addresses', 'customers', 'orders']

describe('a name for a table nobody has named', () => {
  it('is the same first suggestion in every model, because nothing about it is a guess', () => {
    expect(suggestTableName([])).toBe('new_table')
    expect(suggestTableName(shop)).toBe('new_table')
  })

  it('counts up past the ones already there, so two in a row do not collide', () => {
    expect(suggestTableName(['new_table'])).toBe('new_table_2')
    expect(suggestTableName(['new_table', 'new_table_2'])).toBe('new_table_3')
    // A gap is filled rather than skipped: the suggestion is a free name and
    // not a sequence anybody is counting.
    expect(suggestTableName(['new_table', 'new_table_3'])).toBe('new_table_2')
  })

  it('does not suggest a name that differs from one held only in case', () => {
    // Because the form would then immediately warn about its own suggestion.
    expect(suggestTableName(['New_Table'])).toBe('new_table_2')
  })
})

describe('what a new name clashes with', () => {
  it('is nothing, for a name no table has', () => {
    expect(clashFor('invoices', shop)).toBeUndefined()
  })

  it('is the same name, which the server refuses too and the page can say sooner', () => {
    expect(clashFor('orders', shop)).toEqual({ kind: 'same', held: 'orders' })
  })

  it('is a case clash, which is two tables on Linux and one file everywhere else', () => {
    expect(clashFor('Orders', shop)).toEqual({ kind: 'case', held: 'orders' })
    expect(clashFor('ORDERS', shop)).toEqual({ kind: 'case', held: 'orders' })
  })

  it('prefers the exact match, so a model holding both is answered about the one it is', () => {
    // A model that already went wrong this way still has to be editable, and
    // `orders` beside `Orders` is a create that cannot happen rather than one
    // that is merely unwise.
    expect(clashFor('orders', ['Orders', 'orders'])).toEqual({ kind: 'same', held: 'orders' })
  })
})

describe('the shape a table starts with', () => {
  it("is a key called id with no type, because the type is the engine's business", () => {
    expect(NEW_TABLE_COLUMNS).toEqual([{ name: 'id', type: '', pk: true }])
  })

  it('carries a primary key, so a brand new table is not born with a warning', () => {
    // `primary-key-missing` fires on a table that has columns and no `pk: true`,
    // which is what one column and a forgotten flag would produce.
    expect(NEW_TABLE_COLUMNS.some((column) => column.pk === true)).toBe(true)
  })
})
