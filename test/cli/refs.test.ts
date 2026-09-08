/**
 * `dbmd refs`.
 *
 * Five properties are worth more than the rest, and three of them are about a
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
 * 5. What the file says happens to that row, because the question is asked
 *    immediately before a delete. A written clause is printed and an unwritten
 *    one is not, and the two are asserted side by side in one list, because
 *    "the file said nothing" and "the file said no action" are different facts
 *    and it would be easy to ship a version where they read the same.
 * 6. Which of those errors the answer is short because of. A file that did not
 *    load takes its refs out of the lists; a ref at a table that is not there
 *    is an error and is also one of the rows printed. Those are opposite
 *    sentences to put over a list, so the three states are asserted on the
 *    words the reader sees rather than on the count.
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

/**
 * A ref at `customers` and a ref at itself, which is the case that reads oddly
 * if it can, and the two halves of the referential-action question.
 *
 * `customer_id` writes both clauses and the delete one is the frightening
 * value. `superseded_by` writes `on delete: no action` and no `on update` at
 * all, so one column carries a written default and an unwritten key, and the
 * answer has to tell them apart.
 */
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
    on delete: cascade
    on update: cascade
  - name: superseded_by
    type: uuid
    nullable: true
    ref: addresses.id
    on delete: no action
---

An address row is never updated.
`

/**
 * `order_id` is both the ref and part of the key, which is the "key"
 * annotation, and it writes no referential action at all, which is the row
 * that has to stay silent beside one that says "no action".
 */
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
  readonly onDelete?: string
  readonly onUpdate?: string
}

interface Envelope {
  readonly schema: number
  readonly ok: boolean
  readonly directory: string
  readonly table: string
  readonly exists: boolean
  readonly incoming: readonly Edge[]
  readonly outgoing: readonly Edge[]
  readonly model: {
    readonly errors: number
    readonly warnings: number
    readonly readErrors: number
  }
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
    expect(payload(run).model.readErrors).toBeGreaterThan(0)
    expect(prose.err).toContain('may be short')
  })
})

/**
 * Which sentence goes above the answer, in the three states a model can be in.
 *
 * The defect is entirely the wording, so every assertion here is on the words.
 * The count was right in all three states before this block existed, and the
 * sentence built on it was true in one of them.
 */
describe('how far to trust the answer', () => {
  /**
   * Every file loads and the only error is a ref at a table nothing declares.
   *
   * This is the sharpest form of it: the one error being counted is the second
   * row of the answer, so a warning that the answer may be missing it points at
   * the line above it.
   */
  const DANGLING = ADDRESSES.replace('ref: customers.id', 'ref: ghosts.id')

  /** Opened and never closed, so the reader cannot build it and it is not in the model. */
  const UNREADABLE = `---
kind: table
table: sessions
columns:
  - name: id
    type: uuid
