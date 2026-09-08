/**
 * `dbmd check`.
 *
 * The exit code is the whole contract in CI, so every test here asserts one,
 * and the ones that matter most are the pairs: the same model checked as text
 * and as `--json` has to fail the same way, because ADR 0006 names printing
 * successfully and exiting 0 as the classic bug in exactly this command.
 *
 * The model built below has one of each kind of problem, in four different
 * files, and one of those files does not parse at all. That is deliberate: the
 * claim the work item cares about most is that the broken file is reported and
 * the other three are still checked, and it is only observable when the broken
 * file is not the only thing wrong.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

A model with one of everything wrong in it.
`

/** The frontmatter YAML is one space short on `pk`, so the file does not parse. */
const UNPARSEABLE = `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
   pk: true
layout: { x: 120, y: 120 }
---

The commonest way to break a hand-edited model file.
`

/** Parses, and refs a table that was never written: one error, from the validator. */
const DANGLING = `---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: region_id
    type: uuid
    ref: regions.id
layout: { x: 480, y: 120 }
---

\`regions\` was never written.
`

/** Parses, and nothing in it says which row is which: one warning. */
const NO_KEY = `---
kind: table
table: events
columns:
  - name: at
    type: timestamptz
  - name: payload
    type: jsonb
layout: { x: 120, y: 400 }
---

An append-only log, and nobody gave it a key.
`

/** A group no table joins: one warning, and the fourth file. */
const EMPTY_GROUP = `---
kind: group
label: Legacy
---

No table declares \`group: legacy\`.
`

/**
 * A model directory, from a map of relative path to contents.
 *
 * Written rather than kept under `test/fixtures/`, because the point of these
 * tests is which combination of problems is present, and a fixture directory
 * that four tests share is one nobody can change for one of them.
 */
async function modelWith(files: Readonly<Record<string, string>>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dbmd-check-'))
  temporaries.push(parent)
  const directory = join(parent, 'db-model')
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(directory, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }
  return directory
}

/**
 * One broken file, one dangling ref, one keyless table, one empty group.
 *
 * The broken file is a note rather than a table, and that is load-bearing since
 * ADR 0090. A table file the reader refuses is a table whose `group:` nothing
 * can read, so `group-empty` stands down for the whole model while one is
 * there, and a fixture with a broken table would be a fixture with three
 * problems in it. A note declares no membership and masks nothing, which keeps
 * the four independent, which is the only thing these tests want from them.
 */
async function fourProblems(): Promise<string> {
  return await modelWith({
    '_model.md': MODEL_FILE,
    'notes/scratch.md': UNPARSEABLE,
    'tables/customers.md': DANGLING,
    'tables/events.md': NO_KEY,
    'groups/legacy.md': EMPTY_GROUP,
  })
}

/** The same model with both errors removed, so only the two warnings are left. */
async function warningsOnly(): Promise<string> {
  return await modelWith({
    '_model.md': MODEL_FILE,
    'tables/events.md': NO_KEY,
    'groups/legacy.md': EMPTY_GROUP,
  })
}

interface Envelope {
  readonly schema: number
  readonly ok: boolean
  readonly directory: string
  readonly strict: boolean
  readonly counts: { readonly errors: number; readonly warnings: number }
  readonly diagnostics: readonly { readonly code: string; readonly severity: string }[]
}

function payload(run: Run): Envelope {
  return JSON.parse(run.out) as Envelope
}

