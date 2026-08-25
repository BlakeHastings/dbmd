// The canonical shape, on its own, with no engine anywhere near it.

import { describe, expect, it } from 'vitest'
import { validateIntrospectionDocument } from '../../src/import/contract.js'
import { formatDiagnostics } from '../../src/import/diagnostics.js'

const minimalColumn = {
  name: 'id',
  type: { native: 'bigint', normalised: 'integer' },
  nullable: false,
}

function document(...tables: unknown[]) {
  return { dbmdIntrospection: 1, engine: 'fake', tables }
}

function table(extra: Record<string, unknown> = {}) {
  return { schema: 'public', name: 'orders', columns: [minimalColumn], ...extra }
}

describe('validateIntrospectionDocument', () => {
  it('fills in the lists a provider left out', () => {
    const result = validateIntrospectionDocument(document(table()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [only] = result.value.tables
    expect(only?.indexes).toEqual([])
    expect(only?.foreignKeys).toEqual([])
    expect(only?.checkConstraints).toEqual([])
  })

  it('reads null and absent as the same thing, everywhere', () => {
    // SQL Server's FOR JSON omits null columns, so the same query emits a key on
    // one row and no key at all on the next.
    const withNulls = validateIntrospectionDocument(
      document(
        table({
          comment: null,
          primaryKey: null,
          indexes: null,
          columns: [{ ...minimalColumn, default: null, identity: null, collation: null }],
        }),
      ),
    )
    const withoutKeys = validateIntrospectionDocument(document(table()))
    expect(withNulls.ok).toBe(true)
    expect(withoutKeys.ok).toBe(true)
    if (!withNulls.ok || !withoutKeys.ok) return
    expect(JSON.stringify(withNulls.value)).toBe(JSON.stringify(withoutKeys.value))
  })

  it('keeps composite keys as ordered lists rather than a special case', () => {
    const result = validateIntrospectionDocument(
      document(
        table({
          primaryKey: { name: 'pk', columns: ['b', 'a'] },
          foreignKeys: [
            {
              columns: ['b', 'a'],
              referencedSchema: 'public',
              referencedTable: 'other',
              referencedColumns: ['y', 'x'],
            },
          ],
        }),
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Key order is data. Nothing sorted these.
    expect(result.value.tables[0]?.primaryKey?.columns).toEqual(['b', 'a'])
    expect(result.value.tables[0]?.foreignKeys[0]?.referencedColumns).toEqual(['y', 'x'])
  })

  it('catches a foreign key whose two column lists cannot be paired', () => {
    const result = validateIntrospectionDocument(
      document(
        table({
          foreignKeys: [
            {
              name: 'fk_orders_customer',
              columns: ['tenant_id', 'code'],
              referencedSchema: 'public',
              referencedTable: 'other',
              referencedColumns: ['code'],
            },
          ],
        }),
      ),
    )
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'error $.tables[0].foreignKeys[0] [import/mismatched-columns] this foreign key has 2 local columns and 1 referenced, and the two lists are paired by position',
    ])
  })

  it('holds a table to a schema, because a default schema is still a schema', () => {
    const result = validateIntrospectionDocument(document({ name: 'orders', columns: [] }))
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'error $.tables[0].schema [import/missing-field] `schema` is required',
    ])
  })

  it('refuses a normalised type outside the vocabulary and names the vocabulary', () => {
    const result = validateIntrospectionDocument(
      document(
        table({
          columns: [{ name: 'id', nullable: false, type: { native: 'int4', normalised: 'int' } }],
        }),
      ),
    )
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'error $.tables[0].columns[0].type.normalised [import/not-in-vocabulary] `normalised` is "int", and the contract allows only string, boolean, integer, decimal, float, date, time, timestamp, interval, uuid, binary, json, xml, other',
    ])
  })

  it('accepts the SQL Server max sentinel and rejects the raw -1 that produced it', () => {
    const ok = validateIntrospectionDocument(
      document(
        table({
          columns: [
            {
              name: 'notes',
              nullable: true,
              type: { native: 'nvarchar', normalised: 'string', length: 'max' },
            },
          ],
        }),
      ),
    )
    expect(ok.ok).toBe(true)

    const raw = validateIntrospectionDocument(
      document(
        table({
          columns: [
            {
              name: 'notes',
              nullable: true,
              type: { native: 'nvarchar', normalised: 'string', length: -1 },
            },
          ],
        }),
      ),
    )
    expect(raw.ok).toBe(false)
    expect(formatDiagnostics(raw.diagnostics)).toEqual([
      'error $.tables[0].columns[0].type.length [import/wrong-type] `length` must be a non-negative whole number or the string "max", got -1; SQL Server reports -1 for the max forms and a provider translates that here',
    ])
  })

  it('warns about a field it does not read rather than failing on it', () => {
    const result = validateIntrospectionDocument(document(table({ rowCount: 12 })))
    expect(result.ok).toBe(true)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'warning $.tables[0].rowCount [import/unknown-field] nothing in introspection version 1 reads `rowCount`, so it was dropped',
    ])
  })

  it("compares names byte for byte, taking no view on either engine's case rules", () => {
    const clash = validateIntrospectionDocument(document(table(), table()))
    expect(clash.ok).toBe(false)
    expect(formatDiagnostics(clash.diagnostics)).toEqual([
      'error $.tables [import/duplicate] two tables are both named `public.orders`',
    ])

    // Postgres could not hold these two and SQL Server usually could not either,
    // but that is a fact about a collation and not about this contract.
    const cased = validateIntrospectionDocument(document(table(), table({ name: 'Orders' })))
    expect(cased.ok).toBe(true)
  })

  it('sorts everything whose order is not data, and nothing whose order is', () => {
    const shuffled = document(
      table({
        name: 'zebra',
        columns: [
          { ...minimalColumn, name: 'b' },
          { ...minimalColumn, name: 'a' },
        ],
        indexes: [
          { name: 'ix_b', columns: [{ name: 'b' }], isUnique: false },
          { name: 'ix_a', columns: [{ name: 'a' }], isUnique: false },
        ],
      }),
      table({ name: 'apple' }),
    )
    const result = validateIntrospectionDocument(shuffled)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tables.map((t) => t.name)).toEqual(['apple', 'zebra'])
    expect(result.value.tables[1]?.indexes.map((i) => i.name)).toEqual(['ix_a', 'ix_b'])
    // Column order came from the catalog and is left alone.
    expect(result.value.tables[1]?.columns.map((c) => c.name)).toEqual(['b', 'a'])
  })
})
