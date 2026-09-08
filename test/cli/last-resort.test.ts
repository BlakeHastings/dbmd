/**
 * Nothing reaches the last resort.
 *
 * `failure()` in `src/cli/main.ts` is the entry point's catch of last resort.
 * It reports `"code": "failed"` with whatever message happened to be on the
 * throw, and it exists so that an error nobody anticipated is still a report
 * rather than a stack trace. Nothing in normal operation is meant to arrive
 * there, and it is deliberately not deleted: a codebase whose last resort has
 * been removed is worse than one where it is occasionally reached.
 *
 * Four things arrived there anyway, and each was found on its own. `dbmd
 * export` and `dbmd import` both leaked a refused write, `dbmd studio` leaked a
 * refused port, and `dbmd init` leaked an `ENOTDIR` when the parent of its
 * target was a plain file. The fourth was found only once somebody drove every
 * failure they could reach in one script and read the `error.code` of all of
 * them side by side. This file is that reading, kept, so that the fifteenth
 * failure mode is met by a red build rather than by a fifth incident.
 *
 * **The claim here is a property, not a wording.** Each of these failures also
 * has a test of its own, next door, about the sentence a person reads:
 * `export.test.ts` on the refused write, `import.test.ts` on the write that
 * landed one file and refused the next, `studio.test.ts` on the port. Those are
 * about how one message reads. This is about all of them at once: no path out
 * of any command reports the generic code. It is on `error.code` and it is read
 * out of the `--json` report, because that is where the code lives.
 *
 * **A file rather than a line in each of the seven suites**, which was the other
 * way to write it. The claim quantifies over the commands: it is not seven
 * claims that happen to look alike, and stated seven times it would be seven
 * places to forget on the day an eighth command arrives, which is the defect
 * this repository keeps finding in its own prose. Held here, the registry is
 * read once and the list of commands with a failure driven through them is
 * checked against it, which is a thing no per-command file can do about itself.
 *
 * ## What it derives and what it enumerates
 *
 * A hand-written list of cases goes stale the day somebody adds a command, so
 * two things are derived rather than written down here:
 *
 * 1. **The command list**, from `COMMANDS` in `src/cli/main.ts`. The scenarios
 *    below name a command each, and the set of names they use has to equal the
 *    registry exactly, in both directions. An eighth command with no scenario
 *    fails this file, and so does a scenario naming a command that has been
 *    removed. A test that silently covers six of seven commands is worse than
 *    no test.
 * 2. **The error codes**, by reading `src/cli/` for the codes the commands
 *    report. Every one of them has to be produced by a scenario here, with
 *    exactly one exception: `failed`, which is the whole point. So a new
 *    failure path that comes with a new code fails this file until something
 *    drives it.
 *
 * What genuinely cannot be derived is the *gesture* that reaches a failure. A
 * `Command` is a name, a summary, some help text and a `run`, and nothing in
 * that shape says that a plain file where a directory should be reaches
 * `not-a-directory`. Those are the scenarios, written out, and the two
 * derivations above are what say when the written list has fallen behind.
 *
 * ## What it does not cover
 *
 * - **Wording.** Nothing here asserts a sentence. The per-command suites do,
 *   and duplicating them here would mean two files to edit for one rewrite.
 * - **A new failure path that reuses an existing code.** The code scan cannot
 *   see it, because the code it reports is already produced by another
 *   scenario. What still catches it is the property itself, the day that path
 *   forgets to report a code at all.
 * - **The real gesture, for three of these.** A refused write and a refused
 *   `listen` are mocked, for the reason `export.test.ts` gives at length: the
 *   real gesture is a read-only attribute or a privileged port, neither is
 *   portable, and the seam being tested is what the command does with a
 *   rejected call rather than the disk.
 * - **`failure()` itself.** It stays reachable and stays as it is. This file
 *   says nothing arrives there today, not that nothing can.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { COMMANDS } from '../../src/cli/main.js'
import { SECTION_BEGIN, SECTION_END } from '../../src/export/mermaid.js'
import { runCli, type Run } from './harness.js'

/**
 * The two calls whose refusal a command has to report rather than throw, and
 * which no real filesystem or kernel will refuse on demand.
 *
 * `vi.hoisted` because a mock factory is lifted above every import, so the
 * switches have to exist before this file's top level runs. Both are inert
 * until a scenario sets one, and a hook returning `undefined` lets the real
 * call through, which is what keeps every other scenario writing to a real
 * disk.
 */
