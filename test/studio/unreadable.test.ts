/**
 * The file another program has open, which the studio used to call a file
 * somebody else had edited.
 *
 * **The defect was one sentence and the behaviour was already right.** With an
 * exclusive lock on `tables/orders.md`, editing that table in the page wrote
 * nothing, left the file byte for byte as it was, and recovered the moment the
 * lock cleared. What it said was that the file had changed on disk and that the
 * developer should make the edit again, which is the opposite fact about their
 * disk and advice that loops: the next edit fails the same way until whatever
 * has the file lets go of it. Two inches away, in the same page, the reader was
 * saying `file-unreadable: cannot read the file: the file is in use (EBUSY)`.
 * dbmd-e6e.
 *
 * The conflation is one line in `write()`. `readModel` does not throw on a file
 * it cannot open: it raises `file-unreadable` and leaves the object out, so
 * `renderOf` differs and the path takes the refusal branch that the changed
 * file takes. **"Absent because it could not be read" and "present and
 * different" are the same thing to that comparison.**
 *
 * **Why it is mocked, and what that costs.** The gesture that produces this is
 * `FileShare.None` on Windows, which answers `EBUSY`; POSIX will not give that
 * for the same gesture, and a permission change behaves differently on the two
 * again, so a test that reached for a real lock would prove the thing on one
 * operating system and be skipped on the runner. The seam being tested is not
 * the lock. It is what the writer does with a read that came back carrying
 * `file-unreadable` for the file it was about to write, and `vi.mock` reaches
 * that on any platform, which is the same reason `test/model/unreadable.test.ts`
 * is written this way. The real lock is in the pull request that closed the
 * item, driven on Windows, with the message before and after pasted.
 *
 * Both errnos are exercised for that reason: `EBUSY` is what a Windows lock
 * gives and `EACCES` is what a POSIX permission gives, and the writer is not
 * allowed to know the difference. It says what the reader said and names no
 * cause of its own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { basename, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { startStudio, type Studio } from '../../src/studio/index.js'
import { REVISION_HEADER, type WireConflict, type WireStatus } from '../../src/studio/wire.js'
import { exampleShop, withCopy } from '../model/fixtures.js'

/**
 * Which read fails, and with what. `vi.hoisted` because the factory is lifted
 * above every import, so the switch has to exist before this file's top level
 * runs. A hook returning `undefined` lets the real call through, which is what
 * keeps the fixture copy, the studio's own static files and every other table
 * in the model working.
 */