describe('dbmd check reports every file, not just the first broken one', () => {
  test('a file that does not parse is reported and the rest are still checked', async () => {
    const directory = await fourProblems()

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    // The unparseable file, and then the three problems that are only findable
    // because the run did not stop at it.
    expect(err).toContain('frontmatter-invalid')
    expect(err).toContain('ref-table-unknown')
    expect(err).toContain('primary-key-missing')
    expect(err).toContain('group-empty')
  })

  test('the validator runs over what did load, so its diagnostics are in the list', async () => {
    const directory = await fourProblems()

    const run = await runCli(['check', directory, '--json'])

    expect(run.code).toBe(1)
    // `frontmatter-invalid` is the reader's and `group-empty` is the
    // validator's. One list, one sort, no seam, and the order is the sort's.
    expect(payload(run).diagnostics.map((d) => d.code)).toEqual([
      'group-empty',
      'frontmatter-invalid',
      'ref-table-unknown',
      'primary-key-missing',
    ])
  })

  test('diagnostics are grouped under their file, which is named once', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      // Two problems in one file: no key, and a ref at a table that is not there.
      'tables/events.md': `---
kind: table
table: events
columns:
  - name: at
    type: timestamptz
  - name: order_id
    type: uuid
    ref: orders.id
---

Two problems, one file.
`,
    })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err.match(/tables\/events\.md/g)).toHaveLength(1)
    expect(err).toContain('across 1 file.')
  })
})

describe('it does not deny a file it is printing as a heading', () => {
  // ADR 0090. Three diagnostics learned something from the model and reported
  // it as a fact about the disk, and a half-finished rename is exactly the
  // state where those two disagree. Each test here is a pair: the file is
  // there and broken, and then the file is not there at all, which is the
  // common case and the one every one of these sentences was written for.

  /** Refuses to load: one line of prose where the frontmatter should be. */
  const NO_FRONTMATTER = 'Renamed from `clients`, and not finished.\n'

  const REFERRING = `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    ref: customers.id
---

Points at a table whose file is in the middle of a rename.
`

  const IN_A_GROUP = `---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
group: billing
---

Declares the membership the group file is about to be told nobody declares.
`

  const GROUP = `---
kind: group
label: Billing
---

A group that one table joins.
`

  test('a ref at a table whose file is there and broken is not called a table that is not there', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/customers.md': NO_FRONTMATTER,
      'tables/orders.md': REFERRING,
    })

    const { code, err } = await runCli(['check', directory])

    // The reader's error about the file, and nothing on top of it. The old
    // second sentence read "there is no tables/customers.md" four lines under
    // a heading reading `tables/customers.md`.
    expect(code).toBe(1)
    expect(err).toContain('frontmatter-absent')
    expect(err).not.toContain('ref-table-unknown')
    expect(err).not.toContain('there is no tables/customers.md')
  })

  test('and the same ref with nothing at that path says exactly what it always said', async () => {
    const directory = await modelWith({ '_model.md': MODEL_FILE, 'tables/orders.md': REFERRING })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain(
      '`ref: customers.id` on column `customer_id` names no table; there is no tables/customers.md (ref-table-unknown)',
    )
  })

  test('a `group:` at a group file that is there and broken is not called a file that is not there', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'groups/billing.md': NO_FRONTMATTER,
      'tables/orders.md': IN_A_GROUP,
    })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain('frontmatter-absent')
    expect(err).not.toContain('group-unknown')
    expect(err).not.toContain('names no file at groups/billing.md')
  })

  test('and the same `group:` with nothing at that path says exactly what it always said', async () => {
    const directory = await modelWith({ '_model.md': MODEL_FILE, 'tables/orders.md': IN_A_GROUP })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain('`group: billing` names no file at groups/billing.md (group-unknown)')
  })

  test('a group is not called empty on the line above the table that declares it', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'groups/billing.md': GROUP,
      // Refused for a reason of its own: the directory decides the kind, so
      // this file is not loaded, and its `group: billing` goes with it.
      'tables/orders.md': IN_A_GROUP.replace('kind: table', 'kind: note'),
    })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain('kind-mismatch')
    expect(err).not.toContain('group-empty')
    expect(err).not.toContain('no table declares `group: billing`')
  })

  test('and a group nothing declares says exactly what it always said', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'groups/billing.md': GROUP,
      'tables/orders.md': IN_A_GROUP.replace('group: billing\n', ''),
    })

    const { code, err } = await runCli(['check', directory])

    // A warning, so the run still passes, which is the other half of what the
    // reader of this message needs to stay true.
    expect(code).toBe(0)
    expect(err).toContain(
      'no table declares `group: billing`; an empty group is usually a rename that missed a file (group-empty)',
    )
  })

  test('a directory wearing a table file name is not also said not to exist', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      // A directory called `customers.md`, which is what a link to one, or a
      // half-finished move, leaves behind.
      'tables/customers.md/notes.txt': 'not a table\n',
      'tables/orders.md': REFERRING,
    })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain('`customers.md` is a directory rather than a file')
    expect(err).not.toContain('there is no tables/customers.md')
  })
})

