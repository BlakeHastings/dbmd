/**
 * dbmd-18, end to end: an expression index must not be a column with a strange
 * name, at any stage of the journey.
 *
 * The bug this file exists for was found by running the shipped Postgres query
 * against a live database. `create index entry_lower_code on public.entry
 * (lower(ledger_code))` came back as a key column named `lower(ledger_code)`,
 * and `lower(ledger_code)` is a legal Postgres column name, so an index on the
 * expression and an index on such a column were byte-identical from there on.
 *
 * The fix is a shape rather than a rule: an index key is a column *or* an
 * expression, in both the introspection contract and the markdown, and neither
 * can be read as the other. ADR 0022.
 *
 * This file walks one real index through every stage, and then does the same
 * for the column that used to be indistinguishable from it, asserting at each
 * stage that the two are still two things. The stages are deliberately spelled
 * out rather than looped, because the point of the test is the trail.
 */

import { describe, expect, test } from 'vitest'
import { validate } from '../src/model/validate.js'
import { serialiseObject } from '../src/model/write.js'
import { validateIntrospectionDocument } from '../src/import/contract.js'
import { readIntrospection } from '../src/import/read.js'
import type { Index, Table } from '../src/model/types.js'
import { withModel } from './model/helpers.js'

/**
 * What PostgreSQL 16.15 actually printed for that schema, pasted from `psql`
 * rather than imagined, with the envelope fields that vary by server trimmed.
 * Both indexes are on the same eighteen characters and only one of them is a
 * column of the table.
 */
const AS_POSTGRES_PRINTS_IT = {
  dbmdIntrospection: 1,
  engine: 'postgres',
  tables: [
    {
      table_schema: 'public',
      table_name: 'entry',
      columns: [
        { column_name: 'id', format_type: 'uuid', not_null: true },
        { column_name: 'ledger_code', format_type: 'text', not_null: true },
        { column_name: 'lower(ledger_code)', format_type: 'text', not_null: false },
      ],
      primary_key: { constraint_name: 'entry_pkey', columns: ['id'] },
      indexes: [
        {
          index_name: 'entry_lower_code',
          is_unique: false,
          is_constraint: false,
          key_columns: [{ expression: 'lower(ledger_code)', is_descending: false }],
          included_columns: [],
        },
        {
          index_name: 'entry_odd_column',
          is_unique: false,
          is_constraint: false,
          key_columns: [{ column_name: 'lower(ledger_code)', is_descending: false }],
          included_columns: [],
        },
      ],
      foreign_keys: [],
      check_constraints: [],
    },
  ],
}

/** The same table as markdown, which is what a person would have written. */
const AS_MARKDOWN = `---
kind: table
table: entry
columns:
  - name: id
    type: uuid
    pk: true
  - name: ledger_code
    type: text
    nullable: false
  - name: lower(ledger_code)
    type: text
indexes:
  - name: entry_lower_code
    columns: [{ expression: lower(ledger_code) }]
  - name: entry_odd_column
    columns: [lower(ledger_code)]
---

One row per ledger entry.
`

async function entryTable(markdown: string): Promise<{ table: Table; codes: string[] }> {
  const { model, diagnostics } = await withModel({ 'tables/entry.md': markdown })
  const table = model.tables.find((held) => held.name === 'entry')
  if (table === undefined) throw new Error('the entry table did not load')
  return {
    table,
    codes: [...diagnostics.map((d) => d.code), ...validate(model).map((d) => d.code)],
  }
}

function indexNamed(table: Table, name: string): Index {
  const found = table.indexes.find((index) => index.name === name)
  if (found === undefined) throw new Error(`no index called ${name}`)
  return found
}

