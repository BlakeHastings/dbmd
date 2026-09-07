/**
 * Every `--json` payload the documentation shows is run, and has to be what the
 * command printed.
 *
 * Four pages show ten of them, in plain ` ```json ` fences: `check --json` in
 * `README.md`, `query --json` in `docs/import-format.md`, `export --json` in
 * `docs/ci.md` and `refs --json` in `docs/format.md`. Until this file, nothing
 * read any of them. The machinery already on those pages matches only its own
 * info strings, and a plain fence is none of them:
 * `test/docs/format.test.ts` reads ` ```markdown dbmd: `, `test/import/
 * docs.test.ts` reads ` ```json dbmd-import: `, and `test/docs/readme.test.ts`
 * reads ADR 0056's four.
 *
 * That is not a theoretical gap. `README.md` says the PostgreSQL introspection
 * query is 9827 characters and it is 12403, off by a quarter, in a plain fence
 * on the front page, and it drifted for as long as nobody ran it (dbmd-53w).
 * A payload is worse than a number, because a reader writes code against it: a
 * renamed field or a key that moved is a caller that breaks and a page that
 * says it should not have.
 *
 * WHY THE BLOCKS CARRY NO TAG
 * `docs/format.md` and `README.md` both mark the blocks they run in the info
 * string, and ADR 0056 is the record of what such a mark means. These blocks do
 * not, and the cases below name their commands instead. A tag says *how to read
 * this block*; there is only one way to read a `--json` payload, and the thing
 * an author would have to write in the tag is the command line, which is long,
 * has flags, and is already written in the prose above every one of these
 * blocks. What a tag buys instead is exhaustiveness, and that is bought here by
 * counting: every plain ` ```json ` fence on these four pages is claimed by
 * exactly one case, so a new payload block turns this file red until somebody
 * says which command it came from. ADR 0066.
 *
 * WHY THE COMPARISON IS A VALUE AND NOT BYTES
 * `README.md` is the one of these four pages Prettier formats: `.prettierignore`
 * holds it off `docs/`, and it has already rewritten the inside of a fenced
 * block on this page once (ADR 0056, `default: '0'`). It has done it again
 * here, collapsing `"counts": { "errors": 1, "warnings": 0 }` onto one line in a
 * block dbmd printed across four. So both sides are re-indented before they are
 * compared. Key order, key set and every value are still held exactly, because
 * `JSON.stringify` of a parsed document preserves the order it was written in.
 * The only thing given up is the whitespace Prettier owns, which no reader of
 * the page can see and no caller of the CLI can read.
 *
 * WHY THE FIXTURES ARE BUILT HERE AND NOT COMMITTED
 * `docs/format.md`'s second block is `examples/shop` half way through a rename,
 * with `tables/addresses.md` deleted and nothing else touched. Committing that
 * would be committing a copy that has to be kept in step with the original by
 * hand, which is the failure this file exists to stop. So it is built from
 * `examples/shop` and rebuilt on every run, and so is the intact copy, and both
 * are deleted first: a scratch directory left over from a previous run must not
 * be able to make this pass.
 *
 * `examples/shop` itself is only ever copied, never read in place and never
 * written to. `dbmd export` writes a `README.md` into the directory it is given,
 * and the owner works in that directory.
 */

import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runCli } from '../cli/harness.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const brokenModel = fileURLToPath(new URL('../fixtures/db-model', import.meta.url))

/** The four pages that show a payload, and the only ones this file reads. */
const PAGES = ['README.md', 'docs/import-format.md', 'docs/ci.md', 'docs/format.md'] as const
type Page = (typeof PAGES)[number]

interface Block {
  readonly page: Page
  /** The line the fence opened on, so a failure says where to look. */
  readonly line: number
  readonly text: string
}

/**
 * A payload block: the command it claims to be, and what running it must give.
 *
 * `cut` marks the one block that is honestly a prefix. Everything else is the
 * whole document.
 */
interface Case {
  readonly page: Page
  readonly argv: readonly string[]
  /** The exit code the page says the command has, which is half of what it shows. */
  readonly code: number
  /** A key whose value the block shows only the start of, and the marker it stops at. */
  readonly cut?: { readonly key: string; readonly marker: RegExp }
  /** Run before the command, to put the sandbox in the state the block was taken in. */
  readonly setUp?: () => Promise<void>
}

/**
 * The whole introspection query is 12403 characters and does not belong on a
 * page, so `docs/import-format.md` shows the first few lines of `sql` and says
 * in the string where it stopped and how long the real one is. That sentence is
 * a claim about a number, which is the shape of the defect this file exists for,
 * so the number inside it is read back out and checked against the run.
 */
