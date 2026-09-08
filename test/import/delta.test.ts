/**
 * The delta a re-import computes, which is the whole of what dbmd-42 decides.
 *
 * Every case here is a function of two models, so none of it touches a
 * filesystem: `deltaOf` is deliberately pure for exactly this reason, and what
 * the CLI does with the answer is `test/cli/import.test.ts`'s.
 *
 * Two claims run through the file and are worth naming, because both fail
 * silently rather than loudly if they break:
 *
 * - **`write` is the file list and nothing else.** Every assertion about what a
 *   re-import leaves alone is an assertion about that set, because it is what
 *   `writeModel`'s `only` is given. A path in it that no item justifies is a
 *   file that gets rewritten for no reason a user was shown.
 * - **A body is carried, never rebuilt.** The merged table's `body` is compared
 *   with `toBe` against the one that went in, so an accidental round trip
 *   through a template would fail even if it produced the same words.
 */

import { describe, expect, test } from 'vitest'
import { deltaOf } from '../../src/import/delta.js'
import type { Column, Index, Layout, Model, Note, Table } from '../../src/model/types.js'

// --------------------------------------------------------------------------
// Two models, built by hand, so a case is about one thing
// --------------------------------------------------------------------------

function column(name: string, type: string, extra: Partial<Column> = {}): Column {
  return { name, type, nullable: true, ...extra }
}

function table(
  name: string,
  columns: readonly Column[],
  extra: { body?: string; layout?: Layout; group?: string; indexes?: readonly Index[] } = {},
): Table {
  return {
    kind: 'table',
    name,
    path: `tables/${name}.md`,
    complete: true,
    columns,
    indexes: extra.indexes ?? [],
    body: extra.body ?? `\nImported from \`public.${name}\`.\n`,
    ...(extra.layout === undefined ? {} : { layout: extra.layout }),
    ...(extra.group === undefined ? {} : { group: extra.group }),
  }
}

function model(
  tables: readonly Table[],
  extra: { body?: string; engine?: string; name?: string; notes?: readonly Note[] } = {},
): Model {
  return {
    ...(extra.name === undefined ? {} : { name: extra.name }),
    engine: extra.engine ?? 'postgres',
    body: extra.body ?? '\nA model.\n',
    complete: true,
    tables,
    notes: extra.notes ?? [],
    groups: [],
    referencesTo: new Map(),
    groupMembers: new Map(),
    refused: [],
  }
}

/** The headlines, in order, which is what a person actually reads off the list. */
function headlines(items: readonly { headline: string }[]): string[] {
  return items.map((item) => item.headline)
}

/** Every sentence in the list as one run of words, so a rewrap is not a red build. */
function said(items: readonly { detail: readonly string[] }[]): string {
  return items
    .flatMap((item) => item.detail)
    .join(' ')
    .replace(/\s+/g, ' ')
}

const ORDERS = table('orders', [
  column('id', 'bigint', { pk: true, nullable: false }),
  column('total', 'numeric(12,2)', { nullable: false }),
])

// --------------------------------------------------------------------------

describe('nothing changed', () => {
  test('is an empty list, an empty write set, and the model back unaltered', () => {
    const before = model([ORDERS])
    const delta = deltaOf(before, model([ORDERS]))

    expect(delta.items).toEqual([])
    expect([...delta.write]).toEqual([])
    expect(delta.remove).toEqual([])
    // The same object, not an equal one: a re-import of an unchanged database
    // must not be able to produce different bytes by rebuilding a table.
    expect(delta.model.tables[0]).toBe(before.tables[0])
  })

  test('a column the database reports in a different order is not a change', () => {
    const reordered = table('orders', [...ORDERS.columns].reverse())
    const delta = deltaOf(model([ORDERS]), model([reordered]))

    // Order is not a fact this format claims to hold, and taking the
    // catalogue's would rewrite whole `columns:` blocks for a schema that had
    // not moved. ADR 0050.
    expect(delta.items).toEqual([])
    expect([...delta.write]).toEqual([])
  })
})

