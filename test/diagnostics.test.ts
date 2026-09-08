/**
 * The two producers of diagnostics, in one array.
 *
 * This is the test dbmd-13 exists for. The model reader and the import contract
 * used to have a `Diagnostic` each, converged on nearly the same shape by two
 * agents who could not see each other, and `dbmd check --json` would have had to
 * reconcile them at the point of printing. They are one type now (ADR 0014), and
 * the thing worth proving is not that the type compiles but that a consumer can
 * hold both at once, print both, and tell them apart without guessing.
 *
 * Nothing here is a fixture written to make a point. Both halves are real reads
 * of real bad input.
 */

import { describe, expect, test } from 'vitest'
import type { Environment, Payload } from '../src/cli/output.js'
import { createOutput } from '../src/cli/output.js'
import type { Diagnostic } from '../src/diagnostics.js'
import { formatDiagnostics, sortDiagnostics } from '../src/diagnostics.js'
import { readIntrospection } from '../src/import/read.js'
import { withModel } from './model/helpers.js'

/** A model file whose `type` YAML resolved to a boolean, which has a line. */
async function fromTheModelReader(): Promise<Diagnostic> {
  const { diagnostics } = await withModel({
    'tables/orders.md':
      '---\nkind: table\ntable: orders\ncolumns:\n  - name: flag\n    type: true\n---\n',
  })
  const only = diagnostics[0]
  if (only === undefined) throw new Error('expected a diagnostic')
  return only
}

/** A `views/` beside the model's own directories, which is a directory and has no lines. */
async function fromADirectory(): Promise<Diagnostic> {
  const { diagnostics } = await withModel({ 'views/orders.md': 'not a kind dbmd knows\n' })
  const only = diagnostics[0]
  if (only === undefined) throw new Error('expected a diagnostic')
  return only
}

/** An introspection file whose `tables` is an object, which has no lines. */
function fromTheImportContract(): Diagnostic {
  const result = readIntrospection({ dbmdIntrospection: 1, engine: 'postgres', tables: {} })
  const only = result.diagnostics[0]
  if (only === undefined) throw new Error('expected a diagnostic')
  return only
}

describe('one Diagnostic, two sources', () => {
  test('a file location carries a path and a line', async () => {
    const diagnostic = await fromTheModelReader()

    expect(diagnostic).toEqual({
      code: 'field-wrong-type',
      severity: 'error',
      at: { in: 'file', path: 'tables/orders.md', line: 6 },
      message: '`type` must be a string, but YAML read `true` as a boolean; quote it',
    })
  })

  test('a directory location carries a path and has no line to carry', async () => {
    const diagnostic = await fromADirectory()

    // `in: 'directory'` rather than `in: 'file'`, which is what this said until
    // ADR 0086 and is the thing `dbmd check` was counting as a file.
    expect(diagnostic).toEqual({
      code: 'unknown-kind-directory',
      severity: 'warning',
      at: { in: 'directory', path: 'views' },
      message: '`views/` is not a kind of object dbmd knows; its files are ignored',
    })
  })

  test('a document location carries a JSONPath and no line', () => {
    const diagnostic = fromTheImportContract()

    expect(diagnostic).toEqual({
      code: 'import/wrong-type',
      severity: 'error',
      at: { in: 'document', jsonPath: '$.tables' },
      message: '`tables` is not a list, so this is not what the Postgres query prints',
    })
  })

  test('they sort and print together, which is what --json will emit', async () => {
    const mixed = [await fromTheModelReader(), fromTheImportContract()]

    // A JSONPath starts with `$` and a model path starts with a file name, so
    // one comparator orders a mixed array without knowing there are two halves.
    expect(formatDiagnostics(mixed)).toEqual([
      'error $.tables [import/wrong-type] `tables` is not a list, so this is not what the Postgres query prints',
      'error tables/orders.md:6 [field-wrong-type] `type` must be a string, but YAML read `true` as a boolean; quote it',
    ])
    expect(sortDiagnostics([...mixed].reverse())).toEqual(sortDiagnostics(mixed))
  })

  test('a consumer tells them apart on `at.in`, and the type makes it ask', async () => {
    // This is the whole API for "where is it": one conditional, on `at.in`.
    // A consumer that wants to open an editor takes the first branch and is the
    // only one that can see `line`; nothing can reach `line` on the other two,
    // because a directory and a JSON document do not have one.
    const where = (d: Diagnostic): string =>
      d.at.in === 'file'
        ? `${d.at.path}${d.at.line === undefined ? '' : `:${d.at.line}`}`
        : d.at.in === 'directory'
          ? `${d.at.path}/`
          : d.at.jsonPath

    expect(
      [await fromTheModelReader(), await fromADirectory(), fromTheImportContract()].map(where),
    ).toEqual(['tables/orders.md:6', 'views/', '$.tables'])
  })

  test('a list of them is a `Payload`, so `--json` can carry it unaltered', async () => {
    const mixed = sortDiagnostics([await fromTheModelReader(), fromTheImportContract()])

    // The assignment is the assertion: `Payload` demands `JsonValue`, and a
    // TypeScript `interface` never gets the implicit index signature that
    // satisfies it. This is what makes `Diagnostic` a type alias rather than an
    // interface, and this line is what would fail if somebody changed it back.
    const payload: Payload = { diagnostics: mixed }

    const written: string[] = []
    const environment: Environment = {
      env: {},
      stdoutIsTty: false,
      stderrIsTty: false,
      writeOut: (text) => written.push(text),
      writeErr: () => {},
    }
    const output = createOutput(environment, { json: true, noColor: false })

    // Through the real writer, not a stand-in for it: this is the shape
    // `dbmd check --json` will put on stdout, envelope included.
    const code = output.report({ code: 1, text: '', json: payload })

    expect(code).toBe(1)
    expect(JSON.parse(written.join(''))).toEqual({
      schema: 1,
      ok: false,
      diagnostics: [
        {
          code: 'import/wrong-type',
          severity: 'error',
          at: { in: 'document', jsonPath: '$.tables' },
          message: '`tables` is not a list, so this is not what the Postgres query prints',
        },
        {
          code: 'field-wrong-type',
          severity: 'error',
          at: { in: 'file', path: 'tables/orders.md', line: 6 },
          message: '`type` must be a string, but YAML read `true` as a boolean; quote it',
        },
      ],
    })
  })
})
