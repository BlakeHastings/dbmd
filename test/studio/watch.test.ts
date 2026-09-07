import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readModel } from '../../src/model/read.js'
import { startStudio, type Studio } from '../../src/studio/index.js'
import type { WireConflict } from '../../src/studio/wire.js'
import { exampleShop, withCopy } from '../model/fixtures.js'

/**
 * The studio against a developer who is also editing the files.
 *
 * This is the suite for ADR 0019, and it is written the way the defect was
 * found: a studio running, a file changed the way a text editor changes it, and
 * an assertion about what is left on disk afterwards. Nothing here reaches into
 * `Edits`; everything goes over HTTP and comes back through `readModel`,
 * because "the developer's work is still in the file" is the only claim worth
 * making and the API is the only thing a page can see.
 *
 * The two halves are tested apart on purpose. The refusal runs at the write and
 * must hold with `watch: false`, because `fs.watch` is allowed to be late or
 * absent; the watcher is a live update and must never write anything.
 */

interface Running {
  readonly studio: Studio
  readonly dir: string
  /** Everything the server narrated, so a test can count reloads and writes. */
  readonly lines: string[]
}

async function withStudio<T>(
  use: (running: Running) => Promise<T>,
  options: {
    readonly debounceMs?: number
    readonly watchDebounceMs?: number
    readonly watch?: boolean
  } = {},
): Promise<T> {
  return withCopy(exampleShop, async (dir) => {
    const lines: string[] = []
    const studio = await startStudio({
      dir,
      port: 0,
      open: false,
      log: (message) => lines.push(message),
      // Short, so a test that waits for the watcher waits for tens of
      // milliseconds rather than for the default a person would want.
      watchDebounceMs: 40,
      ...options,
    })
    try {
      return await use({ studio, dir, lines })
    } finally {
      await studio.close()
    }
  })
}

interface Status {
  readonly conflicts: WireConflict[]
  readonly revision: number
  readonly pendingWrite: boolean
  readonly writeError: string | null
  readonly lastWrite: { paths: string[] } | null
}

async function get(studio: Studio, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, studio.url))
  return (await response.json()) as Record<string, unknown>
}

async function status(studio: Studio): Promise<Status> {
  return (await get(studio, '/api/model')) as unknown as Status
}

async function patch(
  studio: Studio,
  name: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

/** The debounce is real time, so a test that edits has to let it elapse. */
async function settle(studio: Studio): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500))
  // A request is answered after the flush, so this is a fence rather than
  // another sleep.
  await get(studio, '/api/model')
}

/**
 * Wait for a condition the watcher will bring about.
 *
 * Polling rather than a fixed sleep: `fs.watch` latency is the operating
 * system's business and a sleep long enough to be safe on a loaded Windows
 * machine would be long enough to make the suite unpleasant on every other one.
 */
async function until<T>(what: () => Promise<T | undefined>, why: string): Promise<T> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const answer = await what()
    if (answer !== undefined) return answer
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${why}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const reloads = (running: Running): string[] =>
  running.lines.filter((l) => l.startsWith('reloaded'))
const writes = (running: Running): string[] => running.lines.filter((l) => l.startsWith('wrote '))
const refusals = (running: Running): string[] =>
  running.lines.filter((l) => l.startsWith('refused to write'))

/** What a text editor does to a file: read it, change one thing, write it back. */
async function editByHand(
  dir: string,
  file: string,
  change: (text: string) => string,
): Promise<void> {
  const target = join(dir, ...file.split('/'))
  await writeFile(target, change(await readFile(target, 'utf8')), 'utf8')
}

/** One more column, spelled the way a person would type it into the frontmatter. */
const addColumn = (text: string): string =>
  text.replace('columns:\n', 'columns:\n  - name: hand_edited_note\n    type: text\n')

async function columnNames(dir: string, table: string): Promise<string[] | undefined> {
  const read = await readModel(dir)
  return read.model.tables.find((entry) => entry.name === table)?.columns.map((c) => c.name)
}

