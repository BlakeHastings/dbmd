/**
 * The mermaid renderer.
 *
 * The claim every test here is really making is that the emitted diagram
 * **parses**, because the failure this module exists to prevent is the one that
 * produces no error anywhere: a table or a column mermaid's grammar cannot
 * spell renders on GitHub as a blank box, in somebody else's pull request.
 *
 * That claim used to be asserted by proxy. This file opened by saying there was
 * no mermaid parser here to assert it against and that adding one would be a
 * dependency the size of a browser, so what it asserted instead was the shape
 * the diagram had been measured to need. Half of that was true and dbmd-7s6
 * measured the other half: rendering mermaid needs a DOM, and parsing does not.
 * `mermaid.parse` runs in plain Node with no `document`, no `window`, no jsdom
 * and no headless browser, and it is the same grammar GitHub renders with, so
 * it is now a devDependency and it is what says the diagram parses. ADR 0048.
 *
 * So the shape assertions below have stopped standing in for that claim and
 * have gone back to being what they read as: assertions about what the picture
 * says. `diagram()` hands every diagram this file builds to mermaid first, and
 * the last two blocks are the ones the parser made possible, over the names an
 * import produces rather than the tame ones in `examples/shop`.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import mermaid from 'mermaid'
import { mermaidDiagram, mermaidSection } from '../../src/export/mermaid.js'
import { modelFromIntrospection } from '../../src/import/model.js'
import { readIntrospection } from '../../src/import/read.js'
import { readModel } from '../../src/model/read.js'
import type { Column, Model } from '../../src/model/types.js'
import { exampleShop } from '../model/fixtures.js'
import { withModel } from '../model/helpers.js'

/**
 * `''` when mermaid parses the text, and mermaid's own complaint when it does
 * not.
 *
 * A helper that threw would report which case failed and not why, and mermaid's
 * message names the line and the token, which is the whole value of having a
 * parser here. `expect(await parseError(text)).toBe('')` prints it.
 *
 * `mermaid.parse` is the entirety of what this file uses the dependency for. It
 * detects the diagram type, runs the `erDiagram` grammar over the text and
 * returns; no renderer, no layout, no DOM.
 */
