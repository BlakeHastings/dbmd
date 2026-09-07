/**
 * `dbmd refs`.
 *
 * Four properties are worth more than the rest, and three of them are about a
 * model that is not in a good state, because that is the state somebody is in
 * when they ask.
 *
 * 1. It answers a model with errors in it, where `dbmd export` refuses. That
 *    gap is why the command exists, so it is asserted against the real refusal
 *    rather than described.
 * 2. A table that is gone and still pointed at is an answer. That is the middle
 *    of a rename.
 * 3. A name nothing in the model has heard of is a failure, and an empty answer
 *    about a table that exists is not. Those two sentences read alike and mean
 *    opposite things, so the exit codes have to separate them.
 * 4. The referring column and its file, not just the referring table, because
 *    "three tables point here" does not say what to edit.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
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

Three tables, one self-reference.
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
---

One row per person.
`

/** A ref at `customers` and a ref at itself, which is the case that reads oddly if it can. */
const ADDRESSES = `---
kind: table
table: addresses
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
  - name: superseded_by
    type: uuid
    nullable: true
    ref: addresses.id
---

An address row is never updated.
`

/** `order_id` is both the ref and part of the key, which is the "key" annotation. */
const ORDER_ITEMS = `---
kind: table
table: order_items
columns:
  - name: order_id
    type: uuid
    pk: true
    ref: addresses.id
  - name: line_no
    type: integer
    pk: true
---

One row per line.
`

async function modelWith(files: Readonly<Record<string, string>>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dbmd-refs-'))
  temporaries.push(parent)
  const directory = join(parent, 'db-model')
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(directory, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
  return directory
}

async function shop(): Promise<string> {
  return await modelWith({
    '_model.md': MODEL_FILE,
    'tables/customers.md': CUSTOMERS,
    'tables/addresses.md': ADDRESSES,
    'tables/order_items.md': ORDER_ITEMS,
  })
}

interface Edge {
  readonly from: { readonly table: string; readonly column: string }
  readonly to: { readonly table: string; readonly column: string }
  readonly path: string
  readonly inPrimaryKey?: boolean
  readonly nullable?: boolean
}

interface Envelope {
  readonly schema: number
  readonly ok: boolean
  readonly directory: string
  readonly table: string
  readonly exists: boolean
  readonly incoming: readonly Edge[]
  readonly outgoing: readonly Edge[]
  readonly model: { readonly errors: number; readonly warnings: number }
  readonly error?: { readonly code: string; readonly message: string }
}

/**
 * The narration with every run of spaces collapsed.
 *
 * The list is padded to the widest name in it, so asserting on a row means
 * either writing the padding into the test or taking it out of the answer.
 * Taking it out is the one that still passes when a fixture gains a column.
 */
function unpadded(run: Run): string {
  return run.err.replace(/ +/g, ' ')
}

function payload(run: Run): Envelope {
  return JSON.parse(run.out) as Envelope
}

describe('what points at this table', () => {
  test('it names the referring column and the file the ref is written in', async () => {
    const directory = await shop()

    const { code, out, err } = await runCli(['refs', 'customers', directory])

    expect(code).toBe(0)
    // stdout is data and there is no document here, so the answer is narration.
    expect(out).toBe('')
    expect(err).toContain('addresses.customer_id -> customers.id')
    expect(err).toContain('tables/addresses.md')
  })

  test('a self-reference is one of the answers and reads as itself', async () => {
    const directory = await shop()

    const { code, err } = await runCli(['refs', 'addresses', directory])

    expect(code).toBe(0)
    expect(err).toContain('addresses.superseded_by -> addresses.id')
    expect(err).toContain('order_items.order_id')
  })

  test('nothing points at it is an answer and not a failure', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'order_items', directory, '--json'])

    expect(run.code).toBe(0)
    expect(payload(run)).toMatchObject({ ok: true, exists: true, incoming: [] })
  })

  test('a name no file and no ref has ever mentioned fails instead', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'customerz', directory, '--json'])

    // The same three words as "nothing points at it" and the opposite
    // instruction, so it cannot be the same exit code.
    expect(run.code).toBe(1)
    expect(payload(run).ok).toBe(false)
    expect(payload(run).error?.code).toBe('no-such-table')
  })

  test('the prose form of that says how many tables it looked through', async () => {
    const directory = await shop()

    const { err } = await runCli(['refs', 'customerz', directory])

    expect(err).toContain('no tables/customerz.md')
    expect(err).toContain('3 tables')
  })
})

