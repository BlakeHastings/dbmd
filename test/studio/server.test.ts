import { describe, expect, it } from 'vitest'
import { access, readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { readModel } from '../../src/model/read.js'
import type { CanvasObject } from '../../src/model/types.js'
import { validate } from '../../src/model/validate.js'
import { occupiedNotice } from '../../src/studio/edits.js'
import { startStudio, type Studio } from '../../src/studio/index.js'
import { REVISION_HEADER } from '../../src/studio/wire.js'
import { exampleShop, snapshot, untidyModel, withCopy } from '../model/fixtures.js'

/**
 * The server, driven the way the client will drive it.
 *
 * Nothing here writes or asserts on frontmatter text. Everything read back goes
 * through `readModel`, because the format is still moving and a test holding a
 * literal `null: false` would be asserting on a decision that belongs to the
 * writer.
 *
 * The fixture is the example model, except where a case says otherwise. The one
 * that does is about which files were left alone, and `examples/shop` cannot
 * answer that any more; `test/model/fixtures.ts` says why.
 */

interface Running {
  readonly studio: Studio
  readonly dir: string
  /** Everything the server narrated, so a test can count writes rather than guess. */
  readonly lines: string[]
}

async function withStudio<T>(
  use: (running: Running) => Promise<T>,
  options: {
    readonly debounceMs?: number
    readonly clientDir?: string
    /**
     * Which model to open. The example unless a case says otherwise, because it
     * is the model a reader of this repository already knows; `untidyModel` is
     * for the cases whose subject is what the studio does *not* rewrite, and
     * the reason is on that case.
     */
    readonly fixture?: string
  } = {},
): Promise<T> {
  const { fixture = exampleShop, ...studioOptions } = options
  return withCopy(fixture, async (dir) => {
    const lines: string[] = []
    const studio = await startStudio({
      dir,
      port: 0,
      // Never true in a test. A suite that launched a browser per case would be
      // a suite nobody runs twice.
      open: false,
      log: (message) => lines.push(message),
      ...studioOptions,
    })
    try {
      return await use({ studio, dir, lines })
    } finally {
      await studio.close()
    }
  })
}

/**
 * A request, made the way the page makes one.
 *
 * A mutation has to name the revision it was made against (ADR 0025), and
 * reading it here rather than at every call site is what keeps each test about
 * the thing it is testing. `watch.test.ts` is where the revision itself is the
 * subject, and it sends the number by hand for that reason.
 */
async function call(
  studio: Studio,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if ((init.method ?? 'GET') !== 'GET') {
    const status = await fetch(new URL('/api/model', studio.url))
    headers[REVISION_HEADER] = String(((await status.json()) as { revision: number }).revision)
  }
  const response = await fetch(new URL(path, studio.url), { ...init, headers })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

function json(body: unknown): RequestInit {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * Land what is pending, and be answered after it has landed.
 *
 * This was a 400ms sleep and a `GET` that was called a fence and is not one:
 * `GET /api/model` renders the status at the moment it is handled, so a request
 * that arrives while a flush is in flight is answered from the middle of it.
 * `POST /api/flush` answers after the write (ADR 0025), which is the whole
 * reason the page has it. dbmd-52, and the same repair as `watch.test.ts`.
 */
async function flush(running: Running): Promise<void> {
  const response = await fetch(new URL('/api/flush', running.studio.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status).toBe(200)
  await response.json()
}

/**
 * Wait for something to become true, rather than for a length of time.
 *
 * The one thing left in this file that has to wait on a clock the test does not
 * hold is the debounce firing by itself, and polling for it is bounded by what
 * happened rather than by a guess about how slow the machine is.
 *
 * Under vitest's default `testTimeout` of five seconds, and the same number for
 * the same reason as `until` in `watch.test.ts`: on the number they used to
 * share, vitest gives up first and the run says `Test timed out in 5000ms`
 * instead of naming the wait. The docstring over there has the measurement.
 */
async function until(what: () => Promise<boolean>, why: string): Promise<void> {
  const deadline = Date.now() + 4_000
  for (;;) {
    if (await what()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${why}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const writes = (running: Running): string[] => running.lines.filter((l) => l.startsWith('wrote '))

describe('binding', () => {
  it('binds to loopback on a port the OS chose, and says which', async () => {
    await withStudio(async ({ studio, lines }) => {
      expect(studio.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
      expect(studio.port).toBeGreaterThan(0)
      expect(lines[0]).toBe(`dbmd studio  ${studio.url}`)
    })
  })

  it('refuses a request whose Host is not loopback', async () => {
    // Binding to 127.0.0.1 does not stop a name that resolves to it, which is
    // what a DNS rebinding is. The header is the second half of the promise.
    //
    // `fetch` will not send a `Host` of somebody else's choosing, which is the
    // browser rule this is defending against being circumvented, so the request
    // is made by hand.
    await withStudio(async ({ studio }) => {
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          { host: '127.0.0.1', port: studio.port, path: '/api/model', method: 'GET' },
          (response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          },
        )
        request.setHeader('host', 'studio.example.com')
        request.on('error', reject)
        request.end()
      })
      expect(status).toBe(403)
    })
  })
})

describe('GET /api/model', () => {
  it('returns the model, its diagnostics and where the last write stands', async () => {
    await withStudio(async ({ studio }) => {
      const { status, body } = await call(studio, '/api/model')
      expect(status).toBe(200)
      const model = body['model'] as { name: string; tables: { name: string }[] }
      expect(model.name).toBe('kettleback-shop')
      expect(model.tables.map((table) => table.name)).toContain('orders')
      expect(body['diagnostics']).toEqual([])
      expect(body['lastWrite']).toBeNull()
      expect(body['pendingWrite']).toBe(false)
      expect(body['writeError']).toBeNull()
    })
  })

  it('sends the computed maps as arrays, because JSON renders a Map as {}', async () => {
    await withStudio(async ({ studio }) => {
      const { body } = await call(studio, '/api/model')
      const model = body['model'] as Record<string, unknown>
      const groups = model['groupMembers'] as { group: string; tables: string[] }[]
      const references = model['referencesTo'] as { table: string }[]
      expect(groups.map((entry) => entry.group)).toContain('warehouse')
      expect(references.map((entry) => entry.table)).toContain('orders')
    })
  })
})

describe('PATCH /api/table/:name', () => {
  it('changes a column type and writes exactly that one file', async () => {
    await withStudio(async ({ studio, dir, lines }) => {
      const before = await snapshot(dir)
      const { body } = await call(studio, '/api/model')
      const orders = (
        body['model'] as { tables: { name: string; columns: unknown[] }[] }
      ).tables.find((table) => table.name === 'orders')
      const columns = (orders?.columns as { name: string; type: string }[]).map((column) =>
        column.name === 'status' ? { ...column, type: 'citext' } : column,
      )

      const patched = await call(studio, '/api/table/orders', {
        method: 'PATCH',
        ...json({ columns }),
      })
      expect(patched.status).toBe(200)
      expect(patched.body['pendingWrite']).toBe(true)

      await flush({ studio, dir, lines })

      const after = await snapshot(dir)
      const changed = [...after].filter(([path, text]) => before.get(path) !== text)
      expect(changed.map(([path]) => path)).toEqual(['tables/orders.md'])

      const reread = await readModel(dir)
      expect(reread.diagnostics).toEqual([])
      const table = reread.model.tables.find((entry) => entry.name === 'orders')
      expect(table?.columns.find((column) => column.name === 'status')?.type).toBe('citext')
    })
  })

  it('leaves the files it did not edit alone, even when they are not canonical', async () => {
    // The case above is the same claim against `examples/shop`, and it stopped
    // being able to make it. `examples/shop` became byte-canonical when dbmd-14
    // landed, so writing one file and writing the whole model leave exactly the
    // same bytes on disk: the other seven render to what they already say and
    // the writer skips them either way. The assertion is still worth having,
    // because it catches a patch that edits a second object, but it has not
    // been able to tell "wrote one file" from "wrote all of them" for months,
    // and the studio could stop passing `only` with nothing going red. dbmd-47.
    //
    // `untidy` is where the two differ. Every file in it parses and not one of
    // them is canonical, so a whole-model write rewrites all five, which is
    // exactly the defect ADR 0013 records: one drag put three files nobody had
    // touched into the developer's `git status`.
    await withStudio(
      async (running) => {
        const before = await snapshot(running.dir)
        const { body } = await call(running.studio, '/api/model')
        const orders = (
          body['model'] as { tables: { name: string; columns: unknown[] }[] }
        ).tables.find((table) => table.name === 'orders')
        const columns = (orders?.columns as { name: string; type: string }[]).map((column) =>
          column.name === 'status' ? { ...column, type: 'citext' } : column,
        )

        const patched = await call(running.studio, '/api/table/orders', {
          method: 'PATCH',
          ...json({ columns }),
        })
        expect(patched.status).toBe(200)
        await flush(running)

        const after = await snapshot(running.dir)
        const changed = [...after].filter(([path, text]) => before.get(path) !== text)
        expect(changed.map(([path]) => path)).toEqual(['tables/orders.md'])
        // Named one by one as well as counted, because the count above is the
        // assertion that went quiet and this is what it was for: these four are
        // the files a whole-model write would have reformatted.
        for (const untouched of [
          '_model.md',
          'groups/billing.md',
          'notes/floating.md',
          'tables/customers.md',
        ]) {
          expect(after.get(untouched)).toBe(before.get(untouched))
        }

        const reread = await readModel(running.dir)
        const table = reread.model.tables.find((entry) => entry.name === 'orders')
        expect(table?.columns.find((column) => column.name === 'status')?.type).toBe('citext')
      },
      { fixture: untidyModel },
    )
  })

  it('carries a unique index through a patch that replaces the index list', async () => {
    // The wire format has to round-trip every key the model has, or editing one
    // index would silently drop the constraint that made another one matter.
    await withStudio(async (running) => {
      const { body } = await call(running.studio, '/api/model')
      const products = (
        body['model'] as { tables: { name: string; indexes: { name: string }[] }[] }
      ).tables.find((table) => table.name === 'products')
      const indexes = [
        ...(products?.indexes ?? []),
        { name: 'products_price_idx', columns: ['price_pence'] },
      ]

      await call(running.studio, '/api/table/products', { method: 'PATCH', ...json({ indexes }) })
      await flush(running)

      const reread = await readModel(running.dir)
      expect(reread.diagnostics).toEqual([])
      const written = reread.model.tables.find((table) => table.name === 'products')?.indexes
      expect(written?.map((index) => [index.name, index.unique])).toEqual(
        indexes.map((index) => [index.name, (index as { unique?: boolean }).unique]),
      )
      expect(written?.some((index) => index.unique === true)).toBe(true)
    })
  })

  it('carries an expression key back out unchanged, so a neighbouring edit cannot flatten it', async () => {
    // The inspector cannot edit an expression key and does not try (ADR 0022):
    // it sends back the one it was given, beside whatever the developer did
    // change. If the wire refused that shape, a table with one expression index
    // would have no editable indexes at all; if it accepted a flattened one,
    // renaming a neighbour would rewrite `lower(price_pence)` as a column of
    // that name, which is a different index and a legal one.
    await withStudio(async (running) => {
      const indexes = [
        { name: 'products_price_lower_idx', columns: [{ expression: 'lower(sku)' }] },
        { name: 'products_price_idx', columns: ['price_pence'] },
      ]
      const { status } = await call(running.studio, '/api/table/products', {
        method: 'PATCH',
        ...json({ indexes }),
      })
      expect(status).toBe(200)
      await flush(running)

      const reread = await readModel(running.dir)
      expect(reread.diagnostics).toEqual([])
      const written = reread.model.tables.find((table) => table.name === 'products')?.indexes
      expect(written?.map((index) => index.columns)).toEqual([
        [{ expression: 'lower(sku)' }],
        ['price_pence'],
      ])
    })
  })

  it('does not write a file it did not change', async () => {
    await withStudio(async (running) => {
      const { body } = await call(running.studio, '/api/model')
      const orders = (body['model'] as { tables: { name: string; layout: unknown }[] }).tables.find(
        (table) => table.name === 'orders',
      )
      // The layout the file already carries, sent back verbatim.
      await call(running.studio, '/api/table/orders', {
        method: 'PATCH',
        ...json({ layout: orders?.layout }),
      })
      await flush(running)
      expect(writes(running)).toEqual([])
      const { body: after } = await call(running.studio, '/api/model')
      expect(after['lastWrite']).toBeNull()
    })
  })

  it('writes when the debounce elapses, with nobody asking it to', async () => {
    // Everything else in this file lands its write with `POST /api/flush`, so
    // this is the one case that asserts ADR 0004's actual promise: the edit is
    // written a few hundred milliseconds after it stops arriving, on the
    // server's own timer, with no second request. It waits for the write rather
    // than for a duration, so a slow machine makes it slower and never wrong.
    await withStudio(
      async (running) => {
        const patched = await call(running.studio, '/api/table/orders', {
          method: 'PATCH',
          ...json({ layout: { x: 61, y: 62 } }),
        })
        expect(patched.status).toBe(200)
        expect(patched.body['pendingWrite']).toBe(true)

        await until(async () => writes(running).length > 0, 'the debounce to fire on its own')
        expect(writes(running)).toEqual(['wrote tables/orders.md'])

        const reread = await readModel(running.dir)
        expect(reread.model.tables.find((table) => table.name === 'orders')?.layout).toEqual({
          x: 61,
          y: 62,
        })
      },
      { debounceMs: 40 },
    )
  })

  it('coalesces a drag into one write rather than sixty', async () => {
    await withStudio(
      async (running) => {
        for (let step = 0; step < 60; step += 1) {
          const response = await call(running.studio, '/api/table/orders', {
            method: 'PATCH',
            ...json({ layout: { x: 480 + step, y: 340 + step } }),
          })
          expect(response.status).toBe(200)
        }
        // Nothing has been written yet: the timer has been pushed out 60 times.
        expect(writes(running)).toEqual([])

        await running.studio.close()
        expect(writes(running)).toEqual(['wrote tables/orders.md'])

        const reread = await readModel(running.dir)
        expect(reread.model.tables.find((table) => table.name === 'orders')?.layout).toEqual({
          x: 539,
          y: 399,
        })
      },
      // Long enough that sixty round trips over loopback finish inside it on a
      // busy machine, so the assertion is about coalescing and not about speed.
      { debounceMs: 5_000 },
    )
  })

  it('refuses an edit to a table whose file did not parse', async () => {
    await withCopy(exampleShop, async (dir) => {
      const file = join(dir, 'tables', 'orders.md')
      const text = await readFile(file, 'utf8')
      // A `table:` that disagrees with the file name is an error about this
      // file, so the reader marks the object incomplete and the writer skips it.
      await writeFile(file, text.replace('table: orders', 'table: not_orders'), 'utf8')
      const before = await readFile(file, 'utf8')

      const studio = await startStudio({ dir, port: 0, open: false, log: () => {} })
      try {
        const response = await call(studio, '/api/table/orders', {
          method: 'PATCH',
          ...json({ layout: { x: 1, y: 1 } }),
        })
        expect(response.status).toBe(409)
        expect(response.body['code']).toBe('incomplete')
      } finally {
        await studio.close()
      }
      // The point of the refusal: the file the reader could not understand is
      // still the file the developer has to fix.
      expect(await readFile(file, 'utf8')).toBe(before)
    })
  })

  it('is a 404 for a table that is not in the model', async () => {
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/table/nope', {
        method: 'PATCH',
        ...json({ layout: { x: 1, y: 1 } }),
      })
      expect(response.status).toBe(404)
      expect(response.body['code']).toBe('unknown-table')
    })
  })

  it('carries a referential action through a column patch and onto the disk', async () => {
    await withStudio(async (running) => {
      const columns = [
        { name: 'id', type: 'uuid', pk: true },
        {
          name: 'order_id',
          type: 'uuid',
          nullable: false,
          ref: { table: 'orders', column: 'id', onDelete: 'cascade', onUpdate: 'no action' },
        },
      ]
      const { status } = await call(running.studio, '/api/table/shipments', {
        method: 'PATCH',
        ...json({ columns }),
      })
      expect(status).toBe(200)
      await flush(running)

      const reread = await readModel(running.dir)
      expect(reread.diagnostics).toEqual([])
      expect(
        reread.model.tables.find((table) => table.name === 'shipments')?.columns[1]?.ref,
      ).toEqual({ table: 'orders', column: 'id', onDelete: 'cascade', onUpdate: 'no action' })
    })
  })

  it('refuses an action outside the five rather than writing a file it cannot read back', async () => {
    // The contract's own spelling is the likely mistake, and it is still not one
    // of the five words a file holds. ADR 0046.
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/table/shipments', {
        method: 'PATCH',
        ...json({
          columns: [
            {
              name: 'order_id',
              type: 'uuid',
              ref: { table: 'orders', column: 'id', onDelete: 'setNull' },
            },
          ],
        }),
      })
      expect(response.status).toBe(400)
      expect(response.body['error']).toContain('columns[0].ref.onDelete')
    })
  })

  it('refuses a key it does not understand rather than dropping it', async () => {
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/table/orders', {
        method: 'PATCH',
        ...json({ layuot: { x: 1, y: 1 } }),
      })
      expect(response.status).toBe(400)
      expect(response.body['error']).toContain('layuot')
    })
  })

  it('refuses a body that did not arrive as JSON', async () => {
    // Not pedantry: a form post is one of the three content types a browser
    // sends cross-origin without a preflight, and this is what closes that door.
    await withStudio(async ({ studio }) => {
      const response = await fetch(new URL('/api/table/orders', studio.url), {
        method: 'PATCH',
        headers: { 'content-type': 'text/plain' },
        body: '{"layout":{"x":1,"y":1}}',
      })
      expect(response.status).toBe(415)
    })
  })
})

