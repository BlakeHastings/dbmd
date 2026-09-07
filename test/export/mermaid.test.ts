/**
 * The mermaid renderer.
 *
 * The claim every test here is really making is that the emitted diagram
 * **parses**, because the failure this module exists to prevent is the one that
 * produces no error anywhere: a table or a column mermaid's grammar cannot
 * spell renders on GitHub as a blank box, in somebody else's pull request.
 * There is no mermaid parser in this repository to assert that against, and
 * adding one would be a dependency the size of a browser, so what these tests
 * assert is the shape the diagram was measured to need: names quoted where
 * mermaid allows a quote, rewritten where it does not, and the true name kept
 * beside the rewritten one.
 */

import { describe, expect, test } from 'vitest'
import { mermaidDiagram, mermaidSection } from '../../src/export/mermaid.js'
import { readModel } from '../../src/model/read.js'
import { exampleShop } from '../model/fixtures.js'
import { withModel } from '../model/helpers.js'

/** The lines of the diagram, so an assertion is about one line rather than an offset. */
async function diagram(files: Record<string, string>): Promise<string[]> {
  const { model } = await withModel(files)
  return mermaidDiagram(model).split('\n')
}

const ORDERS = `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
---

The table the awkward one points at.
`

describe('a name mermaid cannot spell', () => {
  test('a hyphen in a table name survives, because an entity name is always quoted', async () => {
    const lines = await diagram({
      'tables/order-items.md': `---
kind: table
table: order-items
columns:
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
---

A hyphen is legal in a file name and legal in a table name.
`,
      'tables/orders.md': ORDERS,
    })

    expect(lines).toContain('  "order-items" {')
    expect(lines).toContain('  "orders" ||..o{ "order-items" : "order_id"')
  })

  test('a space in a column name is rewritten, and the real name is kept beside it', async () => {
    const lines = await diagram({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: order id
    type: uuid
    pk: true
  - name: placed at
    type: timestamp with time zone
    nullable: false
---

An attribute row has no quoted form in either position, so both of these move.
`,
    })

    // The rewritten pair, and then the true pair in the row's comment, which is
    // the one part of an attribute row that can hold a space.
    expect(lines).toContain('    uuid order_id PK "uuid order id"')
    expect(lines).toContain(
      '    timestamp_with_time_zone placed_at "timestamp with time zone placed at"',
    )
  })

  test('a leading digit and a key marker are moved out of the way', async () => {
    const lines = await diagram({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: 2fa_token
    type: text
  - name: PK
    type: text
  - name: uk
    type: text
---

A digit opens a number to the lexer, and PK, FK and UK are the key markers.
`,
    })

    expect(lines).toContain('    text _2fa_token "text 2fa_token"')
    expect(lines).toContain('    text PK_ "text PK"')
    expect(lines).toContain('    text uk_ "text uk"')
  })

  test('a comma survives in a type and not in a name', async () => {
    const lines = await diagram({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: amount
    type: numeric(10,2)
  - name: "a,b"
    type: text
---

Nothing follows a type that a comma could belong to; the key markers follow a
name and are comma-separated.
`,
    })

    expect(lines).toContain('    numeric(10,2) amount')
    expect(lines).toContain('    text a_b "text a,b"')
  })

  test('a letter of another alphabet is left alone rather than replaced', async () => {
    const lines = await diagram({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: Größe
    type: text
---

Rewriting every column of a model written in somebody else's alphabet would be
the worst available reading of "escape or quote".
`,
    })

    expect(lines).toContain('    text Größe')
  })

  test('a quote and a hash in a table name become mermaid escapes, in that order', async () => {
    const lines = await diagram({
      'tables/od.md': `---
kind: table
table: od
columns:
  - name: id
    type: uuid
    pk: true
    ref: "a#b.id"
---

The ref target is never resolved here, so it exercises the escaping of a name
that came from outside.
`,
    })

    // `#` is replaced first, so the `#` written by the `#quot;` escape is not
    // then read as the start of one.
    expect(lines).toContain('  "a#35;b" ||--o| "od" : "id"')
  })
})

