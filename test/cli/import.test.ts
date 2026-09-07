/**
 * `dbmd import`.
 *
 * The exit code is the contract, as it is for every command here, so each test
 * asserts one. What is particular to this command is the three ways a run can be
 * wrong that are not the model's fault, and each of them has a test because each
 * of them is a sentence somebody reads at the worst moment:
 *
 * - the file is not JSON, which is the failure no provider can name because a
 *   provider never sees the characters, and which arrives in four shapes that
 *   want four different answers
 * - the directory already has a model in it, which is the other half of the
 *   command rather than a failure: a delta, printed, and written only once
 *   somebody has confirmed it
 * - the catalogue handed back a name no file can hold, which is a fact about the
 *   model and therefore a diagnostic naming the table rather than an exception
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { type Input, runImport } from '../../src/cli/import.js'
import { createOutput } from '../../src/cli/output.js'
import { captureEnvironment, runCli, type Run } from './harness.js'

const temporaries: string[] = []

afterEach(async () => {
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbmd-import-cli-'))
  temporaries.push(dir)
  return dir
}

const POSTGRES_FIXTURE = fileURLToPath(
  new URL('../import/fixtures/postgres-provider-raw.json', import.meta.url),
)
const SQLSERVER_FIXTURE = fileURLToPath(
  new URL('../import/fixtures/sqlserver-provider-raw.json', import.meta.url),
)

/** A minimal Postgres-shaped file, so a case is about one thing. */
function postgresFile(tables: readonly unknown[]): string {
  return JSON.stringify({ dbmdIntrospection: 1, engine: 'postgres', database: 'shop', tables })
}

function table(name: string, extra: Record<string, unknown> = {}): unknown {
  return {
    table_schema: 'public',
    table_name: name,
    columns: [{ column_name: 'id', format_type: 'bigint', not_null: true }],
    primary_key: { constraint_name: `${name}_pkey`, columns: ['id'] },
    indexes: [],
    foreign_keys: [],
    check_constraints: [],
    ...extra,
  }
}

/** Standard input as a value: what is on it, and whether a person is typing. */
function piped(text: string): Input {
  return { isTty: false, read: () => Promise.resolve(text) }
}

const TERMINAL: Input = {
  isTty: true,
  read: () => Promise.reject(new Error('a terminal must never be read from')),
}

/** `runImport` with its third argument, which `runCli` cannot supply. */
async function runWithStdin(argv: readonly string[], stdin: Input): Promise<Run> {
  const { environment, written } = captureEnvironment()
  const code = await runImport(
    argv,
    createOutput(environment, { json: false, noColor: true }),
    stdin,
  )
  return { code, out: written.out, err: written.err }
}

