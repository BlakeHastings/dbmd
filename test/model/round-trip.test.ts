/**
 * The two properties the format stands on.
 *
 * 1. Parsing a serialised model gives back an equal model, for every model.
 * 2. Serialising a parsed file gives back identical bytes, for every canonical
 *    file.
 *
 * The second holds only for canonical input, and that asymmetry is the design
 * rather than a weakness: a hand-written file normalises on its first save and
 * then never moves again. `test/fixtures/untidy/` is the proof of the "then
 * never moves again" half.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readModel, splitFrontmatter } from '../../src/model/read.js'
import { writeModel } from '../../src/model/write.js'
import type { Group, Layout, Model, Note, Table } from '../../src/model/types.js'
import { canonicalModel, exampleShop, snapshot, untidyModel, withCopy } from './fixtures.js'

describe('property 2: a canonical file serialises back to identical bytes', () => {
  test('every file in the canonical fixture is already what the writer would write', async () => {
    await withCopy(canonicalModel, async (dir) => {
      const before = await snapshot(dir)
      const { model, diagnostics } = await readModel(dir)

      expect(diagnostics).toEqual([])
      const { written } = await writeModel(dir, model)

      // Nothing was written, which is the strongest form of "identical bytes":
      // the writer looked at all fifteen files and had nothing to say about any
      // of them.
      expect(written).toEqual([])
      expect(await snapshot(dir)).toEqual(before)
    })
  })
})

describe('property 1: a serialised model parses back to an equal model', () => {
  test('the canonical fixture survives a read, a write and a read', async () => {
    const first = await readModel(canonicalModel)
    await withCopy(canonicalModel, async (dir) => {
      await writeModel(dir, first.model)
      const second = await readModel(dir)
      expect(second.diagnostics).toEqual([])
      expect(second.model).toEqual(first.model)
    })
  })

  test.each(generatedModels())(
    'a generated model round-trips through the filesystem: $label',
    async ({ input }) => {
      const dir = await mkdtemp(join(tmpdir(), 'dbmd-generated-'))
      try {
        const firstWrite = await writeModel(dir, input)
        expect(firstWrite.skipped.filter((skip) => skip.reason !== 'unchanged')).toEqual([])

        const { model, diagnostics } = await readModel(dir)
        expect(diagnostics).toEqual([])
        expect(model.name).toEqual(input.name)
        expect(model.engine).toEqual(input.engine)
        expect(model.body).toEqual(input.body)
        expect(model.tables).toEqual(input.tables)
        expect(model.notes).toEqual(input.notes)
        expect(model.groups).toEqual(input.groups)

        // And having gone round once, it does not move again.
        expect((await writeModel(dir, model)).written).toEqual([])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('an untidy file normalises once and then never moves', () => {
  test('the second save of a hand-written model writes nothing', async () => {
    await withCopy(untidyModel, async (dir) => {
      const first = await readModel(dir)
      expect(first.diagnostics).toEqual([])
      const firstSave = await writeModel(dir, first.model)

      // Every file was hand-written badly, so every file changes on save one.
      expect(firstSave.written).toEqual([
        '_model.md',
        'groups/billing.md',
        'notes/floating.md',
        'tables/customers.md',
        'tables/orders.md',
      ])

      const second = await readModel(dir)
      const secondSave = await writeModel(dir, second.model)
      expect(secondSave.written).toEqual([])
      expect(second.model).toEqual(first.model)
    })
  })

  test('a CRLF body keeps its carriage returns while the frontmatter becomes LF', async () => {
    const original = await readFile(join(untidyModel, 'tables', 'orders.md'), 'utf8')
    expect(original).toContain('\r\n')

    await withCopy(untidyModel, async (dir) => {
      const { model } = await readModel(dir)
      await writeModel(dir, model)
      const saved = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')

      const body = bodyOf(saved)
      // The body is the bytes the reader handed over, and the reader sliced
      // them out of a CRLF file.
      expect(body).toBe(bodyOf(original))
      expect(body).toContain('\r\n')
      expect(saved.slice(0, saved.length - body.length)).not.toContain('\r')
    })
  })

  test('a body that never had a trailing newline does not grow one', async () => {
    await withCopy(untidyModel, async (dir) => {
      const { model } = await readModel(dir)
      await writeModel(dir, model)
      const saved = await readFile(join(dir, 'tables', 'customers.md'), 'utf8')
      expect(saved.endsWith('without a newline.')).toBe(true)
    })
  })
})

/** The reader's own split, so the test agrees with it about where a body starts. */
function bodyOf(text: string): string {
  const split = splitFrontmatter(text)
  if (split.outcome !== 'ok') throw new Error(`fixture has no frontmatter: ${split.outcome}`)
  return split.body
}

// --------------------------------------------------------------------------
// The generated models.
//
// The interesting half of a model is not its shape but its strings: every trap
// in ADR 0003 and ADR 0008 is a string that YAML resolves to something that is
// not a string. The pool below is those traps plus the ordinary cases, and the
// generator's only job is to get them into every position the format has.
// --------------------------------------------------------------------------

/** Strings a column name, a type or a default may be. Each one is a trap. */
const AWKWARD = [
  'uuid',
  'numeric(12,2)',
  'timestamp with time zone',
  "'pending'",
  'null',
  'true',
  'on',
  'off',
  'y',
  'n',
  '1',
  '-1',
  '+3',
  '1.5',
  '.nan',
  '0x10',
  '1:30',
  '2001-12-14',
  '~',
  '=',
  '',
  ' leading',
  'trailing ',
  'a: b',
  'a #b',
  '# comment',
  '- item',
  '[a, b]',
  '{a: b}',
  'now()::text',
  'a"b',
  "a'b",
  'a\\b',
  'a\nb',
  'a\tb',
  'café',
  '日本語',
  '  ',
]