const fail = vi.hoisted(() => ({
  rename: undefined as undefined | ((from: string, to: string) => unknown),
  startStudio: undefined as undefined | (() => unknown),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    rename: async (from: string, to: string) => {
      const thrown = fail.rename?.(from, to)
      if (thrown !== undefined) throw thrown
      return await actual.rename(from, to)
    },
  }
})

vi.mock('../../src/studio/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/studio/index.js')>()
  return {
    ...actual,
    startStudio: async (options: Parameters<typeof actual.startStudio>[0]) => {
      const thrown = fail.startStudio?.()
      if (thrown !== undefined) throw thrown
      return await actual.startStudio(options)
    },
  }
})

// --------------------------------------------------------------------------
// The scenarios
// --------------------------------------------------------------------------

interface Scenario {
  /** Which command this drives. Checked against `COMMANDS`, both ways. */
  readonly command: string
  /** What is wrong, in the words somebody would use to describe it. */
  readonly what: string
  /**
   * Whatever this needs on disk or on a mock, and then the argument list.
   * `work` is an empty directory of this scenario's own.
   */
  prepare(work: string): Promise<readonly string[]>
}

const MODEL = `---
kind: model
name: shop
engine: postgres
---

Two files and nothing wrong with either.
`

const CUSTOMERS = `---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
---

One row per person.
`

/** A table file whose front matter does not parse, so reading it is an error. */
const UNREADABLE = `---
kind: table
table: [orders
---

The bracket is never closed, so this file is not in the model that is read.
`

/** A provider-shaped introspection file, minimal, with the tables asked for. */
function introspection(...tables: readonly string[]): string {
  return JSON.stringify({
    dbmdIntrospection: 1,
    engine: 'postgres',
    database: 'shop',
    tables: tables.map((name) => ({
      table_schema: 'public',
      table_name: name,
      columns: [{ column_name: 'id', format_type: 'bigint', not_null: true }],
      primary_key: { constraint_name: `${name}_pkey`, columns: ['id'] },
      indexes: [],
      foreign_keys: [],
      check_constraints: [],
    })),
  })
}

/** The shape of a real refused write: the Windows read-only attribute. */
function refusedWrite(from: string, to: string): Error {
  return Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), {
    code: 'EPERM',
  })
}

/**
 * The shape of a refused bind: libuv's, which is a message, an errno, the
 * syscall and the address it was for. `syscall` is the half `src/cli/studio.ts`
 * reads to decide this is its refusal rather than the entry point's.
 */
function refusedListen(errno: string, message: string): Error {
  return Object.assign(new Error(message), {
    code: errno,
    syscall: 'listen',
    address: '127.0.0.1',
    port: 8080,
  })
}

async function put(path: string, contents: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
  return path
}

/** A model directory with nothing wrong in it, so a command gets past reading. */
async function goodModel(at: string): Promise<string> {
  await put(join(at, '_model.md'), MODEL)
  await put(join(at, 'tables', 'customers.md'), CUSTOMERS)
  return at
}

/** A run that has to have worked, because a scenario is built on top of it. */
async function mustSucceed(argv: readonly string[]): Promise<void> {
  const run = await runCli(argv)
  if (run.code !== 0) {
    throw new Error(
      `setting up a scenario, "dbmd ${argv.join(' ')}" exited ${run.code}: ${run.err}`,
    )
  }
}

/**
 * Every failure this suite can reach, one per way of being wrong.
 *
 * Fourteen of these were driven by hand against `main` on 2026-09-08, across
 * all seven commands, and every one already reported a code of its own. The
 * three that a script outside the process could not reach are the three that
 * leaked in the first place: a refused write in `dbmd export`, a refused write
 * in `dbmd import` including the half-written case, and a refused `listen` in
 * `dbmd studio`.
 */