/**
 * Narration as one run of words.
 *
 * Every sentence `dbmd import` prints is wrapped to about 80 columns, so a
 * phrase asserted raw is partly an assertion about where a line happened to
 * break. dbmd-aud found that the hard way in `test/import/sqlserver.test.ts`,
 * where `/stopped early/` against the comment block went red on a rewrap and on
 * nothing else, which teaches people not to improve the paragraph. Flatten
 * first and a reflow is not a red build, while a deletion still is.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ')
}

describe('the happy path', () => {
  test('writes a model directory from a file and says what it wrote', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir])

    expect(run.code).toBe(0)
    // ADR 0006 rule 1: this command's answer is narration, so stdout is empty
    // and a pipe carrying something else is undisturbed.
    expect(run.out).toBe('')
    expect(run.err).toContain('Imported 4 tables from postgres')
    expect((await readdir(join(dir, 'tables'))).sort()).toEqual([
      'Order.md',
      'Tenant.md',
      'event.md',
      'order_line.md',
    ])
    expect(await readFile(join(dir, '_model.md'), 'utf8')).toContain('engine: postgres')
  })

  test('reads standard input, so a pipe works and nothing has to be saved first', async () => {
    const dir = join(await workspace(), 'db-model')
    const text = await readFile(SQLSERVER_FIXTURE, 'utf8')
    const run = await runWithStdin(['--dir', dir], piped(text))

    expect(run.code).toBe(0)
    expect(run.err).toContain('Imported 3 tables from sqlserver')
    // The awkward name dbmd-44 imported: legal everywhere, and written.
    expect(await readdir(join(dir, 'tables'))).toContain('Ledger [Entry].md')
  })

  test('checks clean afterwards, with nothing worse than an opinion about the database', async () => {
    const dir = join(await workspace(), 'db-model')
    expect((await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir])).code).toBe(0)

    const checked = await runCli(['check', dir, '--json'])
    expect(checked.code).toBe(0)
    const report = JSON.parse(checked.out) as { ok: boolean; counts: { errors: number } }
    expect(report.ok).toBe(true)
    expect(report.counts.errors).toBe(0)
  })

  test('--json puts the report on stdout and narrates nothing', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir, '--json'])

    expect(run.code).toBe(0)
    expect(run.err).toBe('')
    const report = JSON.parse(run.out) as {
      ok: boolean
      engine: string
      files: string[]
      counts: { tables: number; errors: number; warnings: number }
    }
    expect(report.ok).toBe(true)
    expect(report.engine).toBe('postgres')
    expect(report.counts).toEqual({ tables: 4, errors: 0, warnings: 0 })
    expect(report.files).toEqual([
      '_model.md',
      'tables/Order.md',
      'tables/Tenant.md',
      'tables/event.md',
      'tables/order_line.md',
    ])
  })
})

describe('nothing prompts, and nothing is written over', () => {
  test('a terminal on standard input with no --file is a usage error, not a wait', async () => {
    // `TERMINAL.read` rejects, so this passing at all is the assertion: the
    // command refused before it could sit there looking like it had hung.
    // A `UsageError` rather than a report, because `main` owns exit code 2.
    await expect(
      runWithStdin(['--dir', join(await workspace(), 'db-model')], TERMINAL),
    ).rejects.toThrow(/standard input is a terminal/)
  })

  test('a directory that is not empty is a delta, and nothing is written without --confirm', async () => {
    const dir = await workspace()
    await writeFile(join(dir, 'something.md'), 'not yours\n', 'utf8')

    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir])
    expect(run.code).toBe(1)
    expect(flat(run.err)).toContain('--confirm')
    // And it really did leave it alone. dbmd-42 replaced the refusal that used
    // to be here; what has not moved is that an unconfirmed run writes nothing.
    expect(await readdir(dir)).toEqual(['something.md'])
  })

  test('the unconfirmed run is a failure in --json, with a code a script can branch on', async () => {
    const dir = await workspace()
    await writeFile(join(dir, 'something.md'), 'not yours\n', 'utf8')

    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir, '--json'])
    expect(run.code).toBe(1)
    const report = JSON.parse(run.out) as { ok: boolean; error: { code: string } }
    expect(report.ok).toBe(false)
    expect(report.error.code).toBe('changes-not-confirmed')
  })

  test('a --dir that is a file is still refused, and says which of the two it is', async () => {
    const dir = await workspace()
    const file = join(dir, 'not-a-directory')
    await writeFile(file, 'a file\n', 'utf8')

    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', file, '--json'])
    expect(run.code).toBe(1)
    const report = JSON.parse(run.out) as { error: { code: string } }
    expect(report.error.code).toBe('not-a-directory')
  })
})

/**
 * A file that is not JSON, and which of the four it is.
 *
 * Until dbmd-aud every one of these got the same sentence, "the usual cause is a
 * paste that stopped early", and ADR 0041 measured that being wrong for both
 * documented routes at once: sqlcmd's row count makes the file too long at the
 * back, and psql's header makes it too long at the front. So each shape has a
 * test, and each test asserts the shape it is told rather than only that
 * something was said. ADR 0045 is the argument for reading the file's two ends
 * instead of the parser's position, and the header case below is the evidence
 * for it: that message carries no position at all.
 */
