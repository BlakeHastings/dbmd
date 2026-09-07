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
 *
 * The second half of this file, since dbmd-4.1, does the same to the page's
 * `json` blocks: they are run through `readEnvelope`, the SQL Server provider's
 * `parse` and `validateIntrospectionDocument` rather than read by eye. See the
 * comment above `taggedJson` for which blocks that is and which it is not.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { ImportDiagnosticCode } from '../../src/diagnostics.js'
import { INTROSPECTION_VERSION } from '../../src/import/contract.js'
import { readEnvelope, validateIntrospectionDocument } from '../../src/import/contract.js'
import type { Diagnostic } from '../../src/import/diagnostics.js'
import { locationText } from '../../src/import/diagnostics.js'
import { sqlserverProvider } from '../../src/import/providers/sqlserver.js'

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

// ---------------------------------------------------------------------------
// The page's JSON blocks are inputs
// ---------------------------------------------------------------------------

/**
 * Four fenced `json` blocks on the page are tagged, and each is run through the
 * function that would read it for real.
 *
 *     ```json dbmd-import:envelope
 *     ```json dbmd-import:raw-column
 *     ```json dbmd-import:canonical-column
 *     ```json dbmd-import:canonical-table
 *
 * The two column blocks are one claim, not two. The page says that the raw
 * column, put through the SQL Server provider, becomes the canonical one, so
 * that is what is asserted: `parse` is run and its output compared with the
 * block the page prints. Checking the two shapes separately would leave the
 * transformation between them, which is the only thing that section is about,
 * resting on somebody's memory of what `max_length` counts.
 *
 * The other two go through the real reader as well: the envelope through
 * `readEnvelope`, and the canonical table through
 * `validateIntrospectionDocument` with no diagnostics allowed at all. A renamed
 * field reads there as `import/unknown-field` and a removed one as
 * `import/missing-field`, which is the assertion that would have caught the
 * dbmd-13 rename that went stale on this page and was found by hand.
 *
 * The blocks that are not covered are the two kinds this cannot reach. The
 * shape listings (`Table`, `Column`, `ColumnType`, ...) are a pseudo-schema with
 * no parser, and checking them means generating them from the TypeScript, which
 * is a larger job than this one. The diagnostic output lines are checked as far
 * as their codes by the tests above, and reproducing each scenario in full is
 * what `test/cli/import.test.ts` already does for the ones worth reproducing.
 *
 * The info string past the language is invisible on GitHub, so the page reads as
 * prose and still cannot lie. Same trick as `test/docs/format.test.ts`, and
 * deliberately not the same code: the two pages' blocks are different kinds of
 * thing and share nothing but the fence scanner.
 */
function taggedJson(tag: string): unknown {
  const lines = page.split('\n')
  const opening = lines.findIndex((line) => line === `\`\`\`json dbmd-import:${tag}`)
  if (opening === -1) {
    throw new Error(`docs/import-format.md has no \`\`\`json dbmd-import:${tag} block`)
  }
  const end = lines.indexOf('```', opening + 1)
  if (end === -1) throw new Error(`unterminated fence at docs/import-format.md:${opening + 1}`)
  return JSON.parse(lines.slice(opening + 1, end).join('\n'))
}

/** The fixture the worked example says its raw column was taken from. */
const fixturePath = fileURLToPath(new URL('./fixtures/sqlserver-raw.json', import.meta.url))

/** Enough of a diagnostic to say what went wrong when the page is the thing that broke. */
function summarise(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `${locationText(d.at)} ${d.code} ${d.message}`)
}

describe('the json in docs/import-format.md is an input', () => {
  test('the tagged blocks are all still there', () => {
    // Without this, a typo in a tag or a fence that lost its info string in a
    // reformat would be a silently missing case rather than a red build. Each
    // block is parsed here too, so a trailing comma reads as a JSON error on
    // this line and not as a puzzling failure three tests down.
    const tags = ['envelope', 'raw-column', 'canonical-column', 'canonical-table']
    expect(tags.map((tag) => typeof taggedJson(tag))).toEqual([
      'object',
      'object',
      'object',
      'object',
    ])
  })

  test('the envelope block is an envelope readEnvelope reads', () => {
    const result = readEnvelope(taggedJson('envelope'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(summarise(result.diagnostics)).toEqual([])
    expect(result.value.version).toBe(INTROSPECTION_VERSION)
    expect(result.value.engine).toBe('postgres')
  })

  test('the raw column is the one the fixture holds', async () => {
    // The page says where the block came from. This is that sentence, checked:
    // a change to the fixture that left the page behind fails here rather than
    // waiting for whoever next opens both files.
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
      readonly tables: readonly {
        readonly schema: string
        readonly name: string
        readonly columns: readonly { readonly name: string }[]
      }[]
    }
    const order = fixture.tables.find((t) => t.schema === 'dbo' && t.name === 'Order')

    expect(order?.columns.find((c) => c.name === 'Code')).toEqual(taggedJson('raw-column'))
  })

  test('the raw column becomes the canonical one, through the real provider', () => {
    // The pair is one claim. `parse` is what the prose between the two blocks
    // describes, so `parse` is what runs here: 64 becoming 32 because
    // `sys.columns` counts bytes, `precision` and `scale` dropped, and
    // `isIdentity: false` disappearing rather than becoming `identity: false`.
    // A test that checked the two blocks separately would check neither.
    const raw = {
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'sqlserver',
      tables: [{ schema: 'dbo', name: 'Order', columns: [taggedJson('raw-column')] }],
    }

    const parsed = sqlserverProvider.parse(raw)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(summarise(parsed.diagnostics)).toEqual([])
    expect(parsed.value.tables[0]?.columns[0]).toEqual(taggedJson('canonical-column'))
  })

  test('the canonical table is a table the contract accepts, in silence', () => {
    const result = validateIntrospectionDocument({
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'sqlserver',
      tables: [taggedJson('canonical-table')],
    })

    // Not even a warning. `import/unknown-field` is what a renamed field reads
    // as and it is a warning, so a test that only asked whether the document
    // was accepted would pass straight over the staleness this block is here to
    // prevent.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(summarise(result.diagnostics)).toEqual([])
  })

  test('and the contract hands that table straight back, unchanged', () => {
    // The validator normalises and sorts. Comparing its output with the block
    // is what makes the page show what a reader will actually get: a list the
    // page printed out of order, or a field it spelled as `null` rather than by
    // leaving it out, is a difference here even though neither is a diagnostic.
    const result = validateIntrospectionDocument({
      dbmdIntrospection: INTROSPECTION_VERSION,
      engine: 'sqlserver',
      tables: [taggedJson('canonical-table')],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tables[0]).toEqual(taggedJson('canonical-table'))
  })
})
