import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { readModel } from '../../src/model/read.js'
import type { Diagnostic, ReadResult } from '../../src/model/types.js'

/**
 * `examples/shop` is the demo, and it is the thing a new user copies. It is not
 * a fixture in the sense `test/fixtures/model` is: that tree is built to break
 * the reader, and this one is built to be right.
 *
 * The reason it is under test at all is rot. An example nothing runs is stale
 * within a month of the format moving, and a stale example is worse than none
 * because it teaches a format that no longer exists. So `npm run check` reads
 * it, and the day somebody changes the format without updating it, this fails.
 *
 * `dbmd check` will eventually do most of this from the command line, and when
 * it does, the parts below that duplicate it should go. The parts that do not
 * duplicate it are the ones about the prose and the layout, and those are the
 * point of the example rather than of the format.
 */

const shopDirectory = fileURLToPath(new URL('../../examples/shop', import.meta.url))

/** Read once: eight files off disk, asserted against many times. */
const shop: Promise<ReadResult> = readModel(shopDirectory)

/** Diagnostics as one line each, which is how a reviewer reads a failure. */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map(
    (d) =>
      `${d.path}${d.line === undefined ? '' : `:${d.line}`} ${d.severity} ${d.code}: ${d.message}`,
  )
}

describe('examples/shop is a model dbmd reads without complaint', () => {
  test('it produces no diagnostics at all, not even warnings', async () => {
    const { diagnostics } = await shop

    // Compared as lines rather than as length, so a failure names the file and
    // the mistake instead of saying `expected 1 to be 0`.
    expect(lines(diagnostics)).toEqual([])
  })

  test('every ref points at a column that exists', async () => {
    const { model } = await shop
    const columnsByTable = new Map(
      model.tables.map((table) => [table.name, new Set(table.columns.map((c) => c.name))]),
    )

    // The reader deliberately does not check this: a dangling `ref` is the
    // validator's question, and the validator does not exist yet. Until it
    // does, the example is the one model that has to be internally consistent,
    // so the check lives here rather than nowhere.
    const dangling = [...model.referencesTo].flatMap(([target, edges]) =>
      edges
        .filter((edge) => !(columnsByTable.get(target)?.has(edge.to.column) ?? false))
        .map((edge) => `${edge.from.table}.${edge.from.column} -> ${target}.${edge.to.column}`),
    )

    expect(dangling).toEqual([])
  })

  test('it stays small enough to read in one screenshot', async () => {
    const { model } = await shop

    // Not an arbitrary ceiling. The example earns its keep by being legible,
    // and a thirty-table demo teaches that a model is a wall of boxes. Raising
    // this number is a decision, which is why it is asserted rather than
    // assumed.
    expect(model.tables.length).toBeLessThanOrEqual(8)
    expect(model.groups.length).toBeGreaterThan(0)
    expect(model.notes.length).toBeGreaterThanOrEqual(2)
  })
})

describe('examples/shop shows off the parts of the format that are easy to miss', () => {
  test('a composite primary key is in there, spelled the way the format spells it', async () => {
    const { model } = await shop
    const composite = model.tables.filter(
      (table) => table.columns.filter((column) => column.pk === true).length > 1,
    )

    expect(composite.map((table) => table.name)).toEqual(['order_items'])
    expect(
      composite[0]?.columns.filter((column) => column.pk === true).map((column) => column.name),
    ).toEqual(['order_id', 'line_no'])
  })

  test('group membership is declared by the members and computed on the way in', async () => {
    const { model } = await shop

    // ADR 0005: the group file never lists its members. If this map is empty
    // for a group, either every `group:` key was dropped or the group is a
    // rename that went wrong, and both are worth failing over.
    for (const group of model.groups) {
      expect(model.groupMembers.get(group.name) ?? []).not.toEqual([])
    }
  })

  test('every table has a position, and no two tables sit on top of each other', async () => {
    const { model } = await shop
    const positions = model.tables.map((table) => {
      expect(table.layout, `${table.name} has no layout`).toBeDefined()
      return `${table.layout?.x},${table.layout?.y}`
    })

    expect(new Set(positions).size).toBe(model.tables.length)
  })
})

describe('examples/shop is mostly prose, which is the only reason it exists', () => {
  // A table documented with "the orders table" teaches, precisely and
  // permanently, that the prose is worthless. There is no way to assert that
  // prose is good. There is a way to assert that somebody has not gutted it,
  // and that is worth more than nothing.
  const floor = 500

  test('every table says something at length about why it is the way it is', async () => {
    const { model } = await shop
    const thin = model.tables
      .filter((table) => table.body.trim().length < floor)
      .map((table) => `${table.path} has ${table.body.trim().length} characters of prose`)

    expect(thin).toEqual([])
  })

  test('the notes and the group carry their reasoning too', async () => {
    const { model } = await shop
    const thin = [...model.notes, ...model.groups]
      .filter((object) => object.body.trim().length < floor)
      .map((object) => `${object.path} has ${object.body.trim().length} characters of prose`)

    expect(thin).toEqual([])
    expect((await shop).model.body.trim().length).toBeGreaterThan(floor)
  })
})