describe('path traversal', () => {
  it('refuses a table name that climbs out of the model directory', async () => {
    await withStudio(async ({ studio, dir }) => {
      const response = await call(studio, '/api/table/..%2F..%2Fpwned', {
        method: 'PATCH',
        ...json({ layout: { x: 1, y: 1 } }),
      })
      expect(response.status).toBe(400)
      expect(response.body['code']).toBe('unsafe-name')
      await expect(access(join(dir, '..', '..', 'pwned.md'))).rejects.toThrow()
    })
  })

  it('refuses to create a table outside the model directory', async () => {
    await withStudio(async ({ studio, dir }) => {
      const response = await call(studio, '/api/table', {
        method: 'POST',
        ...json({ name: '../../pwned' }),
      })
      expect(response.status).toBe(400)
      expect(response.body['code']).toBe('unsafe-name')
      await expect(access(join(dir, '..', '..', 'pwned.md'))).rejects.toThrow()
    })
  })

  it('refuses to delete outside the model directory', async () => {
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/table/..%2F..%2F_model', { method: 'DELETE' })
      expect(response.status).toBe(400)
      expect(response.body['code']).toBe('unsafe-name')
    })
  })

  it('refuses a static path that climbs out of the client directory', async () => {
    await withStudio(async ({ studio }) => {
      const response = await fetch(new URL('/..%2F..%2Fpackage.json', studio.url))
      expect(response.status).toBe(400)
    })
  })
})

