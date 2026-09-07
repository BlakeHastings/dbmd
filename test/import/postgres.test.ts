// The real Postgres provider, over two fixtures that are real query output.
//
// `postgres-raw.json` is the cross-engine fixture dbmd-40 committed: the same
// logical schema as `sqlserver-raw.json`, so the two can be compared. It is now
// what the query in `src/import/providers/postgres.ts` actually printed for that
// schema rather than a hand-written guess at it.
//
// `postgres-provider-raw.json` is this provider's own, and exists because the
// cross-engine one deliberately holds only what both engines can say. The
// branches Postgres has and SQL Server has no counterpart for are here: a
// quoted mixed-case schema and table, identity against `serial`, an enum, an
// array, an expression index and a partitioned table.
//
// Both were produced by pasting `postgresProvider.introspectionQuery()` into
// psql against PostgreSQL 16.15 and pretty-printing the single result value.
// ADR 0007 is clear about what that does and does not prove: these files prove
// `parse`, and only a real database proves the SQL.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { IntrospectionDocument, Table } from '../../src/import/contract.js'
import { INTROSPECTION_VERSION } from '../../src/import/contract.js'
import { registry } from '../../src/import/providers/index.js'
import { postgresProvider } from '../../src/import/providers/postgres.js'
import type { Diagnostic } from '../../src/import/diagnostics.js'
import { readIntrospection } from '../../src/import/read.js'

/**
 * Where an import diagnostic points, asserted rather than assumed: every
 * diagnostic this module raises points into the document, never at a file.
 */
function jsonPath(diagnostic: Diagnostic | undefined): string {
  if (diagnostic?.at.in !== 'document') throw new Error('not a document location')
  return diagnostic.at.jsonPath
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

/** Through the front door, so the registry and the contract validator run too. */
function read(name: string): IntrospectionDocument {
  const result = readIntrospection(fixture(name))
  if (!result.ok) {
    throw new Error(`${name} did not read: ${result.diagnostics.map((d) => d.message).join('; ')}`)
  }
  expect(result.diagnostics).toEqual([])
  return result.value
}

function tableNamed(document: IntrospectionDocument, schema: string, name: string): Table {
  const found = document.tables.find((t) => t.schema === schema && t.name === name)
  if (!found) throw new Error(`no table ${schema}.${name}`)
  return found
}

describe('the registry', () => {
  it('resolves a Postgres file without anybody naming the engine', () => {
    expect(registry.ids).toContain('postgres')
    expect(read('postgres-raw').engine).toBe('postgres')
    expect(read('postgres-provider-raw').engine).toBe('postgres')
  })
})

describe('the query', () => {
  // These are cheap guards on the property the whole design leans on, which is
  // that a person can satisfy themselves by reading the query that it cannot
  // write. They fail the moment somebody adds a statement that could.
  const sql = postgresProvider.introspectionQuery()
  const withoutComments = sql
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n')

  it('is one statement, so it pastes into any client', () => {
    expect(withoutComments.match(/;/g)).toHaveLength(1)
    expect(withoutComments.trimEnd().endsWith(';')).toBe(true)
    // A psql meta-command would make it psql-only.
    expect(withoutComments).not.toMatch(/^\s*\\/m)
  })

  it('contains nothing that could write', () => {
    for (const keyword of [
      'insert',
      'update',
      'delete',
      'merge',
      'create',
      'alter',
      'drop',
      'truncate',
      'copy',
      'grant',
      'revoke',
      'set',
    ]) {
      expect(withoutComments).not.toMatch(new RegExp(`\\b${keyword}\\b`, 'i'))
    }
  })

  it('reads only the catalog, and excludes the catalog schemas from the answer', () => {
    // Every relation it names is schema-qualified into pg_catalog, so it cannot
    // reach a row of user data. The two set-returning functions expand a catalog
    // array into rows and read nothing themselves.
    const generators = ['generate_series', 'generate_subscripts']
    const referenced = [...withoutComments.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/g)]
      .map((match) => match[1] ?? '')
      .filter((name) => !generators.includes(name))
    expect(referenced.length).toBeGreaterThan(0)
    for (const name of referenced) expect(name.startsWith('pg_catalog.')).toBe(true)

    expect(withoutComments).toContain("n.nspname <> 'information_schema'")
    expect(withoutComments).toContain("n.nspname !~ '^pg_'")
  })

  it('writes the version this build reads, so the two cannot drift', () => {
    expect(withoutComments).toContain(`'dbmdIntrospection', ${INTROSPECTION_VERSION}`)
  })
})

