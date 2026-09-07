/**
 * `file-unreadable`, the one diagnostic nothing had ever watched happen.
 *
 * Twenty-nine of the thirty `ModelDiagnosticCode` members were named somewhere
 * in `test/`. This one was named in none of them, and it is emitted from three
 * places. dbmd-f3p.
 *
 * **Why that is worse than an ordinary coverage gap.** The message is built by
 * `errnoText`, which takes the errno out of the error and throws the rest away,
 * because a Node filesystem error's message carries the absolute path the call
 * was made with and ADR 0006 rule 4 forbids an absolute path in output: two
 * machines reading identical input have to print identical bytes, or `dbmd
 * check --json` is not comparable between them. That rule was implemented on a
 * path nothing exercised, so an "improvement" that reached for `error.message`
 * would have made the output machine-dependent with the whole suite still
 * green. `no absolute path reaches the output` below is the test that had been
 * missing, and it is the reason this file exists rather than a coverage number.
 *
 * **Why it is mocked.** The two reader sites are reached by permissions and by
 * races, and neither is a thing a test may do on disk: changing a file's mode
 * behaves differently on Windows and on the Linux runner, and a test skipped on
 * one of them is worse than no test at all. `vi.mock('node:fs/promises')` is
 * how this repository reaches a filesystem failure it cannot cause, which is
 * what `test/model/write.test.ts` does to fail a `rename`.
 *
 * Every assertion here is on the whole sentence rather than on the code, so a
 * reworded message fails rather than passing quietly. That is the standing
 * precedent from dbmd-54: a test that cannot see the words is not reading them.
 */

import { basename } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic } from '../../src/model/types.js'
import { withModel } from './helpers.js'

/**
 * Which paths the two filesystem calls the reader uses should fail on, and with
 * what. `vi.hoisted` because the mock factory is lifted above every import, so
 * the switch has to exist before this file's own top level runs.
 *
 * A hook returning `undefined` means "let the real call through", which is what
 * keeps `withModel` able to build the directory it is about to read.
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

/**
 * A filesystem error as Node raises one: an errno, and a message with the
 * absolute path in it.
 *
 * The path in the message is not decoration. It is what the reader must not
 * print, so a test that builds an error without it cannot fail when the reader
 * starts printing it.
 */
function errno(code: string, path: string): Error {
  const error = new Error(`${code}: something went wrong, open '${path}'`)
  return Object.assign(error, { code })
}

/** Fail exactly one entry, by its base name, and let everything else through. */
function only(name: string, error: unknown): (path: string) => unknown {
  return (path) => (basename(path) === name ? error : undefined)
}

/** Diagnostics as one line each, which is how a reviewer reads them. */
function lines(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => {
    const at = d.at.in === 'file' ? d.at.path : d.at.jsonPath
    return `${at} ${d.severity} ${d.code}: ${d.message}`
  })
}

const ORDERS = '---\nkind: table\ntable: orders\n---\n'