const fail = vi.hoisted(() => ({
  readFile: undefined as undefined | ((path: string) => unknown),
  readdir: undefined as undefined | ((path: string) => unknown),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  type Call = (path: unknown, ...rest: readonly unknown[]) => Promise<unknown>
  const intercept =
    (hook: () => undefined | ((path: string) => unknown), real: Call): Call =>
    async (path, ...rest) => {
      const thrown = typeof path === 'string' ? hook()?.(path) : undefined
      if (thrown !== undefined) throw thrown
      return real(path, ...rest)
    }
  return {
    ...actual,
    default: actual,
    readFile: intercept(() => fail.readFile, actual.readFile as Call),
    readdir: intercept(() => fail.readdir, actual.readdir as Call),
  }
})

afterEach(() => {
  fail.readFile = undefined
  fail.readdir = undefined
})

/** A filesystem error as Node raises one, errno and all. */
function errno(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: something went wrong, open '${path}'`), { code })
}

/** Fail exactly one entry, by its base name, and let everything else through. */
function only(name: string, error: unknown): (path: string) => unknown {
  return (path) => (basename(path) === name ? error : undefined)
}

/** Long enough that nothing is written until a test asks for it. */
const ONLY_ON_DEMAND = 60_000

interface Running {
  readonly studio: Studio
  readonly dir: string
  readonly lines: string[]
}

/**
 * A studio over a copy of the demo model, with the watcher off.
 *
 * Off because it is not the subject and it would be noise: the refusal runs
 * immediately before the write and needs no event to have fired, which is ADR
 * 0019's own reason for putting it there.
 */
async function withStudio(use: (running: Running) => Promise<void>): Promise<void> {
  await withCopy(exampleShop, async (dir) => {
    const lines: string[] = []
    const studio = await startStudio({
      dir,
      port: 0,
      open: false,
      watch: false,
      debounceMs: ONLY_ON_DEMAND,
      log: (message) => lines.push(message),
    })
    try {
      await use({ studio, dir, lines })
    } finally {
      await studio.close()
    }
  })
}

async function status(studio: Studio): Promise<WireStatus> {
  return (await (await fetch(new URL('/api/model', studio.url))).json()) as WireStatus
}

async function patch(studio: Studio, name: string, body: unknown): Promise<number> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      [REVISION_HEADER]: String((await status(studio)).revision),
    },
    body: JSON.stringify(body),
  })
  return response.status
}

async function remove(
  studio: Studio,
  name: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      [REVISION_HEADER]: String((await status(studio)).revision),
    },
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function flush(studio: Studio): Promise<WireStatus> {
  const response = await fetch(new URL('/api/flush', studio.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as WireStatus
}

/** The one conflict a test expects, failing loudly rather than returning undefined. */
function theConflict(status: WireStatus): WireConflict {
  expect(status.conflicts).toHaveLength(1)
  const conflict = status.conflicts[0]
  if (conflict === undefined) throw new Error('unreachable: the length was just asserted')
  return conflict
}

const ORDERS = 'tables/orders.md'
const MOVED = { layout: { x: 700, y: 400 } }

describe('an edit to a file the studio cannot read', () => {
  it('says what the reader said, rather than that somebody changed the file', async () => {
    await withStudio(async ({ studio, dir }) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      expect(await patch(studio, 'orders', MOVED)).toBe(200)

      // Between the edit and its write, which is the window ADR 0019 exists
      // for, and the window a lock lands in exactly as an editor's save does.
      fail.readFile = only('orders.md', errno('EBUSY', 'C:\\model\\tables\\orders.md'))
      const conflict = theConflict(await flush(studio))

      expect(conflict.path).toBe(ORDERS)
      expect(conflict.reason).toBe('unreadable')
      // The reader's own clause, quoted rather than reworded, because the
      // studio does not know why the file would not open and must not guess.
      expect(conflict.message).toContain('cannot read the file: the file is in use (EBUSY)')
      expect(conflict.message).toContain('could not be read just now')
      expect(conflict.message).toContain('Nothing was written and the file is exactly as it was')
      expect(conflict.message).toContain('try it again once the file can be read')
      // The sentence that was wrong, and the advice that looped.
      expect(conflict.message).not.toContain('changed on disk')
      expect(conflict.message).not.toContain('make the edit again if you still want it')
      // And no guess at a cause. A lock is what produced this on Windows; a
      // permission change produces the same refusal and is not a lock.
      expect(conflict.message).not.toMatch(/lock|another program|antivirus/i)

      fail.readFile = undefined
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(before)
    })
  })

  it('refuses the write, which is the half that was always right', async () => {
    await withStudio(async ({ studio, dir, lines }) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      await patch(studio, 'orders', MOVED)
      fail.readFile = only('orders.md', errno('EBUSY', 'C:\\model\\tables\\orders.md'))
      const after = await flush(studio)

      expect(lines.filter((line) => line.startsWith('wrote '))).toEqual([])
      // Not a write failure either: nothing threw, and a page showing this as
      // one would be telling the developer their disk is broken.
      expect(after.writeError).toBeNull()
      expect(lines).toContain(
        `refused to write ${ORDERS}: cannot read the file: the file is in use (EBUSY)`,
      )

      fail.readFile = undefined
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(before)
    })
  })

  it('lands the edit once the file can be read again', async () => {
    await withStudio(async ({ studio, dir }) => {
      await patch(studio, 'orders', MOVED)
      fail.readFile = only('orders.md', errno('EBUSY', 'C:\\model\\tables\\orders.md'))
      expect(theConflict(await flush(studio)).reason).toBe('unreadable')

      // The refused edit was dropped rather than held (ADR 0004: there is no
      // state but the files), so the recovery is the developer making it again
      // on top of what the file says, which is what it said all along.
      fail.readFile = undefined
      await flush(studio)
      expect(await patch(studio, 'orders', MOVED)).toBe(200)
      const settled = await flush(studio)

      expect(settled.conflicts).toEqual([])
      expect(settled.lastWrite?.paths).toEqual([ORDERS])
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toContain('x: 700')
    })
  })

  it('is the same refusal for the errno a POSIX permission gives', async () => {
    // The writer is not allowed to know which operating system it is on. It
    // repeats the reader, and the reader turns whichever errno arrived into a
    // clause; `EBUSY` above is Windows with a lock, this is the other one.
    await withStudio(async ({ studio }) => {
      await patch(studio, 'orders', MOVED)
      fail.readFile = only('orders.md', errno('EACCES', '/model/tables/orders.md'))
      const conflict = theConflict(await flush(studio))

      expect(conflict.reason).toBe('unreadable')
      expect(conflict.message).toContain('cannot read the file: permission denied (EACCES)')
      expect(conflict.message).not.toContain('changed on disk')
    })
  })

  it('says the same thing when it is the directory that will not open', async () => {
    // A `tables/` that cannot be listed leaves every table missing from the
    // read for the same reason one unreadable file does, and a write refused
    // for that has the same two candidate explanations.
    await withStudio(async ({ studio }) => {
      await patch(studio, 'orders', MOVED)
      fail.readdir = only('tables', errno('EACCES', '/model/tables'))
      const conflict = theConflict(await flush(studio))

      expect(conflict.reason).toBe('unreadable')
      expect(conflict.message).toContain('cannot list the directory: permission denied (EACCES)')
      expect(conflict.message).not.toContain('changed on disk')
    })
  })
})

describe('a delete of a file the studio cannot read', () => {
  it('is refused as unreadable, and the file is still there', async () => {
    await withStudio(async ({ studio, dir }) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      fail.readFile = only('orders.md', errno('EBUSY', 'C:\\model\\tables\\orders.md'))

      const refused = await remove(studio, 'orders')

      expect(refused.status).toBe(409)
      // A code rather than prose, because this is the one the page switches on:
      // `conflicted` and `unreadable` both mean re-read rather than retry, and
      // they are opposite things to say to the person who is looking at it.
      expect(refused.body['code']).toBe('unreadable')
      expect(refused.body['error']).toContain('cannot read the file: the file is in use (EBUSY)')
      expect(refused.body['error']).toContain('did not go through with deleting it')

      fail.readFile = undefined
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(before)
    })
  })
})

describe('a file somebody really did edit still says so', () => {
  // The obvious way to get this wrong is to fix the locked file by calling
  // every refusal unreadable. This is the case ADR 0019 was opened for and its
  // sentence is unchanged.
  it('is a conflict, in the words it has always used', async () => {
    await withStudio(async ({ studio, dir }) => {
      await patch(studio, 'orders', MOVED)
      const target = join(dir, 'tables', 'orders.md')
      await writeFile(
        target,
        (await readFile(target, 'utf8')).replace('columns:', 'columns:\n  - name: hand_edit'),
        'utf8',
      )

      const conflict = theConflict(await flush(studio))

      expect(conflict.reason).toBe('changed')
      expect(conflict.message).toContain('changed on disk after the studio read it')
      expect(conflict.message).toContain('make the edit again if you still want it')
      expect(conflict.message).not.toContain('could not be read')
    })
  })

  it('is a conflict when the file stopped parsing, because that is a change', async () => {
    // A file halfway through being typed is missing from the read too, and it
    // is missing for the other reason: it is there, it says something, and what
    // it says is not what the edit was made against. The reader raises a parse
    // diagnostic rather than `file-unreadable`, and that is the whole of the
    // distinction this draws.
    await withStudio(async ({ studio, dir }) => {
      await patch(studio, 'orders', MOVED)
      await writeFile(join(dir, 'tables', 'orders.md'), 'kind: table\nhalf typed\n', 'utf8')

      const conflict = theConflict(await flush(studio))

      expect(conflict.reason).toBe('changed')
      expect(conflict.message).toContain('changed on disk after the studio read it')
    })
  })
})
