/**
 * What the writer does, and the ways it could quietly ruin the format.
 *
 * The round trip lives in `round-trip.test.ts`. This file is the rest: the
 * canonical shape itself, the quoting rule, the files that must not be written,
 * and the two behaviours nobody notices until the day they matter, which are
 * the atomic replace and the refusal to rewrite a file that did not change.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parse } from 'yaml'
import { readModel } from '../../src/model/read.js'
import { scalar, serialiseModelFile, serialiseObject, writeModel } from '../../src/model/write.js'
import type { Group, Model, Note, Table } from '../../src/model/types.js'
import { fixtureModel } from './helpers.js'
import { canonicalModel, exampleShop, snapshot, withCopy } from './fixtures.js'

/**
 * `rename` is the one call whose failure the writer has to survive, and no real
 * filesystem will fail it on demand. `vi.hoisted` because the mock factory is
 * lifted above every import and the switch has to exist by then.
 */
const rename = vi.hoisted(() => ({
  instead: undefined as undefined | ((from: string, to: string) => Promise<void>),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    rename: async (from: string, to: string) =>
      rename.instead === undefined ? actual.rename(from, to) : rename.instead(from, to),
  }
})

afterEach(() => {
  rename.instead = undefined
})

describe('the canonical shape', () => {
  test('a table is kind, name, columns, indexes, group, layout, in that order', () => {
    // An index entry is name, columns, unique, and `unique` is absent on a plain
    // index rather than written as `false`: one canonical spelling per fact.
    expect(
      serialiseObject(
        table({
          columns: [
            { name: 'id', type: 'uuid', pk: true },
            {
              name: 'customer_id',
              type: 'uuid',
              nullable: false,
              ref: { table: 'customers', column: 'id' },
            },
            { name: 'status', type: 'text', nullable: false, default: "'pending'" },
          ],
          indexes: [
            { name: 'orders_customer_status_idx', columns: ['customer_id', 'status'] },
            { name: 'orders_psp_reference_key', columns: ['psp_reference'], unique: true },
          ],
          group: 'billing',
          layout: { x: 480, y: 120 },
        }),
      ),
    ).toBe(`---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
  - name: status
    type: text
    nullable: false
    default: "'pending'"
indexes:
  - name: orders_customer_status_idx
    columns: [customer_id, status]
  - name: orders_psp_reference_key
    columns: [psp_reference]
    unique: true
group: billing
layout: { x: 480, y: 120 }
---

Prose.
`)
  })

  test('a note carries its size and a table does not', () => {
    const note: Note = {
      kind: 'note',
      name: 'why',
      path: 'notes/why.md',
      body: '\nWhy.\n',
      complete: true,
      layout: { x: 120, y: 640, w: 320, h: 200 },
      color: 'amber',
    }
    expect(serialiseObject(note)).toBe(
      '---\nkind: note\nlayout: { x: 120, y: 640, w: 320, h: 200 }\ncolor: amber\n---\n\nWhy.\n',
    )

    // A table's size is a consequence of its columns (ADR 0005), so a `w` that
    // reached the model some other way is dropped rather than written back out
    // for the reader to warn about on every load.
    expect(serialiseObject(table({ layout: { x: 1, y: 2, w: 3, h: 4 } }))).toContain(
      'layout: { x: 1, y: 2 }\n',
    )
  })

  test('a group says what it is and never who is in it or where it sits', () => {
    const group: Group = {
      kind: 'group',
      name: 'billing',
      path: 'groups/billing.md',
      body: '\nBilling.\n',
      complete: true,
      label: 'Billing',
      color: 'violet',
    }
    const text = serialiseObject(group)
    expect(text).toBe('---\nkind: group\nlabel: Billing\ncolor: violet\n---\n\nBilling.\n')
    expect(text).not.toContain('members')
    expect(text).not.toContain('layout')
  })

  test('membership is written on the member', () => {
    expect(serialiseObject(table({ group: 'billing' }))).toContain('\ngroup: billing\n')
  })

  test('an empty list is no key rather than an empty one', () => {
    expect(serialiseObject(table())).toBe('---\nkind: table\ntable: orders\n---\n\nProse.\n')
  })

  test('the model file is kind, name, engine', () => {
    expect(
      serialiseModelFile({ ...model([]), name: 'shop', engine: 'postgres', body: '\nThe shop.\n' }),
    ).toBe('---\nkind: model\nname: shop\nengine: postgres\n---\n\nThe shop.\n')
  })

  test('the body is concatenated, never regenerated', () => {
    const awkward = '\r\nA CRLF body\r\n\r\n```\n---\n```\nand a fence full of dashes.'
    expect(serialiseObject(table({ body: awkward })).endsWith(awkward)).toBe(true)
  })
})

