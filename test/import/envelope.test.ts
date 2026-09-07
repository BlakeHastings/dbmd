// The envelope is the only part of a pasted file dbmd reads before it knows which
// engine wrote it, so these are the messages a user is most likely to meet.

import { describe, expect, it } from 'vitest'
import { INTROSPECTION_VERSION, readEnvelope } from '../../src/import/contract.js'
import { formatDiagnostics } from '../../src/import/diagnostics.js'

describe('readEnvelope', () => {
  it('reads the two keys and hands the rest through untouched', () => {
    const result = readEnvelope({ dbmdIntrospection: 1, engine: 'postgres', tables: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.version).toBe(INTROSPECTION_VERSION)
    expect(result.value.engine).toBe('postgres')
    expect(result.value.body['tables']).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('names both versions when the file is older than this build', () => {
    const result = readEnvelope({ dbmdIntrospection: 0, engine: 'postgres', tables: [] })
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'error $.dbmdIntrospection [import/unsupported-version] this file says `dbmdIntrospection` 0 and this build of dbmd reads version 1; it was produced by an older dbmd, so re-run the query `dbmd query --engine <id>` prints with this build and import the JSON that returns',
    ])
  })

  it('names both versions when the file is newer than this build', () => {
    const result = readEnvelope({ dbmdIntrospection: 2, engine: 'postgres', tables: [] })
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'error $.dbmdIntrospection [import/unsupported-version] this file says `dbmdIntrospection` 2 and this build of dbmd reads version 1; it was produced by a newer dbmd, so upgrade dbmd, or re-run the query `dbmd query --engine <id>` prints with this build',
    ])
  })

  it('does not mistake some other JSON file for an introspection file', () => {
    const result = readEnvelope({ tables: ['orders'] })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'import/missing-field',
      'import/missing-field',
    ])
  })

  it('rejects a version that is not a number rather than coercing it', () => {
    const result = readEnvelope({ dbmdIntrospection: '1', engine: 'postgres' })
    expect(result.ok).toBe(false)
    expect(formatDiagnostics(result.diagnostics)).toEqual([
      'error $.dbmdIntrospection [import/wrong-type] `dbmdIntrospection` must be a whole number, got "1"',
    ])
  })

  it('rejects a whole file that is not an object', () => {
    for (const value of [null, 42, 'a string', [{ dbmdIntrospection: 1 }]]) {
      const result = readEnvelope(value)
      expect(result.ok).toBe(false)
      expect(result.diagnostics[0]?.code).toBe('import/not-an-object')
    }
  })

  it('treats an explicit null engine as an absent one, because FOR JSON omits nulls', () => {
    const withNull = readEnvelope({ dbmdIntrospection: 1, engine: null })
    const withoutKey = readEnvelope({ dbmdIntrospection: 1 })
    expect(withNull.diagnostics).toEqual(withoutKey.diagnostics)
  })
})
