import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareDiagnostics, readModel } from '../../src/model/read.js'
import type { Diagnostic } from '../../src/model/types.js'
import { fixtureModel, withModel } from './helpers.js'

/** Diagnostics as one line each, which is how a reviewer reads them. */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map(
    (d) =>
      `${d.path}${d.line === undefined ? '' : `:${d.line}`} ${d.severity} ${d.code}: ${d.message}`,
  )
}

describe('the body is one opaque string', () => {
  test('a fenced block containing three dashes is not mistaken for a delimiter', async () => {
    const { model } = await readModel(fixtureModel)
    const customers = model.tables.find((table) => table.name === 'customers')
    const onDisk = await readFile(join(fixtureModel, 'tables', 'customers.md'), 'utf8')

    // Asserted rather than optional-chained: a fixture that stopped loading
    // would make every assertion below pass on undefined and say nothing.
    assert(customers !== undefined, 'the customers fixture did not load')
    expect(customers.body).toContain('```sql')
    expect(customers.body).toContain('\n---\n')
    // The body is the tail of the file from the character after the closing
    // delimiter's line break, worked out here independently of the reader.
    const fileLines = onDisk.split('\n')
    const closing = fileLines.indexOf('---', 1)
    expect(customers.body).toBe(fileLines.slice(closing + 1).join('\n'))
  })

  test('CRLF reaches and leaves the reader unchanged', async () => {
    const body =
      '\r\nOne row per customer order.\r\n\r\n```sql\r\nSELECT 1;\r\n---\r\n```\r\nLast line.\r\n'
    const frontmatter = ['---', 'kind: table', 'table: orders', 'columns: []', '---', ''].join(
      '\r\n',
    )

    const { model, diagnostics } = await withModel({ 'tables/orders.md': frontmatter + body })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.body).toBe(body)
    // The reason this matters: a body that came back LF-normalised would make
    // the next save rewrite every line of the file, and a whole-file diff is
    // exactly what this format exists to avoid.
    expect(model.tables[0]?.body.includes('\n\n')).toBe(false)
  })

  test('a body with no trailing newline keeps not having one', async () => {
    const { model } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\nNo newline at the end',
    })

    expect(model.tables[0]?.body).toBe('No newline at the end')
  })

  test('a file that ends at the closing delimiter has an empty body', async () => {
    const { model } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\n',
    })

    expect(model.tables[0]?.body).toBe('')
  })
})

describe('absent, empty and unterminated frontmatter are three different things', () => {
  test('no delimiter at all', async () => {
    const { model, diagnostics } = await withModel({
      'tables/notes-really.md': 'Just prose, in a directory of tables.\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/notes-really.md error frontmatter-absent: no frontmatter: the file does not start with a `---` line',
    ])
    // No table is invented from the file name: a phantom box on the canvas and
    // in every export is worse than a missing one.
    expect(model.tables).toEqual([])
  })

  test('an opening delimiter that is never closed', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error frontmatter-unterminated: the frontmatter opens with `---` and is never closed by a `---` line',
    ])
  })

  test('delimiters with nothing between them', async () => {
    const { diagnostics } = await withModel({ 'tables/orders.md': '---\n---\nProse.\n' })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error frontmatter-empty: the frontmatter is empty, so the file declares nothing',
    ])
  })

  test('frontmatter that is a list rather than a mapping', async () => {
    const { diagnostics } = await withModel({ 'tables/orders.md': '---\n- orders\n---\n' })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:2 error frontmatter-not-a-map: the frontmatter must be a mapping of keys to values',
    ])
  })

  test('broken YAML is one diagnostic with the line the parser stopped on', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ncolumns:\n  - name: id\n   type: uuid\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:5 error frontmatter-invalid: Sequence item without - indicator',
    ])
    expect(model.tables).toEqual([])
  })
})

describe('the directory decides the kind', () => {
  test('a kind that disagrees with its directory is a diagnostic and does not load', async () => {
    const { model, diagnostics } = await withModel({
      'notes/misfiled.md': '---\nkind: table\ntable: misfiled\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'notes/misfiled.md:2 error kind-mismatch: `kind: table` in a directory of notes; the directory decides, so this file is not loaded',
    ])
    expect(model.notes).toEqual([])
    expect(model.tables).toEqual([])
  })

  test('a missing kind is a diagnostic, and the directory still decides', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\ntable: orders\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error kind-missing: no `kind:` key; the directory says this is a table',
    ])
    expect(model.tables[0]?.name).toBe('orders')
  })

  test('a directory that is not a kind is ignored, loudly', async () => {
    const { diagnostics } = await withModel({
      'sketches/idea.md': '---\nkind: table\n---\n',
      'tables/orders.md': '---\nkind: table\ntable: orders\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'sketches warning unknown-kind-directory: `sketches/` is not a kind of object dbmd knows; its files are ignored',
    ])
  })
})