describe('quoting', () => {
  /**
   * The rule the format rests on, stated as the test that proves it: whatever
   * `scalar` emits, a YAML parser reads back as the string it was handed. The
   * list is the traps from ADR 0003 and ADR 0008 plus every character YAML
   * gives a meaning to at the start of a scalar.
   */
  const nasty = [
    'uuid',
    'numeric(12,2)',
    'timestamp with time zone',
    "'pending'",
    'now()::text',
    'null',
    'Null',
    'NULL',
    '~',
    'true',
    'FALSE',
    'on',
    'Off',
    'y',
    'N',
    'yes',
    '=',
    '',
    ' ',
    '  x  ',
    ' leading',
    'trailing ',
    '0',
    '-1',
    '+3',
    '1.5',
    '1e9',
    '.inf',
    '.nan',
    '0x1f',
    '0o17',
    '1:30',
    '2001-12-14',
    '2001-12-14T21:59:43.10-05:00',
    'a: b',
    'a:b',
    'a #b',
    '#a',
    '- a',
    '? a',
    ': a',
    ', a',
    '[a]',
    ']a',
    '{a}',
    '}a',
    '&a',
    '*a',
    '!a',
    '|a',
    '>a',
    "'a",
    '"a',
    '%a',
    '@a',
    '`a',
    'a\nb',
    'a\r\nb',
    'a\tb',
    'a\\b',
    'a b',
    'a\u00a0b',
    'a\u0085b',
    'a\u2028b',
    'a\ufeffb',
    'a"b',
    "a'b",
    'café',
    '日本語',
    '\u{1f600}',
    'a'.repeat(400),
  ]

  test.each(nasty)('a block scalar reads back as itself: %j', (value) => {
    expect(parse(`k: ${scalar(value)}`)).toEqual({ k: value })
  })

  test.each(nasty)('a flow scalar reads back as itself: %j', (value) => {
    expect(parse(`k: [${scalar(value, 'flow')}]`)).toEqual({ k: [value] })
  })

  test('a long scalar is never folded, because a fold is a diff', () => {
    expect(scalar(`${'x'.repeat(500)} ${'y'.repeat(500)}`)).not.toContain('\n')
  })

  test('ordinary words stay unquoted, so a diff stays readable', () => {
    expect(scalar('uuid')).toBe('uuid')
    expect(scalar('numeric(12,2)')).toBe('numeric(12,2)')
    expect(scalar('now()')).toBe('now()')
  })

  test('quoting is double, always, so there is one way to write a value', () => {
    expect(scalar('null')).toBe('"null"')
    expect(scalar("'pending'")).toBe('"\'pending\'"')
    expect(scalar('1')).toBe('"1"')
  })
})