describe('normaliseType', () => {
  it('maps the format_type spelling, not the internal one', () => {
    // format_type prints the SQL standard name, so that is what the map is keyed
    // on. `varchar` is what pg_type calls it and is not what arrives here.
    expect(postgresProvider.normaliseType('character varying')).toBe('string')
    expect(postgresProvider.normaliseType('timestamp with time zone')).toBe('timestamp')
    expect(postgresProvider.normaliseType('timestamp without time zone')).toBe('timestamp')
    expect(postgresProvider.normaliseType('double precision')).toBe('float')
    expect(postgresProvider.normaliseType('bigint')).toBe('integer')
    expect(postgresProvider.normaliseType('numeric')).toBe('decimal')
    expect(postgresProvider.normaliseType('bytea')).toBe('binary')
    expect(postgresProvider.normaliseType('jsonb')).toBe('json')
    expect(postgresProvider.normaliseType('interval')).toBe('interval')
  })

  it('says other rather than guessing, and lets native speak', () => {
    // An enum, an array, a domain and a PostGIS type all land here. ADR 0009.
    expect(postgresProvider.normaliseType('order_state')).toBe('other')
    expect(postgresProvider.normaliseType('text[]')).toBe('other')
    expect(postgresProvider.normaliseType('inet')).toBe('other')
    expect(postgresProvider.normaliseType('')).toBe('other')
  })
})

describe('quoteIdentifier', () => {
  it('doubles the quote character Postgres uses', () => {
    expect(postgresProvider.quoteIdentifier('orders')).toBe('"orders"')
    expect(postgresProvider.quoteIdentifier('Orders')).toBe('"Orders"')
    expect(postgresProvider.quoteIdentifier('we"ird')).toBe('"we""ird"')
  })
})