describe('the file name is the identity', () => {
  test('a table key that disagrees with the file name is a diagnostic', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: order\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('name-mismatch')
    expect(diagnostics[0]?.line).toBe(3)
    expect(model.tables[0]?.name).toBe('orders')
  })

  test('a table with no table key is a diagnostic and still loads', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('name-missing')
    expect(model.tables[0]?.name).toBe('orders')
  })
})

describe('the reverse of ref', () => {
  test('every table has an entry, and the edges are sorted', async () => {
    const { model } = await readModel(fixtureModel)

    expect([...model.referencesTo.keys()]).toEqual([
      'coerced',
      'customers',
      'on',
      'order_items',
      'orders',
      'shipments',
    ])
    expect(model.referencesTo.get('orders')).toEqual([
      { from: { table: 'order_items', column: 'order_id' }, to: { table: 'orders', column: 'id' } },
      { from: { table: 'shipments', column: 'order_id' }, to: { table: 'orders', column: 'id' } },
    ])
    expect(model.referencesTo.get('on')).toEqual([])
  })

  test('a ref that is not table.column is a diagnostic and no edge', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:7 error ref-malformed: `ref: customers` is not `table.column`',
    ])
    expect(model.tables[0]?.columns[0]?.ref).toBeUndefined()
  })

  test('the last dot separates the column, so a qualified table name survives', async () => {
    const { model } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: sales.customers.id
---
`,
    })

    expect(model.tables[0]?.columns[0]?.ref).toEqual({ table: 'sales.customers', column: 'id' })
  })
})

describe('group membership is declared by the member', () => {
  test('a group has its members computed and never stores them', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.groupMembers.get('billing')).toEqual(['order_items', 'orders'])
    const billing = model.groups.find((group) => group.name === 'billing')
    expect(billing).toEqual({
      kind: 'group',
      name: 'billing',
      path: 'groups/billing.md',
      body: billing?.body,
      complete: true,
      label: 'Billing',
      color: 'violet',
    })
  })

  test('an empty group gets an entry rather than disappearing', async () => {
    const { model } = await withModel({ 'groups/billing.md': '---\nkind: group\n---\n' })

    expect(model.groupMembers.get('billing')).toEqual([])
  })

  test('a group that does not exist is a diagnostic, not a new group', async () => {
    const { model, diagnostics } = await readModel(fixtureModel)

    expect(lines(diagnostics)).toContain(
      'tables/shipments.md:12 error group-unknown: `group: shipping` names no file at groups/shipping.md',
    )
    expect(model.groupMembers.has('shipping')).toBe(false)
    // The table itself still loads, and still says what it meant.
    expect(model.tables.find((table) => table.name === 'shipments')?.group).toBe('shipping')
  })

  test('a group with a layout is told that its box is computed', async () => {
    const { model, diagnostics } = await withModel({
      'groups/billing.md': '---\nkind: group\nlayout: { x: 1, y: 2 }\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('unknown-key')
    expect(diagnostics[0]?.message).toContain('a group has no coordinates')
    expect(model.groups[0]).not.toHaveProperty('layout')
  })
})

describe('layout', () => {
  test('a note keeps w and h', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.notes[0]?.layout).toEqual({ x: 120, y: 640, w: 320, h: 200 })
    expect(model.notes[0]?.color).toBe('amber')
  })

  test('a table is told that w and h belong to a note', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\nlayout: { x: 1, y: 2, w: 3 }\n---\n',
    })

    expect(diagnostics[0]?.code).toBe('unknown-key')
    expect(diagnostics[0]?.message).toContain('`w` and `h` belong to a note')
    expect(model.tables[0]?.layout).toEqual({ x: 1, y: 2 })
  })

  test('a layout without coordinates is a diagnostic and no layout', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': '---\nkind: table\ntable: orders\nlayout: { y: 2 }\n---\n',
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:4 error field-missing: `layout` needs `x`',
    ])
    expect(model.tables[0]?.layout).toBeUndefined()
  })
})

describe('keys that mean nothing', () => {
  test('an unknown key is a warning that lists the known ones', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    unqiue: true
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:7 warning unknown-key: `unqiue` means nothing on a column; known keys are default, name, null, pk, ref, type',
    ])
  })

  test('two spellings of the same name are a duplicate, and the first wins', async () => {
    // YAML itself rejects a literally repeated key. This is the case it cannot
    // see: `null` resolves to the null value and `"null"` to a string, so the
    // parser thinks they are two keys and dbmd knows they are one.
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    null: false
    "null": true
---
`,
    })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md:8 error duplicate-key: `null` is given twice; the first one is used',
    ])
    expect(model.tables[0]?.columns[0]?.nullable).toBe(false)
  })
})