describe('a file changed on disk while an edit is pending', () => {
  it('refuses the write rather than deleting the hand edit', async () => {
    // The defect this item exists for. Before ADR 0019 the studio wrote its
    // in-memory version over the top and said nothing at all.
    await withStudio(
      async (running) => {
        // The drag happens first, so its write is genuinely in flight when the
        // editor saves. This is the window: the timer is running and the file
        // it will replace is about to change.
        const dragged = await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        expect(dragged.status).toBe(200)
        expect((dragged.body as unknown as Status).pendingWrite).toBe(true)

        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await settle(running.studio)

        expect(await columnNames(running.dir, 'orders')).toContain('hand_edited_note')
        expect(writes(running)).toEqual([])
        expect(refusals(running)).toEqual([
          'refused to write tables/orders.md: it changed on disk since the studio read it',
        ])
      },
      // Long enough that the hand edit lands inside the debounce rather than
      // after it, which is the case the item calls the sharp one.
      { debounceMs: 400 },
    )
  })

  it('says so on the status, so the page can tell the developer', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await settle(running.studio)

        const after = await status(running.studio)
        expect(after.conflicts.map((conflict) => conflict.path)).toEqual(['tables/orders.md'])
        expect(after.conflicts[0]?.message).toContain('changed on disk')
        expect(Date.parse(after.conflicts[0]?.at ?? '')).not.toBeNaN()
        // Not a write failure: nothing threw, and a page that showed this as
        // one would be telling the developer their disk is broken.
        expect(after.writeError).toBeNull()
      },
      { debounceMs: 400 },
    )
  })

  it('serves the version on disk afterwards, not the edit it refused', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await settle(running.studio)

        const body = await get(running.studio, '/api/model')
        const orders = (
          body['model'] as { tables: { name: string; layout?: { x: number } }[] }
        ).tables.find((table) => table.name === 'orders')
        // ADR 0004 has no state but the files. A refused edit kept in memory
        // would be exactly that second state, and the next flush would find the
        // disk matching its baseline again and write it after all.
        expect(orders?.layout?.x).not.toBe(700)
      },
      { debounceMs: 400 },
    )
  })

  it('refuses even with the watcher switched off', async () => {
    // The refusal is not the watcher's. `fs.watch` may coalesce, may be late,
    // and on some filesystems does not fire at all; the check that matters runs
    // immediately before the write and needs none of it.
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await settle(running.studio)

        expect(reloads(running)).toEqual([])
        expect(refusals(running)).toHaveLength(1)
        expect(await columnNames(running.dir, 'orders')).toContain('hand_edited_note')
      },
      { debounceMs: 400, watch: false },
    )
  })

  it('lets the developer make the edit again on top of what the file now says', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await settle(running.studio)
        expect((await status(running.studio)).conflicts).toHaveLength(1)

        // The second drag is made against the reloaded model, so it carries the
        // hand edit with it rather than over it.
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await settle(running.studio)

        expect((await status(running.studio)).conflicts).toEqual([])
        expect(await columnNames(running.dir, 'orders')).toContain('hand_edited_note')
        const read = await readModel(running.dir)
        expect(read.model.tables.find((t) => t.name === 'orders')?.layout).toEqual({
          x: 700,
          y: 400,
        })
      },
      { debounceMs: 400 },
    )
  })

  it('leaves a pending edit to another table alone', async () => {
    // The old code dropped a whole re-read whenever any edit was pending, which
    // was right about the edit and wrong about every other file. The reverse
    // mistake is just as easy: refusing the drag because a neighbour moved.
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/customers.md', addColumn)
        await settle(running.studio)

        expect(refusals(running)).toEqual([])
        expect(writes(running)).toEqual(['wrote tables/orders.md'])
        expect(await columnNames(running.dir, 'customers')).toContain('hand_edited_note')
        const read = await readModel(running.dir)
        expect(read.model.tables.find((t) => t.name === 'orders')?.layout).toEqual({
          x: 700,
          y: 400,
        })
      },
      { debounceMs: 400 },
    )
  })
})