describe('parse, over the cross-engine fixture', () => {
  const document = read('postgres-raw')

  it('keeps the native type beside the normalised one', () => {
    const placedAt = tableNamed(document, 'public', 'orders').columns.find(
      (c) => c.name === 'placed_at',
    )
    expect(placedAt?.type).toEqual({ native: 'timestamp with time zone', normalised: 'timestamp' })
  })

  it('carries the modifier in length, precision and scale and not in the type name', () => {
    const columns = tableNamed(document, 'public', 'order_line').columns
    expect(columns.find((c) => c.name === 'order_code')?.type).toEqual({
      native: 'character varying',
      normalised: 'string',
      length: 32,
    })
    expect(columns.find((c) => c.name === 'unit_price')?.type).toEqual({
      native: 'numeric',
      normalised: 'decimal',
      precision: 12,
      scale: 2,
    })
  })

  it('drops the precision Postgres invents for the integers', () => {
    const id = tableNamed(document, 'public', 'orders').columns.find((c) => c.name === 'id')
    // information_schema would say precision 64 here. It is true and useless, and
    // the query never asks for it.
    expect(id?.type).toEqual({ native: 'bigint', normalised: 'integer' })
  })

  it('reads a composite primary key and a multi-column foreign key as ordinary', () => {
    const orderLine = tableNamed(document, 'public', 'order_line')
    expect(orderLine.primaryKey).toEqual({
      name: 'order_line_pkey',
      columns: ['order_id', 'line_no'],
    })
    const composite = orderLine.foreignKeys.find((f) => f.columns.length === 2)
    expect(composite).toEqual({
      name: 'order_line_tenant_id_order_code_fkey',
      columns: ['tenant_id', 'order_code'],
      referencedSchema: 'public',
      referencedTable: 'orders',
      referencedColumns: ['tenant_id', 'code'],
      onDelete: 'cascade',
      onUpdate: 'noAction',
    })
  })

  it('translates the single-character referential actions', () => {
    const byId = tableNamed(document, 'public', 'order_line').foreignKeys.find(
      (f) => f.name === 'order_line_order_id_fkey',
    )
    expect(byId?.onDelete).toBe('restrict')
    expect(byId?.onUpdate).toBe('noAction')
  })

  it('carries a partial index predicate, its included column and its direction', () => {
    expect(tableNamed(document, 'public', 'order_line').indexes).toEqual([
      {
        name: 'order_line_open_idx',
        columns: [{ name: 'order_id' }, { name: 'line_no', descending: true }],
        includedColumns: ['quantity'],
        isUnique: false,
        filterExpression: '(quantity > 0)',
      },
    ])
  })

  it('does not repeat the primary key index, and marks the one a constraint owns', () => {
    const orders = tableNamed(document, 'public', 'orders')
    expect(orders.indexes.map((i) => i.name)).toEqual(['orders_tenant_id_code_key'])
    expect(orders.indexes[0]?.isUniqueConstraint).toBe(true)
    expect(orders.indexes[0]?.isUnique).toBe(true)
  })

  it('keeps a check constraint and a default expression verbatim', () => {
    expect(tableNamed(document, 'public', 'orders').checkConstraints).toEqual([
      { name: 'orders_total_check', expression: '(total >= (0)::numeric)' },
    ])
    const total = tableNamed(document, 'public', 'orders').columns.find((c) => c.name === 'total')
    // No `constraintName`: Postgres has no name for a default to give.
    expect(total?.default).toEqual({ expression: '0' })
  })

  it('records a generated column as stored, because in Postgres they all are', () => {
    const lineTotal = tableNamed(document, 'public', 'order_line').columns.find(
      (c) => c.name === 'line_total',
    )
    expect(lineTotal?.generated).toEqual({
      expression: '((quantity)::numeric * unit_price)',
      persisted: true,
    })
  })

  it('says where the file came from without deciding anything about case', () => {
    expect(document.source).toEqual({
      database: 'shop',
      engineVersion: '16.15 (Debian 16.15-1.pgdg13+2)',
      defaultCollation: 'en_US.utf8',
    })
  })

  it('gives every table a schema, which the contract requires to be non-empty', () => {
    for (const table of document.tables) expect(table.schema).not.toBe('')
  })
})

