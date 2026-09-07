/**
 * The validator, tested the way a user meets it: a whole model directory in,
 * a list of lines out.
 *
 * The centrepiece is `test/fixtures/invalid`, a model every file of which
 * parses perfectly. `readModel` says nothing about it at all, and that is
 * asserted below, because it is what makes the list underneath a test of these
 * rules rather than of the reader's. Every rule that a directory can break is
 * broken there exactly once; the two that a directory cannot reach are built in
 * memory further down.
 *
 * The lists are written out in full rather than counted. A count tells you a
 * rule fired; the wording is the product, and a diff that changes it should
 * have to be read by somebody.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { formatDiagnostics } from '../../src/diagnostics.js'
import { readModel } from '../../src/model/read.js'
import { validate } from '../../src/model/validate.js'
import type { Column, Index, Model, Table } from '../../src/model/types.js'

const invalidModel = fileURLToPath(new URL('../fixtures/invalid', import.meta.url))
const shopModel = fileURLToPath(new URL('../../examples/shop', import.meta.url))

/** Read once. Six files off disk, asserted against several times. */
const invalid = readModel(invalidModel)
const shop = readModel(shopModel)

describe('a model that breaks every rule a directory can break', () => {
  test('the reader has nothing to say about it, so the rest is the validator', async () => {
    const { diagnostics } = await invalid

    // Not a warm-up. If the reader complained here, every list below would be
    // partly its output and the fixture would have stopped being about
    // agreement between files.
    expect(formatDiagnostics(diagnostics)).toEqual([])
  })

  test('and this is what the validator says about it', async () => {
    const { model } = await invalid

    expect(formatDiagnostics(validate(model))).toEqual([
      'warning groups/orphans.md [group-empty] no table declares `group: orphans`; an empty group is usually a rename that missed a file',
      'error tables/baskets.md [duplicate-column] `baskets` declares more than one column called `token`',
      'error tables/deliveries.md [duplicate-index] `deliveries` declares more than one index called `deliveries_order_idx`',
      'error tables/orders.md [index-column-unknown] the index `orders_status_idx` names the column `status`, which `orders` does not have',
      'error tables/orders.md [ref-column-unknown] `ref: baskets.reference` on column `basket_id` names no column of `baskets`',
      'error tables/orders.md [ref-table-unknown] `ref: custmers.id` on column `customer_id` names no table; there is no tables/custmers.md',
      "warning tables/orders.md [ref-target-not-unique] `ref: promotions.code` on column `promo_code` points at a column that is neither `promotions`'s whole primary key nor covered by a single-column unique index, so it does not identify one row",
      'warning tables/promotions.md [primary-key-missing] `promotions` has no primary key; put `pk: true` on the column or columns that identify one row',
    ])
  })

  test('every rule it implements is represented, so the fixture cannot quietly shrink', async () => {
    const { model } = await invalid
    const codes = new Set(validate(model).map((diagnostic) => diagnostic.code))

    // `duplicate-table` is the omission and it is not an oversight: one
    // directory holds one `orders.md`. It is covered in memory below.
    expect([...codes].sort()).toEqual([
      'duplicate-column',
      'duplicate-index',
      'group-empty',
      'index-column-unknown',
      'primary-key-missing',
      'ref-column-unknown',
      'ref-table-unknown',
      'ref-target-not-unique',
    ])
  })

  test('twice over the same model is the same bytes', async () => {
    const { model } = await invalid

    // ADR 0006 rule 4. Cheap to assert and the sort of thing that rots the
    // first time a rule iterates a `Set` built in file order.
    expect(formatDiagnostics(validate(model))).toEqual(formatDiagnostics(validate(model)))
  })
})

describe('a model that is right says nothing', () => {
  test('examples/shop produces no diagnostics, not even a warning', async () => {
    const { model, diagnostics } = await shop

    expect(formatDiagnostics(diagnostics)).toEqual([])
    // The example is realistic: eight tables, four unique indexes, a composite
    // key, a self-reference and nine refs. A rule that is too eager fires here
    // first, which is why this is the second test in the file and not the last.
    expect(formatDiagnostics(validate(model))).toEqual([])
  })
})