describe('the summary names what it counted, rather than calling all of it files', () => {
  test('two broken files are two files, which is the case the sentence was written for', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/orders.md': UNPARSEABLE,
      'tables/events.md': UNPARSEABLE.replace('table: orders', 'table: events'),
    })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain('2 errors across 2 files.')
  })

  test('two directories are two directories, and neither is a file', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      // `views/` is not a kind dbmd knows; `tables/archive/` holds markdown one
      // folder too deep. Both diagnostics say "directory" in their own text,
      // and the summary used to add them up as files.
      'views/orders.md': 'ignored\n',
      'tables/archive/orders.md': MODEL_FILE,
    })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(1)
    expect(err).toContain('1 error and 1 warning across 2 directories.')
    expect(err).not.toContain('across 2 files')
  })

  test('a mixture says both, because a sentence that picks one is wrong about the other', async () => {
    const directory = await modelWith({
      '_model.md': MODEL_FILE,
      'tables/orders.md': UNPARSEABLE,
      'views/orders.md': 'ignored\n',
    })

    const { err } = await runCli(['check', directory])

    expect(err).toContain('across 1 file and 1 directory.')
  })

  test('a model directory that is not there is one directory, not one file', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-check-'))
    temporaries.push(parent)

    const { code, err } = await runCli(['check', join(parent, 'nowhere-at-all')])

    expect(code).toBe(1)
    expect(err).toContain('1 error across 1 directory.')
  })

  test('a `_model.md` that is a directory is counted as one, two lines under the sentence saying so', async () => {
    // The two lines have to agree. A warning that opens "`_model.md` is a
    // directory rather than a file" over a summary saying "across 1 file" is a
    // smaller copy of the defect this whole change removes.
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-check-'))
    temporaries.push(parent)
    const directory = join(parent, 'db-model')
    await mkdir(join(directory, '_model.md'), { recursive: true })

    const { code, err } = await runCli(['check', directory])

    expect(code).toBe(0)
    expect(err).toContain('`_model.md` is a directory rather than a file')
    expect(err).toContain('1 warning across 1 directory.')
    expect(err).not.toContain('across 1 file')
  })

  test('a `_model.md` nobody wrote is still counted as the file it has to become', async () => {
    // The one place the noun stays "file" over something that is not on disk.
    // `model-file-missing` is about a path a file has to be written at, and
    // that is what its location says, so the count says the same thing.
    const directory = await modelWith({ 'tables/orders.md': DANGLING })

    const { err } = await runCli(['check', directory])

    expect(err).toContain('model-file-missing')
    expect(err).toContain('across 2 files.')
  })
})

