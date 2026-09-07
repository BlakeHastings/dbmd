/**
 * A symlinked object file, on a machine that cannot make one.
 *
 * dbmd-95n is about `tables/orders.md` being a symlink: a `Dirent` for one
 * answers `isFile()` false whatever it points at, so `markdownFiles` dropped it
 * and the model came back a table short with nothing said. The obvious test is
 * to make the symlink, and `test/model/read.test.ts` does exactly that, gated
 * on a probe.
 *
 * **The probe fails on Windows without Developer Mode, which is the machine
 * this was written on.** A junction is the privilege-free link there and it
 * links directories only: `symlink(aFile, link, 'junction')` is accepted and
 * produces a link that resolves to nothing, so it cannot stand in. That leaves
 * the fix for the case in the item's own title proven only on the Linux runner,
 * and a fix nobody can watch work locally is one that gets reverted by accident.
 *
 * So the `Dirent` is supplied rather than caused. What is asserted is the
 * decision the reader makes about an entry, given the answers a POSIX symlink
 * to a file really gives, measured on Windows 11 and Node 24 with a junction and
 * cross-checked against the POSIX shape ADR 0038 already recorded:
 *
 *     isFile() === false, isDirectory() === false, isSymbolicLink() === true
 *
 * The file behind it is a real file in a real temporary directory, so
 * everything after the decision, the `readFile` included, is unmocked. This is
 * the same technique `test/model/unreadable.test.ts` uses to reach a filesystem
 * failure a test may not cause, for the same reason.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic } from '../../src/model/types.js'
import { withModel } from './helpers.js'

/**
 * Which base names `readdir` should report as symlinks rather than as files.
 *
 * `vi.hoisted` because the mock factory is lifted above every import. Empty
 * means every call behaves exactly as the real one does, which is what keeps
 * `withModel` able to build the directory it is about to read.
 */
const asSymlink = vi.hoisted(() => ({ names: new Set<string>() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const readdir = (async (path: unknown, options: unknown) => {
    const entries = await (actual.readdir as (p: unknown, o: unknown) => Promise<unknown[]>)(
      path,
      options,
    )
    if (asSymlink.names.size === 0) return entries
    return entries.map((entry) => {
      const dirent = entry as { name?: unknown }
      if (typeof dirent.name !== 'string' || !asSymlink.names.has(dirent.name)) return entry
      // The three answers a `Dirent` for a symlink gives, whatever it points
      // at. Laid over the real entry rather than replacing it, so `name` and
      // everything else the reader might reach for is still the genuine
      // article.
      return Object.assign(Object.create(entry as object), {
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true,
      })
    })
  }) as typeof actual.readdir
  return { ...actual, default: actual, readdir }
})

afterEach(() => {
  asSymlink.names.clear()
})

/** Diagnostics as one line each, which is how a reviewer reads them. */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => {
    const at = d.at.in === 'file' ? d.at.path : d.at.jsonPath
    return `${at} ${d.severity} ${d.code}: ${d.message}`
  })
}

const ORDERS = '---\nkind: table\ntable: orders\ncolumns: []\n---\n'

describe('an entry that answers as a symlink is followed rather than skipped', () => {
  test('a linked table file is read, and the model is not a table short', async () => {
    asSymlink.names.add('orders.md')

    const { model, diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    // Before dbmd-95n both of these were empty and the run reported no
    // problems, which is the whole complaint.
    expect(lines(diagnostics)).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })

  test('it is read as itself, contents and all, not merely counted', async () => {
    asSymlink.names.add('orders.md')

    const { model } = await withModel({
      'tables/orders.md':
        '---\nkind: table\ntable: orders\ncolumns:\n  - name: id\n    type: uuid\n---\nOne row per order.\n',
    })

    expect(model.tables[0]?.columns.map((column) => column.name)).toEqual(['id'])
    expect(model.tables[0]?.body).toBe('One row per order.\n')
  })

  test('a linked file that is not `.md` is still skipped in silence', async () => {
    asSymlink.names.add('README.txt')

    const { model, diagnostics } = await withModel({
      'tables/orders.md': ORDERS,
      'tables/README.txt': 'not a table\n',
    })

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })

  test('the entry the mock leaves alone is unaffected, which is what makes the rest mean anything', async () => {
    // A control. If the mock were rewriting every entry, or none, the tests
    // above would pass for a reason that has nothing to do with the reader.
    const { model, diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(diagnostics).toEqual([])
    expect(model.tables.map((table) => table.name)).toEqual(['orders'])
  })
})