const CUT = /\n-- \[cut here, and only here: (\d+) characters in all\]$/

let sandbox = ''
let original = ''

/**
 * Every plain ` ```json ` fence on a page, in the order it shows them.
 *
 * The fence has to be exactly ```` ```json ````: a tagged one belongs to
 * another mechanism. `docs/import-format.md` carries four
 * ` ```json dbmd-import: ` blocks that `test/import/docs.test.ts` parses as
 * catalogues, and reading those here would run a command against an envelope.
 */
function payloadsIn(page: Page, text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '```json') continue
    const end = lines.indexOf('```', i + 1)
    if (end === -1) throw new Error(`unterminated fence at ${page}:${i + 1}`)
    blocks.push({ page, line: i + 1, text: lines.slice(i + 1, end).join('\n') })
    i = end
  }
  return blocks
}

/** A JSON document with only the whitespace taken out of it. Key order survives. */
function reindented(json: string, what: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch (error) {
    throw new Error(`${what} is not JSON: ${(error as Error).message}`)
  }
}

/**
 * The commands the pages show, in the order each page shows them.
 *
 * The pairing is positional and the count is asserted below, which together
 * mean that a block added, removed or moved shows up as a failure naming the
 * line rather than as a case quietly reading its neighbour.
 */
const CASES: readonly Case[] = [
  // README.md: the report `dbmd check --json` writes, over the default
  // directory, which is why the model has to be called `db-model`.
  { page: 'README.md', argv: ['check', '--json'], code: 1 },

  // docs/import-format.md: `dbmd query --json`, printing and refusing.
  {
    page: 'docs/import-format.md',
    argv: ['query', '--engine', 'postgres', '--json'],
    code: 0,
    cut: { key: 'sql', marker: CUT },
  },
  { page: 'docs/import-format.md', argv: ['query', '--engine', 'oracle', '--json'], code: 2 },

  // docs/ci.md: `dbmd export --json`, writing, refused, and over a broken model.
  {
    page: 'docs/ci.md',
    argv: ['export', 'examples/shop', '--json'],
    code: 0,
    // `written: true` is a claim about a run that changed the file, so the file
    // goes first. `examples/shop/README.md` is not committed, but a previous
    // case in this same sandbox may have written it.
    setUp: async () => {
      await rm(join(sandbox, 'examples/shop/README.md'), { force: true })
    },
  },
  { page: 'docs/ci.md', argv: ['export', 'examples/shop', '--stdout', '--json'], code: 2 },
  { page: 'docs/ci.md', argv: ['export', 'db-model', '--json'], code: 1 },

  // docs/format.md: `dbmd refs --json`, answering, answering mid-rename,
  // refusing a name nothing carries, and refused for want of a table.
  { page: 'docs/format.md', argv: ['refs', 'orders', 'examples/shop', '--json'], code: 0 },
  { page: 'docs/format.md', argv: ['refs', 'addresses', 'shop', '--json'], code: 0 },
  { page: 'docs/format.md', argv: ['refs', 'customerz', 'examples/shop', '--json'], code: 1 },
  { page: 'docs/format.md', argv: ['refs', '--json'], code: 2 },
]

const pages = new Map<Page, string>()
for (const page of PAGES) pages.set(page, await readFile(join(repoRoot, page), 'utf8'))
const blocks = new Map<Page, Block[]>()
for (const page of PAGES) blocks.set(page, payloadsIn(page, pages.get(page) as string))

// The sandbox is built once for the whole file rather than inside a `describe`,
// because two of them run commands in it and a `describe`'s `afterAll` would
// take it away before the second one started.
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dbmd-payloads-'))

  // Two copies of the example model, both without the diagram `dbmd export`
  // writes, so `written: true` is a fact about this run rather than about
  // whatever was on disk. Copied rather than read in place: the owner works in
  // `examples/shop`, and export writes into the directory it is given.
  await mkdir(join(sandbox, 'examples'), { recursive: true })
  await cp(join(repoRoot, 'examples/shop'), join(sandbox, 'examples/shop'), { recursive: true })
  await rm(join(sandbox, 'examples/shop/README.md'), { force: true })

  // The mid-rename copy: `tables/addresses.md` deleted and nothing else
  // touched, which is what `docs/format.md` says it is. Built here so that it
  // cannot drift from the model it is a copy of.
  await cp(join(repoRoot, 'examples/shop'), join(sandbox, 'shop'), { recursive: true })
  await rm(join(sandbox, 'shop/README.md'), { force: true })
  await rm(join(sandbox, 'shop/tables/addresses.md'))

  // `README.md` and `docs/ci.md` both show a command given no directory, so the
  // fixture has to land under the name the default is.
  await cp(brokenModel, join(sandbox, 'db-model'), { recursive: true })

  original = process.cwd()
  process.chdir(sandbox)
})

