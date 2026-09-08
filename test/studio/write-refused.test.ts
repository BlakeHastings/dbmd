/**
 * The studio when the disk refuses a file, which is the other caller of
 * `writeModel`.
 *
 * ADR 0083 is what this is about and it was measured in a browser: the status
 * line leads with the file the developer was editing, keeps the operating
 * system's words verbatim, and the edit is not lost because `edits.ts` puts the
 * pending files back and the next flush retries. `writeErrorFile` is the key
 * that carries the first half, because the page cannot recover
 * `tables/orders.md` out of a message full of absolute paths without parsing
 * prose.
 *
 * It is tested here because ADR 0087 changed what a `WriteFailed` carries. The
 * writer now hands the throw the files that had already landed, for
 * `dbmd import`, and this suite is the other caller saying that nothing it
 * relies on moved: the same file named, the same words, the same retry.
 *
 * Everything goes over HTTP, the way `server.test.ts` and `watch.test.ts` do,
 * because the status line the record measured is drawn from exactly what a
 * `GET /api/model` returns.
 */

import { describe, expect, test, vi } from 'vitest'
import { renameSync } from 'node:fs'
import { readModel } from '../../src/model/read.js'
import { startStudio, type Studio } from '../../src/studio/index.js'
import { REVISION_HEADER } from '../../src/studio/wire.js'
import { exampleShop, withCopy } from '../model/fixtures.js'

/** The same switch `test/model/write.test.ts` uses: no real disk refuses on demand. */
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