describe('a file changed on disk with nothing pending', () => {
  it('reloads, so the page can show what the editor saved', async () => {
    await withStudio(async (running) => {
      const before = await status(running.studio)
      await editByHand(running.dir, 'tables/orders.md', addColumn)

      const after = await until(async () => {
        const now = await status(running.studio)
        return now.revision > before.revision ? now : undefined
      }, 'the watcher to notice a hand edit')
      expect(reloads(running)).toHaveLength(1)

      const body = await get(running.studio, '/api/model')
      const orders = (
        body['model'] as { tables: { name: string; columns: { name: string }[] }[] }
      ).tables.find((table) => table.name === 'orders')
      expect(orders?.columns.map((column) => column.name)).toContain('hand_edited_note')
      // Reloading is not editing: nothing was written and nothing is waiting to
      // be.
      expect(after.pendingWrite).toBe(false)
      expect(writes(running)).toEqual([])
    })
  })

  it('reloads a file the studio itself wrote earlier in the session', async () => {
    await withStudio(async (running) => {
      await patch(running.studio, 'orders', { layout: { x: 111, y: 222 } })
      await settle(running.studio)
      expect(writes(running)).toEqual(['wrote tables/orders.md'])
      const written = await status(running.studio)

      await editByHand(running.dir, 'tables/orders.md', addColumn)
      await until(
        async () => ((await status(running.studio)).revision > written.revision ? true : undefined),
        'the watcher to notice a hand edit to a file the studio wrote',
      )

      const body = await get(running.studio, '/api/model')
      const orders = (
        body['model'] as { tables: { name: string; columns: { name: string }[] }[] }
      ).tables.find((table) => table.name === 'orders')
      expect(orders?.columns.map((column) => column.name)).toContain('hand_edited_note')
      // Nothing to conflict over: the studio had no unwritten edit to lose.
      expect((await status(running.studio)).conflicts).toEqual([])
    })
  })

  it('does not wake up for a save the studio made itself', async () => {
    // The echo. Every write here is a `.<name>.<uuid>.tmp` renamed over its
    // target, so a naive watcher sees two events for one save and a reload that
    // rewrote the file would loop forever.
    await withStudio(async (running) => {
      const before = await status(running.studio)
      await patch(running.studio, 'orders', { layout: { x: 333, y: 444 } })
      await settle(running.studio)
      // Longer than the watch debounce, so an event that was going to arrive
      // has arrived.
      await new Promise((resolve) => setTimeout(resolve, 300))
      await get(running.studio, '/api/model')

      expect(writes(running)).toEqual(['wrote tables/orders.md'])
      expect(reloads(running)).toEqual([])
      expect((await status(running.studio)).revision).toBe(before.revision)
    })
  })

  it('ignores a temporary file beside the one it is watching', async () => {
    await withStudio(async (running) => {
      const before = await status(running.studio)
      const temporary = join(running.dir, 'tables', `.orders.md.${randomUUID()}.tmp`)
      await writeFile(temporary, 'not a model file', 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 300))
      await rm(temporary)
      await new Promise((resolve) => setTimeout(resolve, 300))
      await get(running.studio, '/api/model')

      expect(reloads(running)).toEqual([])
      expect((await status(running.studio)).revision).toBe(before.revision)
    })
  })

  it('treats an editor that saves by renaming as one change, not two', async () => {
    // Many editors write a temporary file and rename it over the target, so the
    // filesystem reports a delete and a create for one Ctrl-S. Both have to
    // land in the same burst or the studio re-reads twice and, worse, sees the
    // file briefly absent.
    await withStudio(async (running) => {
      const before = await status(running.studio)
      const target = join(running.dir, 'tables', 'orders.md')
      const staging = join(running.dir, 'tables', '.orders.md.editor-swap')
      await writeFile(staging, addColumn(await readFile(target, 'utf8')), 'utf8')
      await rename(staging, target)

      await until(
        async () => ((await status(running.studio)).revision > before.revision ? true : undefined),
        'the watcher to notice a save by rename',
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      await get(running.studio, '/api/model')

      expect(reloads(running)).toHaveLength(1)
      expect((await status(running.studio)).revision).toBe(before.revision + 1)
      const body = await get(running.studio, '/api/model')
      const orders = (
        body['model'] as { tables: { name: string; columns: { name: string }[] }[] }
      ).tables.find((table) => table.name === 'orders')
      expect(orders?.columns.map((column) => column.name)).toContain('hand_edited_note')
    })
  })
})