afterAll(async () => {
  // Restored before the directory goes: a working directory pointing at a
  // deleted temporary is a failure somewhere else entirely.
  if (original !== '') process.chdir(original)
  if (sandbox !== '') await rm(sandbox, { recursive: true, force: true })
})

describe('every payload block on these pages is claimed by a case', () => {
  // Without this the file passes while a new block goes unread, which is
  // exactly the state all four pages were in before it existed. It is the same
  // floor `test/docs/readme.test.ts` carries, arrived at by counting rather
  // than by a tag, because these blocks carry none.
  for (const page of PAGES) {
    test(`${page}`, () => {
      const found = (blocks.get(page) as Block[]).map((block) => `${page}:${block.line}`)
      const claimed = CASES.filter((one) => one.page === page).map((one) => `dbmd ${one.argv.join(' ')}`)
      expect(
        found.length,
        `plain \`\`\`json fences on ${page} (${found.join(', ') || 'none'}), against the cases in this file (${
          claimed.join('; ') || 'none'
        }). A new payload block needs a case saying which command it came from.`,
      ).toBe(claimed.length)
    })
  }
})

describe('the pages print what they show', () => {
  for (const [index, one] of CASES.entries()) {
    const at = (blocks.get(one.page) as Block[])[CASES.slice(0, index).filter((c) => c.page === one.page).length]
    const where = at === undefined ? one.page : `${one.page}:${at.line}`
    const command = `dbmd ${one.argv.join(' ')}`

    test(`${where} is \`${command}\``, async () => {
      if (at === undefined) throw new Error(`${one.page} has no block for \`${command}\``)
      if (one.setUp !== undefined) await one.setUp()
      const run = await runCli(one.argv)

      // The exit code is half of what every one of these blocks claims: both
      // pages say `--json` carries the same code as the text form, and a caller
      // reads the code before it reads the document.
      expect(run.code, `the exit code of \`${command}\``).toBe(one.code)

      if (one.cut === undefined) {
        expect(reindented(run.out, `the output of \`${command}\``), `${where}, against \`${command}\``).toBe(
          reindented(at.text, where),
        )
        return
      }

      // The honest prefix. Every key but the cut one is compared whole, in
      // order, and the cut one is compared as far as the page goes.
      const live = JSON.parse(run.out) as Record<string, unknown>
      const shown = JSON.parse(at.text) as Record<string, unknown>
      expect(Object.keys(live), `the keys of \`${command}\`, against ${where}`).toEqual(Object.keys(shown))

      const whole = (document: Record<string, unknown>): string => {
        const rest = { ...document }
        delete rest[(one.cut as { key: string }).key]
        return JSON.stringify(rest, null, 2)
      }
      expect(whole(live), `every key but \`${one.cut.key}\` at ${where}`).toBe(whole(shown))

      const claimed = shown[one.cut.key] as string
      const actual = live[one.cut.key] as string
      const stop = one.cut.marker.exec(claimed)
      expect(stop, `${where} shows \`${one.cut.key}\` cut short, and has to say where`).not.toBeNull()
      const prefix = claimed.slice(0, (stop as RegExpExecArray).index)
      expect(actual.startsWith(prefix), `\`${one.cut.key}\` from \`${command}\` still opens the way ${where} shows`).toBe(
        true,
      )
      expect(Number((stop as RegExpExecArray)[1]), `the length ${where} writes into the cut`).toBe(actual.length)
    })
  }
})

/**
 * The sentences around the blocks.
 *
 * A page says things about these reports that no block on it shows, and those
 * sentences go stale the same way a number in a block does. They are the reason
 * for a second key, a second exit code or a second run, so they are the part a
 * caller is most likely to have written code against.
 */