describe('POST and DELETE /api/table', () => {
  it('creates a table file immediately, because creating one is deliberate', async () => {
    await withStudio(async ({ studio, dir }) => {
      const response = await call(studio, '/api/table', {
        method: 'POST',
        ...json({
          name: 'roast_days',
          columns: [{ name: 'id', type: 'uuid', pk: true }],
          layout: { x: 40, y: 40 },
        }),
      })
      expect(response.status).toBe(201)
      expect((response.body['lastWrite'] as { paths: string[] }).paths).toEqual([
        'tables/roast_days.md',
      ])

      const reread = await readModel(dir)
      expect(reread.diagnostics).toEqual([])
      const created = reread.model.tables.find((table) => table.name === 'roast_days')
      expect(created?.columns.map((column) => column.name)).toEqual(['id'])
      expect(created?.layout).toEqual({ x: 40, y: 40 })
    })
  })

  // ADR 0052. `dbmd import` writes one line into every table saying nobody has
  // documented it, because a command that exits has no other way to reach a
  // reader who arrives later. A create here does have one: the panel is open on
  // the new table with the prose box in it, and the box asks. So the file holds
  // the frontmatter and nothing the developer did not type.
  //
  // `body` back through the reader rather than the file text, because that is
  // also the round trip: the body is everything after the closing `---`, so a
  // writer that padded would read back as `\n\n` here.
  it('writes no prose into a created table, because the panel asks for it', async () => {
    await withStudio(async ({ studio, dir }) => {
      const response = await call(studio, '/api/table', {
        method: 'POST',
        ...json({ name: 'roast_days', layout: { x: 40, y: 40 } }),
      })
      expect(response.status).toBe(201)

      const reread = await readModel(dir)
      const created = reread.model.tables.find((table) => table.name === 'roast_days')
      expect(created?.body).toBe('\n')
    })
  })

  it('refuses to create over a table that is already there', async () => {
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/table', {
        method: 'POST',
        ...json({ name: 'orders' }),
      })
      expect(response.status).toBe(409)
      expect(response.body['code']).toBe('table-exists')
    })
  })

  it('deletes the file, which is the one place in this project that deletes', async () => {
    await withStudio(async ({ studio, dir }) => {
      const response = await call(studio, '/api/table/shipments', { method: 'DELETE' })
      expect(response.status).toBe(200)
      await expect(access(join(dir, 'tables', 'shipments.md'))).rejects.toThrow()
      const { body } = await call(studio, '/api/model')
      const names = (body['model'] as { tables: { name: string }[] }).tables.map((t) => t.name)
      expect(names).not.toContain('shipments')
    })
  })

  // The counterfactual for `occupiedNotice`, over HTTP and on every platform,
  // because the case-fold half of that function needs a filesystem that folds
  // and CI runs on one that does not. A file the reader could not turn into an
  // object is the state this refusal was written for, and it still says so.
  it('refuses to create over a file that did not parse, and says to fix or delete it', async () => {
    await withStudio(async ({ studio, dir }) => {
      await writeFile(
        join(dir, 'tables', 'ledger.md'),
        '---\ntable: ledger\ncolumns:\n  - name: id\n   type: uuid\n---\n\nHalf a table.\n',
      )

      const response = await call(studio, '/api/table', {
        method: 'POST',
        ...json({ name: 'ledger' }),
      })

      expect(response.status).toBe(409)
      expect(response.body['error']).toBe(
        '`tables/ledger.md` is already a file, and it is not in the model, which means it did not parse. Fix or delete it rather than writing over it',
      )
      // Nothing was written over, which is the point of the refusal.
      const { model } = await readModel(dir)
      expect(model.tables.map((table) => table.name)).not.toContain('ledger')
    })
  })
})