describe('parse, over the branches only Postgres has', () => {
  const document = read('postgres-provider-raw')

  it('emits identifiers as the catalog holds them, quoted case and all', () => {
    // "Sales"."Order" and public.order_line are different tables in the same
    // database, and neither name is folded on the way through.
    expect(document.tables.map((t) => `${t.schema}.${t.name}`)).toEqual([
      'Sales.Order',
      'Sales.Tenant',
      'public.event',
      'public.order_line',
    ])
    expect(tableNamed(document, 'Sales', 'Order').primaryKey?.columns).toEqual(['TenantId', 'Code'])
  })

  it('reports an identity column as a generation and a serial as its default', () => {
    // The rule is that `identity` comes from pg_attribute.attidentity and from
    // nothing else. A serial is an integer with a nextval() default, and calling
    // it an identity would be a guess that is wrong for any column that happens
    // to default from a sequence for some other reason.
    const tenant = tableNamed(document, 'Sales', 'Tenant')
    const id = tenant.columns.find((c) => c.name === 'Id')
    expect(id?.identity).toEqual({ generation: 'byDefault' })
    expect(id?.default).toBeUndefined()

    const legacy = tenant.columns.find((c) => c.name === 'legacy_key')
    expect(legacy?.identity).toBeUndefined()
    expect(legacy?.default).toEqual({
      expression: `nextval('"Sales"."Tenant_legacy_key_seq"'::regclass)`,
    })

    const always = tableNamed(document, 'public', 'order_line').columns.find(
      (c) => c.name === 'order_id',
    )
    expect(always?.identity).toEqual({ generation: 'always' })
  })

  it('leaves an enum and an array as other, with the real name in native', () => {
    const state = tableNamed(document, 'Sales', 'Order').columns.find((c) => c.name === 'state')
    expect(state?.type).toEqual({ native: 'order_state', normalised: 'other' })
    expect(state?.default).toEqual({ expression: `'draft'::order_state` })

    const tags = tableNamed(document, 'Sales', 'Tenant').columns.find((c) => c.name === 'Tags')
    expect(tags?.type).toEqual({ native: 'text[]', normalised: 'other' })
  })

  it('carries fractional seconds as a scale on a temporal type', () => {
    const placedAt = tableNamed(document, 'Sales', 'Order').columns.find(
      (c) => c.name === 'placed_at',
    )
    expect(placedAt?.type).toEqual({
      native: 'timestamp with time zone',
      normalised: 'timestamp',
      scale: 3,
    })
    expect(placedAt?.nullable).toBe(true)
  })

  it('records only a collation the column was actually given', () => {
    const order = tableNamed(document, 'Sales', 'Order')
    expect(order.columns.find((c) => c.name === 'Code')?.collation).toBe('C')
    // "Name" is collatable too and inherits the database default, which is not a
    // fact about the column and is not carried.
    expect(
      tableNamed(document, 'Sales', 'Tenant').columns.find((c) => c.name === 'Name')?.collation,
    ).toBeUndefined()
  })

  it('names an expression index key by its expression, since it has no column', () => {
    const indexes = tableNamed(document, 'public', 'order_line').indexes
    expect(indexes.map((i) => i.name)).toEqual(['order_line_note_lower_idx', 'order_line_open_idx'])
    expect(indexes[0]?.columns).toEqual([{ name: 'lower(note)' }])
  })

  it('crosses schemas on a foreign key rather than assuming its own', () => {
    const fk = tableNamed(document, 'public', 'order_line').foreignKeys[0]
    expect(fk?.referencedSchema).toBe('Sales')
    expect(fk?.referencedTable).toBe('Order')
    expect(fk?.onDelete).toBe('setNull')
  })

  it('keeps a partitioned table and drops its partitions', () => {
    // public.event is partitioned and public.event_2026 is one of its partitions.
    // The partition is physical detail; nobody modelled it.
    expect(document.tables.map((t) => t.name)).toContain('event')
    expect(document.tables.map((t) => t.name)).not.toContain('event_2026')
    // And a view is not a table.
    expect(document.tables.map((t) => t.name)).not.toContain('open_line')
  })

  it('says nothing rather than saying null, which the format treats the same', () => {
    // json_strip_nulls in the query is what makes this true of the file a user
    // pastes, and both fixtures are that file, so it is checkable here.
    const nulls: string[] = []
    const walk = (value: unknown, path: string): void => {
      if (value === null) nulls.push(path)
      else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`))
      else if (typeof value === 'object')
        for (const [key, item] of Object.entries(value as object)) walk(item, `${path}.${key}`)
    }
    walk(fixture('postgres-provider-raw'), '$')
    walk(fixture('postgres-raw'), '$')
    expect(nulls).toEqual([])
  })
})

describe('parse, when the file is not what the query prints', () => {
  it('says so once rather than crashing downstream', () => {
    const result = postgresProvider.parse('dbmd_introspection\n-------------------\n {"tables":[]}')
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['import/not-an-object'])
    expect(jsonPath(result.diagnostics[0])).toBe('$')
  })

  it('rejects a tables that is not a list, with the path to it', () => {
    const result = postgresProvider.parse({ tables: 'orders, order_line' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('import/wrong-type')
    expect(jsonPath(result.diagnostics[0])).toBe('$.tables')
  })

  it('leaves the rest to the contract validator, which has the paths', () => {
    // A table with no schema is a provider bug, and it surfaces as a diagnostic
    // pointing at where it is rather than as a crash. See provider.ts.
    const result = readIntrospection({
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'postgres',
      tables: [{ table_name: 'orders', columns: [] }],
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map(jsonPath)).toContain('$.tables[0].schema')
  })
})
