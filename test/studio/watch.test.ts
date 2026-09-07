import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readModel } from '../../src/model/read.js'
import { validate } from '../../src/model/validate.js'
import type { Column } from '../../src/model/types.js'
import { startStudio, type Studio } from '../../src/studio/index.js'
import { Burst, ModelWatcher } from '../../src/studio/watch.js'
import { REVISION_HEADER, type WireConflict } from '../../src/studio/wire.js'
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
      watchDebounceMs: WATCH_DEBOUNCE_MS,
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

/**
 * Patch as the page does: read the model, then send an edit naming what it read.
 *
 * The read is not ceremony. ADR 0025 makes the revision the whole of what tells
 * an edit made against the files from one made against a version they have
 * moved on from, so a test that hard-coded a number would be testing a client
 * nobody wrote. `stalePatch` is the other half, for the page that did not.
 */
async function patch(
  studio: Studio,
  name: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return stalePatch(studio, name, body, (await status(studio)).revision)
}

async function stalePatch(
  studio: Studio,
  name: string,
  body: unknown,
  revision: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(revision) },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function remove(
  studio: Studio,
  name: string,
  revision: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(new URL(`/api/table/${name}`, studio.url), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(revision) },
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

/**
 * Land what is pending, and be answered after it has landed.
 *
 * Every case below that edits ends here. It used to be a `settle` that slept
 * 500ms and then issued a `GET`, and the `GET` was called a fence. It is not
 * one: `GET /api/model` renders the status as it stands at the moment it is
 * handled, so a request that arrives while a flush is in flight is answered
 * from the middle of it. And a flush is not cheap. It reads the whole directory
 * to check the baselines, renames a file over each one it writes, and reads the
 * directory again to adopt what the writer normalised. The sleep left about a
 * hundred milliseconds for all of that, which is a margin and not a guarantee,
 * and dbmd-52 is the runs on a loaded machine where it was not enough. It failed
 * in both directions, which is why it read as two different bugs: a conflict a
 * case was waiting for had not been recorded yet, or one a case expected to be
 * cleared had not been written over yet.
 *
 * `POST /api/flush` is the route the page itself uses for this exact question
 * (ADR 0025) and it answers after the write rather than during it, so this waits
 * for the event instead of for a length of time. Same reason `until` exists.
 */
async function flush(studio: Studio): Promise<Status> {
  const response = await fetch(new URL('/api/flush', studio.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Status
}

/**
 * A write debounce no case here will reach, so the only thing that writes is an
 * explicit `flush`.
 *
 * The cases that need a hand edit to land *while the studio's own write is still
 * pending* were arranging that with a 400ms debounce and doing the edit quickly,
 * which is a second clock racing the first: a timer that fired early wrote the
 * file, and the conflict the case exists for never happened. With the flush
 * doing the writing on demand there is no reason to leave that window open at
 * all, so it is made unreachable rather than merely wide. The `POST /api/flush`
 * cases at the bottom of this file were already written this way; this is that
 * idiom given a name. `server.test.ts` keeps one case on a real debounce, which
 * is where ADR 0004's own promise is still asserted.
 */
const ONLY_ON_DEMAND = 60_000

/**
 * Wait for a condition the watcher will bring about.
 *
 * Polling rather than a fixed sleep: `fs.watch` latency is the operating
 * system's business and a sleep long enough to be safe on a loaded Windows
 * machine would be long enough to make the suite unpleasant on every other one.
 *
 * **The deadline is under vitest's own, and that is the whole reason for the
 * number.** It used to be `5_000`, which is exactly vitest's default
 * `testTimeout`, and vitest starts its clock first, so this function has never
 * once been able to say what it was waiting for: a run that lost one of these
 * waits reported `Error: Test timed out in 5000ms` and named no wait at all.
 * Measured on a machine running the suite twice at once, where several cases in
 * this file died that way and the line numbers were the only clue to which wait
 * it was. This is a diagnosis fix and not a timing one; it buys nothing and
 * costs a second of headroom on a wait that takes tens of milliseconds when it
 * works, and it is worth that to be told which wait gave up.
 */
async function until<T>(what: () => Promise<T | undefined>, why: string): Promise<T> {
  const deadline = Date.now() + 4_000
  for (;;) {
    const answer = await what()
    if (answer !== undefined) return answer
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${why}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** One table as the studio is serving it right now, as the page would receive it. */
async function servedTable(
  studio: Studio,
  name: string,
): Promise<{ name: string; complete: boolean } | undefined> {
  const body = (await get(studio, '/api/model')) as unknown as {
    model: { tables: { name: string; complete: boolean }[] }
  }
  return body.model.tables.find((table) => table.name === name)
}

/**
 * Wait for the studio to be serving the table as the file now says it.
 *
 * **Not "the revision moved", which is a weaker thing and is what the checkout
 * cases used to wait for.** `revision` moves for any change a re-read found, and
 * `writeFile` truncates before it writes, so a wake-up that lands inside one
 * reads a file with nothing in it. The studio does the right thing with that:
 * `carryForward` keeps the last version that parsed and marks it
 * `complete: false`. But the shape changed, so the revision moved, so a case
 * waiting on the revision was let through into the middle of somebody else's
 * save. It then patched an object the studio was holding as incomplete, was
 * refused `409`, flushed nothing, and finished by reporting the layout still on
 * disk as though the write had been dropped: `expected { x: 480, y: 340 } to
 * deeply equal { x: 500, y: 500 }`, which is dbmd-056 on `verify (22)`.
 *
 * Naming the state cannot be satisfied by a state on the way to it. The
 * comparison is against a fresh `readModel` rather than a literal because the
 * claim is "the studio has caught up with the directory", and the directory is
 * what settles that; both sides are the same reader's output for the same file,
 * so equal models render to equal text.
 */
async function servesWhatTheFileSays(running: Running, table: string): Promise<void> {
  const onDisk = JSON.stringify(
    (await readModel(running.dir)).model.tables.find((entry) => entry.name === table),
  )
  await until(
    async () =>
      JSON.stringify(await servedTable(running.studio, table)) === onDisk ? true : undefined,
    `the studio to be serving ${table} as the file now says it`,
  )
}

/**
 * The watch debounce every case in this file runs against, studio or watcher.
 *
 * Short, because a case that waits for the watcher should wait for tens of
 * milliseconds. It is named because `pastTheDebounce` below is a multiple of it
 * and the relationship between the two is the only thing that makes that wait
 * defensible.
 */
const WATCH_DEBOUNCE_MS = 40

/**
 * Wait long enough that a wake-up which was going to arrive has arrived.
 *
 * **This is the one wait in this file that is not a fence, and it cannot be
 * made into one.** Everything else here waits for an event: `flush` is answered
 * after the write, `until` polls for a state the watcher will bring about. An
 * absence has no such moment. "The watcher did not fire" is not a thing that
 * happens, so there is nothing to await and nothing to poll for, and a poll that
 * returned early would only be a shorter sleep wearing a better name.
 *
 * So the question is how long, and the only honest answer is a multiple of the
 * two latencies involved: the debounce, which is ours and is
 * `WATCH_DEBOUNCE_MS`, and `fs.watch` delivery, which is the operating system's
 * and is not ours to bound. 7.5x the first is the margin for the second.
 *
 * A fake clock does not solve this. It would fake the debounce, which is the
 * half already under control, and leave the delivery latency real: a fake timer
 * fired before the operating system had delivered the second event of a burst
 * would make the coalescing case below pass for exactly the wrong reason.
 *
 * Removing the delivery latency does solve it, and that is what `the debounce,
 * driven rather than observed` does: it bumps `Burst` by hand, so this wait is
 * still an absence but the burst it is an absence after is one the case made.
 * This is used both ways below and the two are not the same wait, which is why
 * the block that counts wake-ups off a real filesystem no longer counts them.
 *
 * A case that waits this way and then asserts nothing happened must also prove
 * that the watcher was awake the whole time, or a watcher that never fires at
 * all passes it. Every use below is paired with that control.
 */
const pastTheDebounce = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, WATCH_DEBOUNCE_MS * 7.5))

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
        await flush(running.studio)

        expect(await columnNames(running.dir, 'orders')).toContain('hand_edited_note')
        expect(writes(running)).toEqual([])
        expect(refusals(running)).toEqual([
          'refused to write tables/orders.md: it changed on disk since the studio read it',
        ])
      },
      // So the hand edit lands inside the debounce rather than after it, which
      // is the case the item calls the sharp one, and so it does so every time
      // rather than nearly every time.
      { debounceMs: ONLY_ON_DEMAND },
    )
  })

  it('says so on the status, so the page can tell the developer', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await flush(running.studio)

        const after = await status(running.studio)
        expect(after.conflicts.map((conflict) => conflict.path)).toEqual(['tables/orders.md'])
        expect(after.conflicts[0]?.message).toContain('changed on disk')
        expect(Date.parse(after.conflicts[0]?.at ?? '')).not.toBeNaN()
        // Not a write failure: nothing threw, and a page that showed this as
        // one would be telling the developer their disk is broken.
        expect(after.writeError).toBeNull()
      },
      { debounceMs: ONLY_ON_DEMAND },
    )
  })

  it('serves the version on disk afterwards, not the edit it refused', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await flush(running.studio)

        const body = await get(running.studio, '/api/model')
        const orders = (
          body['model'] as { tables: { name: string; layout?: { x: number } }[] }
        ).tables.find((table) => table.name === 'orders')
        // ADR 0004 has no state but the files. A refused edit kept in memory
        // would be exactly that second state, and the next flush would find the
        // disk matching its baseline again and write it after all.
        expect(orders?.layout?.x).not.toBe(700)
      },
      { debounceMs: ONLY_ON_DEMAND },
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
        await flush(running.studio)

        expect(reloads(running)).toEqual([])
        expect(refusals(running)).toHaveLength(1)
        expect(await columnNames(running.dir, 'orders')).toContain('hand_edited_note')
      },
      { debounceMs: ONLY_ON_DEMAND, watch: false },
    )
  })

  it('lets the developer make the edit again on top of what the file now says', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        await flush(running.studio)
        expect((await status(running.studio)).conflicts).toHaveLength(1)

        // The second drag is made against the reloaded model, so it carries the
        // hand edit with it rather than over it.
        await patch(running.studio, 'orders', { layout: { x: 700, y: 400 } })
        await flush(running.studio)

        expect((await status(running.studio)).conflicts).toEqual([])
        expect(await columnNames(running.dir, 'orders')).toContain('hand_edited_note')
        const read = await readModel(running.dir)
        expect(read.model.tables.find((t) => t.name === 'orders')?.layout).toEqual({
          x: 700,
          y: 400,
        })
      },
      { debounceMs: ONLY_ON_DEMAND },
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
        await flush(running.studio)

        expect(refusals(running)).toEqual([])
        expect(writes(running)).toEqual(['wrote tables/orders.md'])
        expect(await columnNames(running.dir, 'customers')).toContain('hand_edited_note')
        const read = await readModel(running.dir)
        expect(read.model.tables.find((t) => t.name === 'orders')?.layout).toEqual({
          x: 700,
          y: 400,
        })
      },
      { debounceMs: ONLY_ON_DEMAND },
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
      await flush(running.studio)
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
    //
    // The watcher does wake here, and this case does not mind: what stops the
    // echo at this level is that a re-read of a directory the session already
    // agrees with changes no fingerprint, so `reload` returns without moving
    // the revision. That is the claim, and it is a live one; deleting the
    // fingerprint guard in `edits.ts` turns this red.
    await withStudio(async (running) => {
      const before = await status(running.studio)
      await patch(running.studio, 'orders', { layout: { x: 333, y: 444 } })
      await flush(running.studio)
      await pastTheDebounce()
      await get(running.studio, '/api/model')

      expect(writes(running)).toEqual(['wrote tables/orders.md'])
      expect(reloads(running)).toEqual([])
      expect((await status(running.studio)).revision).toBe(before.revision)
    })
  })

  it('reloads once for an editor that saves by renaming', async () => {
    // Many editors write a temporary file and rename it over the target, so the
    // filesystem reports the staging file and the target separately for one
    // Ctrl-S. What this case can see is the end of that: the studio noticed,
    // and what it is serving is what the editor saved.
    //
    // That the burst was *one* wake-up rather than two is not visible from
    // here. `reload` is serialised and idempotent, so a second wake-up for the
    // same content leaves no trace in `reloads` or in the revision. The
    // watcher's own coalescing is asserted where it can fail, against the
    // watcher, at the bottom of this file.
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

      expect((await status(running.studio)).revision).toBe(before.revision + 1)
      const body = await get(running.studio, '/api/model')
      const orders = (
        body['model'] as { tables: { name: string; columns: { name: string }[] }[] }
      ).tables.find((table) => table.name === 'orders')
      expect(orders?.columns.map((column) => column.name)).toContain('hand_edited_note')
    })
  })
})