describe('a file that stops parsing while the studio is running', () => {
  /** What half-typed YAML looks like: a key opened and not finished. */
  const breakIt = (text: string): string => text.replace('kind: table', 'kind: table\n  bad: [')

  it('keeps showing the last good version rather than emptying the canvas', async () => {
    await withStudio(async (running) => {
      const before = await status(running.studio)
      await editByHand(running.dir, 'tables/orders.md', breakIt)

      await until(
        async () => ((await status(running.studio)).revision > before.revision ? true : undefined),
        'the watcher to notice a file that stopped parsing',
      )

      const body = await get(running.studio, '/api/model')
      const model = body['model'] as {
        tables: { name: string; complete: boolean; path: string }[]
      }
      const orders = model.tables.find((table) => table.name === 'orders')
      // ADR 0004: the studio reports the parse failure on the affected table
      // and keeps showing the last good version. A file halfway through being
      // typed is the ordinary state of a file, not a deletion.
      expect(orders).toBeDefined()
      expect(orders?.complete).toBe(false)
      const diagnostics = body['diagnostics'] as { severity: string; at: { path?: string } }[]
      expect(
        diagnostics.some((d) => d.severity === 'error' && d.at.path === 'tables/orders.md'),
      ).toBe(true)
    })
  })

  it('will not write over it, and says why rather than dropping the edit quietly', async () => {
    await withStudio(async (running) => {
      await editByHand(running.dir, 'tables/orders.md', breakIt)
      const broken = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
      await until(
        async () => ((await status(running.studio)).revision > 0 ? true : undefined),
        'the watcher to notice a file that stopped parsing',
      )

      const response = await patch(running.studio, 'orders', { layout: { x: 900, y: 900 } })
      expect(response.status).toBe(409)
      expect(response.body['code']).toBe('incomplete')
      await settle(running.studio)
      expect(await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')).toBe(broken)
    })
  })

  it('recovers when the file is fixed, without a restart', async () => {
    await withStudio(async (running) => {
      const original = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
      await editByHand(running.dir, 'tables/orders.md', breakIt)
      await until(async () => {
        const body = await get(running.studio, '/api/model')
        const tables = (body['model'] as { tables: { name: string; complete: boolean }[] }).tables
        return tables.find((t) => t.name === 'orders')?.complete === false ? true : undefined
      }, 'the table to be marked incomplete')

      await writeFile(join(running.dir, 'tables', 'orders.md'), original, 'utf8')
      await until(async () => {
        const body = await get(running.studio, '/api/model')
        const tables = (body['model'] as { tables: { name: string; complete: boolean }[] }).tables
        return tables.find((t) => t.name === 'orders')?.complete === true ? true : undefined
      }, 'the table to come back')

      // And it is editable again, which is the half a restart used to be needed
      // for.
      const response = await patch(running.studio, 'orders', { layout: { x: 12, y: 34 } })
      expect(response.status).toBe(200)
      await settle(running.studio)
      const read = await readModel(running.dir)
      expect(read.diagnostics).toEqual([])
      expect(read.model.tables.find((t) => t.name === 'orders')?.layout).toEqual({ x: 12, y: 34 })
    })
  })

  it('drops a table whose file was deleted, which is not the same thing', async () => {
    await withStudio(async (running) => {
      await rm(join(running.dir, 'tables', 'shipments.md'))
      await until(async () => {
        const body = await get(running.studio, '/api/model')
        const tables = (body['model'] as { tables: { name: string }[] }).tables
        return tables.some((t) => t.name === 'shipments') ? undefined : true
      }, 'the deleted table to leave the model')
      // Not recreated by the next flush either: the writer never deletes, and
      // carrying a table forward past its own file would be this file inventing
      // one.
      await settle(running.studio)
      const read = await readModel(running.dir)
      expect(read.model.tables.some((t) => t.name === 'shipments')).toBe(false)
    })
  })
})

describe('deleting a table somebody is editing', () => {
  it('refuses, because git checkout cannot undo a file that was never committed', async () => {
    // With the watcher off, so the assertion is about the check the delete runs
    // rather than about which of the two noticed first. With the watcher on the
    // page has already been reloaded, and a delete then removes what the
    // developer is actually looking at, which is the right answer to a
    // different question.
    await withStudio(
      async (running) => {
        await editByHand(running.dir, 'tables/shipments.md', addColumn)
        const response = await fetch(new URL('/api/table/shipments', running.studio.url), {
          method: 'DELETE',
        })
        expect(response.status).toBe(409)
        expect(((await response.json()) as { code: string }).code).toBe('conflicted')
        expect(await columnNames(running.dir, 'shipments')).toContain('hand_edited_note')
      },
      { watch: false },
    )
  })
})

describe('the inspector writes several different files at once', () => {
  /** Four tables touched inside one debounce window, which a drag never did. */
  const four = ['orders', 'customers', 'products', 'addresses'] as const

  it('writes all of them, and calls none of them a conflict', async () => {
    // The check before a write reads the directory once and compares per file.
    // A comparison that had drifted into "did anything change" would refuse
    // every file in the batch as soon as the first one of them was written.
    await withStudio(async (running) => {
      for (const name of four) {
        expect((await patch(running.studio, name, { layout: { x: 11, y: 22 } })).status).toBe(200)
      }
      await settle(running.studio)

      expect((await status(running.studio)).conflicts).toEqual([])
      expect(writes(running)).toEqual([
        'wrote tables/addresses.md, tables/customers.md, tables/orders.md, tables/products.md',
      ])
      const read = await readModel(running.dir)
      for (const name of four) {
        expect(read.model.tables.find((table) => table.name === name)?.layout).toEqual({
          x: 11,
          y: 22,
        })
      }
    })
  })

  it('refuses only the one that moved, and lands the other three', async () => {
    await withStudio(
      async (running) => {
        for (const name of four) await patch(running.studio, name, { layout: { x: 33, y: 44 } })
        await editByHand(running.dir, 'tables/products.md', addColumn)
        await settle(running.studio)

        const after = await status(running.studio)
        expect(after.conflicts.map((conflict) => conflict.path)).toEqual(['tables/products.md'])
        expect(after.lastWrite?.paths).toEqual([
          'tables/addresses.md',
          'tables/customers.md',
          'tables/orders.md',
        ])
        const read = await readModel(running.dir)
        for (const name of ['orders', 'customers', 'addresses']) {
          expect(read.model.tables.find((table) => table.name === name)?.layout).toEqual({
            x: 33,
            y: 44,
          })
        }
        expect(await columnNames(running.dir, 'products')).toContain('hand_edited_note')
      },
      { debounceMs: 400 },
    )
  })
})

describe('git checkout, which ADR 0004 says is the undo', () => {
  it('is noticed, and the undone version is not written back', async () => {
    // A developer does this constantly, and it is the undo this tool tells them
    // to use, so a studio that quietly restored what they had just discarded
    // would be undoing the undo.
    await withStudio(async (running) => {
      const committed = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
      await patch(running.studio, 'orders', { layout: { x: 999, y: 999 } })
      await settle(running.studio)
      const written = await status(running.studio)

      // What `git checkout -- db-model` does to the filesystem: the committed
      // bytes, back where they were, with nothing to tell the studio about it.
      await writeFile(join(running.dir, 'tables', 'orders.md'), committed, 'utf8')
      await until(
        async () => ((await status(running.studio)).revision > written.revision ? true : undefined),
        'the watcher to notice a checkout',
      )

      await patch(running.studio, 'orders', { layout: { x: 500, y: 500 } })
      await settle(running.studio)
      const after = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
      expect(after).not.toContain('999')
      const read = await readModel(running.dir)
      expect(read.model.tables.find((table) => table.name === 'orders')?.layout).toEqual({
        x: 500,
        y: 500,
      })
    })
  })

  it('is refused rather than written back when the watcher never fired', async () => {
    await withStudio(
      async (running) => {
        const committed = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
        await patch(running.studio, 'orders', { layout: { x: 999, y: 999 } })
        await settle(running.studio)

        await writeFile(join(running.dir, 'tables', 'orders.md'), committed, 'utf8')
        await patch(running.studio, 'orders', { layout: { x: 500, y: 500 } })
        await settle(running.studio)

        expect((await status(running.studio)).conflicts.map((conflict) => conflict.path)).toEqual([
          'tables/orders.md',
        ])
        expect(await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')).toBe(committed)
      },
      { watch: false },
    )
  })
})
