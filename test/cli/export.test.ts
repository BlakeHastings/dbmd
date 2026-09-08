/**
 * `dbmd export`.
 *
 * Three properties are worth more than the rest and every one of them is about
 * a file the command did not mean to change: prose outside the markers is
 * untouched, a file whose diagram has not moved is not written at all, and
 * `--stdout` writes nothing anywhere. A tool that fails any of those puts noise
 * in somebody's diff, which is the thing this whole repository is arranged to
 * avoid.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SECTION_BEGIN, SECTION_END } from '../../src/export/mermaid.js'
import { runCli, type Run } from './harness.js'

/**
 * Which half of the write refuses, and with what. `vi.hoisted` because the mock
 * factory is lifted above every import, so the switch has to exist before this
 * file's top level runs, and a hook returning `undefined` lets the real call
 * through, which is what keeps every model this file builds on disk.
 *
 * Two calls rather than one, because the command writes through a temporary
 * file and a rename and the two ends of that fail differently. `rename` is the
 * one a read-only target refuses, after the whole diagram is safely on disk
 * somewhere else. `open` is the one a full disk or a directory nobody may write
 * refuses, before there is anything at all.
 *
 * **Why it is mocked, and what that costs.** The gesture that produces this is
 * the Windows read-only attribute, `attrib +R`, which answers `EPERM`; the
 * POSIX equivalent is a permission bit, which answers `EACCES` and does nothing
 * at all when the suite runs as root, and CI here runs on Linux. The seam being
 * tested is not the disk. It is what the command does with a write that
 * rejected, and `vi.mock` reaches that on any platform, which is the same
 * reason `test/studio/unreadable.test.ts` and `test/model/write.test.ts` are
 * written this way, the second of them by mocking this same `rename`. The real
 * read-only attribute is in the pull request that closed the item, driven on
 * Windows, with the output pasted.
 */
