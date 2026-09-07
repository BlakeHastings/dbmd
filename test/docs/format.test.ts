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
import type { DiagnosticCode } from '../../src/model/types.js'
import { withModel } from '../model/helpers.js'

const formatPage = fileURLToPath(new URL('../../docs/format.md', import.meta.url))
const typesFile = fileURLToPath(new URL('../../src/model/types.ts', import.meta.url))

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

    const { diagnostics } = await withModel(files)

    expect(
      diagnostics.map((d) => `${d.path}${d.line === undefined ? '' : `:${d.line}`} ${d.code}`),
    ).toEqual([])
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
    expect(unique).toEqual(['customers_email_key'])

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

describe('docs/format.md keeps up with the reader', () => {
  test('every diagnostic code has a row in the page', async () => {
    // Read out of the source rather than duplicated here, so that adding a code
    // to `DiagnosticCode` and forgetting the reference is a red build rather
    // than a gap somebody finds a year later. The union is a run of `| 'code'`
    // lines with no blank line in it, which is what the slice below relies on.
    const types = await readFile(typesFile, 'utf8')
    const start = types.indexOf('export type DiagnosticCode =')
    expect(start).toBeGreaterThan(-1)
    const union = types.slice(start, types.indexOf('\n\n', start))
    const codes = [...union.matchAll(/\|\s*'([a-z-]+)'/g)].map((match) => match[1] as DiagnosticCode)

    expect(codes.length).toBeGreaterThan(10)
    expect(codes.filter((code) => !page.includes(`\`${code}\``))).toEqual([])
  })
})