/**
 * The watcher on its own, because through the studio it cannot fail.
 *
 * Everything above observes the watcher through `reloads` and the revision,
 * which are `Edits` talking rather than the watcher. `Edits.reload` is
 * serialised and idempotent: it re-reads the directory, compares a fingerprint,
 * and returns silently when nothing moved. So *any* number of wake-ups the
 * watcher should not have had collapses to nothing observable over HTTP.
 *
 * Which means two of the cases that used to live above could not fail. Deleting
 * the whole filename filter from `watch.ts`, so the watcher wakes for every
 * name in a kind directory, left all 788 tests in this repository green.
 * Deleting the debounce, so every filesystem event became its own wake-up, did
 * the same. Both behaviours were covered by a case whose name said so and whose
 * assertions could not tell.
 *
 * The seam that can tell is the one `watch.ts` was built around: the watcher's
 * only output is a call to `onChange`, so a test that holds the callback can
 * count them. `ModelWatcher.open` is that constructor and it needs nothing new
 * in `src/` to be usable here.
 *
 * Each case pairs its absence with a change the watcher must wake for, because
 * a watcher that never fires passes every negative assertion in this block.
 */
describe('the watcher, counted at the callback', () => {
  interface Watching {
    readonly dir: string
    /** How many times the watcher has said "look again". */
    wakes: number
  }

  async function withWatcher<T>(use: (watching: Watching) => Promise<T>): Promise<T> {
    return withCopy(exampleShop, async (dir) => {
      const watching: Watching = { dir, wakes: 0 }
      const watcher = ModelWatcher.open(dir, () => (watching.wakes += 1), {
        debounceMs: WATCH_DEBOUNCE_MS,
      })
      try {
        return await use(watching)
      } finally {
        watcher.close()
      }
    })
  }

  /** Wait for the wake-up a change is certainly going to cause. */
  const woken = (watching: Watching, why: string): Promise<true> =>
    until(async () => (watching.wakes > 0 ? true : undefined), why)

  it('is woken by two files saved together, and not once per filesystem event', async () => {
    // **This case used to assert the count, and the count has moved next door**
    // to `the debounce, driven rather than observed`, where a burst is made
    // rather than hoped for. It could not stay here. Two `editByHand` calls are
    // two writes whose events the operating system delivers when it feels like
    // it, and a burst is events no further apart than the window, so a machine
    // that spaced them by more than 40ms produced two bursts. Two wake-ups for
    // two bursts is the watcher keeping its promise, and this case called it
    // `expected 2 to be 1`: dbmd-056, three runs in a hundred on CI and none in
    // twenty-eight here. It reproduces on a quiet machine with nothing but a
    // 150ms sleep between the two writes, which is the whole of the defect.
    //
    // What is left is what the filesystem can actually answer, and it is not
    // nothing. Both files live in the same kind directory and each has to reach
    // the debounce, so a watcher attached to the wrong thing fails the wait; and
    // the bound is one wake-up per file *changed*, not per event *reported*,
    // which on Windows is up to five for a single save (see the case below).
    // Deleting the debounce breaks the bound there. It cannot break it on a
    // platform that reports one event per write, and that is the cost of asking
    // the filesystem: this is a coalescing proof on some platforms and a wiring
    // proof on the rest. The case next door is neither and holds everywhere.
    await withWatcher(async (watching) => {
      await editByHand(watching.dir, 'tables/orders.md', addColumn)
      await editByHand(watching.dir, 'tables/customers.md', addColumn)
      await woken(watching, 'the watcher to wake for two files saved together')
      await pastTheDebounce()

      expect(watching.wakes).toBeLessThanOrEqual(2)
    })
  })

  it('wakes once for an editor that saves by renaming, not once per name', async () => {
    // The shape the case above this block describes: a staging file written,
    // then renamed over the target. How many events one Ctrl-S becomes is the
    // platform's business: five on Windows, of which the two for the target
    // survive the filter, and as few as one elsewhere. So on some platforms
    // this is a coalescing proof and on others it is a smoke test that the save
    // was seen at all; the case above is the one that holds the debounce to
    // account everywhere.
    await withWatcher(async (watching) => {
      const target = join(watching.dir, 'tables', 'orders.md')
      const staging = join(watching.dir, 'tables', '.orders.md.editor-swap')
      await writeFile(staging, addColumn(await readFile(target, 'utf8')), 'utf8')
      await rename(staging, target)

      await woken(watching, 'the watcher to wake for a save by rename')
      await pastTheDebounce()

      expect(watching.wakes).toBe(1)
    })
  })

  it('keeps the writer’s own temporary file out of the kind directory’s filter', async () => {
    // `write.ts` writes `.<name>.<uuid>.tmp` beside every target. Without the
    // filter the `tables/` watcher would fire for a file that was never part of
    // the model, twice per save. Deleting the filter turns the zero below into
    // a one, which is what this case is for.
    //
    // **Read the name literally. This is not "no non-model file ever wakes it",
    // and the zero below is not evidence for that.** `isRootEntry` passes the
    // *directory*, so the root watcher wakes for "something under `tables`
    // changed" with no filename for `isModelFileName` to reject. dbmd-c8p
    // measured that path on Windows 11 / NTFS / Node 24: this exact write and
    // delete woke the watcher eleven times in twelve against a directory the
    // watcher had been living in, and zero times in twelve against a freshly
    // copied one. `withCopy` hands this case a fresh one every time, so the
    // zero is that fixture's doing rather than the filter's. The same
    // measurement made the root filter unfalsifiable from here: replacing
    // `isRootEntry` with `() => true` leaves this case green.
    //
    // It is harmless in both directions, which is why the leak is a comment on
    // `isRootEntry` and not a change. The temporary file shares a debounce with
    // the rename over the target, and that target is a wake-up the watcher owes
    // anyway; anything else costs one directory read that `Edits.reload` ends
    // by comparing a fingerprint and finding nothing.
    await withWatcher(async (watching) => {
      const temporary = join(watching.dir, 'tables', `.orders.md.${randomUUID()}.tmp`)
      await writeFile(temporary, 'not a model file', 'utf8')
      await rm(temporary)
      await pastTheDebounce()

      expect(watching.wakes).toBe(0)

      // The control. Without it a watcher that attached to nothing would pass
      // the assertion above and every other absence in this block.
      await editByHand(watching.dir, 'tables/orders.md', addColumn)
      await woken(watching, 'the watcher that ignored a temporary file to wake for a real one')
      expect(watching.wakes).toBe(1)
    })
  })
})

