/**
 * `docs/import-format.md` is the page somebody opens when `dbmd import` printed
 * a code at them, and it is the only page that documents the `import/` half.
 *
 * A per-code table goes stale the moment a code is added, and a stale table is
 * worse than no table: it tells the one person who cannot check it against the
 * source that the code they are holding does not exist. So the table is not
 * written down twice. It is written down once, in the page, and checked here
 * against `ImportDiagnosticCode` in `src/diagnostics.ts`.
 *
 * This is the import half of what `test/docs/format.test.ts` does for the model
 * half. Two similar tests rather than one clever one: the two pages have
 * different audiences and different shapes, and there is no third yet.
 *
 * The check runs both ways on purpose. A code with no row is the gap the item
 * asked for. A row with no code is the other half of it, and is what a rename
 * leaves behind: `docs/format.md`'s guarantee would not catch that one.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { ImportDiagnosticCode } from '../../src/diagnostics.js'

const pagePath = fileURLToPath(new URL('../../docs/import-format.md', import.meta.url))
const codesPath = fileURLToPath(new URL('../../src/diagnostics.ts', import.meta.url))

const page = await readFile(pagePath, 'utf8')
const source = await readFile(codesPath, 'utf8')

/**
 * The union, as the source states it.
 *
 * `docs/format.md`'s test slices its union at the first blank line, which makes
 * how that declaration is formatted load-bearing: a blank line put inside it to
 * space out a long doc comment would truncate the list silently, and a silently
 * short list is a green test that has stopped testing. This slices at the next
 * top-level `export` instead, so the only formatting rule it imposes is one
 * TypeScript imposes anyway. Overshooting into the following declaration is
 * safe: the pattern wants a `|` and a quoted `import/` name, which prose in a
 * doc comment does not have, and an over-long list would fail loudly here
 * rather than quietly pass.
 */
function unionMembers(): ImportDiagnosticCode[] {
  const start = source.indexOf('export type ImportDiagnosticCode =')
  if (start === -1) throw new Error('`ImportDiagnosticCode` is not declared in src/diagnostics.ts')
  const rest = source.slice(start + 'export type ImportDiagnosticCode ='.length)
  const next = /^export /m.exec(rest)
  const union = next === null ? rest : rest.slice(0, next.index)
  return [...union.matchAll(/\|\s*'(import\/[a-z-]+)'/g)].map(
    (match) => match[1] as ImportDiagnosticCode,
  )
}

/** Every code the page gives a row to, in either of the two tables. */
function rowCodes(): string[] {
  return [...page.matchAll(/^\| `(import\/[a-z-]+)` \| (error|warning) \|/gm)].map(
    (match) => match[1] as string,
  )
}

const codes = unionMembers()
const rows = rowCodes()

describe('docs/import-format.md keeps up with the reader', () => {
  test('there is a union to read and a table to read it against', () => {
    // Without this, a regex that stopped matching would leave two empty lists
    // that compare equal, which is the shape of a test that has quietly stopped
    // testing anything. The floor is well under the count either side has.
    expect(codes.length).toBeGreaterThan(10)
    expect(rows.length).toBeGreaterThan(10)
  })

  test('every code has a row, and every row has a code', () => {
    expect([...rows].sort()).toEqual([...codes].sort())
  })

  test('no code is given two rows', () => {
    expect([...new Set(rows)].length).toBe(rows.length)
  })

  test('the diagnostics the page prints as examples are codes that exist', () => {
    // The page shows real output in fenced blocks, `error $.tables[0].name
    // [import/unsafe-name] ...`. Those are quoted rather than generated, so this
    // is what stops a renamed code surviving in an example after the table has
    // been fixed.
    const shown = [...page.matchAll(/\[(import\/[a-z-]+)\]/g)].map((match) => match[1] as string)
    expect(shown.length).toBeGreaterThan(0)
    expect(
      [...new Set(shown)].filter((code) => !codes.includes(code as ImportDiagnosticCode)),
    ).toEqual([])
  })
})
