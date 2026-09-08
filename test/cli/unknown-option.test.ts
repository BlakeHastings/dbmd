/**
 * The one thing every command's "you typed it wrong" sentence must never say.
 *
 * Each command writes its own version of that sentence, worded for its own
 * flags, and each one opens with `usageProblem`. Until 2026-09-08 the helper
 * underneath it returned the first token in `argv` with a dash on the front,
 * whether or not the command accepted it, so
 * "dbmd query --engine postgres --bogus" answered
 * `unknown option "--engine"` and then, in the same breath, said the command
 * takes `--engine`. The flag the developer actually mistyped was never
 * mentioned. It passed with the bad flag typed first, which is the arrangement
 * a test reaches for, and lied whenever a good flag came before the bad one.
 *
 * It is handed the option table the command handed `parseArgs`, types included,
 * so the two cannot come to disagree about what the command takes and so a
 * value can be told from a flag: `-1` in "dbmd studio --port -1" is a value
 * refused, `-x` is a flag nobody has heard of, and only the table says which.
 *
 * So the shared behaviour is checked here rather than seven times over: every
 * command on the registry, driven through the real entry point, with a bogus
 * flag on its own and again after each flag its own `--help` promises. A new
 * command is covered the day it joins `COMMANDS`, and a new flag the day it is
 * documented, because neither list is written out again in this file.
 *
 * The exact sentences, including the ones where the helper stays quiet and
 * `parseArgs` speaks for itself, are pinned beside the command they belong to:
 * `studio.test.ts` has "--port" with no value, "--port -1" and "--no-open=yes".
 */

import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import { describe, expect, test } from 'vitest'
import { usageProblem } from '../../src/cli/command.js'
import { COMMANDS } from '../../src/cli/main.js'
import { runCli, type Run } from './harness.js'

async function run(...argv: string[]): Promise<Run> {
  return await runCli(argv)
}

/**
 * The fragment a command opens its sentence with, produced the way a command
 * produces it: hand `parseArgs` the arguments, catch what it threw, and hand
 * both that and the same option table back.
 *
 * Driving the real parser rather than a hand-made error is the point. What this
 * helper has to get right is which token `parseArgs` objected to, and a fake
 * error is a second opinion about that rather than a test of it.
 */
function problem(options: ParseArgsOptionsConfig, ...argv: string[]): string {
  try {
    parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  } catch (error) {
    return usageProblem(error, argv, options)
  }
  throw new Error(`parseArgs accepted "${argv.join(' ')}", so there is no problem to phrase`)
}

/** What `dbmd studio` takes: one string option and one boolean. */
const STUDIO = { port: { type: 'string' }, 'no-open': { type: 'boolean' } } as const

/** What `dbmd refs` takes, which is two booleans and no value to expect. */
const REFS = { incoming: { type: 'boolean' }, outgoing: { type: 'boolean' } } as const

/**
 * The flags a command's own `--help` promises, read out of its Options block.
 *
 * The help is the list the user is working from, so it is the list the message
 * must never contradict. Reading it here rather than writing the flags down
 * means a flag added to a command is driven the day it is documented, without
 * anybody remembering this file, and a command added to `COMMANDS` is driven
 * the day it joins.
 */
function documentedFlags(help: string): readonly string[] {
  const lines = help.split('\n')
  const options = lines.indexOf('Options:')
  if (options === -1) return []

  const flags: string[] = []
  for (const line of lines.slice(options + 1)) {
    // The block ends at the first blank line: prose below it mentions flags
    // too, and "--engine is required here" is a sentence rather than an entry.
    if (line.trim() === '') break
    const flag = /^\s+(--[a-z][a-z\d-]*)/.exec(line)?.[1]
    if (flag !== undefined) flags.push(flag)
  }
  return flags
}

describe('the flag it names', () => {
  test('is the long flag the command does not take', () => {
    expect(problem(REFS, '--bogus')).toBe('unknown option "--bogus"')
  })

  test('is the one that offended, not the first one with a dash on it', () => {
    expect(problem(REFS, '--incoming', '--bogus')).toBe('unknown option "--bogus"')
    expect(problem(STUDIO, '--port', '8080', '--bogus')).toBe('unknown option "--bogus"')
  })

  test('is read from the name half of --name=value', () => {
    expect(problem(REFS, '--bogus=1')).toBe('unknown option "--bogus"')
  })

  test('is not looked for after a bare --, where every token is a positional', () => {
    expect(problem(REFS, '--bogus', '--', '--other')).toBe('unknown option "--bogus"')
    // The other side of it: parseArgs takes the same tokens as positionals when
    // nothing before the -- was wrong, and there is nothing to phrase at all.
    const parsed = parseArgs({
      args: ['--', '--other'],
      options: REFS,
      allowPositionals: true,
      strict: true,
    })
    expect(parsed.positionals).toEqual(['--other'])
  })

  test('is the short flag itself, in the words this project uses', () => {
    // The wording is the point. parseArgs answers "-x" with three lines about
    // quoting a positional after "--", which is not what anybody typing "-x"
    // was doing, and it does not close its own quote.
    expect(problem(REFS, '-x')).toBe('unknown option "-x"')
    expect(problem(STUDIO, '--no-open', '-x')).toBe('unknown option "-x"')
    expect(problem(STUDIO, 'db-model', '-x')).toBe('unknown option "-x"')
    expect(problem(STUDIO, '--port', '8080', '-x')).toBe('unknown option "-x"')
  })
})