/**
 * The same promise, with the filesystem taken out of it.
 *
 * `Burst` is the whole of the watcher's timing and a bump is a function call, so
 * a burst here is something these cases *make*. That is the difference from the
 * block above, and it is the difference dbmd-056 was about: a case that saves
 * two files and expects one wake-up is not asserting that the debounce works, it
 * is asserting that the operating system delivered two events close together,
 * and a loaded CI runner is exactly where it does not.
 *
 * Nothing below depends on how busy the machine is. The bumps inside one burst
 * have no `await` between them, so no stall can get in and split them. The two
 * bursts in the second case are separated by a fence on a wake-up that has
 * already happened rather than by a sleep, and a stall can only push them
 * further apart, which is the direction that keeps the assertion true.
 */
describe('the debounce, driven rather than observed', () => {
  function counted(): { burst: Burst; calls: () => number } {
    let calls = 0
    return { burst: new Burst(WATCH_DEBOUNCE_MS, () => (calls += 1)), calls: () => calls }
  }

  it('turns a burst of separate changes into one wake-up', async () => {
    // The claim the watcher's docstring makes, and the one the case in the
    // block above used to carry: three events that arrive together are one
    // look-again, not three. Delete the debounce and this is three.
    const { burst, calls } = counted()
    try {
      burst.bump()
      burst.bump()
      burst.bump()
      // Trailing, not leading. A wake-up that had already happened by here
      // would be one taken before the burst had finished arriving, which is the
      // thing the watcher exists to avoid.
      expect(calls()).toBe(0)

      await until(async () => (calls() > 0 ? true : undefined), 'the burst to wake')
      await pastTheDebounce()

      expect(calls()).toBe(1)
    } finally {
      burst.cancel()
    }
  })

  it('starts a new burst when the gap is longer than the window', async () => {
    // The other half, and the half dbmd-056 turned out to be about: two changes
    // further apart than the window are two bursts and are owed a wake-up each.
    // A watcher that answered one here would be swallowing the second change,
    // so `expected 2 to be 1` on CI was the right answer to a question the case
    // did not mean to ask.
    const { burst, calls } = counted()
    try {
      burst.bump()
      await until(async () => (calls() === 1 ? true : undefined), 'the first burst to wake')
      burst.bump()
      await until(async () => (calls() === 2 ? true : undefined), 'the second burst to wake')
      await pastTheDebounce()

      expect(calls()).toBe(2)
    } finally {
      burst.cancel()
    }
  })

  it('drops a wake-up that was queued when it was cancelled', async () => {
    // What `close` needs from it. A watcher that has stopped must not call back
    // into a studio whose server has gone, and `ModelWatcher.close` has nothing
    // to do that with but this.
    const { burst, calls } = counted()
    burst.bump()
    burst.cancel()
    await pastTheDebounce()

    expect(calls()).toBe(0)
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
      await flush(running.studio)
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
      await flush(running.studio)
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
      await flush(running.studio)
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
        const before = await status(running.studio)
        await editByHand(running.dir, 'tables/shipments.md', addColumn)
        const response = await remove(running.studio, 'shipments', before.revision)
        expect(response.status).toBe(409)
        expect(response.body['code']).toBe('conflicted')
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
      await flush(running.studio)

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
        await flush(running.studio)

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
      { debounceMs: ONLY_ON_DEMAND },
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
      await flush(running.studio)

      // What `git checkout -- db-model` does to the filesystem: the committed
      // bytes, back where they were, with nothing to tell the studio about it.
      await writeFile(join(running.dir, 'tables', 'orders.md'), committed, 'utf8')
      await servesWhatTheFileSays(running, 'orders')

      const restored = await patch(running.studio, 'orders', { layout: { x: 500, y: 500 } })
      // Asserted rather than assumed, because a patch refused at the door
      // writes nothing and the assertion at the end of this case would then
      // report the layout still on disk as though the flush had lost the edit.
      // That is the sentence dbmd-056 was read as for a day. Say what happened.
      expect(restored.status).toBe(200)
      await flush(running.studio)
      const after = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
      expect(after).not.toContain('999')
      const read = await readModel(running.dir)
      expect(read.model.tables.find((table) => table.name === 'orders')?.layout).toEqual({
        x: 500,
        y: 500,
      })
    })
  })

  it('is noticed even when the watcher first read the file half-written', async () => {
    // The case above, with the race in it made to happen every time instead of
    // three times in a hundred on a loaded runner.
    //
    // `git checkout` writes with `writeFile`, which truncates and then writes,
    // so a wake-up that lands inside one reads a file with nothing in it. Here
    // that read is arranged rather than waited for: the empty file is left on
    // disk until the studio has demonstrably read it, and only then does the
    // committed text arrive. Everything after that is the case above, unchanged.
    //
    // Point the old wait at this and it fails the way CI did. The revision has
    // already moved for the empty read, so `revision > written.revision` lets
    // the case through, the patch lands on an object the studio is holding as
    // incomplete and is refused `409`, the flush writes nothing, and the layout
    // read back at the end is the committed one: `expected { x: 480, y: 340 }
    // to deeply equal { x: 500, y: 500 }`. dbmd-056.
    await withStudio(async (running) => {
      const committed = await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')
      await patch(running.studio, 'orders', { layout: { x: 999, y: 999 } })
      await flush(running.studio)

      await writeFile(join(running.dir, 'tables', 'orders.md'), '', 'utf8')
      await until(
        async () =>
          (await servedTable(running.studio, 'orders'))?.complete === false ? true : undefined,
        'the studio to have read the file while it was empty',
      )
      await writeFile(join(running.dir, 'tables', 'orders.md'), committed, 'utf8')
      await servesWhatTheFileSays(running, 'orders')

      const restored = await patch(running.studio, 'orders', { layout: { x: 500, y: 500 } })
      expect(restored.status).toBe(200)
      await flush(running.studio)
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
        await flush(running.studio)

        await writeFile(join(running.dir, 'tables', 'orders.md'), committed, 'utf8')
        await patch(running.studio, 'orders', { layout: { x: 500, y: 500 } })
        await flush(running.studio)

        expect((await status(running.studio)).conflicts.map((conflict) => conflict.path)).toEqual([
          'tables/orders.md',
        ])
        expect(await readFile(join(running.dir, 'tables', 'orders.md'), 'utf8')).toBe(committed)
      },
      { watch: false },
    )
  })

  it('survives the next inspector edit, which used to write the discarded version back', async () => {
    // The hunting pass watched a checkout be reverted by the next edit made in
    // the panel, which is worse than the drag case: a `columns` patch carries
    // the whole list, so the discarded version comes back in full.
    await withStudio(async (running) => {
      const committed = await readFile(join(running.dir, 'tables', 'customers.md'), 'utf8')
      const drawn = await status(running.studio)
      const held = (await get(running.studio, '/api/model')) as unknown as {
        model: { tables: { name: string; columns: unknown[] }[] }
      }
      const columns = held.model.tables.find((table) => table.name === 'customers')?.columns ?? []

      // An edit lands, and then the developer throws it away with git.
      await patch(running.studio, 'customers', {
        columns: [...columns, { name: 'scratch', type: 'text' }],
      })
      await flush(running.studio)
      expect(await columnNames(running.dir, 'customers')).toContain('scratch')
      await writeFile(join(running.dir, 'tables', 'customers.md'), committed, 'utf8')
      await servesWhatTheFileSays(running, 'customers')

      // The panel still holds the column list it was built from, and sends it.
      const response = await stalePatch(
        running.studio,
        'customers',
        { columns: [...columns, { name: 'scratch', type: 'text' }] },
        drawn.revision,
      )
      expect(response.status).toBe(409)
      await flush(running.studio)
      expect(await readFile(join(running.dir, 'tables', 'customers.md'), 'utf8')).toBe(committed)
    })
  })
})