describe('the reader raises file-unreadable from both of its filesystem calls', () => {
  test('a kind directory that cannot be listed, which is the readdir catch', async () => {
    fail.readdir = only('tables', errno('EACCES', '/abs/db-model/tables'))

    const { model, diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(lines(diagnostics)).toEqual([
      'tables error file-unreadable: cannot list the directory: permission denied (EACCES)',
    ])
    // The directory is not listed, so the tables in it are not read, and the
    // reader still returns rather than throwing.
    expect(model.tables).toEqual([])
  })

  test('a file that cannot be read, which is the readFile catch', async () => {
    fail.readFile = only('orders.md', errno('EACCES', '/abs/db-model/tables/orders.md'))

    const { model, diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error file-unreadable: cannot read the file: permission denied (EACCES)',
    ])
    expect(model.tables).toEqual([])
  })

  test('an unreadable _model.md leaves the model incomplete, so a save cannot flatten it', async () => {
    fail.readFile = only('_model.md', errno('EACCES', '/abs/db-model/_model.md'))

    const { model, diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(lines(diagnostics)).toEqual([
      '_model.md error file-unreadable: cannot read the file: permission denied (EACCES)',
    ])
    // The file is there and unreadable, so what it says is unknown rather than
    // absent. `complete: false` is what stops the writer putting an empty
    // `_model.md` over the top of one it could not read.
    expect(model.complete).toBe(false)
    expect(model.tables.map((t) => t.name)).toEqual(['orders'])
  })

  test('the file that vanished between the listing and the read, which is the race', async () => {
    // The entry was listed a moment ago, so ENOENT here is not a typo in a
    // path: it is a file deleted, or a branch checked out, mid-read. dbmd-52's
    // shape, on the reader rather than on the writer.
    fail.readFile = only('orders.md', errno('ENOENT', '/abs/db-model/tables/orders.md'))

    const { diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(lines(diagnostics)).toEqual([
      'tables/orders.md error file-unreadable: cannot read the file: no such file or directory (ENOENT)',
    ])
  })
})

describe('the message names the errno rather than only spelling it', () => {
  test('an errno the table knows reads as a clause a person can act on', async () => {
    fail.readFile = only('orders.md', errno('EISDIR', '/abs/db-model/tables/orders.md'))

    const { diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    // Before dbmd-f3p this sentence ended `cannot read the file: EISDIR`, and
    // `docs/format.md` answered it with "Check permissions", which is advice
    // for a different failure entirely.
    expect(diagnostics[0]?.message).toBe('cannot read the file: it is a directory (EISDIR)')
  })

  test('an errno the table does not know falls back to itself, never to a guess', async () => {
    fail.readFile = only('orders.md', errno('EWOULDBLOCK', '/abs/db-model/tables/orders.md'))

    const { diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(diagnostics[0]?.message).toBe('cannot read the file: EWOULDBLOCK')
  })

  test('a thrown non-Error has no errno, and says so', async () => {
    // The second untested branch. Nothing in Node throws this today, which is
    // exactly why it is the one that rots.
    fail.readFile = only('orders.md', 'the filesystem threw a string')

    const { diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(diagnostics[0]?.message).toBe('cannot read the file: unknown error')
  })

  test('an Error with no code at all is the same branch', async () => {
    fail.readFile = only('orders.md', new Error('boom'))

    const { diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    expect(diagnostics[0]?.message).toBe('cannot read the file: unknown error')
  })
})

describe('no absolute path reaches the output', () => {
  test('the system message is thrown away, path and all', async () => {
    const path = '/home/someone/checkout/db-model/tables/orders.md'
    fail.readFile = only('orders.md', errno('EACCES', path))

    const { diagnostics } = await withModel({ 'tables/orders.md': ORDERS })

    // The whole serialised report, because a path could hide in a field this
    // file does not think to name.
    const report = JSON.stringify(diagnostics)
    expect(report).not.toContain(path)
    expect(report).not.toContain('/home/someone')
    expect(report).not.toContain('something went wrong')
  })

  test('the same input read from two different directories produces the same bytes', async () => {
    // This is the invariant rule 4 is actually about, and the thing a machine
    // can check that "do not print the path" cannot: `withModel` builds a fresh
    // temporary directory each time, so the two roots differ, and the two
    // reports may not. An error message with the path in it fails here even if
    // somebody remembers to strip the one path this file happens to assert on.
    const failing = (path: string) =>
      basename(path) === 'orders.md' ? errno('EACCES', path) : undefined

    fail.readFile = failing
    const first = await withModel({ 'tables/orders.md': ORDERS })
    fail.readFile = failing
    const second = await withModel({ 'tables/orders.md': ORDERS })

    expect(JSON.stringify(second.diagnostics)).toBe(JSON.stringify(first.diagnostics))
    expect(first.diagnostics).toHaveLength(1)
  })
})