describe('a table in the model that is not in the database', () => {
  const legacy = table('legacy_audit', [column('id', 'bigint')], {
    body: '\nWhat the auditors asked for in 2019.\n',
  })

  test("is proposed for removal in the owner's own words, and its file is deleted", () => {
    const delta = deltaOf(model([ORDERS, legacy]), model([ORDERS]))

    expect(headlines(delta.items)).toEqual(['database table removed'])
    expect(delta.remove).toEqual(['tables/legacy_audit.md'])
    // Not written: a delete is not a write, and putting the path in `only`
    // would have `writeModel` recreate the file this is about to remove.
    expect([...delta.write]).toEqual([])
    expect(delta.model.tables.map((t) => t.name)).toEqual(['orders'])
  })

  test('says what happens to the prose in it, so the cost is on the list', () => {
    const delta = deltaOf(model([ORDERS, legacy]), model([ORDERS]))
    expect(said(delta.items)).toContain('Its prose goes with it')
  })

  test('names the bodies that will then mention a table that is not there', () => {
    const before = model([ORDERS, legacy], {
      body: '\nThe `legacy_audit` table is kept for the auditors.\n',
    })
    const delta = deltaOf(before, model([ORDERS]))

    const sentence = said(delta.items)
    expect(sentence).toContain('1 mention of `legacy_audit` in backticks')
    expect(sentence).toContain('_model.md')
    // And it is a sentence rather than an edit: `_model.md` is not written.
    expect([...delta.write]).toEqual([])
    expect(delta.model.body).toBe(before.body)
  })

  test('says why a table nobody dropped might be on the list', () => {
    const delta = deltaOf(model([ORDERS, legacy]), model([ORDERS]))
    expect(said(delta.items)).toContain('fewer schemas than the last one')
  })
})

describe('a column whose type changed', () => {
  test('proposes the database type and nothing else about the column', () => {
    const widened = table('orders', [
      column('id', 'bigint', { pk: true, nullable: false }),
      column('total', 'numeric(14,4)', { nullable: false }),
    ])
    const delta = deltaOf(model([ORDERS]), model([widened]))

    expect(headlines(delta.items)).toEqual(['database column changed'])
    expect(said(delta.items)).toContain(
      '`orders.total`: type `numeric(12,2)` in the file and `numeric(14,4)` in the database',
    )
    expect([...delta.write]).toEqual(['tables/orders.md'])
    expect(delta.model.tables[0]?.columns[1]?.type).toBe('numeric(14,4)')
    // The column kept its place, and the table kept everything a database has
    // no opinion about.
    expect(delta.model.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'total'])
  })

  test('a `ref:` the database no longer reports is itemised as the column changing', () => {
    const referring = table('orders', [
      column('id', 'bigint', { pk: true, nullable: false }),
      column('total', 'numeric(12,2)', {
        nullable: false,
        ref: { table: 'tenants', column: 'id', onDelete: 'cascade' },
      }),
    ])
    const delta = deltaOf(model([referring]), model([ORDERS]))

    expect(headlines(delta.items)).toEqual(['database column changed'])
    expect(said(delta.items)).toContain('ref `tenants.id, on delete cascade` in the file')
    expect(delta.model.tables[0]?.columns[1]?.ref).toBeUndefined()
  })
})

describe('a column removed from the database while prose still mentions it', () => {
  const documented = table(
    'orders',
    [column('id', 'bigint', { pk: true, nullable: false }), column('note', 'text')],
    {
      body:
        '\nOne row per order. `note` is what the picker typed, and nothing reads it\n' +
        'but a person.\n',
    },
  )

  test('proposes removing the column and leaves the paragraph exactly as written', () => {
    const delta = deltaOf(
      model([documented]),
      model([table('orders', [column('id', 'bigint', { pk: true, nullable: false })])]),
    )

    expect(headlines(delta.items)).toEqual(['database column removed'])
    expect(delta.model.tables[0]?.columns.map((c) => c.name)).toEqual(['id'])
    // Byte for byte, and `toBe` rather than `toEqual` so a rebuild that
    // happened to produce the same words would still fail.
    expect(delta.model.tables[0]?.body).toBe(documented.body)
  })

  test('says in the list that the prose will name a column that is not there', () => {
    const delta = deltaOf(
      model([documented]),
      model([table('orders', [column('id', 'bigint', { pk: true, nullable: false })])]),
    )

    const sentence = said(delta.items)
    expect(sentence).toContain('1 mention of it in backticks')
    expect(sentence).toContain('tables/orders.md')
    expect(sentence).toContain('the prose will name a column that is not there')
  })

  test('a bare span counts only inside the table it is about', () => {
    const elsewhere = table('tenants', [column('id', 'bigint')], {
      body: '\nA tenant. Nothing here has a `note`, in the English sense.\n',
    })
    const delta = deltaOf(
      model([documented, elsewhere]),
      model([
        table('orders', [column('id', 'bigint', { pk: true, nullable: false })]),
        table('tenants', [column('id', 'bigint')]),
      ]),
    )

    // ADR 0044's rule one level down: `note` is a claim about this table inside
    // this table's file and an English word anywhere else. `tenants.md` is not
    // named, and nothing about `tenants` is written.
    expect(said(delta.items)).not.toContain('tables/tenants.md')
    expect([...delta.write]).toEqual(['tables/orders.md'])
  })

  test('a qualified span counts in any body at all', () => {
    const note: Note = {
      kind: 'note',
      name: 'picking',
      path: 'notes/picking.md',
      complete: true,
      body: '\nThe warehouse reads `orders.note` off the pick list.\n',
    }
    const delta = deltaOf(
      model([documented], { notes: [note] }),
      model([table('orders', [column('id', 'bigint', { pk: true, nullable: false })])]),
    )

    expect(said(delta.items)).toContain('notes/picking.md')
    // Named, and not written. A note is prose and an import has no opinion.
    expect([...delta.write]).toEqual(['tables/orders.md'])
  })

  test('a column nothing mentions gets no sentence about prose', () => {
    const quiet = table('orders', [
      column('id', 'bigint', { pk: true, nullable: false }),
      column('spare', 'text'),
    ])
    const delta = deltaOf(
      model([quiet]),
      model([table('orders', [column('id', 'bigint', { pk: true, nullable: false })])]),
    )

    expect(said(delta.items)).not.toContain('mention')
  })
})