describe('a file that is not JSON', () => {
  const whole = postgresFile([table('orders')])

  /** What psql writes without -t: a header, a rule of dashes, then the value. */
  const withHeader = ` dbmd_introspection\n${'-'.repeat(20)}\n ${whole}\n(1 row)\n`
  /** What sqlcmd writes without SET NOCOUNT ON: the value, then a row count. */
  const withFooter = `${whole}\n\n(1 rows affected)\n`

  test('names a header in front of it, and no truncation, when the file has one', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(['--dir', dir], piped(withHeader))

    expect(run.code).toBe(1)
    expect(flat(run.err)).toContain('is not JSON')
    expect(flat(run.err)).toContain('does not begin with {')
    expect(flat(run.err)).toContain('nothing in it was truncated')
    expect(flat(run.err)).not.toContain('stopped early')
    // And this is the evidence for ADR 0045: on the case a position would settle
    // most cleanly, V8 reports the offending token and no position at all. If
    // this ever goes green the other way, the record is the thing to reread
    // rather than the assertion.
    const [parserMessage = ''] = run.err.split('\n')
    expect(parserMessage).not.toMatch(/position \d/)
  })

  test('names a footer after it, and no truncation, when the file has one', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(['--dir', dir], piped(withFooter))

    expect(run.code).toBe(1)
    expect(flat(run.err)).toContain('too long rather than too short')
    expect(flat(run.err)).toContain('nothing in it was truncated')
    expect(flat(run.err)).not.toContain('stopped early')
  })

  test('still names truncation where truncation is what happened', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(['--dir', dir], piped(whole.slice(0, whole.length - 40)))

    expect(run.code).toBe(1)
    expect(flat(run.err)).toContain('a paste that stopped early')
    // The engine's own query header is where the per-client fix lives. This
    // points at it and names no engine, because it has not read one yet.
    expect(flat(run.err)).toContain('comment above the query you ran')
    expect(flat(run.err)).not.toContain('SQL Server')
  })

  test('says so rather than guessing when both ends are right', async () => {
    // A client that breaks a long value across lines and writes a continuation
    // character into every break. Both ends are the right characters and the
    // damage is in the middle, which is the case nothing here can name, so the
    // message says where to look instead of inventing a cause.
    const dir = join(await workspace(), 'db-model')
    const broken = `${whole.slice(0, 30)}.\n${whole.slice(30)}`
    const run = await runWithStdin(['--dir', dir], piped(broken))

    expect(run.code).toBe(1)
    expect(flat(run.err)).toContain('both ends are right')
    expect(flat(run.err)).not.toContain('stopped early')
    expect(flat(run.err)).not.toContain('was truncated')
  })

  test('gives the shape of a correct file whichever of the four it is', async () => {
    // The one sentence a reader can act on without knowing which case they are
    // in, so it is in all four rather than in the one that ran out of answers.
    const dir = await workspace()
    for (const text of [withHeader, withFooter, whole.slice(0, 40), `${whole} ${whole}`]) {
      const run = await runWithStdin(['--dir', join(dir, 'db-model')], piped(text))
      expect(flat(run.err)).toContain('one value that begins { and ends }')
      expect(flat(run.err)).toContain('no row count under it and no padding round it')
    }
  })

  test('is a code and a cause in --json, so a caller does not parse the prose', async () => {
    const dir = join(await workspace(), 'db-model')
    const { environment, written } = captureEnvironment()
    const code = await runImport(
      ['--dir', dir],
      createOutput(environment, { json: true, noColor: true }),
      piped('{"dbmdIntrospection": 1, "engine": "post'),
    )
    expect(code).toBe(1)
    const report = JSON.parse(written.out) as { error: { code: string; likelyCause: string } }
    expect(report.error.code).toBe('input-not-json')
    expect(report.error.likelyCause).toBe('the paste stopped early')
  })

  test('carries the header case into --json too, and not as a truncation', async () => {
    const dir = join(await workspace(), 'db-model')
    const { environment, written } = captureEnvironment()
    const code = await runImport(
      ['--dir', dir],
      createOutput(environment, { json: true, noColor: true }),
      piped(withHeader),
    )
    expect(code).toBe(1)
    const report = JSON.parse(written.out) as { error: { likelyCause: string } }
    expect(report.error.likelyCause).toBe('a header in front of the JSON')
  })

  test('an empty paste says so rather than complaining about position 0', async () => {
    const run = await runWithStdin(['--dir', join(await workspace(), 'db-model')], piped('   \n'))
    expect(run.code).toBe(1)
    expect(run.err).toContain('there was nothing in standard input')
  })

  test('a byte-order mark on the front is not a parse failure', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(['--dir', dir], piped(`${String.fromCharCode(0xfeff)}${whole}`))
    expect(run.code).toBe(0)
  })
})