/**
 * The refusal a create gets when the path is taken, which used to be one
 * sentence and had to be three.
 *
 * The name check in `addObject` is case-sensitive and the filesystem check
 * under it is not, on Windows and macOS. So creating `Orders` beside a healthy
 * `orders` fell past the first and into the second, and the second says the
 * file `is not in the model, which means it did not parse. Fix or delete it`.
 * The file was `tables/orders.md`, it was in the model, it was drawn on the
 * canvas at that moment, and **following the advice deletes a healthy table.**
 * Driven in Chromium on 2026-09-08 through the panel's own `Create anyway`.
 *
 * `occupiedNotice` is asked directly rather than over HTTP because CI runs on
 * Linux, where `access` answers `tables/Orders.md` with `no` and the whole
 * defect is unreachable. The listing it takes is the fact that decides it, so
 * handing it one is handing it the filesystem the case is about. The case that
 * *is* reachable everywhere is the counterfactual above.
 */
describe('the file already at a new object`s path', () => {
  const entries = ['addresses.md', 'customers.md', 'orders.md', 'products.md']
  const held = async (dir: string): Promise<readonly CanvasObject[]> =>
    (await readModel(dir)).model.tables

  it('says which table the file is, when the filesystem folded the name onto one', async () => {
    await withCopy(exampleShop, async (dir) => {
      const notice = occupiedNotice('table', 'Orders', entries, await held(dir))

      expect(notice).toContain(
        '`tables/Orders.md` and `tables/orders.md` are the same file on this filesystem',
      )
      expect(notice).toContain('that file is the table `orders`')
      // The two sentences the old one got wrong: it did parse, and nothing here
      // is safe to delete.
      expect(notice).not.toContain('did not parse')
      expect(notice).not.toContain('Fix or delete it')
    })
  })

  it('says nothing was written, and what a name has to differ by', async () => {
    await withCopy(exampleShop, async (dir) => {
      const notice = occupiedNotice('table', 'Orders', entries, await held(dir))

      expect(notice).toContain('Nothing was written')
      expect(notice).toContain('differs by more than case')
    })
  })

  it('keeps the sentence it was written for when the file is a stray nobody could read', async () => {
    await withCopy(exampleShop, async (dir) => {
      const notice = occupiedNotice('table', 'ledger', [...entries, 'ledger.md'], await held(dir))

      expect(notice).toBe(
        '`tables/ledger.md` is already a file, and it is not in the model, which means it did not parse. Fix or delete it rather than writing over it',
      )
    })
  })

  it('says a fold onto a stray is a fold, and still says to fix or delete it', async () => {
    await withCopy(exampleShop, async (dir) => {
      const notice = occupiedNotice('table', 'Ledger', [...entries, 'ledger.md'], await held(dir))

      expect(notice).toContain(
        '`tables/Ledger.md` and `tables/ledger.md` are the same file on this filesystem',
      )
      expect(notice).toContain('it is not in the model, which means it did not parse')
      expect(notice).toContain('Fix or delete it')
    })
  })

  // macOS folds the accent as well as the case, so the comparison normalises
  // before it lowercases. A listing that holds the composed spelling answers a
  // request for the decomposed one, which is the same defect one character
  // along.
  it('folds a decomposed accent the way the filesystem that produced it does', async () => {
    await withCopy(exampleShop, async (dir) => {
      // The same six letters twice: an `e` and a combining acute in the name,
      // one `é` in the listing. Written as escapes because the difference is
      // invisible in a source file, which is why the fold is asked rather than
      // eyeballed.
      const notice = occupiedNotice('table', 'café', ['café.md'], await held(dir))

      expect(notice).toContain('are the same file on this filesystem')
      expect(notice).toContain('it is not in the model')
    })
  })

  it('names the kind it was asked about, because a note is not a table', async () => {
    await withCopy(exampleShop, async (dir) => {
      const { model } = await readModel(dir)
      const notice = occupiedNotice(
        'note',
        'There-Is-No-Stock-Column',
        ['there-is-no-stock-column.md'],
        model.notes,
      )

      expect(notice).toContain('that file is the note `there-is-no-stock-column`')
      expect(notice).toContain('the case of a note is a rename the studio cannot make here')
    })
  })
})