/**
 * The other half of the same guard: not the disk moving under a write, but the
 * caller having been drawn from a model the disk has moved on from.
 *
 * ADR 0025. These are written the way dbmd-48 was reproduced, which is the
 * ordering that matters: the hand edit happens with **nothing pending**, so the
 * write-time check above correctly allows the write, and the only thing that is
 * stale is whoever is asking.
 */
describe('an edit made against a model the studio has moved on from', () => {
  it('is refused, so a stale page cannot delete a column it never saw', async () => {
    await withStudio(async (running) => {
      // 1. The page loads and holds a model.
      const held = await status(running.studio)
      const before = await columnNames(running.dir, 'customers')

      // 2. A person adds a column in their editor, with nothing pending, so the
      //    studio correctly adopts it.
      await editByHand(running.dir, 'tables/customers.md', addColumn)
      await until(
        async () => ((await status(running.studio)).revision > held.revision ? true : undefined),
        'the watcher to adopt a hand edit',
      )

      // 3. The stale page changes a column type, which sends the whole column
      //    list it still holds. Before ADR 0025 this was a 200 and the column
      //    was gone.
      const response = await stalePatch(
        running.studio,
        'customers',
        { columns: [{ name: 'id', type: 'text' }] },
        held.revision,
      )
      expect(response.status).toBe(409)
      expect(response.body['code']).toBe('stale')
      await flush(running.studio)

      const after = await columnNames(running.dir, 'customers')
      expect(after).toContain('hand_edited_note')
      expect(after).toEqual(['hand_edited_note', ...(before ?? [])])
      expect(writes(running)).toEqual([])
    })
  })

  it('says which revision it was made against and which one this studio is on', async () => {
    await withStudio(async (running) => {
      const response = await stalePatch(running.studio, 'orders', { layout: { x: 1, y: 2 } }, 7)
      expect(response.status).toBe(409)
      expect(response.body['error']).toContain('revision 7')
      expect(response.body['error']).toContain('revision 0')
    })
  })

  it('refuses a mutation that names no revision at all, in the words to fix it', async () => {
    // Absent is a refusal rather than a default. A caller that has not said
    // what it read is a caller this server cannot tell from a stale one, which
    // is a hole shaped exactly like the defect.
    await withStudio(async ({ studio }) => {
      for (const [path, init] of [
        ['/api/table/orders', { method: 'PATCH', body: '{"layout":{"x":1,"y":1}}' }],
        ['/api/table', { method: 'POST', body: '{"name":"nope"}' }],
        ['/api/table/shipments', { method: 'DELETE' }],
      ] as const) {
        const response = await fetch(new URL(path, studio.url), {
          ...init,
          headers: { 'content-type': 'application/json' },
        })
        expect(response.status).toBe(400)
        const body = (await response.json()) as { code: string; error: string }
        expect(body.code).toBe('no-revision')
        expect(body.error).toContain(REVISION_HEADER)
      }
    })
  })

  it('refuses a create and a delete the same way a patch is refused', async () => {
    // Both go through the same reload path in the page (dbmd-38), so both have
    // to inherit this rather than each need their own.
    await withStudio(async (running) => {
      const held = await status(running.studio)
      await editByHand(running.dir, 'tables/customers.md', addColumn)
      await until(
        async () => ((await status(running.studio)).revision > held.revision ? true : undefined),
        'the watcher to adopt a hand edit',
      )

      const created = await fetch(new URL('/api/table', running.studio.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(held.revision) },
        body: JSON.stringify({ name: 'roast_days', layout: { x: 1, y: 1 } }),
      })
      expect(created.status).toBe(409)
      expect(((await created.json()) as { code: string }).code).toBe('stale')

      const deleted = await remove(running.studio, 'shipments', held.revision)
      expect(deleted.status).toBe(409)
      expect(deleted.body['code']).toBe('stale')

      const read = await readModel(running.dir)
      expect(read.model.tables.some((table) => table.name === 'roast_days')).toBe(false)
      expect(read.model.tables.some((table) => table.name === 'shipments')).toBe(true)
    })
  })

  it('does not call the session’s own new diagnostic a reason to refuse the next edit', async () => {
    // dbmd-25 made a blank column name a warning, and `Add column` in the panel
    // writes exactly that (ADR 0016), so the studio's own write comes back from
    // the reader carrying a diagnostic the session could not have predicted.
    // The revision counts the objects and not the diagnostics for this reason:
    // counting both refused the very next character typed into the column the
    // developer had just added, and every character after it.
    await withStudio(async (running) => {
      const drawn = await status(running.studio)
      const held = (await get(running.studio, '/api/model')) as unknown as {
        model: { tables: { name: string; columns: Column[] }[] }
      }
      const columns = held.model.tables.find((table) => table.name === 'orders')?.columns ?? []

      // Add column: the whole list, plus one with no name and no type.
      expect(
        (
          await stalePatch(
            running.studio,
            'orders',
            { columns: [...columns, { name: '', type: '' }] },
            drawn.revision,
          )
        ).status,
      ).toBe(200)
      await flush(running.studio)

      const after = await status(running.studio)
      expect(after.revision).toBe(drawn.revision)
      // The warning is still reported: it is served, it is simply not a reason
      // to call the page stale.
      const body = await get(running.studio, '/api/model')
      const diagnostics = body['diagnostics'] as { severity: string; code: string }[]
      expect(diagnostics.some((d) => d.code === 'empty-value' && d.severity === 'warning')).toBe(
        true,
      )

      // And the next keystrokes into that column land, one after another,
      // against the revision the page still holds.
      for (const name of ['g', 'gi', 'gift']) {
        expect(
          (
            await stalePatch(
              running.studio,
              'orders',
              { columns: [...columns, { name, type: 'text' }] },
              drawn.revision,
            )
          ).status,
        ).toBe(200)
      }
      await flush(running.studio)
      expect(await columnNames(running.dir, 'orders')).toContain('gift')
      expect((await status(running.studio)).conflicts).toEqual([])
    })
  })

  it('lets the edit through once the caller has read the model again', async () => {
    await withStudio(async (running) => {
      const held = await status(running.studio)
      await editByHand(running.dir, 'tables/customers.md', addColumn)
      await until(
        async () => ((await status(running.studio)).revision > held.revision ? true : undefined),
        'the watcher to adopt a hand edit',
      )
      const stale = await stalePatch(
        running.studio,
        'customers',
        { layout: { x: 5, y: 6 } },
        held.revision,
      )
      expect(stale.status).toBe(409)

      // Which is what the page does when it is refused: re-read, then edit.
      expect((await patch(running.studio, 'customers', { layout: { x: 5, y: 6 } })).status).toBe(
        200,
      )
      await flush(running.studio)
      const read = await readModel(running.dir)
      expect(read.model.tables.find((t) => t.name === 'customers')?.layout).toEqual({ x: 5, y: 6 })
      expect(await columnNames(running.dir, 'customers')).toContain('hand_edited_note')
    })
  })
})

