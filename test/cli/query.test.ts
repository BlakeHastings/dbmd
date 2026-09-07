/**
 * `dbmd query`, whose whole contract is which stream each half went to.
 *
 * The command prints SQL somebody is going to redirect into a file or pipe into
 * a client, so a single word of narration on stdout corrupts the file and
 * nothing says so until the query fails to parse in their console. That is the
 * failure these tests are for: stdout is compared byte for byte against the
 * provider's own query, and stderr is where every sentence about it has to be.
 *
 * The registry is a defaulted parameter on `runQuery` rather than an import, so
 * the tests that matter most here can be run against a registry built by hand:
 * a build with no providers at all, and a build whose providers are test doubles
 * with names the real one does not have. Between them they prove the thing ADR
 * 0007 asks for, which is that no engine's name is written anywhere in
 * `src/cli/query.ts`.
 */

import { describe, expect, test } from 'vitest'
import { runQuery } from '../../src/cli/query.js'
import { createOutput, type Output } from '../../src/cli/output.js'
import { createRegistry, registry } from '../../src/import/providers/index.js'
import { postgresProvider } from '../../src/import/providers/postgres.js'
import { sqlserverProvider } from '../../src/import/providers/sqlserver.js'
import { fakePostgresProvider, fakeSqlServerProvider } from '../import/fake-providers.js'
import { captureEnvironment, runCli, type Run } from './harness.js'

async function run(...argv: string[]): Promise<Run> {
  return await runCli(argv)
}

/** `runQuery` against a registry of this test's choosing, with both streams captured. */
async function runAgainst(
  providers: Parameters<typeof runQuery>[2],
  argv: readonly string[],
  json = false,
): Promise<Run> {
  const { environment, written } = captureEnvironment()
  const out: Output = createOutput(environment, { json, noColor: true })
  let code: number
  try {
    code = await runQuery(argv, out, providers)
  } catch (error) {
    // `main` is what turns a `UsageError` into a report, and it is not in play
    // here, so the message is surfaced the way a caller of `runQuery` sees it.
    return { code: 2, out: written.out, err: (error as Error).message }
  }
  return { code, out: written.out, err: written.err }
}

describe('dbmd query', () => {
  test('stdout is the engine’s query and nothing else, byte for byte', async () => {
    const { code, out } = await run('query', '--engine', 'postgres')
    expect(code).toBe(0)
    expect(out).toBe(postgresProvider.introspectionQuery())
  })

  test('every engine in the registry prints its own query, and they differ', async () => {
    for (const provider of registry.providers) {
      const { code, out } = await run('query', '--engine', provider.id)
      expect(code).toBe(0)
      expect(out).toBe(provider.introspectionQuery())
    }
    // Not one query with an engine name substituted into it. If these ever
    // matched, the registry would be resolving to the same provider twice.
    expect(postgresProvider.introspectionQuery()).not.toBe(sqlserverProvider.introspectionQuery())
  })

  test('the query carries its own comments, which are the instructions', async () => {
    // dbmd import's truncation message points at this paragraph rather than
    // repeating it, so a run that printed the SQL without it would leave that
    // message pointing at nothing.
    const { out } = await run('query', '--engine', 'sqlserver')
    expect(out).toContain('BEFORE YOU COPY THE RESULT OUT OF SSMS')
    expect(out).toContain('2033-character pieces')
    expect(out).toContain('Save Results As')
  })

  test('it ends with a newline, so the SQL is a whole last line', async () => {
    const { out } = await run('query', '--engine', 'postgres')
    expect(out.endsWith('\n')).toBe(true)
  })

  test('the narration is on stderr, names the engine and counts the characters', async () => {
    const { out, err } = await run('query', '--engine', 'postgres')
    expect(err).toContain(postgresProvider.displayName)
    // The count is what lets somebody check that what they saved is all of it,
    // which is this feature's most likely support question.
    expect(err).toContain(`${out.length} characters`)
    expect(err).toContain('dbmd import --file')
  })

  test('the two streams do not overlap: stdout is the SQL, stderr is about it', async () => {
    // Asserted as equality rather than as a list of words stdout must not
    // contain, because the query is prose as well as SQL and shares most of its
    // vocabulary with the narration. A leak shows up here as a difference.
    const { out, err } = await run('query', '--engine', 'postgres')
    expect(out).toBe(postgresProvider.introspectionQuery())
    expect(err).not.toContain('SELECT')
    expect(err.length).toBeGreaterThan(0)
  })
})