const fail = vi.hoisted(() => ({
  rename: undefined as undefined | ((from: string, to: string) => unknown),
  open: undefined as undefined | ((path: string) => unknown),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  type Open = (path: unknown, ...rest: readonly unknown[]) => Promise<unknown>
  const realOpen = actual.open as Open
  return {
    ...actual,
    default: actual,
    rename: async (from: string, to: string) => {
      const thrown = fail.rename?.(from, to)
      if (thrown !== undefined) throw thrown
      return await actual.rename(from, to)
    },
    open: async (path: unknown, ...rest: readonly unknown[]) => {
      const thrown = typeof path === 'string' ? fail.open?.(path) : undefined
      if (thrown !== undefined) throw thrown
      return await realOpen(path, ...rest)
    },
  }
})

const temporaries: string[] = []

afterEach(async () => {
  fail.rename = undefined
  fail.open = undefined
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

const MODEL_FILE = `---
kind: model
name: shop
engine: postgres
---

Two tables and one ref.
`

const CUSTOMERS = `---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: citext
    nullable: false
indexes:
  - name: customers_email_key
    columns: [email]
    unique: true
---

One row per person.
`

const ORDERS = `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
---

One row per order.
`

async function modelWith(files: Readonly<Record<string, string>>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dbmd-export-'))
  temporaries.push(parent)
  const directory = join(parent, 'db-model')
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(directory, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
  return directory
}

async function twoTables(): Promise<string> {
  return await modelWith({
    '_model.md': MODEL_FILE,
    'tables/customers.md': CUSTOMERS,
    'tables/orders.md': ORDERS,
  })
}

interface Envelope {
  readonly schema: number
  readonly ok: boolean
  readonly directory: string
  readonly format?: string
  readonly file?: string
  readonly written?: boolean
  readonly tables?: number
  readonly relationships?: number
  readonly characters?: number
  readonly mermaid?: {
    readonly version: string
    readonly maxTextSize: number
    readonly overMaxTextSize: boolean
  }
  readonly error?: { readonly code: string; readonly message: string }
}

function payload(run: Run): Envelope {
  return JSON.parse(run.out) as Envelope
}

async function readme(directory: string): Promise<string> {
  return await readFile(join(directory, 'README.md'), 'utf8')
}

describe('dbmd export writes a diagram GitHub will render', () => {
  test('it writes db-model/README.md with the diagram between the markers', async () => {
    const directory = await twoTables()

    const { code, err } = await runCli(['export', directory])

    expect(code).toBe(0)
    expect(err).toContain('README.md')
    const text = await readme(directory)
    expect(text).toContain(SECTION_BEGIN)
    expect(text).toContain(SECTION_END)
    expect(text).toContain('```mermaid')
    expect(text).toContain('  "customers" ||..o{ "orders" : "customer_id"')
  })

  /**
   * Every other case here builds its model in a directory called `db-model`,
   * so none of them can tell "into the directory it was given" apart from
   * "into db-model". `dbmd export --help` said the second one until this test
   * existed, and a reader who ran it over `examples/shop` was told a path the
   * command never touches. The name here is deliberately not the default.
   */
  test('it writes into the README of the directory it was given, whatever that is called', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-export-elsewhere-'))
    temporaries.push(parent)
    const directory = join(parent, 'shop')
    await mkdir(join(directory, 'tables'), { recursive: true })
    await writeFile(join(directory, '_model.md'), MODEL_FILE, 'utf8')
    await writeFile(join(directory, 'tables', 'customers.md'), CUSTOMERS, 'utf8')

    const { code, err } = await runCli(['export', directory])

    expect(code).toBe(0)
    expect(err).toContain('README.md')
    expect(await readme(directory)).toContain(SECTION_BEGIN)
    // Nothing called db-model was created anywhere, which is the half of this
    // the assertion above cannot see.
    expect(await readdir(parent)).toEqual([basename(directory)])
  })

  test('the --json payload carries the counts and the same exit code', async () => {
    const directory = await twoTables()

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(0)
    expect(run.err).toBe('')
    expect(payload(run)).toMatchObject({
      schema: 1,
      ok: true,
      format: 'mermaid',
      written: true,
      tables: 2,
      relationships: 1,
    })
    // A path a caller could compare between two machines, which a backslash on
    // Windows is not.
    expect(payload(run).file).toMatch(/\/README\.md$/)
  })
})

describe('a file it did not have to change', () => {
  test('a second run writes nothing at all', async () => {
    const directory = await twoTables()
    await runCli(['export', directory])
    const first = await stat(join(directory, 'README.md'))

    const run = await runCli(['export', directory, '--json'])

    expect(payload(run).written).toBe(false)
    const second = await stat(join(directory, 'README.md'))
    expect(second.mtimeMs).toBe(first.mtimeMs)
  })

  test('a column that changed writes it once', async () => {
    const directory = await twoTables()
    await runCli(['export', directory])
    await writeFile(
      join(directory, 'tables', 'orders.md'),
      ORDERS.replace('name: id', 'name: order_id'),
      'utf8',
    )

    const run = await runCli(['export', directory, '--json'])

    expect(payload(run).written).toBe(true)
    expect(await readme(directory)).toContain('uuid order_id PK')
  })

  test('prose above and below the markers is left exactly as it was', async () => {
    const directory = await twoTables()
    const before = `# The shop model

Written by a person, and this paragraph is theirs.

${SECTION_BEGIN}
whatever was here before
${SECTION_END}

## Why there is no stock column

Also theirs, and still here afterwards.
`
    await writeFile(join(directory, 'README.md'), before, 'utf8')

    await runCli(['export', directory])

    const after = await readme(directory)
    expect(after.startsWith(before.slice(0, before.indexOf(SECTION_BEGIN)))).toBe(true)
    expect(after.endsWith(before.slice(before.indexOf(SECTION_END) + SECTION_END.length))).toBe(
      true,
    )
    expect(after).not.toContain('whatever was here before')
  })

  test('a file with neither marker keeps its prose and gets the section appended', async () => {
    const directory = await twoTables()
    await writeFile(join(directory, 'README.md'), '# Notes\n\nMine.\n', 'utf8')

    await runCli(['export', directory])

    const after = await readme(directory)
    expect(after.startsWith('# Notes\n\nMine.\n')).toBe(true)
    expect(after).toContain(SECTION_BEGIN)
  })

  test('a file with one marker and not the other is an error rather than a guess', async () => {
    const directory = await twoTables()
    await writeFile(join(directory, 'README.md'), `# Notes\n\n${SECTION_BEGIN}\n`, 'utf8')

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(1)
    expect(payload(run).error?.code).toBe('markers-unbalanced')
    expect(await readme(directory)).toBe(`# Notes\n\n${SECTION_BEGIN}\n`)
  })

  test('a closing marker above the opening one is told it is out of order', async () => {
    const directory = await twoTables()
    // Both markers, the wrong way round. Until this was fixed the command told
    // this file it had the opening marker "and not" the closing one, which is
    // false of it, and then gave it two instructions that both make it worse:
    // adding a second closing marker leaves the stray one embedded in the prose
    // forever, and deleting the opening marker, which is the one the sentence
    // named as present, lands the reader in the opposite error.
    const before = `# Notes\n\n${SECTION_END}\n\nMine.\n\n${SECTION_BEGIN}\n`
    await writeFile(join(directory, 'README.md'), before, 'utf8')

    const jsonRun = await runCli(['export', directory, '--json'])
    const proseRun = await runCli(['export', directory])

    expect(jsonRun.code).toBe(1)
    // Its own code, because a caller branching on `markers-unbalanced` would
    // take the branch for a file that is missing a marker, and this one is not.
    expect(payload(jsonRun).error).toEqual({
      code: 'markers-out-of-order',
      message: `the file has ${SECTION_END} above ${SECTION_BEGIN}`,
    })
    expect(payload(jsonRun).file).toMatch(/\/README\.md$/)
    // The wording is the whole defect, so it is what this asserts on.
    expect(proseRun.code).toBe(1)
    expect(proseRun.err).toContain(`${SECTION_END} above ${SECTION_BEGIN}`)
    expect(proseRun.err).toContain('Move the closing marker below the opening one')
    expect(proseRun.err).not.toContain('and not')
    expect(proseRun.err).not.toContain('Add the missing marker')
    expect(await readme(directory)).toBe(before)
  })

  test('a stray closing marker above a whole pair still has one region to write', async () => {
    const directory = await twoTables()
    // Not the case above: the opening marker is closed by the marker after it,
    // so which part is generated is not in doubt and the stray one above is
    // prose. Refusing this would be refusing a file the command can answer.
    const before = `# Notes\n\n${SECTION_END}\n\n${SECTION_BEGIN}\nold\n${SECTION_END}\n`
    await writeFile(join(directory, 'README.md'), before, 'utf8')

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(0)
    const after = await readme(directory)
    expect(after.startsWith(`# Notes\n\n${SECTION_END}\n\n${SECTION_BEGIN}`)).toBe(true)
    expect(after).not.toContain('old')
  })

  test('the unbalanced-marker error names the same file the --json report does', async () => {
    const directory = await twoTables()
    await writeFile(join(directory, 'README.md'), `# Notes\n\n${SECTION_BEGIN}\n`, 'utf8')

    const jsonRun = await runCli(['export', directory, '--json'])
    const proseRun = await runCli(['export', directory])

    const file = payload(jsonRun).file
    expect(file).toBeDefined()
    // The same report, told two ways: a path in the --json `file` field and the
    // same path named in the prose error. `join` uses a backslash on Windows,
    // so this fails there unless the prose is put through `slashed` the same
    // way the rest of the file's path prints already are.
    expect(proseRun.err).toContain(file as string)
  })
})

describe('a file the disk refused', () => {
  /** Somebody's prose, and a section out of date, so the run has to write. */
  const STALE = `# The shop model

A paragraph a person wrote, which is the thing at risk here.

${SECTION_BEGIN}
a diagram from three columns ago
${SECTION_END}

And one below, also theirs.
`

  /** The shape of a real one: the Windows read-only attribute on the target. */
  function refusedRename(from: string, to: string): Error {
    return Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), {
      code: 'EPERM',
    })
  }

  test('a write that fails is reported in the command voice, not thrown at the caller', async () => {
    const directory = await twoTables()
    await writeFile(join(directory, 'README.md'), STALE, 'utf8')
    let temporary = ''
    fail.rename = (from, to) => {
      temporary = from
      return to.endsWith('README.md') ? refusedRename(from, to) : undefined
    }

    const jsonRun = await runCli(['export', directory, '--json'])
    const proseRun = await runCli(['export', directory])

    expect(jsonRun.code).toBe(1)
    expect(proseRun.code).toBe(1)
    const report = payload(jsonRun)
    // The last-resort handler in `main.ts` reports `failed` and knows none of
    // these three fields, so this is the assertion that the refusal was
    // answered here rather than escaping in Node's voice.
    expect(report).toMatchObject({ ok: false, format: 'mermaid', error: { code: 'write-failed' } })
    expect(report.directory).toBe(directory)
    expect(report.file).toMatch(/\/README\.md$/)
    // The system's words survive, because the errno is the half that tells the
    // reader whether this is a permission, a full disk or a lock. ADR 0083.
    expect(report.error?.message).toContain('EPERM: operation not permitted')
    expect(proseRun.err).toContain(`Could not write ${report.file as string}`)
    expect(proseRun.err).toContain('EPERM: operation not permitted')
    // The file the reader was working on comes first, and the one they have
    // never seen comes last, behind the sentence that says why it is there at
    // all. ADR 0083 is the record of what the other order costs.
    const first = proseRun.err.split('\n')[0] ?? ''
    const second = proseRun.err.split('\n')[1] ?? ''
    expect(first).toContain('Could not write')
    expect(first).not.toContain('.tmp')
    expect(second.indexOf('temporary file')).toBeLessThan(second.indexOf(basename(temporary)))
    // The command's own sentences carry no machine-specific path: ADR 0006
    // rule 4, which is what `slashed` exists for. The only such strings in the
    // whole message are inside the system's own words, at the end of the
    // second line.
    expect(first).not.toContain('\\')
    expect(second.slice(0, second.indexOf('EPERM'))).not.toContain('\\')
  })

  test('a refused write leaves the file byte for byte as it was', async () => {
    const directory = await twoTables()
    await writeFile(join(directory, 'README.md'), STALE, 'utf8')
    fail.rename = (from, to) => (to.endsWith('README.md') ? refusedRename(from, to) : undefined)

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(1)
    // Which is what "Nothing was changed" claims, asked rather than assumed. A
    // plain `writeFile` truncates at open, so the paragraphs in `STALE` would
    // already be gone by the time that sentence was printed about them, and the
    // reason this passes is the temporary file and the rename.
    expect(await readme(directory)).toBe(STALE)
    // And the temporary is not left behind in somebody's model directory.
    expect((await readdir(directory)).filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  test('a refusal before there is anything to rename says the same thing', async () => {
    const directory = await twoTables()
    await writeFile(join(directory, 'README.md'), STALE, 'utf8')
    // The other end of the same write. A full disk refuses the temporary file
    // rather than the rename, so the failure lands before a byte of the new
    // diagram exists anywhere, and the file is untouched for a second reason.
    fail.open = (path) =>
      path.includes('README.md') && path.endsWith('.tmp')
        ? Object.assign(new Error(`ENOSPC: no space left on device, open '${path}'`), {
            code: 'ENOSPC',
          })
        : undefined

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(1)
    expect(payload(run).error?.code).toBe('write-failed')
    expect(payload(run).error?.message).toContain('ENOSPC')
    expect(await readme(directory)).toBe(STALE)
  })

  test('a run that had nothing to write cannot fail on a write it does not make', async () => {
    const directory = await twoTables()
    await runCli(['export', directory])
    fail.rename = (from, to) => (to.endsWith('README.md') ? refusedRename(from, to) : undefined)

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(0)
    expect(payload(run).written).toBe(false)
  })
})

describe('--stdout prints and writes nothing', () => {
  test('the document is on stdout and stderr is empty', async () => {
    const directory = await twoTables()

    const run = await runCli(['export', directory, '--stdout'])

    expect(run.code).toBe(0)
    // ADR 0006 rule 1 is written with this exact command in it: a diagram and
    // no chatter, in every context, without a quiet flag.
    expect(run.err).toBe('')
    expect(run.out).toContain('```mermaid')
    expect(run.out).toContain(SECTION_BEGIN)
    await expect(readme(directory)).rejects.toThrow()
  })

  test('--stdout and --json both want stdout, so asking for both is a usage error', async () => {
    const directory = await twoTables()

    const run = await runCli(['export', directory, '--stdout', '--json'])

    expect(run.code).toBe(2)
    expect(payload(run).error?.code).toBe('usage')
  })
})

describe('a model it should not draw', () => {
  test('an error in the model is refused, and nothing is written', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      // A ref at a table nobody wrote: an error, and a diagram drawn from it
      // would invent an entity that is not in the model.
      'tables/orders.md': ORDERS.replace('ref: customers.id', 'ref: regions.id'),
    })

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(1)
    expect(payload(run)).toMatchObject({ ok: false, error: { code: 'model-has-errors' } })
    await expect(readme(directory)).rejects.toThrow()
  })

  test('a warning does not stop it', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      // No primary key: a warning, and a perfectly drawable table.
      'tables/events.md': `---
kind: table
table: events
columns:
  - name: at
    type: timestamptz
---

Nobody said which row is which.
`,
    })

    const run = await runCli(['export', directory, '--json'])

    expect(run.code).toBe(0)
    expect(payload(run).tables).toBe(1)
  })
})