describe('the relationship operator is three facts the model already holds', () => {
  const child = (extra: string): Record<string, string> => ({
    'tables/lines.md': `---
kind: table
table: lines
columns:
  - name: order_id
    type: uuid
${extra}    ref: orders.id
---

The child.
`,
    'tables/orders.md': ORDERS,
  })

  test('a not-null ref is exactly one parent, a silent one is zero or one', async () => {
    expect(await diagram(child('    nullable: false\n'))).toContain(
      '  "orders" ||..o{ "lines" : "order_id"',
    )
    // `nullable` absent means the file did not say, and a diagram that claimed
    // "exactly one" out of silence would be claiming something nobody wrote.
    expect(await diagram(child(''))).toContain('  "orders" |o..o{ "lines" : "order_id"')
  })

  test('a ref inside the child key draws a solid line, and one on its own is at most one row', async () => {
    // The whole primary key: identifying, so solid, and one child at most.
    expect(await diagram(child('    pk: true\n'))).toContain(
      '  "orders" ||--o| "lines" : "order_id"',
    )
  })

  test('a unique index over an expression marks nothing and leaves the ref many', async () => {
    const lines = await diagram({
      'tables/lines.md': `---
kind: table
table: lines
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
indexes:
  - name: lines_lower_order_key
    columns: [{ expression: lower(order_id) }]
    unique: true
---

\`unique (lower(order_id))\` constrains the lower-cased value and leaves
\`order_id\` free to repeat, so it is not the same claim as a unique index over
the column. ADR 0022.
`,
      'tables/orders.md': ORDERS,
    })

    // No UK, because an expression is not a column of this table, and no key
    // rendered from the mapping either: `[object Object]` in a mermaid row
    // would be a column called `_object_Object_`, silently, in a diagram.
    expect(lines).toContain('    uuid order_id FK')
    expect(lines.join('\n')).not.toContain('object')
    // And the cardinality reads the same fact, so the child side stays many.
    expect(lines).toContain('  "orders" ||..o{ "lines" : "order_id"')
  })

  test('a unique index over the ref column makes the child side zero or one', async () => {
    const lines = await diagram({
      'tables/lines.md': `---
kind: table
table: lines
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
indexes:
  - name: lines_order_key
    columns: [order_id]
    unique: true
---

One line per order.
`,
      'tables/orders.md': ORDERS,
    })

    expect(lines).toContain('    uuid order_id FK,UK')
    expect(lines).toContain('  "orders" ||..o| "lines" : "order_id"')
  })
})

describe('the diagram is the same bytes every time', () => {
  test('tables are sorted and columns keep the order their author chose', async () => {
    const { model } = await withModel({
      'tables/zulu.md': `---
kind: table
table: zulu
columns:
  - name: zzz
    type: text
  - name: aaa
    type: text
---

Column order is a choice, so it is not sorted.
`,
      'tables/alpha.md': `---
kind: table
table: alpha
columns:
  - name: id
    type: uuid
    pk: true
---

Second on disk, first in the diagram.
`,
    })

    const lines = mermaidDiagram(model).split('\n')
    expect(lines.filter((line) => line.endsWith('{'))).toEqual(['  "alpha" {', '  "zulu" {'])
    expect(lines.indexOf('    text zzz')).toBeLessThan(lines.indexOf('    text aaa'))
  })

  test('a model read twice renders identically', async () => {
    const first = await readModel(exampleShop)
    const second = await readModel(exampleShop)
    expect(mermaidDiagram(first.model)).toBe(mermaidDiagram(second.model))
  })
})

describe('the section around the diagram', () => {
  test('a model with no tables gets a sentence rather than an empty fence', async () => {
    const { model } = await withModel({})

    // `erDiagram` with nothing under it parses and renders as an empty box,
    // which is exactly the failure this module is built not to produce.
    expect(mermaidDiagram(model)).toBe('')
    expect(mermaidSection(model).text).not.toContain('```mermaid')
    expect(mermaidSection(model).text).toContain('no tables yet')
  })

  test('it says what a diagram of this model is missing, because the reader cannot see', async () => {
    const { model } = await readModel(exampleShop)
    const { text } = mermaidSection(model)

    for (const dropped of [
      'sticky notes',
      'grouping boxes',
      'canvas layout',
      'prose body',
      // The one a reader would otherwise read off the diagram wrongly: a
      // unique index they can see in the model, and no UK where they expect it.
      'over an expression',
    ]) {
      expect(text).toContain(dropped)
    }
    expect(text).toContain('<!-- dbmd:diagram -->')
    expect(text).toContain('<!-- /dbmd:diagram -->')
  })
})

describe('examples/shop, which is a real model rather than a fixture', () => {
  test('eight tables, a self-reference, a unique index and an identifying ref', async () => {
    const { model, diagnostics } = await readModel(exampleShop)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    const section = mermaidSection(model)
    expect(section.tables).toBe(8)

    const lines = mermaidDiagram(model).split('\n')
    // `addresses.superseded_by` points at `addresses`: mermaid draws it, and a
    // table that points at itself is the shape that breaks a naive emitter.
    expect(lines).toContain('  "addresses" |o..o{ "addresses" : "superseded_by"')
    // `customers_email_key` is one column and unique, so the column wears UK.
    expect(lines).toContain('    citext email UK')
    // `order_items.order_id` is part of that table's key, so the line is solid.
    expect(lines).toContain('  "orders" ||--o{ "order_items" : "order_id"')
  })
})
