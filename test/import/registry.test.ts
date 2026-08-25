// The seam: a file chooses its own provider, and nothing outside
// `src/import/providers/` knows an engine by name.

import { describe, expect, it } from 'vitest'
import { createRegistry, resolveProvider } from '../../src/import/providers/index.js'
import { readEnvelope } from '../../src/import/contract.js'
import { formatDiagnostics } from '../../src/import/diagnostics.js'
import { readIntrospection } from '../../src/import/read.js'
import { fakePostgresProvider, fakeSqlServerProvider } from './fake-providers.js'

const twoEngines = createRegistry([fakeSqlServerProvider, fakePostgresProvider])

function envelope(engine: string) {
  const result = readEnvelope({ dbmdIntrospection: 1, engine, tables: [] })
  if (!result.ok) throw new Error('the fixture envelope should be readable')
  return result.value
}

describe('the registry', () => {
  it('sorts its ids however they were registered', () => {
    expect(twoEngines.ids).toEqual(['postgres', 'sqlserver'])
  })

  it('refuses two providers claiming the same engine, at construction', () => {
    expect(() => createRegistry([fakePostgresProvider, fakePostgresProvider])).toThrow(
      "two providers both claim the engine id 'postgres'",
    )
  })

  it('picks the provider the envelope names', () => {
    const result = resolveProvider(envelope('sqlserver'), twoEngines)
    expect(result.ok && result.value.id).toBe('sqlserver')
  })

  it('names the engines that do exist when it does not know the one asked for', () => {
    const result = resolveProvider(envelope('postgresql'), twoEngines)
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      "error $.engine [import/unknown-engine] no provider claims the engine 'postgresql', and this build knows postgres, sqlserver",
    ])
  })

  it('says so plainly when the build has no providers at all', () => {
    // Which is what a build with its providers removed looks like, so it is worth
    // a message rather than an empty list in a sentence.
    const none = createRegistry([])
    expect(none.ids).toEqual([])
    const result = resolveProvider(envelope('postgres'), none)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      "error $.engine [import/unknown-engine] no provider claims the engine 'postgres', and this build has no engine providers at all",
    ])
  })
})

describe('--engine, overriding what the file says', () => {
  const file = { dbmdIntrospection: 1, engine: 'postgres', tables: [] }

  it('is never silent', () => {
    const result = readIntrospection(file, { registry: twoEngines, engine: 'sqlserver' })
    expect(result.ok).toBe(true)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      "warning $.engine [import/engine-overridden] this file says it came from 'postgres' and --engine says 'sqlserver', so it is being read as 'sqlserver'",
    ])
    expect(result.ok && result.value.engine).toBe('sqlserver')
  })

  it('says nothing when it agrees with the file', () => {
    const result = readIntrospection(file, { registry: twoEngines, engine: 'postgres' })
    expect(result.diagnostics).toEqual([])
  })
})

describe('quoteIdentifier', () => {
  it('escapes whichever quote character the engine uses', () => {
    expect(fakePostgresProvider.quoteIdentifier('Order"s')).toBe('"Order""s"')
    expect(fakeSqlServerProvider.quoteIdentifier('Order]s')).toBe('[Order]]s]')
  })
})
