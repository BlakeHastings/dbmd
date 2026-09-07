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

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { SECTION_BEGIN, SECTION_END } from '../../src/export/mermaid.js'
import { runCli, type Run } from './harness.js'

const temporaries: string[] = []

afterEach(async () => {
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