describe('the exit code policy', () => {
  test('errors fail the run', async () => {
    const { code } = await runCli(['check', await fourProblems()])
    expect(code).toBe(1)
  })

  test('warnings print and do not fail the run', async () => {
    const { code, err } = await runCli(['check', await warningsOnly()])

    expect(code).toBe(0)
    expect(err).toContain('primary-key-missing')
    expect(err).toContain('group-empty')
    expect(err).toContain('2 warnings')
  })

  test('--strict promotes them, and says that it did', async () => {
    const directory = await warningsOnly()

    const lenient = await runCli(['check', directory])
    const strict = await runCli(['check', directory, '--strict'])

    expect(lenient.code).toBe(0)
    expect(strict.code).toBe(1)
    expect(strict.err).toContain('--strict: warnings count as errors.')
  })

  test('--strict says nothing extra when there is nothing to promote', async () => {
    const clean = fileURLToPath(new URL('../../examples/shop', import.meta.url))

    const { code, err } = await runCli(['check', clean, '--strict'])

    expect(code).toBe(0)
    expect(err).not.toContain('--strict')
  })

  test('a clean model exits 0 and says what it read', async () => {
    const clean = fileURLToPath(new URL('../../examples/shop', import.meta.url))

    const { code, out, err } = await runCli(['check', clean])

    expect(code).toBe(0)
    expect(out).toBe('')
    expect(err).toContain('no problems.')
    expect(err).toContain('8 tables')
  })

  test('a model directory that is not there is an error, not a usage error', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-check-'))
    temporaries.push(parent)
    const missing = join(parent, 'nowhere')

    const { code, err } = await runCli(['check', missing])

    // 1 rather than 2: the command line was fine and the repository is wrong,
    // which is the thing a CI log needs to be told. ADR 0020.
    expect(code).toBe(1)
    expect(err).toContain('model-directory-unreadable')
    // The reader points at the model directory as `.`, and a heading of `.`
    // above "cannot read the model directory" is a riddle.
    expect(err).toContain(missing)
    expect(err.split('\n')[0]).not.toBe('.')
  })
})

describe('--json says the same thing as the text form', () => {
  test('it exits non-zero on errors rather than 0 because printing worked', async () => {
    const directory = await fourProblems()

    const text = await runCli(['check', directory])
    const json = await runCli(['check', directory, '--json'])

    expect(json.code).toBe(text.code)
    expect(json.code).toBe(1)
    expect(payload(json).ok).toBe(false)
  })

  test('and on a --strict run whose only problems are warnings', async () => {
    const directory = await warningsOnly()

    const lenient = await runCli(['check', directory, '--json'])
    const strict = await runCli(['check', directory, '--json', '--strict'])

    expect(lenient.code).toBe(0)
    expect(payload(lenient).ok).toBe(true)
    expect(strict.code).toBe(1)
    expect(payload(strict).ok).toBe(false)
  })

  test('--strict changes the outcome and never a severity', async () => {
    const directory = await warningsOnly()

    const strict = payload(await runCli(['check', directory, '--json', '--strict']))

    // A severity is a fact about the model and belongs to whoever found it.
    // Whether this run failed is `ok`, which is derived from the exit code.
    expect(strict.diagnostics.map((d) => d.severity)).toEqual(['warning', 'warning'])
    expect(strict.counts).toEqual({ errors: 0, warnings: 2 })
    expect(strict.strict).toBe(true)
    expect(strict.ok).toBe(false)
  })

  test('the report is on stdout, alone, in the envelope', async () => {
    const { out, err } = await runCli(['check', await fourProblems(), '--json'])

    expect(err).toBe('')
    const envelope = JSON.parse(out) as Envelope
    expect(envelope.schema).toBe(1)
    expect(envelope.counts).toEqual({ errors: 2, warnings: 2 })
  })

  test('a clean run is still a report, with an empty list', async () => {
    const clean = fileURLToPath(new URL('../../examples/shop', import.meta.url))

    const { code, out } = await runCli(['check', clean, '--json'])

    expect(code).toBe(0)
    const envelope = JSON.parse(out) as Envelope
    expect(envelope.ok).toBe(true)
    expect(envelope.diagnostics).toEqual([])
  })
})

describe('what it refuses', () => {
  test('an unknown flag is a usage error naming the flag', async () => {
    const { code, out, err } = await runCli(['check', '--fix'])

    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('unknown option "--fix"')
    expect(err).toContain('dbmd check --help')
  })

  test('two directories is a usage error rather than a guess', async () => {
    const { code, err } = await runCli(['check', 'one', 'two'])

    expect(code).toBe(2)
    expect(err).toContain('at most one directory')
  })

  test('it is in the root help, so somebody can find it', async () => {
    const { out } = await runCli([])

    expect(out).toContain('check')
  })

  test('--help is a document on stdout and exits 0', async () => {
    const { code, out, err } = await runCli(['check', '--help'])

    expect(code).toBe(0)
    expect(out).toContain('Usage: dbmd check')
    expect(out).toContain('--strict')
    expect(err).toBe('')
  })
})
