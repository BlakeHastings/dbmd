/**
 * `docs/format.md` is the reference somebody writes a model against with no
 * tooling. This runs its examples.
 *
 * A format reference goes stale the moment the format moves, and a stale
 * reference is worse than none: it teaches a format that no longer exists,
 * confidently, to the one person who cannot check it against the code. So the
 * examples in that page are not illustrations. They are inputs.
 *
 * Two kinds of block are picked up, by their info string:
 *
 *   ```markdown dbmd:tables/customers.md
 *   ```markdown dbmd-error:tables/orders.md:superseded-key,unknown-key
 *
 * The `dbmd:` blocks are assembled into one model directory and must produce no
 * diagnostics at all, not even a warning. Each `dbmd-error:` block is read on
 * its own and must produce exactly the codes its tag names, which is what keeps
 * the page's claims about what goes wrong honest rather than remembered.
 *
 * The info string beyond the language is invisible on GitHub, so the page reads
 * as prose and still cannot lie.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { locationText } from '../../src/diagnostics.js'
import type { ModelDiagnosticCode } from '../../src/diagnostics.js'
import { validate } from '../../src/model/validate.js'
import { withModel } from '../model/helpers.js'

const formatPage = fileURLToPath(new URL('../../docs/format.md', import.meta.url))
const codesFile = fileURLToPath(new URL('../../src/diagnostics.ts', import.meta.url))

interface Block {
  /** Where in the model directory the block's text belongs. */
  readonly path: string
  readonly text: string
  /** Present on a `dbmd-error:` block: the codes it claims to produce. */
  readonly expected?: readonly string[]
}

/**
 * Every tagged fenced block, in the order the page shows them.
 *
 * The fence is matched on its own line so that an indented block inside a list
 * item is not silently skipped, and the closing fence is the next line that is
 * only backticks: none of these blocks nests a fence.
 */
function blocksIn(page: string): Block[] {
  const blocks: Block[] = []
  const lines = page.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const opening = /^```\S*\s+(dbmd(?:-error)?):(\S+)\s*$/.exec(lines[i] ?? '')
    if (opening === null) continue
    const end = lines.indexOf('```', i + 1)
    if (end === -1) throw new Error(`unterminated fence at docs/format.md:${i + 1}`)
    const text = `${lines.slice(i + 1, end).join('\n')}\n`
    const tag = opening[2] as string
    if (opening[1] === 'dbmd') {
      blocks.push({ path: tag, text })
    } else {
      const split = tag.lastIndexOf(':')
      if (split <= 0) throw new Error(`\`dbmd-error:\` needs a path and a code: ${tag}`)
      blocks.push({
        path: tag.slice(0, split),
        text,
        expected: tag.slice(split + 1).split(','),
      })
    }
    i = end
  }
  return blocks
}

const page = await readFile(formatPage, 'utf8')
const source = await readFile(codesFile, 'utf8')
const blocks = blocksIn(page)
const good = blocks.filter((block) => block.expected === undefined)
const bad = blocks.filter((block) => block.expected !== undefined)

describe('the examples in docs/format.md are a model dbmd reads', () => {
  test('there are examples to read', () => {
    // A refactor that broke the info strings would otherwise turn this whole
    // file into a green suite that asserts nothing.
    expect(good.length).toBeGreaterThanOrEqual(4)
    expect(bad.length).toBeGreaterThanOrEqual(4)
    expect(good.map((block) => block.path)).toContain('_model.md')
  })

  test('assembled, they produce no diagnostics at all', async () => {
    const files = Object.fromEntries(good.map((block) => [block.path, block.text]))
    expect(Object.keys(files).length).toBe(good.length)

    const { model, diagnostics } = await withModel(files)

    expect(
      diagnostics.map((d) => `${locationText(d.at)} ${d.code}`),
    ).toEqual([])

    // The validator too, since dbmd-12. The page teaches refs, unique indexes
    // and groups, which is exactly the material the validator has opinions
    // about, and an example that taught a dangling ref would be worse than no
    // example. This is what forces the page to show the tables it refers to
    // rather than only the ones it is explaining.
    expect(validate(model).map((d) => `${locationText(d.at)} ${d.code}`)).toEqual([])
  })

  test('and the model they describe is the one the page says it is', async () => {
    const files = Object.fromEntries(good.map((block) => [block.path, block.text]))
    const { model } = await withModel(files)

    // The page's own claims, in the order it makes them: a composite key whose
    // order is the file's line order, uniqueness on an index, membership
    // declared by the member, and a default that survived as SQL text.
    const lines = model.tables.find((table) => table.name === 'invoice_lines')
    expect(lines?.columns.filter((column) => column.pk === true).map((c) => c.name)).toEqual([
      'invoice_id',
      'line_no',
    ])

    const unique = model.tables.flatMap((table) =>
      table.indexes.filter((index) => index.unique === true).map((index) => index.name),
    )
    expect(unique).toEqual(['customers_email_key', 'invoices_reference_key'])

    expect([...model.groupMembers].map(([group, members]) => `${group}: ${members.join(', ')}`))
      .toEqual(['billing: customers, invoice_lines'])

    const created = model.tables
      .find((table) => table.name === 'customers')
      ?.columns.find((column) => column.name === 'created_at')
    expect(created?.default).toBe('now()')
  })
})