const SCENARIOS: readonly Scenario[] = [
  {
    command: 'init',
    what: 'the target is a plain file',
    prepare: async (work) => ['init', await put(join(work, 'model.md'), 'not a directory\n')],
  },
  {
    command: 'init',
    what: 'a plain file is the parent of the target',
    prepare: async (work) => {
      const file = await put(join(work, 'model.md'), 'not a directory\n')
      // The fourth leak: on Linux this is refused before the write, and on
      // Windows the file in the way is not met until the writer's first mkdir.
      return ['init', join(file, 'db-model')]
    },
  },
  {
    command: 'init',
    what: 'the directory is there already and has something in it',
    prepare: async (work) => {
      await put(join(work, 'db-model', 'notes.md'), 'somebody was here first\n')
      return ['init', join(work, 'db-model')]
    },
  },

  {
    command: 'query',
    what: 'an engine nobody has written a provider for',
    prepare: async () => ['query', '--engine', 'sybase'],
  },
  {
    command: 'query',
    what: 'no engine at all, which is the one thing it needs',
    prepare: async () => ['query'],
  },

  {
    command: 'import',
    what: 'the file to import is not there',
    prepare: async (work) => [
      'import',
      '--file',
      join(work, 'introspection.json'),
      '--dir',
      join(work, 'db-model'),
    ],
  },
  {
    command: 'import',
    what: 'the file to import is a directory',
    prepare: async (work) => {
      await mkdir(join(work, 'a-directory'))
      return ['import', '--file', join(work, 'a-directory'), '--dir', join(work, 'db-model')]
    },
  },
  {
    command: 'import',
    what: 'the file to import is not JSON',
    prepare: async (work) => [
      'import',
      '--file',
      await put(join(work, 'rows.csv'), 'table_name,column_name\norders,id\n'),
      '--dir',
      join(work, 'db-model'),
    ],
  },
  {
    command: 'import',
    what: 'the file to import is empty',
    prepare: async (work) => [
      'import',
      '--file',
      await put(join(work, 'empty.json'), '\n'),
      '--dir',
      join(work, 'db-model'),
    ],
  },
  {
    command: 'import',
    what: 'the model directory is a plain file',
    prepare: async (work) => [
      'import',
      '--file',
      await put(join(work, 'introspection.json'), introspection('orders')),
      '--dir',
      await put(join(work, 'db-model'), 'not a directory\n'),
    ],
  },
  {
    command: 'import',
    what: 'the model already there does not parse',
    prepare: async (work) => {
      const dir = await goodModel(join(work, 'db-model'))
      await put(join(dir, 'tables', 'orders.md'), UNREADABLE)
      return [
        'import',
        '--file',
        await put(join(work, 'introspection.json'), introspection('orders')),
        '--dir',
        dir,
      ]
    },
  },
  {
    command: 'import',
    what: 'a re-import nobody has confirmed',
    prepare: async (work) => {
      const dir = join(work, 'db-model')
      const first = await put(join(work, 'first.json'), introspection('orders'))
      await mustSucceed(['import', '--file', first, '--dir', dir])
      const second = await put(join(work, 'second.json'), introspection('orders', 'payments'))
      return ['import', '--file', second, '--dir', dir]
    },
  },
  {
    command: 'import',
    what: 'every write is refused, so nothing lands',
    prepare: async (work) => {
      fail.rename = refusedWrite
      return [
        'import',
        '--file',
        await put(join(work, 'introspection.json'), introspection('orders')),
        '--dir',
        join(work, 'db-model'),
      ]
    },
  },
  {
    command: 'import',
    what: 'one file lands and the next is refused',
    prepare: async (work) => {
      // The partial write, which is the one that has to say which files it
      // wrote before the one it could not, and is a different path through the
      // same report.
      fail.rename = (from, to) => (to.endsWith('payments.md') ? refusedWrite(from, to) : undefined)
      return [
        'import',
        '--file',
        await put(join(work, 'introspection.json'), introspection('orders', 'payments')),
        '--dir',
        join(work, 'db-model'),
      ]
    },
  },

  {
    command: 'check',
    what: 'there is no model directory there',
    prepare: async (work) => ['check', join(work, 'db-model')],
  },
  {
    command: 'check',
    what: 'the model directory is a plain file',
    prepare: async (work) => ['check', await put(join(work, 'db-model'), 'not a directory\n')],
  },

  {
    command: 'refs',
    what: 'there is no model directory there',
    prepare: async (work) => ['refs', 'customers', join(work, 'db-model')],
  },
  {
    command: 'refs',
    what: 'the model directory is a plain file',
    prepare: async (work) => [
      'refs',
      'customers',
      await put(join(work, 'db-model'), 'not a directory\n'),
    ],
  },

  {
    command: 'studio',
    what: 'there is no model directory there',
    prepare: async (work) => ['studio', join(work, 'db-model'), '--no-open'],
  },
  {
    command: 'studio',
    what: 'the model directory is a plain file',
    prepare: async (work) => [
      'studio',
      await put(join(work, 'db-model'), 'not a directory\n'),
      '--no-open',
    ],
  },
  {
    command: 'studio',
    what: 'the port belongs to somebody else already',
    prepare: async (work) => {
      fail.startStudio = () =>
        refusedListen('EADDRINUSE', 'listen EADDRINUSE: address already in use 127.0.0.1:8080')
      return ['studio', await goodModel(join(work, 'db-model')), '--no-open', '--port', '8080']
    },
  },
  {
    command: 'studio',
    what: 'the machine refuses the port for some other reason',
    prepare: async (work) => {
      fail.startStudio = () =>
        refusedListen('EACCES', 'listen EACCES: permission denied 127.0.0.1:80')
      return ['studio', await goodModel(join(work, 'db-model')), '--no-open', '--port', '80']
    },
  },

  {
    command: 'export',
    what: 'there is no model directory there',
    prepare: async (work) => ['export', join(work, 'db-model')],
  },
  {
    command: 'export',
    what: 'the model directory is a plain file',
    prepare: async (work) => ['export', await put(join(work, 'db-model'), 'not a directory\n')],
  },
  {
    command: 'export',
    what: 'the README has one marker and not the other',
    prepare: async (work) => {
      const dir = await goodModel(join(work, 'db-model'))
      await put(join(dir, 'README.md'), `# Notes\n\n${SECTION_BEGIN}\n`)
      return ['export', dir]
    },
  },
  {
    command: 'export',
    what: 'the README has its markers the wrong way round',
    prepare: async (work) => {
      const dir = await goodModel(join(work, 'db-model'))
      await put(join(dir, 'README.md'), `# Notes\n\n${SECTION_END}\n\nMine.\n\n${SECTION_BEGIN}\n`)
      return ['export', dir]
    },
  },
  {
    command: 'export',
    what: 'the write is refused',
    prepare: async (work) => {
      const dir = await goodModel(join(work, 'db-model'))
      fail.rename = (from, to) => (to.endsWith('README.md') ? refusedWrite(from, to) : undefined)
      return ['export', dir]
    },
  },
]