async function parseError(text: string): Promise<string> {
  try {
    await mermaid.parse(text)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The lines of the diagram, so an assertion is about one line rather than an
 * offset, and mermaid's verdict on the whole of it before any of them.
 *
 * Every case in this file goes through here and therefore parses before it is
 * read. The empty model is the one diagram that does not: it has its own test
 * below, and `mermaid.parse('')` is a missing diagram type rather than a
 * grammar error, which is a different sentence about a different thing.
 */
async function diagram(files: Record<string, string>): Promise<string[]> {
  const { model } = await withModel(files)
  const text = mermaidDiagram(model)
  expect(await parseError(text)).toBe('')
  return text.split('\n')
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

    expect(await parseError(mermaidDiagram(model))).toBe('')
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

// --------------------------------------------------------------------------
// The three blocks below are the ones the parser made possible. Everything
// above proves the diagram says the right thing; these prove it is a diagram.
// --------------------------------------------------------------------------

/**
 * A committed provider payload, read the way `dbmd import` reads one, as the
 * model that import would have written.
 *
 * `examples/shop` is a hand-written model with tame names, so drawing it proves
 * the least interesting case. These two files are what two real catalogues
 * actually returned: a table called `Ledger [Entry]` that dbmd-44 met rather
 * than invented, columns with spaces in them, `character varying(32)` and
 * `numeric(12,2)`, and an index over `lower(ledger_code)` sitting beside a
 * column of that name.
 */
function imported(fixture: string): Model {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../import/fixtures/${fixture}.json`, import.meta.url), 'utf8'),
  )
  const read = readIntrospection(raw)
  if (!read.ok) {
    throw new Error(`${fixture}: ${read.diagnostics.map((d) => d.message).join('; ')}`)
  }
  return modelFromIntrospection(read.value).model
}

describe('the names an import produces, which is where the tame ones run out', () => {
  test('what a live SQL Server 2022 catalogue produced, pasted rather than imagined', async () => {
    // `[Ledger [Entry]]]` was created in a real SQL Server 2022, introspected
    // with the recipe `dbmd import` prints, imported and exported. The text
    // below is what `dbmd export` wrote, byte for byte. It is asserted as a
    // literal rather than rebuilt from a fixture because the question this item
    // asked is whether the bytes a user's GitHub renders are bytes mermaid
    // takes, and a string that made the round trip is the one answer nobody can
    // say was arranged to pass. Three things in it had never been checked: the
    // brackets and the space inside a quoted entity name, and `nvarchar(max)`
    // and `datetime2(7)` sitting bare in the type position, which has no quoted
    // form at all.
    const asExported = `erDiagram
  "Ledger [Entry]" {
    int id PK
    nvarchar(max) note
  }
  "customers" {
    uniqueidentifier id PK
    nvarchar(200) email UK
    datetime2(7) created_at
  }
  "orders" {
    bigint id PK
    uniqueidentifier customer_id FK
    int total_pence
  }
  "customers" ||..o{ "orders" : "customer_id"
`
    expect(await parseError(asExported)).toBe('')
  })

  test('a SQL Server catalogue: a bracket in a table name, spaces in column names', async () => {
    const text = mermaidDiagram(imported('sqlserver-provider-raw'))
    expect(await parseError(text)).toBe('')

    // Quoted, so the bracket and the space both survive as themselves.
    expect(text).toContain('  "Ledger [Entry]" {')
    // Rewritten, because an attribute row has no quoted form, with the true
    // `type name` in the row's comment beside it.
    expect(text).toMatch(/^ {4}nvarchar\(50\) Ledger_Code.*"nvarchar\(50\) Ledger Code"$/m)
  })

  test('a Postgres catalogue: type modifiers, and an expression index beside a column of that name', async () => {
    const text = mermaidDiagram(imported('postgres-provider-raw'))
    expect(await parseError(text)).toBe('')

    // The two spellings ADR 0029 puts back together, in the two positions that
    // treat a comma differently.
    expect(text).toMatch(/^ {4}character_varying\(32\) .*"character varying\(32\) /m)
    expect(text).toMatch(/^ {4}numeric\(12,2\) /m)
    // ADR 0022's shape, drawn: the expression marks nothing, and the column
    // that happens to be spelled the same way is still a column.
    expect(text).not.toContain('object')
  })
})

/**
 * A model built in memory rather than read from a directory.
 *
 * `mermaidDiagram` is exported from `src/index.ts`, and some of what a name can
 * hold never comes off a disk: a backslash cannot be in a file name on Windows,
 * a control character cannot be in one anywhere, and `readModel` skips a
 * dot-file so a table read from a directory is never called nothing. A model
 * holding any of those reaches this module without having been a file, which is
 * the only way to put these three characters in front of the parser.
 */
function inMemory(name: string, columns: readonly Pick<Column, 'name' | 'type'>[]): Model {
  return {
    body: '',
    complete: true,
    tables: [
      {
        kind: 'table',
        name,
        path: `tables/${name}.md`,
        body: '',
        complete: true,
        columns,
        indexes: [],
      },
    ],
    notes: [],
    groups: [],
    referencesTo: new Map(),
    groupMembers: new Map(),
    refused: [],
  }
}

describe('what the parser corrected, which is the reason it is here', () => {
  test('a backslash and a percent are escapes, because mermaid refuses both raw', async () => {
    // ADR 0023 recorded that a quoted entity name took "every character tried".
    // These two were not tried: `a\b` is a legal file name on Linux, and `%%`
    // opens a comment to mermaid's lexer.
    const text = mermaidDiagram(inMemory('a\\b%c', [{ name: 'id', type: 'uuid' }]))
    expect(await parseError(text)).toBe('')
    expect(text).toContain('  "a#92;b#37;c" {')
  })

  test('a control character is still a space, and the diagram still parses', async () => {
    const text = mermaidDiagram(inMemory('a\u0007b', [{ name: 'id', type: 'uuid' }]))
    expect(await parseError(text)).toBe('')
    expect(text).toContain('  "a b" {')
  })

  test('a word may not open with a bracket, a dot, a hyphen or a paren', async () => {
    // `[int]` is how the SQL Server catalogue spells a type to itself, and
    // `(deleted)` is a column name a person can write. Both were legal in the
    // middle of a word and a parse error at the front of one, and the old rule
    // guarded a leading digit only.
    const text = mermaidDiagram(
      inMemory('t', [
        { name: '[Entry]', type: '[int]' },
        { name: '(deleted)', type: '.text' },
        { name: '-id', type: '-uuid' },
      ]),
    )
    expect(await parseError(text)).toBe('')
    expect(text).toContain('    _[int] _[Entry] "[int] [Entry]"')
    expect(text).toContain('    _.text _(deleted) ".text (deleted)"')
    expect(text).toContain('    _-uuid _-id "-uuid -id"')
  })

  test('a table with no name is a box with no name, rather than a parse error', async () => {
    // An empty entity name is `""`, which mermaid refuses. A nameless table is
    // not a name for this module to invent, so it gets a nameless box: ADR 0027
    // keeps an empty name rather than losing it, and this keeps the picture of
    // it honest.
    const text = mermaidDiagram(inMemory('', [{ name: 'id', type: 'uuid' }]))
    expect(await parseError(text)).toBe('')
    expect(text).toContain('  " " {')
  })
})

describe('the parser can say no, which is what makes the rest of this file evidence', () => {
  // ADR 0034: a guard that never fires looks exactly like a guard that cannot.
  // Every line below is what this module would emit if one rule of ADR 0023
  // were dropped, and mermaid's verdict on each is the reason the assertions
  // above are worth writing.
  const refused: Record<string, string> = {
    // The reserved word. `style` is why every entity name is quoted rather than
    // the ones that look dangerous.
    'a bare entity name the grammar reserves': 'erDiagram\n  style {\n    uuid id PK\n  }\n',
    // The empty one, which is what `quoted` now spends a space avoiding.
    'an empty entity name': 'erDiagram\n  "" {\n    uuid id PK\n  }\n',
    // The two characters no quoting rescues.
    'a raw backslash in a quoted entity name': 'erDiagram\n  "a\\b" {\n    uuid id PK\n  }\n',
    'a raw percent in a quoted entity name': 'erDiagram\n  "a%b" {\n    uuid id PK\n  }\n',
    // An attribute has no quoted form in either position, which is why `word`
    // rewrites rather than escapes.
    'a quoted attribute name': 'erDiagram\n  "t" {\n    uuid "order id" PK\n  }\n',
    'a space in an attribute type': 'erDiagram\n  "t" {\n    character varying(32) name\n  }\n',
    'a leading digit in an attribute name': 'erDiagram\n  "t" {\n    text 2fa_token\n  }\n',
    'a leading bracket in an attribute type': 'erDiagram\n  "t" {\n    [int] id\n  }\n',
    'a leading paren in an attribute name': 'erDiagram\n  "t" {\n    text (deleted)\n  }\n',
    // The key markers, which the lexer takes in any case.
    'a key marker as an attribute name': 'erDiagram\n  "t" {\n    text pk\n  }\n',
  }

  for (const [what, text] of Object.entries(refused)) {
    test(`mermaid refuses ${what}`, async () => {
      expect(await parseError(text)).toMatch(/error/i)
    })
  }
})

describe('a bare entity name is worse than a parse error now, which is a finding', () => {
  test('two bare words are an entity and an alias, so an unquoted name renders the wrong thing', async () => {
    // ADR 0023 measured that a bare entity name may not contain a space. In
    // mermaid 11.17 it may: `order items {` is the entity `order` labelled
    // `items`, and it parses. So dropping the quotes would no longer produce a
    // blank box; it would produce a picture of a table nobody has, which is the
    // failure this module exists to prevent wearing a better disguise.
    expect(await parseError('erDiagram\n  order items {\n    uuid id PK\n  }\n')).toBe('')
    // Three words is still an error, so the bare form is not a general escape
    // hatch either. Quoting remains the rule and now has two reasons.
    expect(await parseError('erDiagram\n  one two three {\n    uuid id PK\n  }\n')).toMatch(
      /error/i,
    )
  })
})
