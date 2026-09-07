/**
 * The output contract itself: colour, the two streams, the `--json` envelope,
 * and the sort.
 *
 * `--no-color`, `NO_COLOR` and terminal detection are three inputs to one
 * decision, and the bug worth catching is in the combination rather than in any
 * one of them, so the combinations are a table here rather than a paragraph in
 * a decision record.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  colorEnabled,
  createOutput,
  sortedBy,
  type Environment,
  type Payload,
} from '../../src/cli/output.js'
import { captureEnvironment, runCli, type ProcessFacts } from './harness.js'

/** An escape sequence, spelled rather than pasted: a literal escape byte is invisible in a diff. */
const ESC = String.fromCharCode(0x1b)

function facts(overrides: ProcessFacts): Environment {
  return captureEnvironment(overrides).environment
}

const terminal: ProcessFacts = { stdoutIsTty: true, stderrIsTty: true }

describe('the colour decision', () => {
  const cases: ReadonlyArray<{
    readonly what: string
    readonly facts: ProcessFacts
    readonly noColor: boolean
    readonly expected: boolean
  }> = [
    { what: 'a terminal, nothing set', facts: terminal, noColor: false, expected: true },
    { what: '--no-color at a terminal', facts: terminal, noColor: true, expected: false },
    {
      what: 'NO_COLOR set to anything',
      facts: { ...terminal, env: { NO_COLOR: '1' } },
      noColor: false,
      expected: false,
    },
    {
      what: 'NO_COLOR=0, which is still set',
      facts: { ...terminal, env: { NO_COLOR: '0' } },
      noColor: false,
      expected: false,
    },
    {
      what: 'NO_COLOR empty, which no-color.org says is not set',
      facts: { ...terminal, env: { NO_COLOR: '' } },
      noColor: false,
      expected: true,
    },
    {
      what: 'TERM=dumb, a terminal that cannot render an escape code',
      facts: { ...terminal, env: { TERM: 'dumb' } },
      noColor: false,
      expected: false,
    },
    {
      what: 'a real TERM',
      facts: { ...terminal, env: { TERM: 'xterm-256color' } },
      noColor: false,
      expected: true,
    },
    {
      what: 'stdout piped, stderr still a terminal',
      facts: { stdoutIsTty: false, stderrIsTty: true },
      noColor: false,
      expected: false,
    },
    {
      what: 'stderr redirected to a file, stdout still a terminal',
      facts: { stdoutIsTty: true, stderrIsTty: false },
      noColor: false,
      expected: false,
    },
    {
      what: 'neither is a terminal, which is CI',
      facts: {},
      noColor: false,
      expected: false,
    },
    {
      what: '--no-color wins over everything, including a terminal with a real TERM',
      facts: { ...terminal, env: { TERM: 'xterm-256color' } },
      noColor: true,
      expected: false,
    },
  ]

  for (const item of cases) {
    test(item.what, () => {
      expect(colorEnabled(facts(item.facts), { json: false, noColor: item.noColor })).toBe(
        item.expected,
      )
    })
  }

  test('the palette is the identity when colour is off, so a caller never branches', () => {
    const off = createOutput(facts({}), { json: false, noColor: false })
    expect(off.style.bad('dbmd:')).toBe('dbmd:')
    expect(off.style.strong('db-model')).toBe('db-model')
    expect(off.style.faint('_model.md')).toBe('_model.md')
  })

  test('styling ends with a reset, so it cannot leak into the next line', () => {
    const on = createOutput(facts(terminal), { json: false, noColor: false })
    expect(on.style.bad('dbmd:')).toBe(`${ESC}[31mdbmd:${ESC}[0m`)
    expect(on.style.strong('db-model')).toBe(`${ESC}[1mdb-model${ESC}[0m`)
    expect(on.style.faint('_model.md')).toBe(`${ESC}[2m_model.md${ESC}[0m`)
  })
})

describe('the two streams', () => {
  test('a report is narration: text on stderr, nothing on stdout', () => {
    const { environment, written } = captureEnvironment({})
    const out = createOutput(environment, { json: false, noColor: false })

    const code = out.report({ code: 0, text: 'wrote 12 files\n', json: { files: 12 } })

    expect(code).toBe(0)
    expect(written.out).toBe('')
    expect(written.err).toBe('wrote 12 files\n')
  })

  test('with --json the answer is on stdout and stderr stays empty', () => {
    const { environment, written } = captureEnvironment({})
    const out = createOutput(environment, { json: true, noColor: false })

    out.report({ code: 0, text: 'wrote 12 files\n', json: { files: 12 } })

    expect(written.err).toBe('')
    expect(JSON.parse(written.out)).toEqual({ schema: 1, ok: true, files: 12 })
  })

  test('data goes to stdout verbatim', () => {
    const { environment, written } = captureEnvironment({})
    const out = createOutput(environment, { json: false, noColor: false })

    out.data('# a diagram\n')

    expect(written.out).toBe('# a diagram\n')
    expect(written.err).toBe('')
  })
})