// --------------------------------------------------------------------------
// Driving them
// --------------------------------------------------------------------------

interface Envelope {
  readonly schema?: number
  readonly ok?: boolean
  readonly diagnostics?: readonly { readonly severity?: string }[]
  readonly error?: { readonly code?: string; readonly message?: string }
}

interface Outcome {
  readonly scenario: Scenario
  readonly run: Run
  /** The parsed `--json` report, or `undefined` when stdout was not one. */
  readonly report: Envelope | undefined
}

const outcomes: Outcome[] = []
const temporaries: string[] = []

/** One line naming a scenario, for a failure message somebody has to act on. */
function name(outcome: Outcome): string {
  return `dbmd ${outcome.scenario.command}: ${outcome.scenario.what}`
}

beforeAll(async () => {
  for (const scenario of SCENARIOS) {
    fail.rename = undefined
    fail.startStudio = undefined
    const work = await mkdtemp(join(tmpdir(), 'dbmd-last-resort-'))
    temporaries.push(work)
    const argv = await scenario.prepare(work)
    // `--json` last, because the report is where the code lives and the entry
    // point takes a global flag from anywhere in the line.
    const run = await runCli([...argv, '--json'])
    let report: Envelope | undefined
    try {
      report = JSON.parse(run.out) as Envelope
    } catch {
      report = undefined
    }
    outcomes.push({ scenario, run, report })
  }
  fail.rename = undefined
  fail.startStudio = undefined
}, 120_000)