describe('what a re-import never touches', () => {
  test('a table nothing was said about is not in the write set', () => {
    const untouched = table('tenants', [column('id', 'bigint')], {
      body: '\nA paragraph somebody wrote this morning.\n',
      layout: { x: 900, y: 40 },
      group: 'billing',
    })
    const changed = table('orders', [
      column('id', 'bigint', { pk: true, nullable: false }),
      column('total', 'numeric(14,4)', { nullable: false }),
    ])

    const delta = deltaOf(
      model([ORDERS, untouched]),
      model([changed, table('tenants', [column('id', 'bigint')])]),
    )

    expect([...delta.write]).toEqual(['tables/orders.md'])
    expect(delta.model.tables.find((t) => t.name === 'tenants')).toBe(untouched)
  })

  test('the layout and the group on a table that did change survive it', () => {
    const placed = table('orders', ORDERS.columns, {
      layout: { x: 1180, y: 620 },
      group: 'billing',
      body: '\nOne row per placed order.\n',
    })
    const delta = deltaOf(
      model([placed]),
      model([
        table('orders', [
          column('id', 'bigint', { pk: true, nullable: false }),
          column('total', 'numeric(14,4)', { nullable: false }),
        ]),
      ]),
    )

    const merged = delta.model.tables[0]
    expect(merged?.layout).toEqual({ x: 1180, y: 620 })
    expect(merged?.group).toBe('billing')
    expect(merged?.body).toBe(placed.body)
  })

  test('the prose in `_model.md` survives a change to the facts above it', () => {
    const before = model([ORDERS], { engine: 'postgres', body: '\nWhat this is for.\n' })
    const delta = deltaOf(before, model([ORDERS], { engine: 'sqlserver' }))

    expect(headlines(delta.items)).toEqual(['database facts changed'])
    expect([...delta.write]).toEqual(['_model.md'])
    expect(delta.model.engine).toBe('sqlserver')
    expect(delta.model.body).toBe(before.body)
  })

  test('a fact the import does not carry is not a proposal to delete one', () => {
    const before = model([ORDERS], { name: 'shop' })
    const delta = deltaOf(before, model([ORDERS]))

    // `name` comes from the database's own name, which not every client puts in
    // the export. Absent means "this export did not say".
    expect(delta.items).toEqual([])
    expect(delta.model.name).toBe('shop')
  })
})