describe('the pages say true things about the payloads they do not show', () => {
  test('docs/import-format.md: `characters` is the length of `sql`, for both engines', async () => {
    // The page names both numbers in prose and says they move whenever a query
    // does, which is the trap it is warning about. So the numbers are read back
    // off the page rather than written here.
    const page = pages.get('docs/import-format.md') as string
    const claim = /(\d+) for Postgres and (\d+) for SQL Server/.exec(page)
    expect(claim, 'docs/import-format.md names the character count of both engines').not.toBeNull()

    for (const [engine, shown] of [
      ['postgres', Number((claim as RegExpExecArray)[1])],
      ['sqlserver', Number((claim as RegExpExecArray)[2])],
    ] as const) {
      const run = await runCli(['query', '--engine', engine, '--json'])
      const report = JSON.parse(run.out) as { characters: number; sql: string }
      expect(report.characters, `\`characters\` from \`dbmd query --engine ${engine} --json\``).toBe(report.sql.length)
      expect(report.characters, `docs/import-format.md on ${engine}`).toBe(shown)
    }
  })

  test('docs/ci.md: a second export of an unchanged model is the same keys with `written: false`', async () => {
    // "the same eight keys come back with `written: false` when the committed
    // diagram was already current, and `ok` is `true` either way". The first run
    // is the block above; this is the sentence under it.
    const first = JSON.parse((await runCli(['export', 'examples/shop', '--json'])).out) as Record<string, unknown>
    const again = await runCli(['export', 'examples/shop', '--json'])
    const second = JSON.parse(again.out) as Record<string, unknown>

    expect(Object.keys(second), 'the keys of a re-export').toEqual(Object.keys(first))
    expect(second['written'], '`written` when the diagram was already current').toBe(false)
    expect(second['ok'], '`ok` on a run that wrote nothing').toBe(true)
    expect(again.code, 'the exit code of a re-export').toBe(0)
  })

  test('docs/format.md: the intact directory reports the ref the mid-rename copy lost', async () => {
    // "Asked of the intact directory the same question reports two incoming
    // refs. The one missing above is `addresses.superseded_by`". The whole point
    // of the second block is that contrast, and no block shows the other half.
    const intact = JSON.parse((await runCli(['refs', 'addresses', 'examples/shop', '--json'])).out) as {
      incoming: { from: { table: string; column: string } }[]
    }
    const midRename = JSON.parse((await runCli(['refs', 'addresses', 'shop', '--json'])).out) as {
      incoming: { from: { table: string; column: string } }[]
      exists: boolean
      ok: boolean
    }
    const naming = (report: { incoming: { from: { table: string; column: string } }[] }): string[] =>
      report.incoming.map((ref) => `${ref.from.table}.${ref.from.column}`)

    expect(naming(intact), 'what points at `addresses` in the intact directory').toContain('addresses.superseded_by')
    expect(intact.incoming, 'incoming refs in the intact directory').toHaveLength(2)
    expect(naming(midRename), 'what points at `addresses` mid-rename').not.toContain('addresses.superseded_by')
    expect(midRename.incoming, 'incoming refs mid-rename').toHaveLength(1)
    expect([midRename.exists, midRename.ok], 'mid-rename is an answer rather than a failure').toEqual([false, true])
  })

  test('docs/format.md: a table nothing points at is `exists: true` and safe to drop', async () => {
    // "A table that is there with nothing pointing at it comes back
    // `exists: true` with an empty `incoming`, `ok: true`, exit code 0". That is
    // the half of the `exists` argument the page states and does not show, and
    // it is the one that reads as permission to delete a file.
    const run = await runCli(['refs', 'stock_movements', 'examples/shop', '--json'])
    const report = JSON.parse(run.out) as { exists: boolean; ok: boolean; incoming: unknown[] }
    expect(
      [report.exists, report.ok, report.incoming.length, run.code],
      '`dbmd refs stock_movements examples/shop --json`',
    ).toEqual([true, true, 0, 0])
  })

  test('docs/format.md: a directory typed first is a missing table and not a usage error', async () => {
    // "A directory typed before the table produces that shape rather than a
    // usage error, which is the one to watch for in a script." Nothing on the
    // page shows it, and the difference is exit 1 against exit 2.
    const run = await runCli(['refs', 'examples/shop', 'orders', '--json'])
    const report = JSON.parse(run.out) as { directory: string; table: string; error: { code: string } }
    expect(
      [run.code, report.error.code, report.directory, report.table],
      '`dbmd refs examples/shop orders --json`, with the arguments the wrong way round',
    ).toEqual([1, 'no-such-table', 'orders', 'examples/shop'])
  })

  test('README.md: `--json` carries the same exit code as the text form', async () => {
    // "`--strict` fails on a warning too, and `--json` puts the same report on
    // stdout with the same exit code". The block shows one of the two forms, and
    // the sentence is about both.
    const text = await runCli(['check'])
    const json = await runCli(['check', '--json'])
    expect(json.code, 'the exit code of `dbmd check --json`').toBe(text.code)
    expect(json.code, 'a model with one error in it').toBe(1)
  })
})