afterAll(async () => {
  for (const work of temporaries.splice(0)) {
    await rm(work, { recursive: true, force: true })
  }
})

describe('every way a command can fail', () => {
  test('every scenario ran and answered on stdout as a report', () => {
    expect(outcomes).toHaveLength(SCENARIOS.length)
    // Which is what makes the assertion below mean something: a scenario that
    // exits 0, or prints nothing, proves nothing about the last resort.
    const wrong = outcomes.filter(
      (outcome) =>
        outcome.run.code === 0 || outcome.report === undefined || outcome.report.ok !== false,
    )
    expect(
      wrong.map((outcome) => `${name(outcome)} -> exit ${outcome.run.code}, ${outcome.run.out}`),
    ).toEqual([])
  })

  test('no path out of any command reports the last-resort code', () => {
    // The whole file. `failed` is `main.ts` saying it does not know what
    // happened, and every one of these is something a command does know.
    const leaked = outcomes.filter((outcome) => outcome.report?.error?.code === 'failed')
    expect(
      leaked.map((outcome) => `${name(outcome)} -> ${outcome.report?.error?.message ?? ''}`),
    ).toEqual([])
  })

  test('a failure says why, in a code of its own or in diagnostics that name errors', () => {
    // The other half of the same property, and the reason it is not written as
    // "the code is not `failed`" alone: `dbmd check` reports no error object at
    // all, on purpose, because its answer is the diagnostics. A command that
    // quietly stopped saying anything would pass the assertion above and fail
    // this one.
    const silent = outcomes.filter((outcome) => {
      const report = outcome.report
      if (report === undefined) return true
      if (typeof report.error?.code === 'string' && report.error.code !== '') return false
      return !(report.diagnostics ?? []).some((one) => one.severity === 'error')
    })
    expect(silent.map(name)).toEqual([])
  })
})

describe('the list does not go stale on its own', () => {
  test('every registered command has a failure driven through it, and no others', () => {
    // Derived, not written down. An eighth command reaches this line the day it
    // is registered, with nothing in `SCENARIOS` naming it, and the assertion
    // says which one.
    const registered = [...new Set(COMMANDS.map((command) => command.name))].sort()
    const covered = [...new Set(SCENARIOS.map((scenario) => scenario.command))].sort()
    expect(covered).toEqual(registered)
  })

  test('every error code the commands can report is produced by a scenario', async () => {
    const declared = await reportCodes()
    const produced = new Set(
      outcomes
        .map((outcome) => outcome.report?.error?.code)
        .filter((code): code is string => typeof code === 'string'),
    )

    // `failed` is the one code in there that no scenario may produce, and the
    // test above is where that is asserted. Holding it out here keeps this one
    // about coverage: anything else the source can report and nothing drives is
    // a failure path with no case, which is how the fourth leak survived.
    expect(declared.codes.has('failed')).toBe(true)
    const owed = [...declared.codes].filter((code) => code !== 'failed')
    expect(owed.filter((code) => !produced.has(code)).sort()).toEqual([])

    // And the other direction, so the scan cannot go blind. A code arriving in
    // a report that the scan did not find in the source means the scan has
    // stopped reading the shape the commands are written in, which would leave
    // the assertion above passing over nothing.
    expect([...produced].filter((code) => !declared.codes.has(code)).sort()).toEqual([])

    // A code the scan could see was there and could not read is worse than one
    // it never saw, because it looks like coverage. Fail on it and say where.
    expect(declared.unreadable).toEqual([])
  })

  test('the scan reads a report the way the commands write one', () => {
    // The guard on the guard. If this ever reads nothing, the assertion above
    // is comparing two empty sets and would not notice a thing.
    expect(
      codesIn(`json: { directory, error: { code: 'no-such-table', message: reason } },`),
    ).toEqual(['no-such-table'])
    expect(codesIn(`error: {\n  code: 'model-has-errors',\n  message: reason,\n},`)).toEqual([
      'model-has-errors',
    ])
    // The ternary in `src/cli/studio.ts`: two codes on one line, and an errno
    // being compared against that is not one of them.
    expect(
      codesIn(
        `error: { code: errno === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed', message },`,
      ),
    ).toEqual(['port-in-use', 'listen-failed'])
    // A diagnostic is not a report. It has a code too and it is not the CLI
    // saying why it stopped.
    expect(codesIn(`{ severity: 'error', code: 'import/unsafe-name', message }`)).toEqual([])
    // And a code it cannot read is reported rather than skipped.
    expect(codesIn(`error: { code: whicheverItWas, message },`)).toEqual([UNREADABLE_CODE])
  })
})

