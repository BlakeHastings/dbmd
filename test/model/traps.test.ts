/**
 * The two ways YAML silently produces a wrong model that looks right, plus the
 * family they belong to.
 *
 * These came first, from a probe of `yaml`'s behaviour run before `read.ts`
 * existed, because both of them are invisible in a plain `parse()` result and
 * choosing the parser is the decision that makes them fixable at all.
 */

import { describe, expect, test } from 'vitest'
import { withModel } from './helpers.js'

describe('the nullability key is literally named null', () => {
  test('`null: false` is a key named null, not a boolean and not a dropped key', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: status
    type: text
    null: false
---
`,
    })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.columns).toEqual([{ name: 'status', type: 'text', nullable: false }])
  })

  test('a column may also be named null, in the same mapping as the null key', async () => {
    const { model, diagnostics } = await withModel({
      'tables/customers.md': `---
kind: table
table: customers
columns:
  - name: "null"
    type: boolean
    null: false
---
`,
    })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.columns).toEqual([{ name: 'null', type: 'boolean', nullable: false }])
  })
})

describe('a SQL default survives as SQL', () => {
  test('a quoted SQL string keeps its quotes', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: status
    type: text
    default: "'pending'"
---
`,
    })

    expect(diagnostics).toEqual([])
    // Nine characters, the outer two of them single quotes. Flattened to
    // \`pending\` this would emit \`DEFAULT pending\`, which is a column
    // reference and not a string, and nothing would notice until it ran.
    expect(model.tables[0]?.columns[0]?.default).toBe("'pending'")
  })

  test('YAML quoting is not SQL quoting, and the difference is preserved', async () => {
    const { model } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: a
    type: text
    default: 'pending'
  - name: b
    type: text
    default: now()
  - name: c
    type: integer
    default: "0"
---
`,
    })

    expect(model.tables[0]?.columns.map((column) => column.default)).toEqual([
      'pending',
      'now()',
      '0',
    ])
  })

  test('an unquoted number is a diagnostic rather than a guess', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: quantity
    type: integer
    default: 0
---
`,
    })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('field-wrong-type')
    expect(diagnostics[0]?.line).toBe(7)
    expect(diagnostics[0]?.message).toContain('`default` must be a string')
    expect(model.tables[0]?.columns[0]?.default).toBeUndefined()
  })
})

describe('YAML 1.1 boolean words', () => {
  test('a table named on, a column named y and a type of off all stay strings', async () => {
    const { model, diagnostics } = await withModel({
      'tables/on.md': `---
kind: table
table: on
columns:
  - name: y
    type: off
  - name: n
    type: no
---
`,
    })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.name).toBe('on')
    expect(model.tables[0]?.columns).toEqual([
      { name: 'y', type: 'off' },
      { name: 'n', type: 'no' },
    ])
  })

  test('a value that really did resolve to a non-string is diagnosed, never coerced', async () => {
    const { model, diagnostics } = await withModel({
      'tables/coerced.md': `---
kind: table
table: coerced
columns:
  - name: id
    type: uuid
  - name: null
    type: text
  - name: flag
    type: true
---
`,
    })

    expect(diagnostics.map((diagnostic) => [diagnostic.line, diagnostic.message])).toEqual([
      [7, '`name` must be a string, but YAML read `null` as null. Quote it.'],
      [10, '`type` must be a string, but YAML read `true` as a boolean. Quote it.'],
    ])
    // The two columns dbmd could not read are absent rather than invented.
    expect(model.tables[0]?.columns).toEqual([{ name: 'id', type: 'uuid' }])
  })

  test('pk and the null key must be booleans, and a quoted one is not', async () => {
    const { diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: "true"
---
`,
    })

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toBe(
      '`pk` must be true or false, but YAML read `"true"` as a string',
    )
  })
})