describe('docs/format.md is right about what goes wrong', () => {
  test.each(bad.map((block, index) => [`${index + 1}. ${block.path}`, block] as const))(
    'the %s example produces the diagnostics it claims',
    async (_label, block) => {
      const { diagnostics } = await withModel({ [block.path]: block.text })

      expect([...diagnostics.map((d) => d.code)].sort()).toEqual([...(block.expected ?? [])].sort())
    },
  )
})

/**
 * The `ModelDiagnosticCode` declaration, as source text.
 *
 * Read out of the source rather than duplicated here, so that adding a code and
 * forgetting the reference is a red build rather than a gap somebody finds a
 * year later. It lives in `src/diagnostics.ts` rather than in
 * `src/model/types.ts` since dbmd-13 made the model reader and the import
 * contract share one `Diagnostic`. This page documents the model half, so it is
 * the model half that is read: the import codes are `docs/import-format.md`'s.
 *
 * Sliced at the next top-level `export`, which is what `test/import/docs.test.ts`
 * does and for the same reason. This used to slice at the first blank line,
 * which made the formatting of a type declaration load-bearing in a way nobody
 * would guess: a blank line put inside the union to space out a long doc comment
 * dropped every code after it out of the checked set, and the suite stayed green
 * while the guarantee below covered less than it claimed (dbmd-8ms). The only
 * formatting rule left is one TypeScript imposes anyway.
 */
function unionText(): string {
  const declaration = 'export type ModelDiagnosticCode ='
  const start = source.indexOf(declaration)
  if (start === -1) throw new Error('`ModelDiagnosticCode` is not declared in src/diagnostics.ts')
  const rest = source.slice(start + declaration.length)
  const next = /^export /m.exec(rest)
  return next === null ? rest : rest.slice(0, next.index)
}

const union = unionText()
const codes = [...union.matchAll(/\|\s*'([a-z][a-z-]*)'/g)].map(
  (match) => match[1] as ModelDiagnosticCode,
)

/**
 * Every code the page gives a row to, across the reader table and the validator
 * one.
 *
 * A row, not a mention: the check this replaces asked only whether the code
 * appeared anywhere in the page, which a passing reference in prose satisfies.
 * What a reader looks up is the row.
 */
const rows = [...page.matchAll(/^\| `([a-z][a-z-]*)` \| (?:error|warning) \|/gm)].map(
  (match) => match[1] as string,
)

describe('docs/format.md keeps up with the reader', () => {
  test('the union read is the model half, and all of it', () => {
    // Thirty-two: twenty-three the reader raises, nine the validator does. The exact
    // count, not a floor, so that a slice which stopped early or ran long says
    // so. The floor this replaces was `toBeGreaterThan(10)`, which passed
    // happily on the twenty-eight a blank line near the end of the declaration
    // used to leave behind: a control that only fires on the case nobody hits
    // is the reason nobody looks again. Adding a code means changing this
    // number, which is the point.
    expect(codes.length).toBe(32)
    // `ImportDiagnosticCode` is the next declaration in that file, so a slice
    // that ran past the end of this one would pick it up.
    expect(union).not.toContain('ImportDiagnosticCode')
  })

  test('every code has a row, and every row has a code', () => {
    // Both directions since dbmd-8ms. A code with no row is the gap the page
    // was written to close; a row naming no code is what a rename leaves
    // behind, and sends a reader to look up something that cannot happen.
    expect([...rows].sort()).toEqual([...codes].sort())
  })

  test('no code is given two rows', () => {
    expect([...new Set(rows)].length).toBe(rows.length)
  })
})