describe('a table the model has never seen', () => {
  test('lands below everything already placed, and moves nothing that is', () => {
    const placed = table('orders', ORDERS.columns, { layout: { x: 40, y: 300 } })
    const note: Note = {
      kind: 'note',
      name: 'why',
      path: 'notes/why.md',
      complete: true,
      body: '\nA note.\n',
      layout: { x: 40, y: 620 },
    }

    const delta = deltaOf(
      model([placed], { notes: [note] }),
      model([table('orders', ORDERS.columns), table('shipments', [column('id', 'bigint')])]),
    )

    expect(headlines(delta.items)).toEqual(['database table added'])
    expect(delta.model.tables.find((t) => t.name === 'orders')?.layout).toEqual({ x: 40, y: 300 })
    // The note is the lowest thing on the canvas, so the new row starts under it.
    expect(delta.model.tables.find((t) => t.name === 'shipments')?.layout).toEqual({
      x: 40,
      y: 880,
    })
  })

  test('the same input gives the same coordinates', () => {
    const before = model([table('orders', ORDERS.columns, { layout: { x: 40, y: 40 } })])
    const after = model([
      table('orders', ORDERS.columns),
      table('a', [column('id', 'bigint')]),
      table('b', [column('id', 'bigint')]),
    ])

    const once = deltaOf(before, after)
    const twice = deltaOf(before, after)
    expect(twice.model.tables.map((t) => t.layout)).toEqual(once.model.tables.map((t) => t.layout))
    // Two arrivals in one row of the grid, at the pitch an import already uses.
    expect(once.model.tables.find((t) => t.name === 'a')?.layout).toEqual({ x: 40, y: 300 })
    expect(once.model.tables.find((t) => t.name === 'b')?.layout).toEqual({ x: 340, y: 300 })
  })

  test('a block of arrivals is as wide as the block is, and nobody dragged moves', () => {
    // Somebody has arranged these four by hand, nowhere near the grid, and one
    // of them is far to the right, which is the case that decides where the new
    // row starts. ADR 0075: the width the arrivals get is worked out from the
    // arrivals, because the tables already on the canvas are not being laid out.
    const arranged = [
      table('orders', ORDERS.columns, { layout: { x: 1700, y: 90 } }),
      table('customers', [column('id', 'bigint')], { layout: { x: 15, y: 640 } }),
      table('products', [column('id', 'bigint')], { layout: { x: 980, y: 205 } }),
      table('suppliers', [column('id', 'bigint')], { layout: { x: 620, y: 1120 } }),
    ]
    const arriving = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
      table(name, [column('id', 'bigint')]),
    )

    const delta = deltaOf(
      model(arranged),
      model([...arranged.map((t) => table(t.name, t.columns)), ...arriving]),
    )

    // Every hand-placed table is exactly where it was, to the pixel.
    for (const before of arranged) {
      expect(delta.model.tables.find((t) => t.name === before.name)?.layout).toEqual(before.layout)
    }
    // And the six new ones are three wide and two deep, starting one row pitch
    // under the lowest thing already placed, which is `suppliers` at 1120.
    const landed = arriving.map((t) => delta.model.tables.find((x) => x.name === t.name)?.layout)
    expect(landed).toEqual([
      { x: 40, y: 1380 },
      { x: 340, y: 1380 },
      { x: 640, y: 1380 },
      { x: 40, y: 1640 },
      { x: 340, y: 1640 },
      { x: 640, y: 1640 },
    ])
    // Nothing was written for a table that only sat still.
    expect([...delta.write].sort()).toEqual(arriving.map((t) => t.path).sort())
  })
})

describe('indexes', () => {
  const withIndex = table('orders', ORDERS.columns, {
    indexes: [{ name: 'orders_total_idx', columns: ['total'] }],
  })

  test('one the database no longer has is itemised and removed', () => {
    const delta = deltaOf(model([withIndex]), model([table('orders', ORDERS.columns)]))
    expect(headlines(delta.items)).toEqual(['database index removed'])
    expect(delta.model.tables[0]?.indexes).toEqual([])
  })

  test('one whose columns moved says both sides', () => {
    const changed = table('orders', ORDERS.columns, {
      indexes: [{ name: 'orders_total_idx', columns: ['id', 'total'], unique: true }],
    })
    const delta = deltaOf(model([withIndex]), model([changed]))

    expect(headlines(delta.items)).toEqual(['database index changed'])
    expect(said(delta.items)).toContain(
      '(total) in the file and unique (id, total) in the database',
    )
  })
})

describe('a rename is a drop and an add', () => {
  test('and is never guessed at, because a catalogue reports names and nothing else', () => {
    const delta = deltaOf(
      model([table('subscriptions', [column('id', 'bigint')])]),
      model([table('plans', [column('id', 'bigint')])]),
    )

    // Two items, deliberately. Matching `subscriptions` to `plans` because the
    // columns agree would delete a body the day the guess was wrong, and there
    // is nothing in an introspection document that could make it right.
    expect(headlines(delta.items).sort()).toEqual([
      'database table added',
      'database table removed',
    ])
  })
})
