/**
 * A canonical introspection document as a model.
 *
 * Two kinds of assertion here, and the second is the one worth keeping. The
 * first is what a table becomes: the type spelling, the prose, the grid, and the
 * three things that get a diagnostic rather than a silently wrong file. The
 * second is the round trip: this model, written and read back, is the same
 * model. That is ADR 0012's property applied to the importer, and it is what
 * stops the two computed indexes in `modelFromIntrospection` and `readModel`
 * drifting apart without anybody noticing.
 */

import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { IntrospectionDocument, Table as CatalogTable } from '../../src/import/contract.js'
import { modelFromIntrospection, typeText } from '../../src/import/model.js'
import { readIntrospection } from '../../src/import/read.js'
import { readModel } from '../../src/model/read.js'
import type { Table } from '../../src/model/types.js'
import { validate } from '../../src/model/validate.js'
import { writeModel } from '../../src/model/write.js'

const temporaries: string[] = []

afterEach(async () => {
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-import-'))
  temporaries.push(dir)
  return dir
}

function fixture(name: string): IntrospectionDocument {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  )
  const read = readIntrospection(raw)
  if (!read.ok) throw new Error(`${name}: ${read.diagnostics.map((d) => d.message).join('; ')}`)
  return read.value
}

/** A document with exactly the tables given, and nothing else to distract from them. */
function document(tables: readonly Partial<CatalogTable>[]): IntrospectionDocument {
  return {
    dbmdIntrospection: 1,
    engine: 'postgres',
    tables: tables.map((table) => ({
      schema: 'public',
      name: 'thing',
      columns: [],
      indexes: [],
      foreignKeys: [],
      checkConstraints: [],
      ...table,
    })),
  }
}

function tableNamed(tables: readonly Table[], name: string): Table {
  const found = tables.find((table) => table.name === name)
  if (!found) throw new Error(`no table named ${name}`)
  return found
}

describe('a column type is the engine name with its modifier put back on', () => {
  test('the modifier the contract keeps beside `native` goes back on the end', () => {
    expect(typeText({ native: 'character varying', normalised: 'string', length: 32 })).toBe(
      'character varying(32)',
    )
    expect(typeText({ native: 'nvarchar', normalised: 'string', length: 'max' })).toBe(
      'nvarchar(max)',
    )
    expect(typeText({ native: 'numeric', normalised: 'decimal', precision: 12, scale: 2 })).toBe(
      'numeric(12,2)',
    )
    expect(typeText({ native: 'datetime2', normalised: 'timestamp', scale: 3 })).toBe(
      'datetime2(3)',
    )
    expect(typeText({ native: 'text', normalised: 'string' })).toBe('text')
  })

  test('nothing is normalised away, because `string` is not a type any engine has', () => {
    const model = modelFromIntrospection(fixture('postgres-provider-raw')).model
    const types = tableNamed(model.tables, 'Order').columns.map((column) => column.type)
    expect(types).toEqual([
      'integer',
      'character varying(32)',
      // A Postgres enum normalises to `other` and would have lost its name.
      'order_state',
      'timestamp with time zone(3)',
      'numeric(12,2)',
    ])
  })
})

describe('the prose body', () => {
  test('is one line, and it is a prompt rather than a description', () => {
    const model = modelFromIntrospection(document([{ schema: 'public', name: 'orders' }])).model
    expect(tableNamed(model.tables, 'orders').body).toBe(
      '\nImported from `public.orders`, and nobody has written down what it is for yet.\n',
    )
  })

  test('carries a table comment, because those are words a person wrote', () => {
    const model = modelFromIntrospection(
      document([{ name: 'orders', comment: 'One row per placed order.' }]),
    ).model
    expect(tableNamed(model.tables, 'orders').body).toBe(
      '\nOne row per placed order.\n\nImported from `public.orders`.\n',
    )
  })

  test('keeps the schema, which is the one place that fact survives a flat directory', () => {
    const model = modelFromIntrospection(document([{ schema: 'sales', name: 'orders' }])).model
    expect(tableNamed(model.tables, 'orders').body).toContain('`sales.orders`')
  })
})