describe('what it will not call an unknown option', () => {
  test('the value parseArgs refused to read, which is the option before it', () => {
    const fragment = problem(STUDIO, '--no-open', '--port', '-1')
    expect(fragment).toContain('--port')
    expect(fragment).not.toContain('--no-open')
    expect(fragment).not.toContain('unknown option')
  })

  test('an option left waiting for a value by the end of the arguments', () => {
    expect(problem(STUDIO, '--port')).toContain('--port')
    expect(problem(STUDIO, '--port')).not.toContain('unknown option')
  })

  test('an option given a value it does not take', () => {
    expect(problem(STUDIO, '--no-open=yes')).toContain('--no-open')
    expect(problem(STUDIO, '--no-open=yes')).not.toContain('unknown option')
  })

  test('a -- that a string option was waiting on, rather than what follows it', () => {
    const fragment = problem(STUDIO, '--port', '--', '--other')
    expect(fragment).toContain('--port')
    expect(fragment).not.toContain('--other')
  })

  test('a cluster, where only the parser knows which half of it was refused', () => {
    // No command declares a short today. When one does, "-qz" is one token here
    // and two options to parseArgs, so this stands aside rather than name a
    // token that is half accepted.
    const clustered = { quiet: { type: 'boolean', short: 'q' } } as const
    expect(problem(clustered, '-qz')).not.toContain('unknown option')
  })
})

describe('the fragment it hands back', () => {
  test('is one line, so the sentence it opens stays one sentence', () => {
    // parseArgs writes three lines about an ambiguous value, and every call site
    // writes `. "dbmd studio" takes ...` after whatever it is given.
    const fragment = problem(STUDIO, '--port', '-1')
    expect(fragment).not.toContain('\n')
  })

  test('ends without a full stop, because the call site writes one', () => {
    expect(problem(STUDIO, '--port', '-1').endsWith('.')).toBe(false)
    expect(problem(REFS, '--bogus').endsWith('.')).toBe(false)
  })

  test('folds and trims exactly that much and no more', () => {
    // Pinned against something this project owns rather than against Node's
    // wording, which is what the rest of this file refuses to depend on.
    expect(usageProblem(new Error('One.\nTwo.\n'), [], REFS)).toBe('One. Two')
  })
})

describe('the flags every command is driven with', () => {
  test('come from each command help rather than from a list written here', () => {
    // If the extraction above ever returns nothing, every loop below runs zero
    // cases and passes, which is the shape of a test that has stopped testing.
    const named = COMMANDS.filter((command) => documentedFlags(command.help).length > 0)
    expect(named.map((command) => command.name)).toEqual([
      'query',
      'import',
      'check',
      'refs',
      'studio',
      'export',
    ])
  })
})

for (const { name, help } of COMMANDS) {
  describe(`dbmd ${name}`, () => {
    test('names an unknown flag typed on its own', async () => {
      const { code, out, err } = await run(name, '--bogus')
      expect(code).toBe(2)
      expect(out).toBe('')
      expect(err).toContain('unknown option "--bogus"')
      expect(err).toContain(`dbmd ${name} --help`)
    })

    for (const flag of documentedFlags(help)) {
      test(`names the unknown flag after ${flag}, and does not call ${flag} unknown`, async () => {
        const { code, out, err } = await run(name, flag, '--bogus')
        expect(code).toBe(2)
        expect(out).toBe('')
        expect(err).toContain('unknown option "--bogus"')
        expect(err).not.toContain(`unknown option "${flag}"`)
      })

      test(`names the unknown flag typed before ${flag} too`, async () => {
        const { code, err } = await run(name, '--bogus', flag)
        expect(code).toBe(2)
        expect(err).toContain('unknown option "--bogus"')
        expect(err).not.toContain(`unknown option "${flag}"`)
      })
    }
  })
}

describe('the sentences from the report this was filed as', () => {
  test('dbmd query --engine postgres --bogus', async () => {
    const { code, err } = await run('query', '--engine', 'postgres', '--bogus')
    expect(code).toBe(2)
    expect(err).toBe(
      'dbmd: unknown option "--bogus". "dbmd query" takes --engine and nothing else; ' +
        'run "dbmd query --help".\n',
    )
  })

  test('dbmd refs accounts --incoming --bogus', async () => {
    const { code, err } = await run('refs', 'accounts', '--incoming', '--bogus')
    expect(code).toBe(2)
    expect(err).toBe(
      'dbmd: unknown option "--bogus". "dbmd refs" takes a table, an optional directory, ' +
        '--incoming and --outgoing; run "dbmd refs --help".\n',
    )
  })

  test('dbmd check -x, which used to get three lines of advice from Node', async () => {
    const { code, err } = await run('check', '-x')
    expect(code).toBe(2)
    expect(err).toBe(
      'dbmd: unknown option "-x". "dbmd check" takes an optional directory and --strict; ' +
        'run "dbmd check --help".\n',
    )
  })

  test('the JSON form carries the same corrected message', async () => {
    const { code, out } = await run('query', '--json', '--engine', 'postgres', '--bogus')
    expect(code).toBe(2)
    const parsed = JSON.parse(out) as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('usage')
    expect(parsed.error.message).toContain('unknown option "--bogus"')
  })
})
