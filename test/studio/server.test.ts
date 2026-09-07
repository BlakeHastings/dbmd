import { describe, expect, it } from 'vitest'
import { access, readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { readModel } from '../../src/model/read.js'
import { startStudio, type Studio } from '../../src/studio/index.js'
import { REVISION_HEADER } from '../../src/studio/wire.js'
import { exampleShop, snapshot, withCopy } from '../model/fixtures.js'

/**
 * The server, driven the way the client will drive it.
 *
 * Nothing here writes or asserts on frontmatter text. The fixture is the example
 * model and everything read back goes through `readModel`, because the format is
 * still moving and a test holding a literal `null: false` would be asserting on
 * a decision that belongs to the writer.
 */

interface Running {
  readonly studio: Studio
  readonly dir: string
  /** Everything the server narrated, so a test can count writes rather than guess. */
  readonly lines: string[]
}

async function withStudio<T>(
  use: (running: Running) => Promise<T>,
  options: { readonly debounceMs?: number; readonly clientDir?: string } = {},
): Promise<T> {
  return withCopy(exampleShop, async (dir) => {
    const lines: string[] = []
    const studio = await startStudio({
      dir,
      port: 0,
      // Never true in a test. A suite that launched a browser per case would be
      // a suite nobody runs twice.
      open: false,
      log: (message) => lines.push(message),
      ...options,
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

/** The debounce is real time, so a test that edits has to let it elapse. */
async function settle(running: Running): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400))
  // The write may have started just as the timer fired; a request is answered
  // after it, so this is a fence rather than another sleep.
  await call(running.studio, '/api/model')
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

      await settle({ studio, dir, lines })

      const after = await snapshot(dir)
      const changed = [...after].filter(([path, text]) => before.get(path) !== text)
      expect(changed.map(([path]) => path)).toEqual(['tables/orders.md'])

      const reread = await readModel(dir)
      expect(reread.diagnostics).toEqual([])
      const table = reread.model.tables.find((entry) => entry.name === 'orders')
      expect(table?.columns.find((column) => column.name === 'status')?.type).toBe('citext')
    })
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
      await settle(running)

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
      await settle(running)

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
      await settle(running)
      expect(writes(running)).toEqual([])
      const { body: after } = await call(running.studio, '/api/model')
      expect(after['lastWrite']).toBeNull()
    })
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