describe('the layout is a grid and never an opinion', () => {
  test('is the same coordinates whatever order the catalogue returned its rows in', () => {
    const forwards = modelFromIntrospection(fixture('postgres-provider-raw')).model
    const reversed = fixture('postgres-provider-raw')
    const backwards = modelFromIntrospection({
      ...reversed,
      tables: [...reversed.tables].reverse(),
    }).model

    expect(backwards.tables.map((t) => `${t.name} ${t.layout?.x},${t.layout?.y}`)).toEqual(
      forwards.tables.map((t) => `${t.name} ${t.layout?.x},${t.layout?.y}`),
    )
    expect(forwards.tables.map((t) => t.layout)).toEqual([
      { x: 40, y: 40 },
      { x: 340, y: 40 },
      { x: 640, y: 40 },
      { x: 940, y: 40 },
    ])
  })

  test('wraps at five and starts a second row rather than running off the canvas', () => {
    const many = document(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name })))
    const model = modelFromIntrospection(many).model
    expect(model.tables.map((table) => table.layout)).toEqual([
      { x: 40, y: 40 },
      { x: 340, y: 40 },
      { x: 640, y: 40 },
      { x: 940, y: 40 },
      { x: 1240, y: 40 },
      { x: 40, y: 300 },
    ])
  })
})

describe('a foreign key becomes a ref, or a diagnostic saying why it did not', () => {
  test('a composite key becomes one ref per column pair, paired by position', () => {
    const model = modelFromIntrospection(fixture('postgres-provider-raw')).model
    const line = tableNamed(model.tables, 'order_line')
    expect(
      line.columns
        .filter((c) => c.ref !== undefined)
        .map((c) => `${c.name} -> ${c.ref?.table}.${c.ref?.column}`),
    ).toEqual(['tenant_id -> Order.TenantId', 'order_code -> Order.Code'])
  })

  test('a table the file does not contain is a warning and no ref at all', () => {
    const { model, diagnostics } = modelFromIntrospection(
      document([
        {
          name: 'orders',
          columns: [
            {
              name: 'customer_id',
              type: { native: 'uuid', normalised: 'uuid' },
              nullable: false,
            },
          ],
          foreignKeys: [
            {
              name: 'orders_customer_id_fkey',
              columns: ['customer_id'],
              referencedSchema: 'public',
              referencedTable: 'customers',
              referencedColumns: ['id'],
            },
          ],
        },
      ]),
    )

    // The point of the whole case: no dangling ref went to disk for `dbmd
    // check` to find later.
    expect(tableNamed(model.tables, 'orders').columns[0]?.ref).toBeUndefined()
    expect(diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual([
      'warning import/reference-not-exported',
    ])
    expect(diagnostics[0]?.message).toContain('`public.customers`')
    expect(diagnostics[0]?.at).toEqual({ in: 'document', jsonPath: '$.tables[0].foreignKeys[0]' })
  })

  test('a table of the same name in another schema is not the table being pointed at', () => {
    const { diagnostics } = modelFromIntrospection(
      document([
        { schema: 'archive', name: 'customers' },
        {
          schema: 'public',
          name: 'orders',
          foreignKeys: [
            {
              columns: ['customer_id'],
              referencedSchema: 'public',
              referencedTable: 'customers',
              referencedColumns: ['id'],
            },
          ],
        },
      ]),
    )
    expect(diagnostics.map((d) => d.code)).toEqual(['import/reference-not-exported'])
  })
})

describe('two tables that would be one file', () => {
  test('are an error naming both, and only the first is written', () => {
    const { model, diagnostics } = modelFromIntrospection(
      document([
        { schema: 'dbo', name: 'Order' },
        { schema: 'sales', name: 'Order' },
      ]),
    )

    expect(model.tables.map((table) => table.name)).toEqual(['Order'])
    expect(diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual([
      'error import/name-collision',
    ])
    expect(diagnostics[0]?.message).toContain('`sales.Order`')
    expect(diagnostics[0]?.message).toContain('`dbo.Order`')
  })
})

describe('what an import writes is what the reader reads back', () => {
  test.each(['postgres-provider-raw', 'sqlserver-provider-raw'])(
    '%s survives being written and read again, unchanged',
    async (name) => {
      const dir = await directory()
      const built = modelFromIntrospection(fixture(name))
      expect(built.diagnostics).toEqual([])

      const first = await writeModel(dir, built.model)
      expect(first.skipped).toEqual([])

      const { model, diagnostics } = await readModel(dir)
      // Every file the reader could produce a diagnostic about, and it did not,
      // which is what "canonical by construction" means (ADR 0012).
      expect(diagnostics).toEqual([])
      expect(model).toEqual(built.model)

      // And writing the model a second time touches nothing, which is the
      // byte-level half of the same claim.
      const again = await writeModel(dir, built.model)
      expect(again.written).toEqual([])
    },
  )

  test.each(['postgres-provider-raw', 'sqlserver-provider-raw'])(
    '%s validates with no errors, only opinions about the database itself',
    async (name) => {
      const dir = await directory()
      await writeModel(dir, modelFromIntrospection(fixture(name)).model)
      const { model } = await readModel(dir)
      expect(validate(model).filter((d) => d.severity === 'error')).toEqual([])
    },
  )
})