/** Names that also have to work as file names, so they are a narrower set. */
const OBJECT_NAMES = ['orders', 'customers', 'null', 'on', 'Ünïcode', 'order-items', 'a b', 'x0']

/** A ref's column cannot hold a dot: the reader splits on the last one. */
const REF_PARTS = ['id', 'customer_id', 'null', 'on', 'a b']

const BODIES = [
  '',
  '\nOrdinary prose.\n',
  '\n---\n\nA body that opens with three dashes on its own line.\n',
  '\r\nA body with carriage returns.\r\n',
  'No leading blank line and no trailing newline.',
  '\n```sql\nCOPY t FROM STDIN;\n---\n```\n',
]

/** A small deterministic generator, so a failure is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function generatedModels(): { label: string; input: Model }[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({
    label: `seed ${seed}`,
    input: generateModel(seed),
  }))
}

function generateModel(seed: number): Model {
  const next = random(seed)
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T
  const count = (max: number): number => Math.floor(next() * (max + 1))
  const maybe = (): boolean => next() < 0.5
  const coordinate = (): number => Math.floor(next() * 4000) - 2000

  const groupNames = distinct(OBJECT_NAMES, count(3), next)
  const groups: Group[] = groupNames.map((name) => ({
    kind: 'group',
    name,
    path: `groups/${name}.md`,
    body: pick(BODIES),
    complete: true,
    ...(maybe() ? { label: pick(AWKWARD) } : {}),
    ...(maybe() ? { color: pick(AWKWARD) } : {}),
  }))

  const noteNames = distinct(OBJECT_NAMES, count(3), next)
  const notes: Note[] = noteNames.map((name) => ({
    kind: 'note',
    name,
    path: `notes/${name}.md`,
    body: pick(BODIES),
    complete: true,
    ...(maybe() ? { layout: layout(coordinate, maybe) } : {}),
    ...(maybe() ? { color: pick(AWKWARD) } : {}),
  }))

  const tableNames = distinct(OBJECT_NAMES, 1 + count(5), next)
  const tables: Table[] = tableNames.map((name) => ({
    kind: 'table',
    name,
    path: `tables/${name}.md`,
    body: pick(BODIES),
    complete: true,
    columns: Array.from({ length: count(4) }, () => ({
      name: pick(AWKWARD),
      type: pick(AWKWARD),
      ...(maybe() ? { pk: maybe() } : {}),
      ...(maybe() ? { nullable: maybe() } : {}),
      ...(maybe() ? { default: pick(AWKWARD) } : {}),
      ...(maybe() ? { ref: { table: pick(OBJECT_NAMES), column: pick(REF_PARTS) } } : {}),
    })),
    indexes: Array.from({ length: count(2) }, () => ({
      name: pick(AWKWARD),
      columns: Array.from({ length: count(3) }, () => pick(AWKWARD)),
    })),
    ...(groups.length > 0 && maybe() ? { group: pick(groups).name } : {}),
    ...(maybe() ? { layout: { x: coordinate(), y: coordinate() } } : {}),
  }))

  return {
    ...(maybe() ? { name: pick(AWKWARD) } : {}),
    ...(maybe() ? { engine: pick(AWKWARD) } : {}),
    body: pick(BODIES),
    complete: true,
    tables: sortByName(tables),
    notes: sortByName(notes),
    groups: sortByName(groups),
    referencesTo: new Map(),
    groupMembers: new Map(),
  }
}

function layout(coordinate: () => number, maybe: () => boolean): Layout {
  return {
    x: coordinate(),
    y: coordinate(),
    ...(maybe() ? { w: coordinate() } : {}),
    ...(maybe() ? { h: coordinate() } : {}),
  }
}

function distinct(pool: readonly string[], howMany: number, next: () => number): string[] {
  const chosen = new Set<string>()
  for (let attempt = 0; attempt < howMany * 4 && chosen.size < howMany; attempt++) {
    chosen.add(pool[Math.floor(next() * pool.length)] as string)
  }
  return [...chosen]
}

function sortByName<T extends { name: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// --------------------------------------------------------------------------
// And over `examples/shop`, which is the strongest material in the repository
// for this: eight real tables written by a person from ADR 0003 alone, with
// prose bodies full of fences, emphasis, colons and dashes.
// --------------------------------------------------------------------------

describe('examples/shop, hand-written from the ADR', () => {
  test('normalises only where the ADR never said what to do, and then settles', async () => {
    await withCopy(exampleShop, async (dir) => {
      const before = await snapshot(dir)
      const first = await readModel(dir)
      expect(first.diagnostics).toEqual([])

      const { written } = await writeModel(dir, first.model)
      const after = await snapshot(dir)

      // Whatever moved, every changed line is a `default:`: key order,
      // indentation, flow style and every body came back untouched. The example
      // quotes a SQL literal as `"\'GB\'"` the way ADR 0003 shows, and quotes a
      // non-string default as `\'1\'` the way nothing shows, and the second is
      // the one this item had to decide.
      for (const path of written) {
        const changed = changedLines(before.get(path) ?? '', after.get(path) ?? '')
        expect(changed.filter((line) => !line.trimStart().startsWith('default:'))).toEqual([])
      }

      const second = await readModel(dir)
      expect(second.model).toEqual(first.model)
      const secondSave = await writeModel(dir, second.model)
      expect(secondSave.written).toEqual([])
    })
  })
})

/** The lines in one text and not in the other, in both directions. */
function changedLines(before: string, after: string): string[] {
  const kept = new Set(after.split('\n'))
  const original = new Set(before.split('\n'))
  return [
    ...before.split('\n').filter((line) => !kept.has(line)),
    ...after.split('\n').filter((line) => !original.has(line)),
  ]
}
