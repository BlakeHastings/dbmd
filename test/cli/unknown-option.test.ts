/**
 * The one thing every command's "you typed it wrong" sentence must never say.
 *
 * Each command writes its own version of that sentence, worded for its own
 * flags, and each one opens with `offendingOption`. Until 2026-09-08 that
 * helper returned the first token in `argv` with a dash on the front, whether
 * or not the command accepted it, so
 * "dbmd query --engine postgres --bogus" answered
 * `unknown option "--engine"` and then, in the same breath, said the command
 * takes `--engine`. The flag the developer actually mistyped was never
 * mentioned. It passed with the bad flag typed first, which is the arrangement
 * a test reaches for, and lied whenever a good flag came before the bad one.
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

import { describe, expect, test } from 'vitest'
import { offendingOption } from '../../src/cli/command.js'
import { COMMANDS } from '../../src/cli/main.js'
import { runCli, type Run } from './harness.js'

async function run(...argv: string[]): Promise<Run> {
  return await runCli(argv)
}

/**
 * The flags a command's own `--help` promises, read out of its Options block.
 *
 * The help is the list the user is working from, so it is the list the message
 * must never contradict. Reading it here rather than writing the flags down
 * means a flag added to a command is covered without anybody remembering this
 * file, which is the failure this test exists to catch: the accepted names are
 * passed to `offendingOption` by hand, a few lines from the `parseArgs` call
 * they mirror, and a flag added to one and not the other brings the whole
 * defect back for that flag alone.
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

describe('offendingOption', () => {
  test('names a long flag the command does not take', () => {
    expect(offendingOption(['--bogus'], ['strict'])).toBe('unknown option "--bogus"')
  })

  test('names the one that offended, not the first one with a dash on it', () => {
    expect(offendingOption(['--strict', '--bogus'], ['strict'])).toBe('unknown option "--bogus"')
  })

  test('says nothing when every flag given is one the command takes', () => {
    expect(offendingOption(['--incoming', '--outgoing'], ['incoming', 'outgoing'])).toBeUndefined()
  })

  test('matches on the name half of --name=value', () => {
    expect(offendingOption(['--bogus=1'], ['strict'])).toBe('unknown option "--bogus"')
    expect(offendingOption(['--strict=yes'], ['strict'])).toBeUndefined()
  })

  test('a token after -- is a positional, however it is spelled', () => {
    expect(offendingOption(['--', '--bogus'], ['strict'])).toBeUndefined()
    expect(offendingOption(['--bogus', '--', '--other'], ['strict'])).toBe(
      'unknown option "--bogus"',
    )
  })

  test('a bare word is a positional or a value, and neither offends', () => {
    expect(offendingOption(['accounts', 'db-model'], ['incoming'])).toBeUndefined()
    expect(offendingOption(['--engine', 'postgres', '--bogus'], ['engine'])).toBe(
      'unknown option "--bogus"',
    )
  })

  test('it stays quiet about a single-dash token rather than guessing', () => {
    // "-1" here is not an unknown option at all: it is the value parseArgs
    // refused to read for "--port", and the error it threw says so. A single
    // dash token is the one shape a list of long names cannot settle, so the
    // helper leaves it to the error rather than inventing a claim about it.
    expect(offendingOption(['--port', '-1'], ['port'])).toBeUndefined()
    expect(offendingOption(['-x'], ['port'])).toBeUndefined()
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

  test('the JSON form carries the same corrected message', async () => {
    const { code, out } = await run('query', '--json', '--engine', 'postgres', '--bogus')
    expect(code).toBe(2)
    const parsed = JSON.parse(out) as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('usage')
    expect(parsed.error.message).toContain('unknown option "--bogus"')
  })
})