describe('stage 1: the introspection contract', () => {
  test('reads the two indexes as two different kinds of thing', () => {
    const result = readIntrospection(AS_POSTGRES_PRINTS_IT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toEqual([])

    const indexes = result.value.tables[0]?.indexes ?? []
    expect(indexes.map((index) => index.name)).toEqual(['entry_lower_code', 'entry_odd_column'])
    expect(indexes[0]?.columns).toEqual([{ expression: 'lower(ledger_code)' }])
    expect(indexes[1]?.columns).toEqual([{ column: 'lower(ledger_code)' }])

    // The whole item in one line: the same text, in the same field, meaning two
    // different things, and the shape says which.
    expect(indexes[0]?.columns).not.toEqual(indexes[1]?.columns)
  })

  // Straight at the contract validator rather than through a provider. The
  // Postgres query cannot emit both fields, but a canonical document is a file
  // somebody can hand-edit, and a key that says both holds no fact to keep.
  test('refuses a key that claims to be both, rather than picking one', () => {
    const result = validateIntrospectionDocument({
      dbmdIntrospection: 1,
      engine: 'postgres',
      tables: [
        {
          schema: 'public',
          name: 'entry',
          columns: [
            {
              name: 'ledger_code',
              type: { native: 'text', normalised: 'string' },
              nullable: false,
            },
          ],
          indexes: [
            {
              name: 'entry_lower_code',
              columns: [{ column: 'ledger_code', expression: 'lower(ledger_code)' }],
              isUnique: false,
            },
          ],
        },
      ],
    })
    expect(result.diagnostics.map((d) => d.code)).toEqual(['import/conflicting-fields'])
  })
})

describe('stage 2: the markdown', () => {
  test('reads an expression key and a column key as two different things', async () => {
    const { table, codes } = await entryTable(AS_MARKDOWN)

    expect(codes).toEqual([])
    expect(indexNamed(table, 'entry_lower_code').columns).toEqual([
      { expression: 'lower(ledger_code)' },
    ])
    expect(indexNamed(table, 'entry_odd_column').columns).toEqual(['lower(ledger_code)'])
  })

  test('writes both back byte for byte, so the file is already canonical', async () => {
    const { table } = await entryTable(AS_MARKDOWN)
    expect(serialiseObject(table)).toBe(AS_MARKDOWN)
  })

  test('survives a second trip through the writer and the reader', async () => {
    const first = await entryTable(AS_MARKDOWN)
    const second = await entryTable(serialiseObject(first.table))
    expect(second.table).toEqual(first.table)
    expect(second.codes).toEqual([])
  })

  test('quotes an expression whose characters need it, and only then', async () => {
    const table: Table = {
      kind: 'table',
      name: 'entry',
      path: 'tables/entry.md',
      body: '\n',
      complete: true,
      columns: [{ name: 'created_at', type: 'timestamptz' }],
      indexes: [
        {
          name: 'entry_day',
          columns: [{ expression: "date_trunc('day', created_at)" }, { expression: 'lower(x)' }],
        },
      ],
    }
    // A comma would end the flow sequence and a quote is not plain, so the first
    // is quoted; the second is made only of characters YAML resolves to itself.
    // The rule is the writer's ordinary scalar rule and not a rule about SQL.
    expect(serialiseObject(table)).toContain(
      `columns: [{ expression: "date_trunc('day', created_at)" }, { expression: lower(x) }]`,
    )
  })
})

describe('stage 3: the validator', () => {
  test('says nothing about an expression, and still catches a misspelled column', async () => {
    const { codes } = await entryTable(
      AS_MARKDOWN.replace('columns: [lower(ledger_code)]', 'columns: [ledgr_code]'),
    )
    // One complaint, about the typo, and none about the expression beside it.
    expect(codes).toEqual(['index-column-unknown'])
  })

  test('points somebody who meant an expression at the spelling that says so', async () => {
    const { model } = await withModel({
      'tables/entry.md': AS_MARKDOWN.replace(
        'columns: [{ expression: lower(ledger_code) }]',
        'columns: [lower(other_code)]',
      ),
    })
    expect(validate(model)[0]?.message).toContain('write it as `{ expression: lower(other_code) }`')
  })

  test('a unique expression index does not make any column unique', async () => {
    // `unique (lower(email))` constrains the lower-cased value. It leaves
    // `email` free to repeat in another case, so a `ref` at `email` is still a
    // ref at something that does not identify one row.
    const { model } = await withModel({
      'tables/people.md': `---
kind: table
table: people
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: text
indexes:
  - name: people_email_lower_key
    columns: [{ expression: lower(email) }]
    unique: true
---
`,
      'tables/logins.md': `---
kind: table
table: logins
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: text
    ref: people.email
---
`,
    })
    expect(validate(model).map((d) => d.code)).toEqual(['ref-target-not-unique'])
  })
})

describe('what a hand-author gets wrong', () => {
  test('a mapping with no expression is a missing field, not a silent skip', async () => {
    const { codes } = await entryTable(
      AS_MARKDOWN.replace('{ expression: lower(ledger_code) }', '{ expr: lower(ledger_code) }'),
    )
    expect(codes).toEqual(['field-missing', 'unknown-key'])
  })

  test('a key that is neither a name nor a mapping says what the two spellings are', async () => {
    const { model, diagnostics } = await withModel({
      'tables/entry.md': AS_MARKDOWN.replace('{ expression: lower(ledger_code) }', '17'),
    })
    expect(diagnostics.map((d) => d.code)).toEqual(['field-wrong-type'])
    expect(diagnostics[0]?.message).toContain('a column name or `{ expression: ... }`')
    // The file lost something, so the writer will not save over it (ADR 0010).
    expect(model.tables[0]?.complete).toBe(false)
  })

  /**
   * dbmd-2z4. The studio prints a held key as `{ expression: lower(email) }`
   * and the editable row is directly beneath it, so the line above gets copied.
   * Quoting it is what YAML makes you do to get those characters into a string,
   * and the validator used to answer by wrapping the string in another mapping,
   * which the reader then refused. Both ends of the loop are asserted here so
   * that neither can come back on its own.
   */
  test('the copied mapping spelling is told to lose its quotes, not to wrap again', async () => {
    const { model } = await withModel({
      'tables/entry.md': AS_MARKDOWN.replace(
        'columns: [{ expression: lower(ledger_code) }]',
        'columns: ["{ expression: lower(other_code) }"]',
      ),
    })
    const message = validate(model)[0]?.message ?? ''

    expect(message).toContain('remove the quotes to index the expression')
    // The wrapper is the thing that looped, so its absence is the assertion.
    expect(message).not.toContain('{ expression: { expression:')
  })

  test('and taking the quotes off is the whole edit', async () => {
    const { model, diagnostics } = await withModel({
      'tables/entry.md': AS_MARKDOWN.replace(
        'columns: [{ expression: lower(ledger_code) }]',
        'columns: [{ expression: lower(other_code) }]',
      ),
    })

    // Doing what the message says leaves nothing to say, which is what the old
    // message could not manage from the same starting file.
    expect(diagnostics.map((d) => d.code)).toEqual([])
    expect(validate(model).map((d) => d.code)).toEqual([])
  })

  test('a column really called that is still writable, and still validates', async () => {
    // ADR 0022's other spelling, and the reason nothing above guesses: the file
    // escapes the collision by quoting the scalar, and this is a legal table.
    const markdown = `---
kind: table
table: oddity
columns:
  - name: id
    type: uuid
    pk: true
  - name: "{ expression: lower(email) }"
    type: text
indexes:
  - name: oddity_odd_column_idx
    columns: ["{ expression: lower(email) }"]
---

A column whose name is the other spelling.
`
    const { model, diagnostics } = await withModel({ 'tables/oddity.md': markdown })
    const table = model.tables[0]
    if (table === undefined) throw new Error('the oddity table did not load')

    expect(diagnostics.map((d) => d.code)).toEqual([])
    expect(validate(model).map((d) => d.code)).toEqual([])
    expect(indexNamed(table, 'oddity_odd_column_idx').columns).toEqual([
      '{ expression: lower(email) }',
    ])
    // Byte for byte, quotes and all, so the advice above is about a file the
    // writer can produce rather than one only a person can type.
    expect(serialiseObject(table)).toBe(markdown)
  })

  test('and misspelling it still gets the ordinary complaint about the name', async () => {
    const { model } = await withModel({
      'tables/entry.md': AS_MARKDOWN.replace('columns: [lower(ledger_code)]', 'columns: [ledgr]'),
    })
    expect(validate(model)[0]?.message).toContain('write it as `{ expression: ledgr }`')
  })
})