describe('the ref-target warning, which is the one dbmd-14 made computable', () => {
  test('a ref at a column a single-column unique index covers is silent', () => {
    const diagnostics = validate(
      aModel([
        aTable('coupons', {
          columns: [column('id', { pk: true }), column('code')],
          indexes: [{ name: 'coupons_code_key', columns: ['code'], unique: true }],
        }),
        aTable('orders', { columns: [column('coupon_code', { ref: 'coupons.code' })] }),
      ]),
    )

    expect(formatDiagnostics(diagnostics.filter(about('ref-target-not-unique')))).toEqual([])
  })

  test('a ref at the same column without the unique index warns', () => {
    const diagnostics = validate(
      aModel([
        aTable('coupons', { columns: [column('id', { pk: true }), column('code')] }),
        aTable('orders', { columns: [column('coupon_code', { ref: 'coupons.code' })] }),
      ]),
    )

    // The two models differ by one `indexes:` entry and nothing else. Before
    // dbmd-14 that entry was unwritable, so this warning would have fired on
    // both and been deleted within a week.
    expect(formatDiagnostics(diagnostics.filter(about('ref-target-not-unique')))).toEqual([
      "warning tables/orders.md [ref-target-not-unique] `ref: coupons.code` on column `coupon_code` points at a column that is neither `coupons`'s whole primary key nor covered by a single-column unique index, so it does not identify one row",
    ])
  })

  test('one column of a composite primary key is not a unique target', () => {
    const diagnostics = validate(
      aModel([
        aTable('order_items', {
          columns: [column('order_id', { pk: true }), column('line_no', { pk: true })],
        }),
        aTable('picks', { columns: [column('order_id', { ref: 'order_items.order_id' })] }),
      ]),
    )

    // `(order_id, line_no)` identifies a row. `order_id` identifies the lines
    // of an order, which is a set, and an arrow drawn at it is drawn at a set.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('ref-target-not-unique')
  })

  test('nor is one column of a multi-column unique index', () => {
    const diagnostics = validate(
      aModel([
        aTable('slots', {
          columns: [column('id', { pk: true }), column('room'), column('starts_at')],
          indexes: [{ name: 'slots_room_key', columns: ['room', 'starts_at'], unique: true }],
        }),
        aTable('bookings', { columns: [column('room', { ref: 'slots.room' })] }),
      ]),
    )

    // `unique` on `(room, starts_at)` says two rooms may share a start and one
    // room may be booked twice at different times. It says nothing about `room`
    // on its own, and reading it as though it did is the way this rule would
    // start approving typos.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('ref-target-not-unique')
  })

  test('a ref at a column that does not exist gets one complaint and not two', () => {
    const diagnostics = validate(
      aModel([
        aTable('coupons', { columns: [column('id', { pk: true })] }),
        aTable('orders', {
          columns: [column('id', { pk: true }), column('coupon_code', { ref: 'coupons.code' })],
        }),
      ]),
    )

    // An absent column is trivially not unique, so the uniqueness rule would
    // fire too if it were not stood down. Saying the same mistake twice, in two
    // severities, is how a list stops being read.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['ref-column-unknown'])
  })
})

