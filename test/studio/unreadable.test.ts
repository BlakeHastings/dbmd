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
import {
  REVISION_HEADER,
  type WireConflict,
  type WireModelResponse,
  type WireStatus,
} from '../../src/studio/wire.js'
import { saidAbout } from '../../src/studio/unreadable.js'
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
  // `rm` is here for dbmd-062, and it is the call the other two are not: a file
  // that will not unlink is not missing from the read, so nothing before the
  // delete has a chance to see it and the throw lands on the 500.
  rm: undefined as undefined | ((path: string) => unknown),
  /**
   * Every path the three intercepted calls were given, in order.
   *
   * For dbmd-dil, which turns on a read that is *not* made: the recheck on
   * `GET /api/model` has to cost nothing while the model is readable, and the
   * only honest way to say "nothing" is to count the calls. Recorded here
   * rather than by borrowing a `fail` hook so that counting and failing stay
   * separate things.
   */
  seen: [] as string[],
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  type Call = (path: unknown, ...rest: readonly unknown[]) => Promise<unknown>
  const intercept =
    (hook: () => undefined | ((path: string) => unknown), real: Call): Call =>
    async (path, ...rest) => {
      if (typeof path === 'string') fail.seen.push(path)
      const thrown = typeof path === 'string' ? hook()?.(path) : undefined
      if (thrown !== undefined) throw thrown
      return real(path, ...rest)
    }
  return {
    ...actual,
    default: actual,
    readFile: intercept(() => fail.readFile, actual.readFile as Call),
    readdir: intercept(() => fail.readdir, actual.readdir as Call),
    rm: intercept(() => fail.rm, actual.rm as Call),
  }
})

afterEach(() => {
  fail.readFile = undefined
  fail.readdir = undefined
  fail.rm = undefined
  fail.seen.length = 0
})

/**
 * A filesystem error as Node raises one, errno and all.
 *
 * `syscall` is part of "as Node raises one" rather than decoration: it is what
 * tells a failed system call apart from every other `Error` carrying a `code`,
 * and the studio's 500 asks that question before it decides whether the message
 * is safe to print. The message ends in the path for the same reason, because
 * that is the half ADR 0006 rule 4 forbids in output.
 */