describe('_model.md', () => {
  test('its name, engine and prose are the model-wide facts', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.name).toBe('shop')
    expect(model.engine).toBe('postgres')
    expect(model.body).toContain('The order side of the shop.')
  })

  test('a missing one is a warning and not a failure', async () => {
    const { model, diagnostics } = await withModel(
      { 'tables/orders.md': '---\nkind: table\ntable: orders\n---\n' },
      { modelFile: false },
    )

    expect(lines(diagnostics)).toEqual([
      '_model.md warning model-file-missing: no _model.md, so the model has no name and no engine',
    ])
    expect(model.name).toBeUndefined()
    expect(model.tables).toHaveLength(1)
  })

  test('one that is all prose is all body', async () => {
    const { model, diagnostics } = await withModel({ '_model.md': 'Just the why.\n' })

    expect(diagnostics).toEqual([])
    expect(model.body).toBe('Just the why.\n')
  })
})

describe('never throwing, and always in the same order', () => {
  test('a directory that is not there is a diagnostic', async () => {
    const { model, diagnostics } = await readModel(join(fixtureModel, 'no-such-directory'))

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('model-directory-unreadable')
    expect(diagnostics[0]?.path).toBe('.')
    // ADR 0006 forbids absolute paths in output, so the message carries the
    // errno and not the path the caller already knows.
    expect(diagnostics[0]?.message).toBe('cannot read the model directory: ENOENT')
    expect(model.tables).toEqual([])
  })

  test('diagnostics sort by path, then line, and two reads agree', async () => {
    const first = await readModel(fixtureModel)
    const second = await readModel(fixtureModel)

    expect(lines(first.diagnostics)).toEqual(lines(second.diagnostics))
    // Sorted by the comparator rather than by the rendered text: line 8 comes
    // before line 11, which string order gets backwards.
    expect(lines([...first.diagnostics].reverse().sort(compareDiagnostics))).toEqual(
      lines(first.diagnostics),
    )
    expect(first.model.tables.map((table) => table.name)).toEqual([
      'coerced',
      'customers',
      'on',
      'order_items',
      'orders',
      'shipments',
    ])
  })

  test('the whole fixture reads to exactly these diagnostics', async () => {
    const { diagnostics } = await readModel(fixtureModel)

    expect(lines(diagnostics)).toEqual([
      'notes/misfiled.md:2 error kind-mismatch: `kind: table` in a directory of notes; the directory decides, so this file is not loaded',
      'tables/broken-yaml.md:6 error frontmatter-invalid: Sequence item without - indicator',
      'tables/coerced.md:8 error field-wrong-type: `name` must be a string, but YAML read `null` as null. Quote it.',
      'tables/coerced.md:11 error field-wrong-type: `type` must be a string, but YAML read `true` as a boolean. Quote it.',
      'tables/coerced.md:14 error field-wrong-type: `default` must be a string, but YAML read `0` as a number. A SQL default must be a string so that it survives as SQL text. Quote it, and quote it twice if it is a SQL string literal: `default: "\'pending\'"`.',
      'tables/coerced.md:15 warning unknown-key: `unqiue` means nothing on a column; known keys are default, name, null, pk, ref, type',
      'tables/empty-frontmatter.md error frontmatter-empty: the frontmatter is empty, so the file declares nothing',
      'tables/no-frontmatter.md error frontmatter-absent: no frontmatter: the file does not start with a `---` line',
      'tables/shipments.md:12 error group-unknown: `group: shipping` names no file at groups/shipping.md',
      'tables/unterminated.md error frontmatter-unterminated: the frontmatter opens with `---` and is never closed by a `---` line',
    ])
  })

  test('a composite primary key is two columns that both say pk', async () => {
    const { model } = await readModel(fixtureModel)
    const items = model.tables.find((table) => table.name === 'order_items')

    expect(
      items?.columns.filter((column) => column.pk === true).map((column) => column.name),
    ).toEqual(['order_id', 'product_id'])
  })

  test('an index keeps its columns in the order it declared them', async () => {
    const { model } = await readModel(fixtureModel)

    expect(model.tables.find((table) => table.name === 'orders')?.indexes).toEqual([
      { name: 'orders_customer_status_idx', columns: ['customer_id', 'status'] },
    ])
  })
})