describe('what the validator refuses to say', () => {
  test('nothing that depends on what an incomplete object does not have', () => {
    const diagnostics = validate(
      aModel([
        // The reader raised an error building this one, which means the file
        // holds something the table does not: a column whose type YAML read as
        // a boolean is dropped, and so is its `pk: true`.
        aTable('half_read', { complete: false, columns: [column('id')], indexes: [] }),
      ]),
    )

    // `primary-key-missing` would be a guess about a file this process already
    // failed to read, and the person has an error about that file to fix first.
    expect(formatDiagnostics(diagnostics)).toEqual([])
  })

  test('nor about a ref into an incomplete table', () => {
    const diagnostics = validate(
      aModel([
        aTable('coupons', { complete: false, columns: [column('id', { pk: true })] }),
        aTable('orders', {
          columns: [column('id', { pk: true }), column('coupon_code', { ref: 'coupons.code' })],
        }),
      ]),
    )

    // `coupons` may well have a `code`; the reader lost a line in that file and
    // said so. Accusing `orders.md` of a dangling ref on that evidence sends
    // somebody to the wrong file.
    expect(formatDiagnostics(diagnostics)).toEqual([])
  })

  test('but an incomplete object can still hold two of something', () => {
    const diagnostics = validate(
      aModel([
        aTable('half_read', {
          complete: false,
          columns: [column('id', { pk: true }), column('token'), column('token')],
        }),
      ]),
    )

    // Dropping a column cannot invent a duplicate, so this one is safe to say
    // about a file the reader stumbled in. Absences are not evidence; presences
    // are.
    expect(formatDiagnostics(diagnostics)).toEqual([
      'error tables/half_read.md [duplicate-column] `half_read` declares more than one column called `token`',
    ])
  })

  test('and nothing the reader has already said', async () => {
    // `group-unknown` is the overlap that matters: the item this file came from
    // asks for it, the reader already raises it, and the reader can put a line
    // number on it that a `Model` cannot. Two complaints, one of them worse, is
    // the wrong answer to "who owns this rule".
    const { model, diagnostics } = await readModel(invalidModel)
    const reader = new Set(diagnostics.map((diagnostic) => diagnostic.code))
    const validator = new Set(validate(model).map((diagnostic) => diagnostic.code))

    expect([...validator].filter((code) => reader.has(code))).toEqual([])
    expect(validator.has('group-unknown')).toBe(false)
    expect(validator.has('kind-mismatch')).toBe(false)
  })
})

describe('the rules a directory cannot break', () => {
  test('two tables under one name, which is how an import of two schemas arrives', () => {
    const diagnostics = validate(
      aModel([
        aTable('orders', { path: 'tables/orders.md', columns: [column('id', { pk: true })] }),
        aTable('orders', { path: 'tables/orders-1.md', columns: [column('id', { pk: true })] }),
      ]),
    )

    // The diagnostic is on the second file, because that is the one to rename,
    // and it names the first so that the reader of the message knows which two.
    expect(formatDiagnostics(diagnostics)).toEqual([
      'error tables/orders-1.md [duplicate-table] a second table called `orders` is declared here; the first is tables/orders.md',
    ])
  })

  test('a table with no columns at all is not told it has no primary key', () => {
    const diagnostics = validate(aModel([aTable('planned')]))

    // The format writes an empty list as no key, so this is a table somebody
    // created and has not filled in. Telling them the key is missing is telling
    // them the table is empty in the least useful available words.
    expect(formatDiagnostics(diagnostics)).toEqual([])
  })
})

// --------------------------------------------------------------------------
// Models built in memory, for the cases a directory cannot produce.
//
// `referencesTo` and `groupMembers` are left empty on purpose. The validator
// reads the `ref:` and `group:` declarations rather than the reader's derived
// indexes, and these tests are what would fail if that ever changed quietly.
// --------------------------------------------------------------------------

function aModel(tables: readonly Table[], groups: readonly Model['groups'][number][] = []): Model {
  return {
    name: 'in-memory',
    body: '',
    complete: true,
    tables,
    notes: [],
    groups,
    referencesTo: new Map(),
    groupMembers: new Map(),
  }
}

type TableParts = {
  readonly path?: string
  readonly complete?: boolean
  readonly columns?: readonly Column[]
  readonly indexes?: readonly Index[]
  readonly group?: string
}

function aTable(name: string, parts: TableParts = {}): Table {
  return {
    kind: 'table',
    name,
    path: parts.path ?? `tables/${name}.md`,
    body: '',
    complete: parts.complete ?? true,
    columns: parts.columns ?? [],
    indexes: parts.indexes ?? [],
    ...(parts.group === undefined ? {} : { group: parts.group }),
  }
}

function column(
  name: string,
  parts: { readonly pk?: boolean; readonly ref?: string } = {},
): Column {
  const dot = parts.ref === undefined ? -1 : parts.ref.lastIndexOf('.')
  return {
    name,
    type: 'text',
    ...(parts.pk === undefined ? {} : { pk: parts.pk }),
    ...(parts.ref === undefined || dot < 0
      ? {}
      : { ref: { table: parts.ref.slice(0, dot), column: parts.ref.slice(dot + 1) } }),
  }
}

/** A filter that reads at the call site: `diagnostics.filter(about('code'))`. */
function about(code: string): (diagnostic: { readonly code: string }) => boolean {
  return (diagnostic) => diagnostic.code === code
}
