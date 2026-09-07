/**
 * The listing the other tests assert against.
 *
 * `snapshot` is a helper rather than shipped code, so it is not obvious that it
 * deserves tests of its own. It does, because several tests decide what a write
 * touched by diffing two of its results, and a helper that answers a slightly
 * different question from `readModel` turns those assertions into a flake that
 * only shows up on somebody else's machine. dbmd-36 was exactly that: the
 * studio's PATCH test saw `writeModel`'s `.<name>.<uuid>.tmp` between its
 * creation and the rename that puts it over the target.
 *
 * So the rule the listing applies is pinned here rather than left as a habit in
 * one function nobody reads.
 */

import { describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hiddenEntries, snapshot } from './fixtures.js'

async function inDirectory(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-snapshot-'))
  try {
    await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('snapshot', () => {
  test('skips the writer temp file, which is the dbmd-36 flake', async () => {
    await inDirectory(async (dir) => {
      await mkdir(join(dir, 'tables'), { recursive: true })
      await writeFile(join(dir, 'tables', 'orders.md'), 'the table\n', 'utf8')
      // The name `writeAtomically` builds, spelled out rather than generated,
      // so that changing the writer's temp naming fails here and not at random
      // in CI a month later.
      await writeFile(
        join(dir, 'tables', '.orders.md.77f4e0f3-b8dc-45fc-87b7-b7849d626440.tmp'),
        'half of the table\n',
        'utf8',
      )

      expect([...(await snapshot(dir)).keys()]).toEqual(['tables/orders.md'])
    })
  })

  test('skips a dotfile and a dot directory anywhere under the root', async () => {
    await inDirectory(async (dir) => {
      await mkdir(join(dir, '.git'), { recursive: true })
      await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
      await writeFile(join(dir, '.DS_Store'), 'junk\n', 'utf8')
      await writeFile(join(dir, '_model.md'), 'the model\n', 'utf8')

      expect([...(await snapshot(dir)).keys()]).toEqual(['_model.md'])
    })
  })

  test('keeps a file that is not markdown, because this lists a directory', async () => {
    // A stray file appearing is something a test should be told about. Only the
    // documented dotfile rule is applied, not the reader's `*.md` filter.
    await inDirectory(async (dir) => {
      await writeFile(join(dir, '_model.md'), 'the model\n', 'utf8')
      await writeFile(join(dir, 'notes.txt'), 'mine\n', 'utf8')

      expect([...(await snapshot(dir)).keys()]).toEqual(['_model.md', 'notes.txt'])
    })
  })

  test('reads the text back, keyed by a slash-separated relative path', async () => {
    await inDirectory(async (dir) => {
      await mkdir(join(dir, 'notes'), { recursive: true })
      await writeFile(join(dir, 'notes', 'why.md'), 'because\n', 'utf8')

      expect(await snapshot(dir)).toEqual(new Map([['notes/why.md', 'because\n']]))
    })
  })
})

describe('hiddenEntries', () => {
  test('names exactly what snapshot dropped, so rubbish can still be asserted on', async () => {
    await inDirectory(async (dir) => {
      await mkdir(join(dir, 'tables'), { recursive: true })
      await mkdir(join(dir, '.git'), { recursive: true })
      await writeFile(join(dir, 'tables', 'orders.md'), 'the table\n', 'utf8')
      await writeFile(join(dir, 'tables', '.orders.md.6f2a.tmp'), 'half\n', 'utf8')

      // `.git` is named and not descended into: it is one piece of rubbish to
      // report, not a few hundred.
      expect(await hiddenEntries(dir)).toEqual(['.git', 'tables/.orders.md.6f2a.tmp'])
    })
  })

  test('is empty for a directory with nothing hidden in it', async () => {
    await inDirectory(async (dir) => {
      await writeFile(join(dir, '_model.md'), 'the model\n', 'utf8')
      expect(await hiddenEntries(dir)).toEqual([])
    })
  })
})
