/**
 * The ways YAML silently produces a wrong model that looks right, plus the
 * family they belong to.
 *
 * These came first, from a probe of `yaml`'s behaviour run before `read.ts`
 * existed, because every one of them is invisible in a plain `parse()` result
 * and choosing the parser is the decision that makes them fixable at all.
 *
 * The nullability key used to be one of them, and dbmd-16 deleted it by
 * renaming the key. What is left here is the retired spelling, which still has
 * to be recognised in order to be refused, and a column that really is named
 * `null`, which was never the same question and is still a legal column.
 */

import { describe, expect, test } from 'vitest'
import type { Diagnostic } from '../../src/model/types.js'
import { withModel } from './helpers.js'

/** The 1-based file line, which only a file location has. */
function lineOf(diagnostic: Diagnostic | undefined): number | undefined {
  if (diagnostic?.at.in !== 'file') throw new Error('not a file location')
  return diagnostic.at.line
}

describe('nullability', () => {
  test('`nullable: false` is an ordinary key with no trap in it', async () => {
    const { model, diagnostics } = await withModel({
      'tables/orders.md': `---
kind: table
table: orders
columns:
  - name: status
    type: text
    nullable: false
---
`,
    })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.columns).toEqual([{ name: 'status', type: 'text', nullable: false }])
  })

  test('the retired `null` key is named in the diagnostic, not swept into unknown-key', async () => {
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

    expect(diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`)).toEqual([
      'error superseded-key: `null` is now `nullable` and means the same thing: write `nullable: false`',
    ])
    // An error rather than a warning, and this is the reason: the file says the
    // column is not nullable, the model does not, and a complete object would
    // be written back over the file with that fact gone.
    expect(model.tables[0]?.columns[0]?.nullable).toBeUndefined()
    expect(model.tables[0]?.complete).toBe(false)
  })

  test('a column may still be named null, which was always a different question', async () => {
    const { model, diagnostics } = await withModel({
      'tables/customers.md': `---
kind: table
table: customers
columns:
  - name: "null"
    type: boolean
    nullable: false
---
`,
    })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.columns).toEqual([{ name: 'null', type: 'boolean', nullable: false }])
  })
})

describe('uniqueness is an index key and never a column key', () => {
  test('`unique: true` on an index is read', async () => {
    const { model, diagnostics } = await withModel({
      'tables/customers.md': `---
kind: table
table: customers
columns:
  - name: email
    type: citext
    nullable: false
indexes:
  - name: customers_email_key
    columns: [email]
    unique: true
  - name: customers_created_idx
    columns: [email]
---
`,
    })

    expect(diagnostics).toEqual([])
    expect(model.tables[0]?.indexes).toEqual([
      { name: 'customers_email_key', columns: ['email'], unique: true },
      { name: 'customers_created_idx', columns: ['email'] },
    ])
  })

  test('`unique: true` on a column says where to write it instead', async () => {
    const { model, diagnostics } = await withModel({
      'tables/customers.md': `---
kind: table
table: customers
columns:
  - name: email
    type: citext
    unique: true
---
`,
    })

    expect(diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`)).toEqual([
      'error superseded-key: `unique` is declared on an index and not on a column, because a unique constraint has a name and a column has nowhere to put one; write it as an `indexes:` entry with `columns: [email]` and `unique: true`',
    ])
    expect(model.tables[0]?.complete).toBe(false)
  })

  test('and a column with no name is not told to write a line that will not parse', async () => {
    // The remedy above is a line you can copy because there is a name to put in
    // it. Here there is not, and the fallback used to produce
    // `columns: [this column]`, in a code span, which no file will parse. This
    // state is only ever reached beside the `field-missing` on the line above
    // it, so the sentence sends the reader to that instead.
    const { diagnostics } = await withModel({
      'tables/customers.md': `---
kind: table
table: customers
columns:
  - type: citext
    unique: true
---
`,
    })

    expect(diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`)).toEqual([
      'error field-missing: `name` is required',
      'error superseded-key: `unique` is declared on an index and not on a column, because a unique constraint has a name and a column has nowhere to put one; write it as an `indexes:` entry with `unique: true`, whose `columns:` names this column once it has a `name:`',
    ])
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
    expect(lineOf(diagnostics[0])).toBe(7)
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

    expect(diagnostics.map((diagnostic) => [lineOf(diagnostic), diagnostic.message])).toEqual([
      [7, '`name` must be a string, but YAML read `null` as null; quote it'],
      [10, '`type` must be a string, but YAML read `true` as a boolean; quote it'],
    ])
    // The two columns dbmd could not read are absent rather than invented.
    expect(model.tables[0]?.columns).toEqual([{ name: 'id', type: 'uuid' }])
  })

  test('pk and nullable must be booleans, and a quoted one is not', async () => {
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