/**
 * dbmd-39, driven in exactly the order `renameTable` in the page issues.
 *
 * A rename is a create, a patch per referring table and a delete (ADR 0016),
 * every one of them naming the revision the confirmation was written against.
 * It is here rather than in a unit test because the property is about several
 * requests and a debounce, which is a thing about the server and the clock and
 * not a thing about a function.
 */
describe('a rename while one of the files it must edit changes on disk', () => {
  interface Rename {
    /** Every file the rename managed to write, in the order it wrote them. */
    readonly landed: string[]
    /** Why it stopped, or null if it ran to the end. */
    readonly stopped: string | null
  }

  const retarget = (columns: readonly Column[], from: string, to: string): Column[] =>
    columns.map((column) =>
      column.ref === undefined || column.ref.table !== from
        ? column
        : { ...column, ref: { table: to, column: column.ref.column } },
    )

  async function rename(
    running: Running,
    from: string,
    to: string,
    interrupt: (table: string) => Promise<void>,
  ): Promise<Rename> {
    const read = (await get(running.studio, '/api/model')) as unknown as {
      model: { tables: { name: string; columns: Column[] }[] }
      revision: number
    }
    const base = read.revision
    const table = read.model.tables.find((held) => held.name === from)
    if (table === undefined) throw new Error(`no ${from}`)
    const landed: string[] = []

    /** What `renameTable` does between steps: land it, and stop if anything moved. */
    const check = async (): Promise<string | null> => {
      const flushed = await flush(running.studio)
      if (flushed.revision === base) return null
      return flushed.conflicts.map((conflict) => conflict.path).join(' and ')
    }

    const created = await fetch(new URL('/api/table', running.studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
      body: JSON.stringify({ name: to, columns: retarget(table.columns, from, to) }),
    })
    if (!created.ok) return { landed, stopped: 'the create was refused' }
    landed.push(`tables/${to}.md`)
    const afterCreate = await check()
    if (afterCreate !== null) return { landed, stopped: afterCreate }

    for (const referrer of read.model.tables) {
      if (!referrer.columns.some((column) => column.ref?.table === from)) continue
      if (referrer.name === from) continue
      const response = await stalePatch(
        running.studio,
        referrer.name,
        { columns: retarget(referrer.columns, from, to) },
        base,
      )
      if (response.status !== 200) return { landed, stopped: 'a patch was refused' }
      await interrupt(referrer.name)
      const after = await check()
      if (after !== null) return { landed, stopped: after }
      landed.push(`tables/${referrer.name}.md`)
    }

    const deleted = await remove(running.studio, from, base)
    if (deleted.status !== 200) return { landed, stopped: 'the delete was refused' }
    landed.push(`deleted tables/${from}.md`)
    return { landed, stopped: null }
  }

  it('stops, rather than deleting a table something still points at', async () => {
    await withStudio(
      async (running) => {
        const result = await rename(running, 'customers', 'clients', async (name) => {
          if (name !== 'addresses') return
          await editByHand(running.dir, 'tables/addresses.md', addColumn)
        })

        // It stopped, and it stopped somewhere it can describe.
        expect(result.stopped).toBe('tables/addresses.md')
        expect(result.landed).toEqual(['tables/clients.md'])

        const read = await readModel(running.dir)
        // The two things dbmd-39 said were wrong. `customers.md` is still there,
        // so nothing points at a table that is not, and the hand edit survived.
        expect(read.model.tables.map((table) => table.name)).toContain('customers')
        expect(await columnNames(running.dir, 'addresses')).toContain('hand_edited_note')
        const dangling = read.model.tables.filter((table) =>
          table.columns.some((column) => column.ref?.table === 'customers'),
        )
        expect(dangling.map((table) => table.name)).toEqual([
          'addresses',
          'orders',
          'subscriptions',
        ])
        expect(validate(read.model)).toEqual([])
      },
      { debounceMs: ONLY_ON_DEMAND },
    )
  })

  it('runs to the end when nothing changes underneath it', async () => {
    await withStudio(
      async (running) => {
        const result = await rename(running, 'customers', 'clients', async () => {})
        expect(result.stopped).toBeNull()
        expect(result.landed).toEqual([
          'tables/clients.md',
          'tables/addresses.md',
          'tables/orders.md',
          'tables/subscriptions.md',
          'deleted tables/customers.md',
        ])
        const read = await readModel(running.dir)
        expect(read.model.tables.map((table) => table.name)).not.toContain('customers')
        expect(validate(read.model)).toEqual([])
      },
      { debounceMs: ONLY_ON_DEMAND },
    )
  })
})