describe('only what changed is written', () => {
  test('changing one column type writes one file out of fifteen', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const { model: read } = await readModel(dir)
      const retyped = withTable(read, 'orders', (orders) => ({
        ...orders,
        columns: orders.columns.map((column) =>
          column.name === 'status' ? { ...column, type: 'varchar(32)' } : column,
        ),
      }))

      const { written, skipped } = await writeModel(dir, retyped)
      expect(written).toEqual(['tables/orders.md'])
      expect(skipped.every((skip) => skip.reason === 'unchanged')).toBe(true)
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toContain(
        '    type: varchar(32)\n',
      )
    })
  })

  test('`only` leaves a neighbour that is not canonical exactly as it was', async () => {
    // The example model is hand-written, so a whole-model write over it also
    // canonicalises files nobody edited. A caller saving one edit says which
    // files it edited and gets a one-file diff instead of a four-file one.
    await withCopy(exampleShop, async (dir) => {
      const before = await snapshot(dir)
      const { model: read } = await readModel(dir)
      const moved = withTable(read, 'orders', (orders) => ({
        ...orders,
        layout: { x: 11, y: 22 },
      }))

      const { written } = await writeModel(dir, moved, { only: new Set(['tables/orders.md']) })
      expect(written).toEqual(['tables/orders.md'])

      const after = await snapshot(dir)
      const changed = [...after].filter(([path, text]) => before.get(path) !== text)
      expect(changed.map(([path]) => path)).toEqual(['tables/orders.md'])
    })
  })

  test('`only` covers `_model.md`, which is otherwise written on every call', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const { model: read } = await readModel(dir)
      const renamed: Model = { ...read, name: 'something-else' }
      expect(
        (await writeModel(dir, renamed, { only: new Set(['tables/orders.md']) })).written,
      ).toEqual([])
    })
  })

  test('adding a table to a group touches that table and not the group', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const before = await snapshot(dir)
      const { model: read } = await readModel(dir)
      const joined = withTable(read, 'shipments', (shipments) => ({
        ...shipments,
        group: 'billing',
      }))

      expect((await writeModel(dir, joined)).written).toEqual(['tables/shipments.md'])

      const after = await snapshot(dir)
      expect(after.get('groups/billing.md')).toBe(before.get('groups/billing.md'))
      expect(after.get('tables/shipments.md')).toBe(
        before.get('tables/shipments.md')?.replace('layout:', 'group: billing\nlayout:'),
      )
    })
  })

  test('a group drag writes the members that moved and nothing else', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const before = await snapshot(dir)
      const { model: read } = await readModel(dir)
      const inBilling = new Set(read.groupMembers.get('billing') ?? [])
      expect(inBilling.size).toBe(4)

      // A drag picks up every member. Two of them are put back exactly where
      // they were, which is the case that makes `git status` useless if the
      // writer trusts the caller about what changed.
      const stayed = new Set(['payments', 'refunds'])
      const dragged: Model = {
        ...read,
        tables: read.tables.map((current) =>
          inBilling.has(current.name) && !stayed.has(current.name) && current.layout !== undefined
            ? { ...current, layout: { ...current.layout, x: current.layout.x + 40 } }
            : current,
        ),
      }

      expect((await writeModel(dir, dragged)).written).toEqual([
        'tables/invoice_lines.md',
        'tables/invoices.md',
      ])
      const after = await snapshot(dir)
      expect(after.get('groups/billing.md')).toBe(before.get('groups/billing.md'))
      expect(after.get('tables/payments.md')).toBe(before.get('tables/payments.md'))
    })
  })
})

describe('a file the reader could not fully load', () => {
  /**
   * The shortest call the signature allows, which is the one a careless caller
   * makes. There is no option to forget, because the fact that a file did not
   * fully load travels on the object that came out of it.
   */
  test('is left exactly as it is by the shortest possible call', async () => {
    await withCopy(fixtureModel, async (dir) => {
      const before = await snapshot(dir)
      const { model: read } = await readModel(dir)

      const { written, skipped } = await writeModel(dir, read)
      const after = await snapshot(dir)

      // `coerced.md` loads with one of its four columns, because three of them
      // hold values YAML did not resolve to strings. Writing the model back
      // would silently delete two columns and a default from the file its
      // author has to fix, and their undo is a commit that has not happened.
      expect(skipped).toContainEqual({ path: 'tables/coerced.md', reason: 'incomplete' })
      expect(written).not.toContain('tables/coerced.md')
      expect(after.get('tables/coerced.md')).toBe(before.get('tables/coerced.md'))
      expect(after.get('tables/coerced.md')).toContain('unqiue: true')
    })
  })

  test('says so on the object, so the fact survives being carried around', async () => {
    const { model: read } = await readModel(fixtureModel)
    const complete = (name: string): boolean | undefined =>
      read.tables.find((current) => current.name === name)?.complete

    expect(complete('coerced')).toBe(false)
    expect(complete('orders')).toBe(true)

    // `shipments` declares `group: shipping` and there is no such group, which
    // is an error. It is an error about the model rather than about this file:
    // everything the file says did reach the object, so saving it loses
    // nothing and it is not marked incomplete.
    expect(complete('shipments')).toBe(true)
  })

  test('is not deleted either, because a broken file is missing from the model', async () => {
    await withCopy(fixtureModel, async (dir) => {
      const before = await snapshot(dir)
      const { model: read } = await readModel(dir)
      await writeModel(dir, read)
      const after = await snapshot(dir)
      expect([...after.keys()]).toEqual([...before.keys()])
      for (const path of ['tables/broken-yaml.md', 'tables/no-frontmatter.md', 'notes/misfiled.md'])
        expect(after.get(path)).toBe(before.get(path))
    })
  })

  test('a `_model.md` that half loaded is not overwritten with what survived', async () => {
    await withCopy(fixtureModel, async (dir) => {
      const broken = '---\nkind: model\nname: 1\n---\n\nThe name is a number.\n'
      await writeFile(join(dir, '_model.md'), broken, 'utf8')

      const { model: read } = await readModel(dir)
      expect(read.complete).toBe(false)
      expect(read.name).toBeUndefined()

      const { skipped } = await writeModel(dir, read)
      expect(skipped).toContainEqual({ path: '_model.md', reason: 'incomplete' })
      expect(await readFile(join(dir, '_model.md'), 'utf8')).toBe(broken)
    })
  })
})