/**
 * The warning a diagram too large for mermaid to draw gets. ADR 0100.
 *
 * Mermaid's `maxTextSize` is checked in `render` and not in `parse`, and when it
 * trips mermaid substitutes `graph TB;a[Maximum text size in diagram
 * exceeded];style a fill:#faa` for the diagram. So the failure is a red box on
 * GitHub with no error anywhere: `dbmd export` reported success, `mermaid.parse`
 * in `test/export/mermaid.test.ts` accepts the text, and nothing between the two
 * has an opinion.
 *
 * **The two fixtures are one character apart across the limit**, which is the
 * whole point of them. Twelve tables of 170 columns, plus one more column on
 * the first table whose name is the only thing that differs, is 50,000
 * characters of diagram in one case and 50,001 in the other. Mermaid's check is
 * `text.length > maxTextSize`, so 50,000 draws and 50,001 does not, and this
 * pair is the smallest thing that can say which. A constant that drifted, a
 * comparison that became `>=`, or a count taken over `section.text` rather than
 * over the diagram inside the fence turns one of the two red. A pair chosen at
 * 8 and 600 tables would survive all three.
 *
 * The size is reached with wide tables rather than with six hundred files
 * because the predicate is the length of the diagram and nothing else, and
 * twelve files run in milliseconds where six hundred do not. The three-size run
 * over models shaped like the reported one is in the pull request.
 *
 * The directories here are called `warehouse`, and deliberately not `db-model`:
 * every other fixture in this file builds its model in a directory with the
 * default's name, which is how `dbmd export --help` claimed for weeks to write
 * into `db-model` whatever it was given.
 */