describe('POST /api/flush', () => {
  it('lands what is pending and answers after it, not before', async () => {
    // The whole reason it exists: a PATCH is answered when the edit is accepted
    // and the write happens a few hundred milliseconds later, so a client
    // composing several edits has nothing to read until something makes the
    // write happen.
    await withStudio(
      async (running) => {
        expect((await patch(running.studio, 'orders', { layout: { x: 7, y: 8 } })).status).toBe(200)
        expect(writes(running)).toEqual([])

        const flushed = await flush(running.studio)
        expect(writes(running)).toEqual(['wrote tables/orders.md'])
        expect(flushed.pendingWrite).toBe(false)
        expect(flushed.lastWrite?.paths).toEqual(['tables/orders.md'])
      },
      { debounceMs: ONLY_ON_DEMAND },
    )
  })

  it('reports a refusal that only came into existence at the write', async () => {
    await withStudio(
      async (running) => {
        await patch(running.studio, 'orders', { layout: { x: 7, y: 8 } })
        await editByHand(running.dir, 'tables/orders.md', addColumn)
        const flushed = await flush(running.studio)
        expect(flushed.conflicts.map((conflict) => conflict.path)).toEqual(['tables/orders.md'])
      },
      { debounceMs: ONLY_ON_DEMAND, watch: false },
    )
  })

  it('takes a content type, like every other mutation, and no revision', async () => {
    await withStudio(async ({ studio }) => {
      const form = await fetch(new URL('/api/flush', studio.url), {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
      })
      expect(form.status).toBe(415)
      // No revision, because it carries no edit: everything it writes was
      // accepted by a request that named one.
      const plain = await fetch(new URL('/api/flush', studio.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      expect(plain.status).toBe(200)
    })
  })
})