// --------------------------------------------------------------------------
// What the source says a command can report
// --------------------------------------------------------------------------

const root = fileURLToPath(new URL('../..', import.meta.url))

/** What `codesIn` returns where an `error:` block's code is not a literal. */
const UNREADABLE_CODE = '<not a literal>'

/**
 * Every `error.code` a report in one source file can carry.
 *
 * Reports are object literals, so this reads them rather than importing
 * anything: a `code` is inside an `error: { ... }` block, and there is no way
 * to ask a `Command` which failures it has. The block is taken by matching
 * braces rather than by line, because `src/cli/studio.ts` writes two codes into
 * one ternary and `src/cli/import.ts` writes one over four lines.
 *
 * A comparison against a string is stripped before the literals are collected,
 * so that `errno === 'EADDRINUSE' ? ...` contributes the two codes it chooses
 * between and not the errno it is asking about.
 */
function codesIn(source: string): string[] {
  const found: string[] = []
  const opening = /\berror:\s*\{/g
  let match: RegExpExecArray | null
  while ((match = opening.exec(source)) !== null) {
    const body = balanced(source, match.index + match[0].length)
    const code = /\bcode:/.exec(body)
    if (code === null) continue
    const expression = untilComma(body, code.index + code[0].length)
    const decided = expression.replace(/[!=]==?\s*'[^']*'/g, '')
    const literals = [...decided.matchAll(/'([^']*)'/g)].map((one) => one[1] as string)
    found.push(...(literals.length === 0 ? [UNREADABLE_CODE] : literals))
  }
  return found
}

/** From just inside an open brace to just before the one that closes it. */
function balanced(source: string, from: number): string {
  let depth = 1
  let index = from
  while (index < source.length && depth > 0) {
    const character = source[index]
    if (character === '{') depth++
    else if (character === '}') depth--
    index++
  }
  return source.slice(from, index - 1)
}

/** One property's value: up to the comma that ends it, nesting and quotes aside. */
function untilComma(source: string, from: number): string {
  let depth = 0
  let quote = ''
  for (let index = from; index < source.length; index++) {
    const character = source[index] as string
    if (quote !== '') {
      if (character === '\\') index++
      else if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"' || character === '`') quote = character
    else if ('{[('.includes(character)) depth++
    else if ('}])'.includes(character)) depth--
    else if (character === ',' && depth === 0) return source.slice(from, index)
  }
  return source.slice(from)
}

/**
 * Every code the CLI's own reports carry, and where a scan could not read one.
 *
 * `src/cli/` and not the whole of `src/`, because that is where a `Report` is
 * built: a command is the only thing that reports, and the entry point is the
 * only other file in there that does. Measured on 2026-09-08, the same scan
 * over the whole of `src/` finds exactly this set and nothing else, so the
 * narrower read is not hiding anything today. What it would miss is a report
 * assembled in some other directory and handed to a command, and that is worth
 * knowing about before it happens rather than after.
 */
async function reportCodes(): Promise<{ codes: Set<string>; unreadable: string[] }> {
  const directory = join(root, 'src', 'cli')
  const codes = new Set<string>()
  const unreadable: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  expect(files.length).toBeGreaterThan(0)
  for (const entry of files) {
    for (const code of codesIn(await readFile(join(directory, entry.name), 'utf8'))) {
      if (code === UNREADABLE_CODE) unreadable.push(`src/cli/${entry.name}`)
      else codes.add(code)
    }
  }
  return { codes, unreadable }
}
