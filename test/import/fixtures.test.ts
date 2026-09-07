// Two files, one shaped like each engine's output, going in the front door.
//
// Nothing here tells `readIntrospection` which engine it is looking at. The file
// says so, and the registry does the rest: that is the whole claim of ADR 0007,
// and this is where it is either true or not.
//
// The assertions that matter are the ones that would be different if this
// contract had been designed from Postgres alone. They are marked.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { IntrospectionDocument, Table } from '../../src/import/contract.js'
import { createRegistry } from '../../src/import/providers/index.js'
import { readIntrospection } from '../../src/import/read.js'
import { fakePostgresProvider, fakeSqlServerProvider } from './fake-providers.js'

const registry = createRegistry([fakePostgresProvider, fakeSqlServerProvider])

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

function read(name: string): IntrospectionDocument {
  const result = readIntrospection(fixture(name), { registry })
  if (!result.ok) {
    throw new Error(`${name} did not read: ${result.diagnostics.map((d) => d.message).join('; ')}`)
  }
  expect(result.diagnostics).toEqual([])
  return result.value
}

function tableNamed(document: IntrospectionDocument, name: string): Table {
  const found = document.tables.find((t) => t.name === name)
  if (!found) throw new Error(`no table named ${name}`)
  return found
}

describe('both engines, from the envelope alone', () => {
  it('resolves each file to its own provider with nobody being told which', () => {
    expect(read('postgres-raw').engine).toBe('postgres')
    expect(read('sqlserver-raw').engine).toBe('sqlserver')
  })

  it('produces the same structure from both, differing only where the engines do', () => {
    const postgres = tableNamed(read('postgres-raw'), 'order_line')
    const sqlserver = tableNamed(read('sqlserver-raw'), 'OrderLine')

    expect(postgres.primaryKey?.columns).toEqual(['order_id', 'line_no'])
    expect(sqlserver.primaryKey?.columns).toEqual(['OrderId', 'LineNo'])

    const postgresComposite = postgres.foreignKeys.find((f) => f.columns.length === 2)
    const sqlserverComposite = sqlserver.foreignKeys.find((f) => f.columns.length === 2)
    expect(postgresComposite?.referencedColumns).toEqual(['tenant_id', 'code'])
    expect(sqlserverComposite?.referencedColumns).toEqual(['TenantId', 'Code'])
    expect(postgresComposite?.onDelete).toBe('cascade')
    expect(sqlserverComposite?.onDelete).toBe('cascade')

    // Single-column and multi-column foreign keys are the same shape.
    expect(postgres.foreignKeys.map((f) => f.columns.length).sort()).toEqual([1, 2])
    expect(sqlserver.foreignKeys.map((f) => f.columns.length).sort()).toEqual([1, 2])
  })

  it('is byte-identical however the engine happened to order its rows', () => {
    const forwards = readIntrospection(fixture('sqlserver-raw'), { registry })
    const shuffled = fixture('sqlserver-raw') as { tables: unknown[] }
    shuffled.tables.reverse()
    const backwards = readIntrospection(shuffled, { registry })
    expect(forwards.ok && backwards.ok).toBe(true)
    if (!forwards.ok || !backwards.ok) return
    expect(JSON.stringify(backwards.value)).toBe(JSON.stringify(forwards.value))
  })
})

describe('what SQL Server forced into the contract', () => {
  const sqlserver = read('sqlserver-raw')

  it('carries nvarchar length in characters, not the bytes sys.columns reports', () => {
    const code = tableNamed(sqlserver, 'Order').columns.find((c) => c.name === 'Code')
    // sys.columns says 64 for nvarchar(32).
    expect(code?.type.length).toBe(32)
    expect(code?.type.native).toBe('nvarchar')
  })

  it('has somewhere to put nvarchar(max), which reports its length as -1', () => {
    const notes = tableNamed(sqlserver, 'Order').columns.find((c) => c.name === 'Notes')
    expect(notes?.type.length).toBe('max')
  })

  it('keeps the default expression verbatim, extra parentheses and all', () => {
    const quantity = tableNamed(sqlserver, 'OrderLine').columns.find((c) => c.name === 'Quantity')
    expect(quantity?.default?.expression).toBe('((0))')
    // And the name of the constraint that holds it, which Postgres cannot give.
    expect(quantity?.default?.constraintName).toBe('DF_OrderLine_Quantity')
  })

  it('carries included columns and the clustered flag on an index', () => {
    const index = tableNamed(sqlserver, 'OrderLine').indexes[0]
    expect(index?.includedColumns).toEqual(['Quantity'])
    expect(index?.isClustered).toBe(false)
    expect(index?.columns).toEqual([{ column: 'OrderId' }, { column: 'LineNo', descending: true }])
    expect(index?.filterExpression).toBe('([Quantity]>(0))')
    expect(tableNamed(sqlserver, 'OrderLine').primaryKey?.isClustered).toBe(true)
  })

  it('treats dbo as a schema name and not as the absence of one', () => {
    expect(tableNamed(sqlserver, 'Order').schema).toBe('dbo')
    expect(tableNamed(sqlserver, 'OrderLine').schema).toBe('sales')
    // A foreign key crossing schemas needs the schema on the far side too.
    const across = tableNamed(sqlserver, 'OrderLine').foreignKeys[0]
    expect(across?.referencedSchema).toBe('dbo')
  })

  it('records a computed column that is not persisted, which Postgres cannot have', () => {
    const lineTotal = tableNamed(sqlserver, 'OrderLine').columns.find((c) => c.name === 'LineTotal')
    expect(lineTotal?.generated).toEqual({
      expression: '([Quantity]*[UnitPrice])',
      persisted: true,
    })
  })

  it('says what the database collation is rather than deciding about case itself', () => {
    expect(sqlserver.source?.defaultCollation).toBe('SQL_Latin1_General_CP1_CI_AS')
  })
})

describe('what Postgres put in that SQL Server has no answer for', () => {
  const postgres = read('postgres-raw')

  it('has a referential action SQL Server does not implement', () => {
    const byId = tableNamed(postgres, 'order_line').foreignKeys.find(
      (f) => f.name === 'order_line_order_id_fkey',
    )
    expect(byId?.onDelete).toBe('restrict')
  })

  it('keeps the native type beside the normalised one, which is the whole argument', () => {
    const placedAt = tableNamed(postgres, 'orders').columns.find((c) => c.name === 'placed_at')
    expect(placedAt?.type).toEqual({ native: 'timestamp with time zone', normalised: 'timestamp' })
    // `timestamp` is what the model switches on; the time zone survives in
    // `native`, and it would not survive anywhere else.
  })

  it('reports identity as a generation rather than as a default expression', () => {
    const id = tableNamed(postgres, 'orders').columns.find((c) => c.name === 'id')
    expect(id?.identity).toEqual({ generation: 'always' })
    expect(id?.default).toBeUndefined()
  })

  it('carries a partial index predicate in the same field as a filtered index', () => {
    expect(tableNamed(postgres, 'order_line').indexes[0]?.filterExpression).toBe('(quantity > 0)')
  })
})