describe('where a file goes', () => {
  test('the directories a model needs are created', async () => {
    await inEmptyDirectory(async (dir) => {
      await writeModel(dir, model([table()]))
      expect(await readdir(join(dir, 'tables'))).toEqual(['orders.md'])
    })
  })

  test('a name that is not a file name is refused rather than escaping the directory', async () => {
    await inEmptyDirectory(async (dir) => {
      const result = await writeModel(dir, model([table({ name: '../escape' })]))
      expect(result.skipped).toContainEqual({ path: 'tables/../escape', reason: 'unsafe-name' })
      expect(result.written).toEqual(['_model.md'])
    })
  })
})

describe('the write is atomic', () => {
  test('the target is untouched until a fully written temporary file replaces it', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      const { model: read } = await readModel(dir)
      const changed = withTable(read, 'orders', (orders) => ({ ...orders, group: 'billing' }))

      const observed: { source: string; destination: string }[] = []
      rename.instead = async (from, to) => {
        // At the moment of the rename the new content is already complete on
        // disk under another name and the old file is still whole. That is what
        // makes an interrupted save lose nothing.
        observed.push({
          source: await readFile(from, 'utf8'),
          destination: await readFile(to, 'utf8'),
        })
      }

      await writeModel(dir, changed)

      expect(observed).toHaveLength(1)
      expect(observed[0]?.destination).toBe(before)
      expect(observed[0]?.source).toBe(before.replace('layout:', 'group: billing\nlayout:'))
    })
  })

  test('a failed rename leaves the original whole and no rubbish behind', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const before = await snapshot(dir)
      const { model: read } = await readModel(dir)
      const changed = withTable(read, 'orders', (orders) => ({ ...orders, group: 'billing' }))

      rename.instead = async () => {
        throw new Error('the disk filled up')
      }

      await expect(writeModel(dir, changed)).rejects.toThrow('the disk filled up')
      expect(await snapshot(dir)).toEqual(before)
    })
  })

  test('a temporary file left behind by a crash is not read as part of the model', async () => {
    await withCopy(canonicalModel, async (dir) => {
      await writeFile(join(dir, 'tables', '.orders.md.6f2a.tmp'), '---\nkind: tab', 'utf8')
      const { model: read, diagnostics } = await readModel(dir)
      expect(diagnostics).toEqual([])
      expect(read.tables).toHaveLength(10)
    })
  })
})

// --------------------------------------------------------------------------
// Test plumbing.
// --------------------------------------------------------------------------

function table(over: Partial<Table> = {}): Table {
  return {
    kind: 'table',
    name: 'orders',
    path: 'tables/orders.md',
    body: '\nProse.\n',
    complete: true,
    columns: [],
    indexes: [],
    ...over,
  }
}

function model(objects: readonly (Table | Note | Group)[]): Model {
  return {
    body: '',
    complete: true,
    tables: objects.filter((object): object is Table => object.kind === 'table'),
    notes: objects.filter((object): object is Note => object.kind === 'note'),
    groups: objects.filter((object): object is Group => object.kind === 'group'),
    referencesTo: new Map(),
    groupMembers: new Map(),
  }
}

function withTable(source: Model, name: string, change: (table: Table) => Table): Model {
  return {
    ...source,
    tables: source.tables.map((current) => (current.name === name ? change(current) : current)),
  }
}

async function inEmptyDirectory(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-write-'))
  try {
    await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