/**
 * The third place `file-unreadable` is raised, and the only one of the three a
 * test can reach without mocking a filesystem call: a `--file` that is not
 * there. The other two are in `src/model/read.ts` and are covered by
 * `test/model/unreadable.test.ts`, which had to mock `node:fs/promises` because
 * a permission is not a thing a test may set on two operating systems.
 *
 * Until dbmd-f3p none of the three had a test, so this one is not padding: it
 * is the same code, raised by a different module, whose message was built a
 * different way and said different things in text and in `--json`.
 */
describe('a --file that cannot be read', () => {
  test('names the file once and says why, rather than pasting the system error', async () => {
    const dir = join(await workspace(), 'db-model')
    const missing = join(await workspace(), 'not-here.json')
    const run = await runCli(['import', '--file', missing, '--dir', dir])

    expect(run.code).toBe(1)
    expect(run.err).toBe(`dbmd: ${missing} could not be read: no such file or directory (ENOENT)\n`)
    // What it used to say: `... could not be read: ENOENT: no such file or
    // directory, open '<the same path again>'`. Node's message is the right
    // thing to print for a parse error and the wrong thing here, because it
    // repeats the path and `--json` could not carry it at all.
    expect(run.err).not.toContain('ENOENT: no such file')
  })

  test('is the same sentence in --json, under file-unreadable', async () => {
    const dir = join(await workspace(), 'db-model')
    const missing = join(await workspace(), 'not-here.json')
    const { environment, written } = captureEnvironment()
    const code = await runImport(
      ['--file', missing, '--dir', dir],
      createOutput(environment, { json: true, noColor: true }),
      // `--file` is given, so standard input is never touched. This one throws
      // if that stops being true.
      TERMINAL,
    )

    expect(code).toBe(1)
    const report = JSON.parse(written.out) as { error: { code: string; message: string } }
    expect(report.error.code).toBe('file-unreadable')
    // The message used to stop at "could not be read", so a caller reading
    // `--json` was told that something failed and never told what.
    expect(report.error.message).toBe(
      `${missing} could not be read: no such file or directory (ENOENT)`,
    )
  })
})

describe('a name a file cannot hold', () => {
  const catalogue = postgresFile([table('Ledger: Entry'), table('orders')])

  test('is a diagnostic naming the table, and the rest of the model is still written', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(['--dir', dir], piped(catalogue))

    expect(run.code).toBe(1)
    expect(run.err).toContain('import/unsafe-name')
    expect(run.err).toContain('`Ledger: Entry`')
    // Not an exception three frames down with a path in it: the run finished,
    // said which table, and wrote everything it could. ADR 0026.
    expect(await readdir(join(dir, 'tables'))).toEqual(['orders.md'])
  })

  test('points at the row of the catalogue it came from', async () => {
    const dir = join(await workspace(), 'db-model')
    const { environment, written } = captureEnvironment()
    const code = await runImport(
      ['--dir', dir],
      createOutput(environment, { json: true, noColor: true }),
      piped(catalogue),
    )
    expect(code).toBe(1)
    const report = JSON.parse(written.out) as {
      diagnostics: { code: string; at: { in: string; jsonPath: string } }[]
    }
    expect(report.diagnostics.map((d) => d.code)).toEqual(['import/unsafe-name'])
    expect(report.diagnostics[0]?.at).toEqual({ in: 'document', jsonPath: '$.tables[0].name' })
  })
})