describe('a model that is half way through a rename', () => {
  /** The file moved, `table:` moved with it, and two refs still name the old one. */
  async function midRename(): Promise<string> {
    return await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/postal_addresses.md': ADDRESSES.replace(
        'table: addresses',
        'table: postal_addresses',
      ),
      'tables/order_items.md': ORDER_ITEMS,
    })
  }

  test('dbmd export refuses it and dbmd refs answers it', async () => {
    const directory = await midRename()

    const refused = await runCli(['export', directory, '--stdout'])
    const answered = await runCli(['refs', 'addresses', directory])

    // The gap this command was built for, asserted against the real refusal.
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('nothing safe to draw')
    expect(answered.code).toBe(0)
    expect(unpadded(answered)).toContain('order_items.order_id -> addresses.id')
    expect(unpadded(answered)).toContain('postal_addresses.superseded_by -> addresses.id')
  })

  test('it says the table is gone before it lists what still points at it', async () => {
    const directory = await midRename()

    const run = await runCli(['refs', 'addresses', directory, '--json'])

    expect(run.code).toBe(0)
    expect(payload(run).exists).toBe(false)
    expect(payload(run).incoming).toHaveLength(2)
    expect(payload(run).model.errors).toBeGreaterThan(0)
  })

  test('a file that did not load takes its refs with it, and the run says so', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      // Opened and never closed, so the reader cannot build it and the model
      // does not have it. Its `ref: customers.id` is therefore not in the
      // answer, and an answer that did not admit that would be a lie.
      'tables/addresses.md': ADDRESSES.replace(/\n---\n\nAn address[\s\S]*$/, '\n'),
    })

    const run = await runCli(['refs', 'customers', directory, '--json'])
    const prose = await runCli(['refs', 'customers', directory])

    expect(run.code).toBe(0)
    expect(payload(run).incoming).toEqual([])
    expect(payload(run).model.errors).toBeGreaterThan(0)
    expect(prose.err).toContain('may be short')
  })
})

describe('the other direction', () => {
  test('--outgoing is what this table points at', async () => {
    const directory = await shop()

    const { code, err } = await runCli(['refs', 'addresses', directory, '--outgoing'])

    expect(code).toBe(0)
    expect(err.replace(/ +/g, ' ')).toContain('addresses.customer_id -> customers.id')
    expect(err.replace(/ +/g, ' ')).toContain('addresses.superseded_by -> addresses.id')
    // The incoming section is not printed, so the ref from order_items is not
    // in this answer.
    expect(err).not.toContain('order_items')
  })

  test('both flags print both sections', async () => {
    const directory = await shop()

    const { err } = await runCli(['refs', 'addresses', directory, '--incoming', '--outgoing'])

    expect(err).toContain('point at')
    expect(err).toContain('holds')
    expect(err).toContain('order_items.order_id')
  })

  test('a table that points at nothing says so rather than printing an empty list', async () => {
    const directory = await shop()

    const { code, err } = await runCli(['refs', 'customers', directory, '--outgoing'])

    expect(code).toBe(0)
    expect(err).toContain('points at nothing')
  })
})

describe('the --json answer', () => {
  test('it carries both directions whichever flags were given', async () => {
    const directory = await shop()

    const incoming = await runCli(['refs', 'addresses', directory, '--json'])
    const outgoing = await runCli(['refs', 'addresses', directory, '--outgoing', '--json'])

    // The flags choose what a person reads. A caller that asked for the report
    // gets the whole answer either way, so it never has to run this twice.
    expect(payload(incoming)).toEqual(payload(outgoing))
    expect(payload(incoming).incoming).toHaveLength(2)
    expect(payload(incoming).outgoing).toHaveLength(2)
  })

  test('an edge carries the file, the key-ness and what the file said about nullable', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'addresses', directory, '--json'])

    expect(run.err).toBe('')
    expect(payload(run).incoming).toEqual([
      {
        from: { table: 'addresses', column: 'superseded_by' },
        to: { table: 'addresses', column: 'id' },
        path: 'tables/addresses.md',
        nullable: true,
      },
      {
        from: { table: 'order_items', column: 'order_id' },
        to: { table: 'addresses', column: 'id' },
        path: 'tables/order_items.md',
        // Part of `order_items`' own primary key, so the row cannot be
        // orphaned, and the file says nothing about nullable, so neither does
        // this: a key the file did not set is a key that is not here.
        inPrimaryKey: true,
      },
    ])
  })

  test('the same model answered twice produces the same bytes', async () => {
    const directory = await shop()

    const first = await runCli(['refs', 'addresses', directory, '--json'])
    const second = await runCli(['refs', 'addresses', directory, '--json'])

    expect(first.out).toBe(second.out)
  })
})

describe('the command line', () => {
  test('it needs a table, because that is the question', async () => {
    const run = await runCli(['refs'])

    expect(run.code).toBe(2)
    expect(run.err).toContain('needs that table')
  })

  test('the directory typed first is a usage failure that names the order', async () => {
    const directory = await shop()

    const { code, err } = await runCli(['refs', directory, 'customers'])

    expect(code).toBe(1)
    expect(err).toContain('The table comes first')
  })

  test('an unknown flag says what this command takes', async () => {
    const run = await runCli(['refs', 'customers', '--sideways'])

    expect(run.code).toBe(2)
    expect(run.err).toContain('--incoming and --outgoing')
  })
})