`

  test('a validation error alone does not say the answer may be short', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/addresses.md': DANGLING,
    })

    const run = await runCli(['refs', 'addresses', directory, '--outgoing'])

    expect(run.code).toBe(0)
    expect(unpadded(run)).toContain('addresses.customer_id -> ghosts.id')
    expect(run.err).toContain('has 1 error in it, and every file in it loaded')
    expect(run.err).toContain('Nothing is missing from what follows')
    expect(run.err).toContain('disagrees with itself rather than failing to read')
    // The whole of the defect: this sentence was printed over the row that is
    // the error, and it is the one thing that must not be said here.
    expect(run.err).not.toContain('may be short')
    expect(run.err).not.toContain('did not load')
  })

  test('a read error alone still says it, in the words it always used', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/addresses.md': ADDRESSES,
      'tables/sessions.md': UNREADABLE,
    })

    const run = await runCli(['refs', 'customers', directory])

    expect(run.code).toBe(0)
    // The banner that was right all along, held to the byte so that fixing the
    // other two states cannot quietly reword this one.
    expect(run.err).toContain(
      'has 1 error in it. A file that did not load is missing from the model along with every ref\n' +
        'written in it, so what follows may be short.',
    )
    expect(run.err).not.toContain('every file in it loaded')
  })

  test('both kinds at once is one banner, and it splits the count', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/addresses.md': DANGLING,
      'tables/sessions.md': UNREADABLE,
    })

    const run = await runCli(['refs', 'addresses', directory, '--outgoing'])

    expect(run.code).toBe(0)
    // One banner rather than one per kind, because "what follows may be short"
    // and "nothing is missing from what follows" cannot both stand over one
    // list. The short answer wins, and the split count says how much of the
    // model went missing rather than how much of it is wrong.
    expect(run.err).toContain('has 2 errors in it, 1 of them in the reading')
    expect(run.err).toContain('may be short')
    expect(run.err).not.toContain('Nothing is missing from what follows')
  })

  test('a caller reads the same split off the report', async () => {
    const clean = await shop()
    const dangling = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/addresses.md': DANGLING,
    })
    const unreadable = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/addresses.md': DANGLING,
      'tables/sessions.md': UNREADABLE,
    })

    const good = await runCli(['refs', 'customers', clean, '--json'])
    const invalid = await runCli(['refs', 'addresses', dangling, '--json'])
    const short = await runCli(['refs', 'addresses', unreadable, '--json'])

    // `errors` still counts everything `dbmd check` would count, so nothing a
    // caller already reads has changed meaning. `readErrors` is the part that
    // means the two lists may be short, and it is the only way to tell a model
    // that is wrong from an answer that is incomplete.
    expect(payload(good).model).toEqual({ errors: 0, warnings: 0, readErrors: 0 })
    expect(payload(invalid).model).toEqual({ errors: 1, warnings: 0, readErrors: 0 })
    expect(payload(short).model).toEqual({ errors: 2, warnings: 0, readErrors: 1 })
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

describe('what a delete does to the rows that point here', () => {
  test('the clause is printed beside the row, spelled as the file spells it', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'customers', directory])

    expect(run.code).toBe(0)
    // The whole of the gap: "one ref points here" and "one ref points here and
    // it empties when you delete" are different answers to the same question.
    expect(unpadded(run)).toContain(
      'addresses.customer_id -> customers.id tables/addresses.md required on delete: cascade on update: cascade',
    )
    expect(run.err).toContain('"on delete", "on update"')
  })

  test('a ref the file wrote nothing about prints nothing, beside one that says no action', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'addresses', directory])

    // One list, two rows, and the difference between them is the fact ADR 0046
    // refuses to collapse: absent is not `no action`.
    expect(unpadded(run)).toContain(
      'addresses.superseded_by -> addresses.id tables/addresses.md on delete: no action',
    )
    expect(unpadded(run)).toContain(
      'order_items.order_id -> addresses.id tables/order_items.md key\n',
    )
    // Neither of these two refs writes an `on update`, so the words are on
    // neither row. The legend still names the key, because one sentence covers
    // both clauses and this list used one of them.
    expect(run.err).not.toContain('on update: ')
  })

  test('the outgoing direction says it too, and the legend is one sentence for both', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'addresses', directory, '--outgoing'])

    expect(unpadded(run)).toContain(
      'addresses.customer_id -> customers.id required on delete: cascade on update: cascade',
    )
    // Two clauses on the list and one paragraph under it.
    expect(run.err.split('"on delete", "on update"')).toHaveLength(2)
  })

  test('a list with no clause anywhere in it does not explain one', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/addresses.md': ADDRESSES.replace(/\n    on (delete|update): [a-z ]+/g, ''),
    })

    const { err } = await runCli(['refs', 'customers', directory])

    expect(err).toContain('addresses.customer_id -> customers.id')
    expect(err).not.toContain('on delete')
  })

  test('it says so half way through a rename, where dbmd export refuses', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': CUSTOMERS,
      'tables/postal_addresses.md': ADDRESSES.replace(
        'table: addresses',
        'table: postal_addresses',
      ),
      'tables/order_items.md': ORDER_ITEMS,
    })

    const refused = await runCli(['export', directory, '--stdout'])
    const answered = await runCli(['refs', 'addresses', directory])

    // Nothing added here needs the validator: the clause comes off the ref the
    // reader built, so it survives the state the command exists for.
    expect(refused.code).toBe(1)
    expect(answered.code).toBe(0)
    // Every file in a renamed model still parses, so this is a whole answer
    // over a model that disagrees with itself. This line said "may be short"
    // until 2026-09-08, which was the falsehood rather than the assertion.
    expect(answered.err).toContain('every file in it loaded')
    expect(answered.err).not.toContain('may be short')
    expect(unpadded(answered)).toContain(
      'postal_addresses.superseded_by -> addresses.id tables/postal_addresses.md on delete: no action',
    )
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

  test('an edge carries the file, the key-ness, nullable and the actions', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'addresses', directory, '--json'])

    expect(run.err).toBe('')
    expect(payload(run).incoming).toEqual([
      {
        from: { table: 'addresses', column: 'superseded_by' },
        to: { table: 'addresses', column: 'id' },
        path: 'tables/addresses.md',
        nullable: true,
        // The file wrote the default out loud, so the payload carries it. The
        // absent `onUpdate` beside it is the other fact, and the two are only
        // distinguishable because neither is invented.
        onDelete: 'no action',
      },
      {
        from: { table: 'order_items', column: 'order_id' },
        to: { table: 'addresses', column: 'id' },
        path: 'tables/order_items.md',
        // Part of `order_items`' own primary key, so the row cannot be
        // orphaned, and the file says nothing about nullable or about either
        // action, so neither does this: a key the file did not set is a key
        // that is not here.
        inPrimaryKey: true,
      },
    ])
  })

  test('the action is a value on the ref rather than a flag beside it', async () => {
    const directory = await shop()

    const run = await runCli(['refs', 'customers', directory, '--json'])

    // A closed vocabulary, spelled as the file spells it, so a caller switches
    // on the word rather than testing a boolean and losing the other four.
    expect(payload(run).incoming[0]).toMatchObject({
      from: { table: 'addresses', column: 'customer_id' },
      onDelete: 'cascade',
      onUpdate: 'cascade',
    })
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