/** Refuse exactly one file, and let every other one through to the real disk. */
function refuse(name: string): void {
  rename.instead = async (from, to) => {
    if (!to.endsWith(name)) return renameSync(from, to)
    throw new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`)
  }
}

interface Status {
  readonly conflicts: { readonly path: string }[]
  readonly writeError: string | null
  readonly writeErrorFile: { readonly path: string; readonly viaTemporary: boolean } | null
  readonly pendingWrite: boolean
  readonly lastWrite: { readonly paths: string[] } | null
  readonly revision: number
}

/** A debounce no case here reaches, so the only thing that writes is a flush. */
const ONLY_ON_DEMAND = 60_000

async function withStudio<T>(use: (studio: Studio, dir: string) => Promise<T>): Promise<T> {
  return withCopy(exampleShop, async (dir) => {
    const studio = await startStudio({
      dir,
      port: 0,
      open: false,
      log: () => {},
      debounceMs: ONLY_ON_DEMAND,
      // Nothing here edits the files behind the studio's back, and a watcher
      // firing mid-case would be a second clock in a suite about a write.
      watch: false,
    })
    try {
      return await use(studio, dir)
    } finally {
      // The refusal has to be gone before the close, because `close` flushes
      // and a directory that cannot be written is not what the copy's cleanup
      // is about.
      rename.instead = undefined
      await studio.close()
    }
  })
}

async function status(studio: Studio): Promise<Status> {
  const response = await fetch(new URL('/api/model', studio.url))
  return (await response.json()) as Status
}

/** Drag a box, as the page does: read the revision, then send the layout. */
async function drag(studio: Studio, name: string, x: number, y: number): Promise<void> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      [REVISION_HEADER]: String((await status(studio)).revision),
    },
    body: JSON.stringify({ layout: { x, y } }),
  })
  expect(response.status).toBe(200)
}

async function flush(studio: Studio): Promise<Status> {
  const response = await fetch(new URL('/api/flush', studio.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Status
}

async function layoutOf(dir: string, name: string): Promise<{ x: number; y: number } | undefined> {
  const { model } = await readModel(dir)
  const found = model.tables.find((table) => table.name === name)
  return found?.layout === undefined ? undefined : { x: found.layout.x, y: found.layout.y }
}

describe('a write the disk refuses', () => {
  test('names the file the developer was editing, and keeps the words', async () => {
    await withStudio(async (studio) => {
      refuse('orders.md')
      await drag(studio, 'orders', 659, 506)

      const after = await flush(studio)

      expect(after.writeError).toContain('EPERM: operation not permitted')
      // The two facts the message cannot carry, which is why they travel beside
      // it rather than being parsed back out of it. ADR 0083.
      expect(after.writeErrorFile).toEqual({ path: 'tables/orders.md', viaTemporary: true })
      // And the edit is still here, which is what the sentence on the page
      // promises: it rides out with the next write.
      expect(after.pendingWrite).toBe(true)
    })
  })

  test('rides out with the next write once the refusal is cleared', async () => {
    await withStudio(async (studio, dir) => {
      refuse('orders.md')
      await drag(studio, 'orders', 659, 506)
      expect((await flush(studio)).writeError).not.toBeNull()

      rename.instead = undefined
      const after = await flush(studio)

      expect(after.writeError).toBeNull()
      expect(after.writeErrorFile).toBeNull()
      expect(after.lastWrite?.paths).toEqual(['tables/orders.md'])
      expect(await layoutOf(dir, 'orders')).toEqual({ x: 659, y: 506 })
    })
  })

  test('names the file that refused and not the one that landed before it', async () => {
    await withStudio(async (studio, dir) => {
      refuse('orders.md')
      // Two pending files, written in path order, so `addresses` lands and
      // `orders` throws. This is the case ADR 0087 changed the writer for: the
      // throw now carries `tables/addresses.md` as well. What the studio says
      // is unchanged, and deliberately: the record's own note is that exactly
      // one file refused, so exactly one is named.
      await drag(studio, 'addresses', 100, 200)
      await drag(studio, 'orders', 659, 506)

      const after = await flush(studio)

      expect(after.writeErrorFile).toEqual({ path: 'tables/orders.md', viaTemporary: true })
      // The file that landed really did, which is the fact the writer now hands
      // over and this caller does not use.
      expect(await layoutOf(dir, 'addresses')).toEqual({ x: 100, y: 200 })
      expect(await layoutOf(dir, 'orders')).not.toEqual({ x: 659, y: 506 })

      rename.instead = undefined
      await flush(studio)
      expect(await layoutOf(dir, 'orders')).toEqual({ x: 659, y: 506 })
      expect(await layoutOf(dir, 'addresses')).toEqual({ x: 100, y: 200 })
    })
  })

  /**
   * Measured on 2026-09-08 while ADR 0087 was being written, and left here as a
   * measurement rather than as a promise.
   *
   * A partial write is a state `edits.ts` predates: a file the studio wrote
   * itself goes back into the pending set with the rest, its baseline stays
   * frozen at what the disk said before the write, and the next flush compares
   * the two and quite correctly finds them different. So the session records
   * "changed on disk" against a change it made, and the status the flush
   * reports says nothing at all about the file that landed. Nothing is lost:
   * the disk holds the edit either way, which is what the case above asserts.
   *
   * **This change neither causes it nor fixes it.** The writer has always
   * written the files before the one that refused; what is new is only that the
   * throw says which they were, so a caller that wanted to could now answer
   * both of these in a line. `dbmd import` is the caller that needed it. Doing
   * the same in the studio is a change to what a person sees on a page and
   * wants its own measurement in a browser.
   */
  test('reports nothing about the file it landed, and conflicts with itself on the retry', async () => {
    await withStudio(async (studio) => {
      refuse('orders.md')
      await drag(studio, 'addresses', 100, 200)
      await drag(studio, 'orders', 659, 506)

      const failed = await flush(studio)
      expect(failed.lastWrite).toBeNull()

      rename.instead = undefined
      const retried = await flush(studio)
      expect(retried.lastWrite?.paths).toEqual(['tables/orders.md'])
      expect(retried.conflicts.map((conflict) => conflict.path)).toEqual(['tables/addresses.md'])
    })
  })
})