describe('a foreign key to a table the export does not contain', () => {
  test('is a warning, and no dangling ref reaches the file', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(
      ['--dir', dir],
      piped(
        postgresFile([
          table('orders', {
            columns: [
              { column_name: 'id', format_type: 'bigint', not_null: true },
              { column_name: 'customer_id', format_type: 'bigint', not_null: true },
            ],
            foreign_keys: [
              {
                constraint_name: 'orders_customer_id_fkey',
                columns: ['customer_id'],
                referenced_schema: 'public',
                referenced_table: 'customers',
                referenced_columns: ['id'],
                on_delete: 'a',
                on_update: 'a',
              },
            ],
          }),
        ]),
      ),
    )

    expect(run.code).toBe(0)
    expect(run.err).toContain('import/reference-not-exported')
    expect(run.err).toContain('`public.customers`')
    expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).not.toContain('ref:')
  })
})

/**
 * Re-importing over a model somebody has been writing in. dbmd-42, ADR 0050.
 *
 * The thing these tests are really about is the two files a re-import must not
 * open. Every case here hand-edits a body and a `layout:` first, the way a
 * person does, and then asserts that what came back out is the same bytes: an
 * assertion that the delta was right is worth much less than an assertion that
 * the paragraph is still there, because the second is the failure nobody
 * notices until it is in a commit.
 */