describe('dbmd query --json', () => {
  test('the report is on stdout, the SQL is inside it, and stderr is empty', async () => {
    const { code, out, err } = await run('query', '--json', '--engine', 'sqlserver')
    expect(code).toBe(0)
    expect(err).toBe('')
    expect(JSON.parse(out)).toEqual({
      schema: 1,
      ok: true,
      engine: 'sqlserver',
      displayName: sqlserverProvider.displayName,
      characters: sqlserverProvider.introspectionQuery().length,
      sql: sqlserverProvider.introspectionQuery(),
    })
  })

  test('the raw SQL is not on stdout as well, because stdout carries one thing', async () => {
    // ADR 0011. A caller that parses stdout as JSON must not find a document in
    // front of it, and the way that bug arrives is printing the SQL and then
    // reporting.
    const { out } = await run('query', '--json', '--engine', 'postgres')
    expect(out.startsWith('{')).toBe(true)
    expect(() => JSON.parse(out) as unknown).not.toThrow()
  })

  test('a usage error is JSON too, with the same exit code the prose has', async () => {
    const text = await run('query')
    const json = await run('query', '--json')
    expect(json.code).toBe(text.code)
    expect(json.code).toBe(2)
    expect(json.err).toBe('')
    const parsed = JSON.parse(json.out) as { ok: boolean; error: { code: string; message: string } }
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('usage')
    expect(parsed.error.message).toContain('--engine')
  })
})

describe('dbmd query, told the wrong thing', () => {
  test('no --engine is a usage error that names the engines there are', async () => {
    const { code, out, err } = await run('query')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('--engine')
    for (const id of registry.ids) expect(err).toContain(id)
  })

  test('the missing --engine says why import does not need one', async () => {
    // The asymmetry is the question a reader asks, so it is answered where they
    // are looking rather than left for them to notice.
    const { err } = await run('query')
    expect(err).toContain('dbmd import')
    expect(err).toContain('reads the engine out of the file')
  })

  test('an engine nobody provides is a usage error naming the ones that exist', async () => {
    const { code, out, err } = await run('query', '--engine', 'mysql')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('mysql')
    for (const id of registry.ids) expect(err).toContain(id)
  })

  test('a model directory is refused rather than ignored', async () => {
    // Every other command takes one, so somebody will type one here, and a path
    // silently dropped is worse than a sentence saying there is nothing for it
    // to mean.
    const { code, out, err } = await run('query', '--engine', 'postgres', 'db-model')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('db-model')
    expect(err).toContain('takes no directory')
  })

  test('an unknown flag names the flag and points at the help', async () => {
    const { code, out, err } = await run('query', '--dir', 'db-model')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('unknown option "--dir"')
    expect(err).toContain('dbmd query --help')
  })

  test('an empty --engine is a usage error rather than a lookup for ""', async () => {
    const { code, err } = await run('query', '--engine', '')
    expect(code).toBe(2)
    expect(err).toContain('empty')
  })
})

describe('dbmd query resolves through the registry and nowhere else', () => {
  test('a build of test doubles prints their queries, engine names and all', async () => {
    // Neither of these is the real Postgres provider, and the command cannot
    // tell: the only thing it knows about an engine is what the registry it was
    // handed says. That is ADR 0007's seam, tested rather than asserted.
    const doubles = createRegistry([fakePostgresProvider, fakeSqlServerProvider])
    const { code, out, err } = await runAgainst(doubles, ['--engine', 'sqlserver'])
    expect(code).toBe(0)
    expect(out).toBe(`${fakeSqlServerProvider.introspectionQuery()}\n`)
    expect(err).toContain(fakeSqlServerProvider.displayName)
  })

  test('a build with no providers says so rather than crashing', async () => {
    // What a build with a provider removed looks like. `providers/index.ts` says
    // this has to stay survivable, and the message a user gets is the only way
    // that is visible.
    const empty = createRegistry([])
    const missing = await runAgainst(empty, [])
    expect(missing.code).toBe(2)
    expect(missing.err).toContain('no engine providers at all')

    const named = await runAgainst(empty, ['--engine', 'postgres'])
    expect(named.code).toBe(2)
    expect(named.err).toContain('no engine providers at all')
    expect(named.out).toBe('')
  })
})

describe('dbmd query in the CLI it belongs to', () => {
  test('the root help lists it, before import, because that is the order it is run in', async () => {
    const { out } = await run('--help')
    expect(out).toContain('query')
    expect(out.indexOf('\n  query')).toBeLessThan(out.indexOf('\n  import'))
  })

  test('its --help is on stdout and lists every engine the build has', async () => {
    const { code, out, err } = await run('query', '--help')
    expect(code).toBe(0)
    expect(err).toBe('')
    expect(out).toContain('Usage: dbmd query --engine <id>')
    for (const provider of registry.providers) {
      expect(out).toContain(provider.id)
      expect(out).toContain(provider.displayName)
    }
  })

  test('the help says the journey it is the first step of', async () => {
    const { out } = await run('query', '--help')
    expect(out).toContain('dbmd import')
    expect(out).toContain('dbmd check')
  })

  test('the error messages that send a user here name a command that exists', async () => {
    // The item, in one test. `src/import/contract.ts` tells a user to run
    // `dbmd query --engine <id>`, and until this command landed that was an
    // unknown command. Reading the instruction back out of the message and
    // running it is the only way that stays true.
    const { readEnvelope } = await import('../../src/import/contract.js')
    const result = readEnvelope({ hello: 'world' })
    const message = result.diagnostics.map((d) => d.message).join('\n')
    expect(message).toContain('dbmd query --engine')

    const { code, out } = await run('query', '--engine', registry.ids[0] as string)
    expect(code).toBe(0)
    expect(out.length).toBeGreaterThan(0)
  })
})