describe('routing', () => {
  it('answers 405 with an Allow header on a method an endpoint does not take', async () => {
    await withStudio(async ({ studio }) => {
      const response = await fetch(new URL('/api/model', studio.url), { method: 'DELETE' })
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET')
    })
  })

  it('answers 404 for an endpoint that does not exist', async () => {
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/nothing')
      expect(response.status).toBe(404)
      expect(response.body['code']).toBe('unknown-endpoint')
    })
  })
})

/**
 * Notes and groups, which are the same server as tables one directory along.
 *
 * ADR 0005 made a kind a directory and a set of keys and nothing else, and
 * `edits.ts` is one code path for all three, so most of what is proven for a
 * table above is proven for these by construction. What is here is the part
 * that is *not* the same: the keys a group refuses, and the write a group drag
 * makes.
 */
describe('notes', () => {
  it('creates one file and edits no other', async () => {
    await withStudio(
      async (running) => {
        const before = await snapshot(running.dir)
        const created = await call(running.studio, '/api/note', {
          method: 'POST',
          ...json({ name: 'why-it-is-like-this', layout: { x: 40, y: 400 }, color: 'amber' }),
        })
        expect(created.status).toBe(201)
        await flush(running)

        const after = await snapshot(running.dir)
        expect([...after.keys()].filter((path) => !before.has(path))).toEqual([
          'notes/why-it-is-like-this.md',
        ])
        for (const [path, text] of before) expect(after.get(path)).toBe(text)

        const reread = await readModel(running.dir)
        expect(reread.diagnostics).toEqual([])
        const note = reread.model.notes.find((held) => held.name === 'why-it-is-like-this')
        expect(note?.layout).toEqual({ x: 40, y: 400 })
        expect(note?.color).toBe('amber')
      },
      { fixture: untidyModel },
    )
  })

  it('moves, resizes, recolours and rewrites one, and touches nothing else', async () => {
    await withStudio(
      async (running) => {
        const before = await snapshot(running.dir)
        const patched = await call(running.studio, '/api/note/floating', {
          method: 'PATCH',
          ...json({
            layout: { x: 10, y: 20, w: 400, h: 300 },
            color: 'teal',
            body: '\nMoved, resized and repainted.\n',
          }),
        })
        expect(patched.status).toBe(200)
        await flush(running)

        const after = await snapshot(running.dir)
        const changed = [...after].filter(([path, text]) => before.get(path) !== text)
        expect(changed.map(([path]) => path)).toEqual(['notes/floating.md'])

        const note = (await readModel(running.dir)).model.notes[0]
        expect(note?.layout).toEqual({ x: 10, y: 20, w: 400, h: 300 })
        expect(note?.color).toBe('teal')
        expect(note?.body).toBe('\nMoved, resized and repainted.\n')
      },
      { fixture: untidyModel },
    )
  })

  it('removes the colour when the patch says null, rather than writing an empty one', async () => {
    await withStudio(
      async (running) => {
        await call(running.studio, '/api/note/floating', {
          method: 'PATCH',
          ...json({ color: null }),
        })
        await flush(running)
        expect((await readModel(running.dir)).model.notes[0]?.color).toBeUndefined()
        expect(await readFile(join(running.dir, 'notes', 'floating.md'), 'utf8')).not.toContain(
          'color',
        )
      },
      { fixture: untidyModel },
    )
  })

  it('deletes one, and leaves the rest of the model alone', async () => {
    await withStudio(
      async (running) => {
        const before = await snapshot(running.dir)
        const response = await call(running.studio, '/api/note/floating', { method: 'DELETE' })
        expect(response.status).toBe(200)
        await expect(access(join(running.dir, 'notes', 'floating.md'))).rejects.toThrow()

        const after = await snapshot(running.dir)
        expect([...before.keys()].filter((path) => !after.has(path))).toEqual(['notes/floating.md'])
        for (const [path, text] of after) expect(before.get(path)).toBe(text)
      },
      { fixture: untidyModel },
    )
  })

  it('says which note it does not have, rather than saying nothing', async () => {
    await withStudio(async ({ studio }) => {
      const response = await call(studio, '/api/note/nope', { method: 'PATCH', ...json({}) })
      expect(response.status).toBe(404)
      expect(response.body['code']).toBe('unknown-note')
    })
  })
})