describe('re-importing over a model', () => {
  /** The four-table fixture, and one table edited the way a person edits one. */
  async function imported(): Promise<string> {
    const dir = join(await workspace(), 'db-model')
    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir])
    expect(run.code).toBe(0)
    return dir
  }

  /** A real paragraph in a body, and a table dragged somewhere it was not. */
  async function handEdited(dir: string): Promise<{ body: string; layout: string }> {
    const path = join(dir, 'tables', 'order_line.md')
    const text = await readFile(path, 'utf8')
    const body =
      '\nOne row per line on an order. `note` is what the picker in the warehouse\n' +
      'typed, and nothing reads it but a person.\n'
    await writeFile(path, text.slice(0, text.indexOf('---\n', 4) + 4) + body, 'utf8')

    const order = join(dir, 'tables', 'Order.md')
    const layout = 'layout: { x: 1180, y: 620 }'
    await writeFile(
      order,
      (await readFile(order, 'utf8')).replace('layout: { x: 40, y: 40 }', layout),
      'utf8',
    )
    return { body, layout }
  }

  /**
   * The same database one release later, as JSON: a table dropped, a type
   * widened, and a column dropped whose prose names it. All three of the
   * owner's cases in one file, so one delta shows the list as a user sees it.
   */
  async function nextRelease(): Promise<string> {
    const document = JSON.parse(await readFile(POSTGRES_FIXTURE, 'utf8')) as {
      tables: {
        table_name: string
        columns: { column_name: string; numeric_precision?: number; numeric_scale?: number }[]
        indexes: { index_name: string }[]
      }[]
    }
    document.tables = document.tables.filter((t) => t.table_name !== 'event')
    const line = document.tables.find((t) => t.table_name === 'order_line')
    if (line === undefined) throw new Error('the fixture has stopped holding order_line')
    const price = line.columns.find((c) => c.column_name === 'unit_price')
    if (price === undefined) throw new Error('the fixture has stopped holding unit_price')
    price.numeric_precision = 14
    price.numeric_scale = 4
    line.columns = line.columns.filter((c) => c.column_name !== 'note')
    line.indexes = line.indexes.filter((i) => i.index_name !== 'order_line_note_lower_idx')

    return await fileOf(JSON.stringify(document))
  }

  /** Some JSON, as a `--file` somewhere throwaway. */
  async function fileOf(text: string): Promise<string> {
    const path = join(await workspace(), 'introspection.json')
    await writeFile(path, text, 'utf8')
    return path
  }

  test('an unchanged database says so, writes nothing, and exits 0', async () => {
    const dir = await imported()
    const before = await readFile(join(dir, 'tables', 'Order.md'), 'utf8')

    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir])
    expect(run.code).toBe(0)
    expect(flat(run.err)).toContain('nothing to change')
    expect(await readFile(join(dir, 'tables', 'Order.md'), 'utf8')).toBe(before)
  })

  test('an unchanged database is a no-op with --confirm too, so a script can always pass it', async () => {
    const dir = await imported()
    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir, '--confirm'])
    expect(run.code).toBe(0)
    expect(flat(run.err)).toContain('nothing to change')
  })

  test("lists all three of the owner's cases in one delta and writes nothing", async () => {
    const dir = await imported()
    const { body, layout } = await handEdited(dir)
    const file = await nextRelease()

    const run = await runCli(['import', '--file', file, '--dir', dir])
    expect(run.code).toBe(1)

    const list = flat(run.err)
    expect(list).toContain('database table removed')
    expect(list).toContain('database column changed')
    expect(list).toContain('database column removed')
    // The type change proposes the database's type and says both sides.
    expect(list).toContain('`numeric(12,2)` in the file and `numeric(14,4)` in the database')
    // The removed column's prose is named and is not offered to be edited.
    expect(list).toContain('the prose will name a column that is not there')
    // Nothing was written, and that includes the file the list is about.
    expect(await readFile(join(dir, 'tables', 'order_line.md'), 'utf8')).toContain(body)
    expect(await readFile(join(dir, 'tables', 'Order.md'), 'utf8')).toContain(layout)
    expect((await readdir(join(dir, 'tables'))).sort()).toEqual([
      'Order.md',
      'Tenant.md',
      'event.md',
      'order_line.md',
    ])
  })

  test('--confirm makes the changes, and the prose and the coordinates survive', async () => {
    const dir = await imported()
    const { body, layout } = await handEdited(dir)
    const before = await readFile(join(dir, 'tables', 'Tenant.md'), 'utf8')
    const model = await readFile(join(dir, '_model.md'), 'utf8')

    const run = await runCli(['import', '--file', await nextRelease(), '--dir', dir, '--confirm'])
    expect(run.code).toBe(0)

    // The `only` set is doing its job: one file written out of four tables, one
    // deleted, and the ones nobody said anything about are byte-identical.
    const said = flat(run.err)
    expect(said).toContain('1 file written: tables/order_line.md')
    expect(said).toContain('1 file deleted: tables/event.md')
    expect(await readFile(join(dir, 'tables', 'Tenant.md'), 'utf8')).toBe(before)
    expect(await readFile(join(dir, '_model.md'), 'utf8')).toBe(model)

    // The schema moved.
    const line = await readFile(join(dir, 'tables', 'order_line.md'), 'utf8')
    expect(line).toContain('type: numeric(14,4)')
    expect(line).not.toContain('name: note')
    expect((await readdir(join(dir, 'tables'))).sort()).toEqual([
      'Order.md',
      'Tenant.md',
      'order_line.md',
    ])

    // And the two things a machine must never touch did not move.
    expect(line).toContain(body)
    expect(await readFile(join(dir, 'tables', 'Order.md'), 'utf8')).toContain(layout)
  })

  test('a table new to the database lands below what is placed and moves nothing', async () => {
    const dir = join(await workspace(), 'db-model')
    await runCli(['import', '--dir', dir, '--file', await fileOf(postgresFile([table('orders')]))])
    const placed = (await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).replace(
      'layout: { x: 40, y: 40 }',
      'layout: { x: 40, y: 300 }',
    )
    await writeFile(join(dir, 'tables', 'orders.md'), placed, 'utf8')

    const run = await runCli([
      'import',
      '--dir',
      dir,
      '--confirm',
      '--file',
      await fileOf(postgresFile([table('orders'), table('shipments')])),
    ])
    expect(run.code).toBe(0)
    expect(await readFile(join(dir, 'tables', 'orders.md'), 'utf8')).toBe(placed)
    expect(await readFile(join(dir, 'tables', 'shipments.md'), 'utf8')).toContain(
      'layout: { x: 40, y: 560 }',
    )
  })

  test('a pipe works, nothing prompts, and the flag is named on stderr', async () => {
    const dir = await imported()
    const document = await readFile(await nextRelease(), 'utf8')

    const run = await runWithStdin(['--dir', dir], piped(document))
    expect(run.code).toBe(1)
    // ADR 0006 rule 1: the whole delta is narration, so a pipe carrying
    // something else is undisturbed.
    expect(run.out).toBe('')
    expect(flat(run.err)).toContain('run the same command again with --confirm')
    // And it says the thing a pipe makes true and a --file does not.
    expect(flat(run.err)).toContain('the thing to run again is the whole pipeline')
    expect((await readdir(join(dir, 'tables'))).sort()).toContain('event.md')

    const confirmed = await runWithStdin(['--dir', dir, '--confirm'], piped(document))
    expect(confirmed.code).toBe(0)
    expect((await readdir(join(dir, 'tables'))).sort()).not.toContain('event.md')
  })

  test('the delta is in --json, item by item, with the same exit code', async () => {
    const dir = await imported()
    const run = await runCli(['import', '--file', await nextRelease(), '--dir', dir, '--json'])

    expect(run.code).toBe(1)
    const report = JSON.parse(run.out) as {
      ok: boolean
      reimport: boolean
      confirmed: boolean
      files: string[]
      removed: string[]
      changes: { kind: string; path: string; headline: string; detail: string[] }[]
      counts: { changes: number }
    }
    expect(report.ok).toBe(false)
    expect(report.reimport).toBe(true)
    expect(report.confirmed).toBe(false)
    expect(report.files).toEqual([])
    expect(report.removed).toEqual([])
    expect(report.changes.map((change) => change.kind).sort()).toEqual([
      'column-changed',
      'column-removed',
      'index-removed',
      'table-removed',
    ])
    expect(report.counts.changes).toBe(report.changes.length)
  })

  test('a model this cannot read is refused rather than read as a database that dropped it', async () => {
    const dir = await imported()
    // A table file that does not parse. The table is still there, with its
    // prose in it, and a delta computed over a model missing it would put
    // "database table removed" on the list about a file sitting on disk.
    await writeFile(join(dir, 'tables', 'Tenant.md'), 'no frontmatter here\n', 'utf8')

    const run = await runCli(['import', '--file', POSTGRES_FIXTURE, '--dir', dir, '--confirm'])
    expect(run.code).toBe(1)
    expect(flat(run.err)).toContain('holds a model this cannot read')
    expect(await readFile(join(dir, 'tables', 'Tenant.md'), 'utf8')).toBe('no frontmatter here\n')
  })
})

describe('the command line', () => {
  test('rejects a bare word, because it could be either of the two paths', async () => {
    const run = await runCli(['import', 'db-model'])
    expect(run.code).toBe(2)
    expect(run.err).toContain('--file')
    expect(run.err).toContain('--dir')
  })

  test('--engine overrides the file and never does it silently', async () => {
    const dir = join(await workspace(), 'db-model')
    const run = await runWithStdin(
      ['--dir', dir, '--engine', 'sqlserver'],
      piped(postgresFile([table('orders')])),
    )
    expect(run.err).toContain('import/engine-overridden')
  })

  test('is listed in the root help, so somebody can find it', async () => {
    const run = await runCli([])
    expect(run.out).toContain('import')
  })
})