function errno(code: string, path: string, syscall = 'open'): Error {
  return Object.assign(new Error(`${code}: something went wrong, ${syscall} '${path}'`), {
    code,
    syscall,
    path,
  })
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

/** The same request, kept whole, because dbmd-dil is about the diagnostics on it. */
async function page(studio: Studio): Promise<WireModelResponse> {
  return (await (await fetch(new URL('/api/model', studio.url))).json()) as WireModelResponse
}

/**
 * How many times the reader listed `tables/`, which is exactly once per
 * `readModel`, so it is how many times the model directory was read.
 */
function listings(): number {
  return fail.seen.filter((path) => basename(path) === 'tables').length
}

async function edit(
  studio: Studio,
  name: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      [REVISION_HEADER]: String((await status(studio)).revision),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function patch(studio: Studio, name: string, body: unknown): Promise<number> {
  return (await edit(studio, name, body)).status
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

/**
 * The same delete, one read later. dbmd-062.
 *
 * The refusal above compares the file on disk with the version the session
 * holds, and an unreadable file is missing from the first side, which is what
 * makes the two differ. Give the session one re-read while the file is still
 * unreadable and it is missing from the second side as well: the comparison
 * finds them equal, agrees there is nothing in the way, and hands an `rm` a
 * file the operating system will not let go of. That threw, nothing caught it,
 * and the answer was `500 internal` carrying the absolute path the reader is
 * careful never to print. ADR 0006 rule 4.
 *
 * A re-read is not a contrived step. Every flush does one, the watcher does one
 * per burst of filesystem events, and the studio's own writes cause both, so
 * the ordinary way to meet this is to leave the page open for a moment before
 * pressing delete.
 */
describe('a delete of a file the session has already absorbed as unreadable', () => {
  const ABSOLUTE = 'C:\\Users\\somebody\\models\\shop\\tables\\orders.md'

  it('is the same refusal, and says the relative path', async () => {
    await withStudio(async ({ studio, dir }) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      fail.readFile = only('orders.md', errno('EBUSY', ABSOLUTE))
      // The step that puts this past the check above: a flush re-reads, so the
      // read with the file missing from it becomes the baseline the delete
      // compares against.
      await flush(studio)
      // And the delete really would throw here. `rm` on a file another process
      // holds open answers `EBUSY` on Windows, and that throw is what produced
      // the 500; a test that left it out would pass on the day the refusal
      // stopped working.
      fail.rm = only('orders.md', errno('EBUSY', ABSOLUTE, 'unlink'))

      const refused = await remove(studio, 'orders')

      expect(refused.status).toBe(409)
      expect(refused.body['code']).toBe('unreadable')
      expect(refused.body['error']).toContain(`\`${ORDERS}\``)
      expect(refused.body['error']).toContain('cannot read the file: the file is in use (EBUSY)')
      expect(refused.body['error']).toContain('did not go through with deleting it')
      // No guess at a cause, exactly as the write path is not allowed one.
      expect(refused.body['error']).not.toMatch(/lock|another program|antivirus/i)
      expect(JSON.stringify(refused.body)).not.toContain(ABSOLUTE)

      fail.rm = undefined
      fail.readFile = undefined
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(before)
    })
  })

  it('reads the same for the errno a POSIX permission gives', async () => {
    const posix = '/home/somebody/models/shop/tables/orders.md'
    await withStudio(async ({ studio }) => {
      fail.readFile = only('orders.md', errno('EACCES', posix))
      await flush(studio)
      fail.rm = only('orders.md', errno('EACCES', posix, 'unlink'))

      const refused = await remove(studio, 'orders')

      expect(refused.status).toBe(409)
      expect(refused.body['code']).toBe('unreadable')
      expect(refused.body['error']).toContain('cannot read the file: permission denied (EACCES)')
      expect(JSON.stringify(refused.body)).not.toContain(posix)
    })
  })

  it('names no machine even when the throw is one nothing predicted', async () => {
    // The file reads perfectly and still will not unlink, which is what a
    // handle opened for sharing gives on Windows. No refusal can see that
    // coming, so it lands on the 500 that has no case for it, and a 500 body is
    // output like every other. This is the net under the refusals, not a
    // substitute for one: the status stays 500 because something really did go
    // wrong, and only the borrowed system message goes.
    await withStudio(async ({ studio, dir }) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      fail.rm = only('orders.md', errno('EBUSY', ABSOLUTE, 'unlink'))

      const failed = await remove(studio, 'orders')

      expect(failed.status).toBe(500)
      expect(failed.body['code']).toBe('internal')
      expect(failed.body['error']).toBe('the file is in use (EBUSY)')
      expect(JSON.stringify(failed.body)).not.toContain(ABSOLUTE)

      fail.rm = undefined
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(before)
    })
  })
})

/**
 * The third false reason, one edit after the second. dbmd-c7q.
 *
 * The two refusals above are about the moment the file stopped being readable.
 * This is the moment after, and it is where a person actually ends up: the
 * refusal told them to try again once the file can be read, so they try again,
 * and by then the session has absorbed a read the file is missing from.
 * `carryForward` keeps the table and marks it `complete: false`, which is a
 * flag with two causes behind it and no room for either, and `patchObject`
 * refused every one of them with "did not parse ... Fix the file and reload".
 *
 * It parsed fine. Nobody can fix it, and reloading shows the same thing. That
 * is a third wrong sentence about somebody's disk after two were carefully
 * removed, and the fix is the one both of those took: ask the reader, repeat
 * its clause, name no cause.
 */
describe('an edit to an object the session is holding because the file would not open', () => {
  const LOCKED = 'C:\\Users\\somebody\\models\\shop\\tables\\orders.md'

  /** Get the session into the state a person meets: one read later, still locked. */
  async function absorbed(studio: Studio, thrown: Error): Promise<void> {
    fail.readFile = only('orders.md', thrown)
    // A flush is not a contrived step. Every write does one, the watcher does
    // one per burst, and the refusal above tells the developer to try again,
    // which is a request that re-reads on the way through.
    await flush(studio)
  }

  it('says what the reader said, rather than that the file did not parse', async () => {
    await withStudio(async ({ studio, dir }) => {
      const before = await readFile(join(dir, 'tables', 'orders.md'), 'utf8')
      await absorbed(studio, errno('EBUSY', LOCKED))

      const refused = await edit(studio, 'orders', MOVED)

      expect(refused.status).toBe(409)
      // The same code the delete and the write use, because it is the same
      // fact: the page switches on this, and `incomplete` and `unreadable` are
      // opposite things to say to the person reading the panel.
      expect(refused.body['code']).toBe('unreadable')
      expect(refused.body['error']).toContain('cannot read the file: the file is in use (EBUSY)')
      expect(refused.body['error']).toContain(`\`${ORDERS}\``)
      expect(refused.body['error']).toContain('did not go through with editing it')
      // The sentence that was wrong, and the instruction nobody could follow.
      expect(refused.body['error']).not.toContain('did not parse')
      expect(refused.body['error']).not.toContain('Fix the file and reload')
      // No guess at a cause, and no machine named, exactly as the other two.
      expect(refused.body['error']).not.toMatch(/lock|another program|antivirus/i)
      expect(JSON.stringify(refused.body)).not.toContain(LOCKED)

      fail.readFile = undefined
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(before)
    })
  })

  it('reads the same for the errno a POSIX permission gives', async () => {
    const posix = '/home/somebody/models/shop/tables/orders.md'
    await withStudio(async ({ studio }) => {
      await absorbed(studio, errno('EACCES', posix))

      const refused = await edit(studio, 'orders', MOVED)

      expect(refused.status).toBe(409)
      expect(refused.body['code']).toBe('unreadable')
      expect(refused.body['error']).toContain('cannot read the file: permission denied (EACCES)')
      expect(refused.body['error']).not.toContain('did not parse')
      expect(JSON.stringify(refused.body)).not.toContain(posix)
    })
  })

  it('says the same thing when it is the directory that will not open', async () => {
    // Every table is missing from that read for one reason, so every one of
    // them is carried forward incomplete and every edit to any of them meets
    // this refusal. `saidAbout` counts the containing directory for exactly
    // this, which is why the clause reads `cannot list the directory:`.
    await withStudio(async ({ studio }) => {
      fail.readdir = only('tables', errno('EACCES', '/model/tables'))
      await flush(studio)

      const refused = await edit(studio, 'orders', MOVED)

      expect(refused.status).toBe(409)
      expect(refused.body['code']).toBe('unreadable')
      expect(refused.body['error']).toContain(
        'cannot list the directory: permission denied (EACCES)',
      )
      expect(refused.body['error']).not.toContain('did not parse')
    })
  })

  it('lands the edit once the file can be read again', async () => {
    // The advice the new sentence gives is a condition rather than an action,
    // so the thing to prove is that the condition is the whole of it: nothing
    // else has to happen, and no restart.
    await withStudio(async ({ studio, dir }) => {
      await absorbed(studio, errno('EBUSY', LOCKED))
      expect((await edit(studio, 'orders', MOVED)).status).toBe(409)

      fail.readFile = undefined
      await flush(studio)
      expect(await patch(studio, 'orders', MOVED)).toBe(200)
      const settled = await flush(studio)

      expect(settled.conflicts).toEqual([])
      expect(settled.lastWrite?.paths).toEqual([ORDERS])
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toContain('x: 700')
    })
  })

  it('is still `incomplete` for a file that genuinely did not parse', async () => {
    // The obvious way to go wrong here is to fix the locked file by calling
    // every incomplete object unreadable. A file halfway through being typed is
    // the common case, "did not parse" is true of it, and "fix the file and
    // reload" is advice somebody can act on. Word for word what it always said.
    await withStudio(async ({ studio, dir }) => {
      await writeFile(join(dir, 'tables', 'orders.md'), 'kind: table\nhalf typed\n', 'utf8')
      await flush(studio)

      const refused = await edit(studio, 'orders', MOVED)

      expect(refused.status).toBe(409)
      expect(refused.body['code']).toBe('incomplete')
      expect(refused.body['error']).toBe(
        `\`${ORDERS}\` did not parse, so this server is holding less than the file does; writing it back would delete the part it could not read. Fix the file and reload`,
      )
      expect(refused.body['error']).not.toContain('could not be read just now')
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

/**
 * The moment after all of the above: whatever had the file lets go of it.
 *
 * **A lock being released is not a filesystem event**, so `fs.watch` has
 * nothing to deliver and the watcher never fires. The session went on holding
 * the file as unreadable until something else under the model directory moved,
 * which left a diagnostics panel showing an error that was no longer true, for
 * as long as nobody touched anything. dbmd-dil, and ADR 0061 for why the read
 * that closes it hangs off `GET /api/model` rather than off a timer of its own.
 *
 * The watcher is off in this file, and here that is the point rather than a way
 * of dodging one: the recovery owes nothing to an event, because there is no
 * event for it to owe anything to.
 */
describe('a file that stops being unreadable, with nothing else under the model directory moving', () => {
  const LOCKED = 'C:\\Users\\somebody\\models\\shop\\tables\\orders.md'

  it('is readable again to the next page that asks, and nothing else had to happen', async () => {
    await withStudio(async ({ studio }) => {
      fail.readFile = only('orders.md', errno('EBUSY', LOCKED))
      await flush(studio)
      const locked = await page(studio)
      expect(saidAbout(locked.diagnostics, ORDERS)).toContain('the file is in use (EBUSY)')

      // The whole of the gesture. No edit, no write, no touch of any other
      // file, and no wait: the lock clears, and the page asks the question it
      // was going to ask anyway.
      fail.readFile = undefined

      const cleared = await page(studio)
      expect(saidAbout(cleared.diagnostics, ORDERS)).toBeUndefined()
      // And the revision moved with it, so a page holding the box it drew from
      // memory is told to redraw rather than left believing its own copy.
      expect(cleared.revision).toBeGreaterThan(locked.revision)
    })
  })

  it('lets the table be edited again, without the edit being the thing that unstuck it', async () => {
    // The advice the refusal gives is "try it again once the file can be read",
    // and it worked because the retry was itself the re-read. What this asserts
    // is that it no longer has to be: by the time somebody gets there, the page
    // has already caught up on its own.
    await withStudio(async ({ studio, dir }) => {
      fail.readFile = only('orders.md', errno('EBUSY', LOCKED))
      await flush(studio)
      expect((await edit(studio, 'orders', MOVED)).status).toBe(409)

      fail.readFile = undefined
      await page(studio)

      expect(await patch(studio, 'orders', MOVED)).toBe(200)
      const settled = await flush(studio)
      expect(settled.conflicts).toEqual([])
      expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toContain('x: 700')
    })
  })

  it('says the same thing when it was the directory that would not list', async () => {
    await withStudio(async ({ studio }) => {
      fail.readdir = only('tables', errno('EACCES', '/model/tables'))
      await flush(studio)
      expect(saidAbout((await page(studio)).diagnostics, ORDERS)).toContain(
        'cannot list the directory',
      )

      fail.readdir = undefined
      expect(saidAbout((await page(studio)).diagnostics, ORDERS)).toBeUndefined()
    })
  })

  it('reads the directory once per request while something is unreadable, and not twice', async () => {
    // Bounded, which is the half of this that is not free. It is the item's
    // "do not poll unconditionally" seen from the other side: the beat belongs
    // to the page, the studio adds no timer of its own, and one request is one
    // read.
    await withStudio(async ({ studio }) => {
      fail.readFile = only('orders.md', errno('EBUSY', LOCKED))
      await flush(studio)

      fail.seen.length = 0
      await page(studio)
      expect(listings()).toBe(1)
      await page(studio)
      expect(listings()).toBe(2)
    })
  })

  it('reads nothing at all while every file is readable', async () => {
    // The other half, and the one that decides whether this is affordable. A
    // studio nobody has locked anything on is the ordinary case, and it has to
    // cost what it cost before: a `GET` answered out of memory.
    await withStudio(async ({ studio }) => {
      await flush(studio)

      fail.seen.length = 0
      await page(studio)
      await page(studio)
      await page(studio)

      expect(listings()).toBe(0)
    })
  })

  it('stops reading again the moment the file comes back', async () => {
    // The gate closes itself. Nothing has to notice that the lock cleared and
    // switch the recheck off, because the recheck asks the diagnostics of the
    // read the session is serving, and the read that cleared it replaced them.
    await withStudio(async ({ studio }) => {
      fail.readFile = only('orders.md', errno('EBUSY', LOCKED))
      await flush(studio)
      fail.readFile = undefined

      await page(studio)
      fail.seen.length = 0
      await page(studio)
      await page(studio)

      expect(listings()).toBe(0)
    })
  })
})