describe('groups', () => {
  it('creates one with a label and a colour and no coordinates', async () => {
    await withStudio(async (running) => {
      const created = await call(running.studio, '/api/group', {
        method: 'POST',
        ...json({ name: 'billing', label: 'Billing', color: 'violet' }),
      })
      expect(created.status).toBe(201)
      await flush(running)

      const text = await readFile(join(running.dir, 'groups', 'billing.md'), 'utf8')
      expect(text).toContain('label: Billing')
      expect(text).not.toContain('layout')
      // Empty, and that is the format: a table joins from its own file. The
      // validator says so, which is the warning working rather than a fault.
      const reread = await readModel(running.dir)
      expect(reread.model.groupMembers.get('billing')).toEqual([])
    })
  })

  it('refuses a `layout` on a group, and says why rather than saying `unknown key`', async () => {
    // The trap this whole item is arranged around. A client that sent a group a
    // position believed something about this format that is not true, and the
    // refusal is the only place it will be told.
    await withStudio(async (running) => {
      const response = await call(running.studio, '/api/group/warehouse', {
        method: 'PATCH',
        ...json({ layout: { x: 0, y: 0 } }),
      })
      expect(response.status).toBe(400)
      expect(String(response.body['error'])).toContain('a group has no coordinates')
      expect(String(response.body['error'])).toContain('ADR 0005')
    })
  })

  it('refuses a members list, and points at the table patch that does it properly', async () => {
    await withStudio(async (running) => {
      const response = await call(running.studio, '/api/group/warehouse', {
        method: 'PATCH',
        ...json({ members: ['shipments'] }),
      })
      expect(response.status).toBe(400)
      expect(String(response.body['error'])).toContain('PATCH /api/table/')
    })
  })

  it('puts a table in a group by writing one line in that table, not in the group', async () => {
    await withStudio(
      async (running) => {
        const before = await snapshot(running.dir)
        await call(running.studio, '/api/table/customers', {
          method: 'PATCH',
          ...json({ group: 'billing' }),
        })
        await flush(running)

        const after = await snapshot(running.dir)
        const changed = [...after].filter(([path, text]) => before.get(path) !== text)
        expect(changed.map(([path]) => path)).toEqual(['tables/customers.md'])
        expect(after.get('groups/billing.md')).toBe(before.get('groups/billing.md'))
        expect(after.get('tables/customers.md')).toContain('group: billing')
      },
      { fixture: untidyModel },
    )
  })

  it('drags as one write of its members, and nothing at all for the group', async () => {
    // The whole of dbmd-34's trap, from the request side. The canvas sends one
    // `PATCH` per member that moved, all inside the server's debounce window,
    // so what reaches the disk is one `writeModel` whose `only` set is exactly
    // those members. What must not appear anywhere is `groups/billing.md`.
    //
    // `untidy` and not `examples/shop`, for the reason the case above spells
    // out: every file in `untidy` is non-canonical, so a write that forgot to
    // narrow itself rewrites the neighbours and this notices. Against a
    // canonical fixture the assertion cannot fail. dbmd-47.
    //
    // The two members come out of the fixture and are deliberately not made
    // here. Joining one in the test would flush first, and a flush that had
    // stopped narrowing itself would canonicalise the whole directory before
    // the drag, so the drag would then find every neighbour already canonical
    // and change nothing — the same fixture-shaped blindness, arrived at from
    // the other end. Checked by removing `only` and watching this go green.
    await withStudio(
      async (running) => {
        const before = await snapshot(running.dir)
        const writesBefore = writes(running).length

        for (const [table, layout] of [
          ['customers', { x: 220, y: 220 }],
          ['orders', { x: 580, y: 220 }],
        ] as const) {
          const response = await call(running.studio, `/api/table/${table}`, {
            method: 'PATCH',
            ...json({ layout }),
          })
          expect(response.status).toBe(200)
        }
        await flush(running)

        // One write, naming both members and nothing else. Counted from the
        // narration rather than from the files, because the question is how
        // many times the writer ran and with what, and two writes of one file
        // each would leave the same bytes behind as one write of two.
        expect(writes(running).slice(writesBefore)).toEqual([
          'wrote tables/customers.md, tables/orders.md',
        ])

        const after = await snapshot(running.dir)
        const changed = [...after].filter(([path, text]) => before.get(path) !== text)
        expect(changed.map(([path]) => path)).toEqual(['tables/customers.md', 'tables/orders.md'])
        // Named as well as counted. `groups/billing.md` is the one that matters
        // and the other three are what a whole-model write would have
        // reformatted on the way past.
        for (const untouched of ['_model.md', 'groups/billing.md', 'notes/floating.md']) {
          expect(after.get(untouched)).toBe(before.get(untouched))
        }
        expect(after.get('groups/billing.md')).not.toContain('layout')

        const reread = await readModel(running.dir)
        expect(reread.model.tables.find((held) => held.name === 'orders')?.layout).toEqual({
          x: 580,
          y: 220,
        })
      },
      { fixture: untidyModel },
    )
  })

  it('leaves an empty group standing when its last member is deleted', async () => {
    // Not a cascade. The group file keeps its label and its prose, `dbmd check`
    // reports `group-empty`, and deciding what that means is the developer's.
    await withStudio(
      async (running) => {
        for (const table of ['orders', 'customers']) {
          const response = await call(running.studio, `/api/table/${table}`, { method: 'DELETE' })
          expect(response.status).toBe(200)
        }

        const reread = await readModel(running.dir)
        expect(reread.model.groups.map((group) => group.name)).toEqual(['billing'])
        expect(reread.model.groupMembers.get('billing')).toEqual([])
        expect(validate(reread.model).map((diagnostic) => diagnostic.code)).toContain('group-empty')
      },
      { fixture: untidyModel },
    )
  })
})

describe('the client', () => {
  it('serves the page at the root', async () => {
    // The default client directory is the one beside this module, which under
    // vitest is the source and after `npm run build` is the bundle. Both hold
    // `index.html`, so this is the same assertion in both.
    await withStudio(async ({ studio }) => {
      const response = await fetch(studio.url)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('dbmd studio')
    })
  })

  it('is a 404 for a file the client directory does not hold', async () => {
    await withStudio(async ({ studio }) => {
      const response = await fetch(new URL('/nothing.js', studio.url))
      expect(response.status).toBe(404)
    })
  })
})