describe('a diagram mermaid will not draw', () => {
  const LIMIT = 50_000

  /**
   * The eight-character name that makes the diagram exactly `LIMIT` characters,
   * and the nine-character one that makes it exactly one over.
   *
   * A column row is `    varchar <name>` and its newline, so the name's length
   * is the whole of the difference between the two fixtures. Twelve tables of
   * 170 columns is 49,979 characters on its own; these add the last 21 and 22.
   */
  const AT_LIMIT = 'cccccccc'
  const OVER_LIMIT = 'ccccccccc'

  /**
   * Twelve tables, each carrying 170 columns beyond its key and a `ref` at the
   * one before it, plus one extra column on the first table with the given
   * name, in a directory of the given name.
   *
   * The shape is the one the character counts above were measured against, so
   * changing a name or a type in here moves both fixtures relative to the
   * limit. Every assertion reads the count off the run rather than trusting it,
   * and says in its failure message which knob is the one to turn.
   */
  async function wideModel(name: string, extra: string): Promise<string> {
    const tables = 12
    const columns = 170
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-export-wide-'))
    temporaries.push(parent)
    const directory = join(parent, name)
    await mkdir(join(directory, 'tables'), { recursive: true })
    await writeFile(
      join(directory, '_model.md'),
      `---\nkind: model\nname: warehouse\nengine: postgres\n---\n\n${tables} wide tables.\n`,
      'utf8',
    )
    for (let i = 0; i < tables; i++) {
      const table = `t${String(i).padStart(3, '0')}`
      const parentRef =
        i === 0
          ? ''
          : `  - name: parent_id\n    type: uuid\n    nullable: false\n    ref: t${String(i - 1).padStart(3, '0')}.id\n`
      const wide = Array.from(
        { length: columns },
        (_, c) => `  - name: column_${String(c).padStart(4, '0')}\n    type: varchar\n`,
      ).join('')
      const tail = i === 0 ? `  - name: ${extra}\n    type: varchar\n` : ''
      await writeFile(
        join(directory, 'tables', `${table}.md`),
        `---\nkind: table\ntable: ${table}\ncolumns:\n  - name: id\n    type: uuid\n    pk: true\n` +
          `${parentRef}${wide}${tail}---\n\nTable ${i}.\n`,
        'utf8',
      )
    }
    return directory
  }

  /** What is inside the mermaid fence, which is what a renderer hands mermaid. */
  function diagramIn(text: string): string {
    const open = text.indexOf('```mermaid\n')
    expect(open, 'the README has a mermaid fence in it').toBeGreaterThan(-1)
    const body = text.slice(open + '```mermaid\n'.length)
    const close = body.indexOf('```')
    expect(close, 'the mermaid fence is closed').toBeGreaterThan(-1)
    return body.slice(0, close)
  }

  test('a diagram over the limit is written, warned about, and still exit 0', async () => {
    const directory = await wideModel('warehouse', OVER_LIMIT)

    const run = await runCli(['export', directory])

    // The file is correct and the model is fine, so refusing to write would be
    // refusing over somebody else's renderer's configuration. ADR 0100.
    expect(run.code).toBe(0)
    expect(await readme(directory)).toContain('```mermaid')
    expect(run.err).toContain('Wrote')

    // The three things the message owes a reader: the number, the limit, and
    // whose default the limit is.
    expect(run.err).toContain('warning:')
    expect(run.err).toContain('50000')
    expect(run.err).toContain("mermaid 11.17.2's default maxTextSize rather than a rule")
    // The sentence mermaid actually draws, so somebody who has already seen the
    // red box on GitHub can match this line to it.
    expect(run.err).toContain('Maximum text size in diagram exceeded')
    // Not a failure, and it does not wear the CLI's failure prefix.
    expect(run.err).not.toContain('dbmd:')
  })

  test('the count in the warning is the length of the diagram it just wrote', async () => {
    const directory = await wideModel('warehouse', OVER_LIMIT)

    const run = await runCli(['export', directory])

    // The whole claim rests on this number being the fence body rather than the
    // section, which carries a notice and a caveats paragraph as well and is
    // about a kilobyte longer. Both are over the limit for this fixture, so
    // only reading it back off the file can tell them apart.
    const characters = diagramIn(await readme(directory)).length
    expect(
      characters,
      `this fixture is meant to be exactly ${LIMIT + 1} characters. If it has moved, the column ` +
        `name lengths at the top of this block are the knob: one character of name is one ` +
        `character of diagram.`,
    ).toBe(LIMIT + 1)
    expect(run.err).toContain(`that diagram is ${characters} characters`)
  })

  test('a diagram of exactly the limit draws, and is told nothing about its size', async () => {
    const directory = await wideModel('warehouse', AT_LIMIT)

    const run = await runCli(['export', directory])

    const characters = diagramIn(await readme(directory)).length
    expect(
      characters,
      `this fixture is meant to be exactly ${LIMIT} characters. If it has moved, the column ` +
        `name lengths at the top of this block are the knob: one character of name is one ` +
        `character of diagram.`,
    ).toBe(LIMIT)
    // Mermaid's check is `text.length > maxTextSize`, so a diagram of exactly
    // the limit is drawn. One character apart from the test above, and silent:
    // this is the assertion a `>=` fails.
    expect(run.code).toBe(0)
    expect(run.err).not.toContain('warning')
    expect(run.err).not.toContain('Maximum text size')
    expect(run.err).toContain('Wrote')
  })

  test('the ordinary two-table model is silent about size in both forms', async () => {
    const directory = await twoTables()

    const prose = await runCli(['export', directory])
    const json = await runCli(['export', directory, '--json'])

    expect(prose.err).not.toContain('warning')
    expect(prose.err).not.toContain('Maximum text size')
    expect(payload(json).mermaid).toEqual({
      version: '11.17.2',
      maxTextSize: 50000,
      overMaxTextSize: false,
    })
  })

  test('the --json report carries the count and the claim rather than the prose', async () => {
    const directory = await wideModel('warehouse', OVER_LIMIT)

    const run = await runCli(['export', directory, '--json'])

    // ADR 0006 rule 3: a caller scripting export has the same problem as a
    // person, and should never have to read prose off stderr to find out.
    expect(run.code).toBe(0)
    expect(run.err).toBe('')
    const report = payload(run)
    expect(report.ok).toBe(true)
    expect(report.characters).toBe(diagramIn(await readme(directory)).length)
    expect(report.mermaid).toEqual({
      version: '11.17.2',
      maxTextSize: 50000,
      overMaxTextSize: true,
    })
  })

  test('--stdout warns too, on stderr, having written no file', async () => {
    const directory = await wideModel('warehouse', OVER_LIMIT)

    const run = await runCli(['export', directory, '--stdout'])

    // The same text with the same problem, going somewhere else. ADR 0006 rule
    // 1 is about stdout and is untouched: the document is on stdout, whole, and
    // a run under the limit still writes nothing at all to stderr, which the
    // block above asserts.
    expect(run.code).toBe(0)
    expect(run.out).toContain('```mermaid')
    expect(run.err).toContain('Maximum text size in diagram exceeded')
    expect(run.err).toContain(`that diagram is ${diagramIn(run.out).length} characters`)
    await expect(readme(directory)).rejects.toThrow()
  })

  test('a second run of an unchanged oversized model still warns', async () => {
    const directory = await wideModel('warehouse', OVER_LIMIT)
    await runCli(['export', directory])

    const run = await runCli(['export', directory, '--json'])

    // The file did not need writing and is still too large to draw. A warning
    // attached to the write rather than to the diagram would go quiet here,
    // which is the run somebody does after a rebase to find out where they are.
    expect(payload(run).written).toBe(false)
    expect(payload(run).mermaid?.overMaxTextSize).toBe(true)
  })
})

describe('the command line', () => {
  test('an unknown format is a usage error and nothing runs', async () => {
    const directory = await twoTables()

    const run = await runCli(['export', directory, '--format', 'graphviz'])

    expect(run.code).toBe(2)
    expect(run.err).toContain('graphviz')
    await expect(readme(directory)).rejects.toThrow()
  })

  test('--format mermaid is what the default already was', async () => {
    const directory = await twoTables()

    const run = await runCli(['export', directory, '--format', 'mermaid', '--json'])

    expect(run.code).toBe(0)
    expect(payload(run).format).toBe('mermaid')
  })

  test('two directories is a usage error', async () => {
    const run = await runCli(['export', 'one', 'two'])

    expect(run.code).toBe(2)
  })

  test('export is in the root help and has its own', async () => {
    expect((await runCli([])).out).toContain('export')
    expect((await runCli(['export', '--help'])).out).toContain('Usage: dbmd export')
  })
})