describe('the JSON envelope', () => {
  test('ok is the exit code, so the two cannot disagree', () => {
    const { environment, written } = captureEnvironment({})
    const out = createOutput(environment, { json: true, noColor: false })

    const code = out.report({ code: 1, text: 'nope\n', json: { error: { code: 'nope' } } })

    expect(code).toBe(1)
    expect(JSON.parse(written.out)).toEqual({
      schema: 1,
      ok: false,
      error: { code: 'nope' },
    })
  })

  test('it is newline-terminated and indented, so a log and a diff both read', () => {
    const { environment, written } = captureEnvironment({})
    const out = createOutput(environment, { json: true, noColor: false })

    out.report({ code: 0, text: '', json: { files: ['a', 'b'] } })

    expect(written.out).toBe(
      [
        '{',
        '  "schema": 1,',
        '  "ok": true,',
        '  "files": [',
        '    "a",',
        '    "b"',
        '  ]',
        '}',
        '',
      ].join('\n'),
    )
  })

  test('a payload cannot claim an envelope key', () => {
    const payload: Payload = {
      // @ts-expect-error `ok` is the envelope's, derived from the exit code. A command
      // that could set it could report success while exiting 1, which is the bug ADR
      // 0006 names.
      ok: true,
    }
    expect(payload).toBeDefined()
  })
})

describe('the sort', () => {
  test('code-unit order, not locale order, so every machine agrees', () => {
    // `localeCompare` puts "a" before "Z" in an English locale and after it in
    // others. This is the property that stops an agent chasing a diff that is
    // only the sort order of somebody else's machine.
    expect(sortedBy(['a', 'Z', 'B'])).toEqual(['B', 'Z', 'a'])
  })

  test('it takes any iterable and does not disturb the caller', () => {
    const original = ['b', 'a']
    expect(sortedBy(new Set(['b', 'a']))).toEqual(['a', 'b'])
    expect(sortedBy(original)).toEqual(['a', 'b'])
    expect(original).toEqual(['b', 'a'])
  })

  test('a key picks the field to sort on, and equal keys keep their order', () => {
    const rows = [
      { table: 'orders', column: 'id' },
      { table: 'accounts', column: 'id' },
      { table: 'orders', column: 'account_id' },
    ]
    expect(sortedBy(rows, (row) => row.table)).toEqual([
      { table: 'accounts', column: 'id' },
      { table: 'orders', column: 'id' },
      { table: 'orders', column: 'account_id' },
    ])
  })
})

describe('one real command, in every context', () => {
  const temporaries: string[] = []

  async function vacantPath(): Promise<string> {
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-output-'))
    temporaries.push(parent)
    return join(parent, 'db-model')
  }

  async function occupiedPath(): Promise<string> {
    const directory = await vacantPath()
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'notes.txt'), 'mine\n', 'utf8')
    return directory
  }

  afterEach(async () => {
    for (const directory of temporaries.splice(0)) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('at a terminal the narration is coloured and stdout is untouched', async () => {
    const { out, err } = await runCli(['init', await vacantPath()], terminal)
    expect(err).toContain(ESC)
    expect(out).toBe('')
  })

  test('piped, the same run has no escape codes anywhere', async () => {
    const { out, err } = await runCli(['init', await vacantPath()], {})
    expect(err).not.toContain(ESC)
    expect(out).toBe('')
  })

  test('NO_COLOR at a terminal is the piped output', async () => {
    const coloured = await runCli(['init', await vacantPath()], terminal)
    const plain = await runCli(['init', await vacantPath()], {
      ...terminal,
      env: { NO_COLOR: '1' },
    })
    expect(coloured.err).toContain(ESC)
    expect(plain.err).not.toContain(ESC)
  })

  test('--no-color at a terminal is the piped output', async () => {
    const { err } = await runCli(['init', '--no-color', await vacantPath()], terminal)
    expect(err).not.toContain(ESC)
  })

  test('--json is never coloured, even at a terminal', async () => {
    const { out, err } = await runCli(['init', '--json', await vacantPath()], terminal)
    expect(out).not.toContain(ESC)
    expect(err).toBe('')
    expect(JSON.parse(out)).toMatchObject({ ok: true })
  })

  test('the failing case exits 1 in both forms, and says so in both', async () => {
    const directory = await occupiedPath()

    const text = await runCli(['init', directory], {})
    const json = await runCli(['init', '--json', directory], {})

    expect(text.code).toBe(1)
    expect(json.code).toBe(1)
    expect(JSON.parse(json.out)).toMatchObject({ ok: false })
  })

  test('the succeeding case exits 0 in both forms', async () => {
    const text = await runCli(['init', await vacantPath()], {})
    const json = await runCli(['init', '--json', await vacantPath()], {})

    expect(text.code).toBe(0)
    expect(json.code).toBe(0)
    expect(JSON.parse(json.out)).toMatchObject({ ok: true })
  })

  test('the same input twice writes the same bytes', async () => {
    const directory = await vacantPath()

    const first = await runCli(['init', '--json', directory], {})
    await rm(directory, { recursive: true, force: true })
    const second = await runCli(['init', '--json', directory], {})

    expect(first.out).toBe(second.out)
  })
})
