/**
 * The entry point and `dbmd init`.
 *
 * The two streams are captured at the `Environment` the entry point is handed
 * rather than at `process.stdout`, so what these tests assert is which stream a
 * line was addressed to, which is the half of ADR 0006 rule 1 that a command
 * can get wrong. That the data stream really is file descriptor 1 is proven by
 * running the packed tarball, which is in the pull request rather than here: a
 * test that spawns a process can only test the source tree, and the source tree
 * is exactly what hides a broken `bin` mapping.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { exampleModel } from '../../src/cli/example.js'
import { readModel } from '../../src/model/read.js'
import { validate } from '../../src/model/validate.js'
import { writeModel } from '../../src/model/write.js'
import { runCli, type Run } from './harness.js'

async function run(...argv: string[]): Promise<Run> {
  return await runCli(argv)
}

const temporaries: string[] = []

/** A directory that does not exist yet, inside one that does. */
async function vacantPath(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dbmd-cli-'))
  temporaries.push(parent)
  return join(parent, 'db-model')
}

afterEach(async () => {
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('the entry point', () => {
  test('no arguments prints the usage to stdout and exits 0', async () => {
    const { code, out, err } = await run()
    expect(code).toBe(0)
    expect(out).toContain('Usage: dbmd <command>')
    expect(out).toContain('init')
    expect(err).toBe('')
  })

  test('--help and -h are the same as no arguments', async () => {
    const bare = await run()
    expect(await run('--help')).toEqual(bare)
    expect(await run('-h')).toEqual(bare)
  })

  test('--version prints the installed version to stdout and nothing else', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }

    const { code, out, err } = await run('--version')
    expect(code).toBe(0)
    expect(out).toBe(`${manifest.version}\n`)
    expect(err).toBe('')
  })

  test('an unknown command exits non-zero, on stderr, naming what was expected', async () => {
    const { code, out, err } = await run('validate')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('unknown command "validate"')
    expect(err).toContain('init')
  })

  test('an unknown global flag exits non-zero and says a command was expected', async () => {
    const { code, out, err } = await run('--quiet')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('unknown option "--quiet"')
    expect(err).toContain('init')
  })

  test('a command gets its own --help, on stdout', async () => {
    const { code, out, err } = await run('init', '--help')
    expect(code).toBe(0)
    expect(out).toContain('Usage: dbmd init')
    expect(out).toContain('db-model')
    expect(err).toBe('')
  })

  test('the root help documents the global flags and says where the two streams go', async () => {
    const { out } = await run('--help')
    expect(out).toContain('--json')
    expect(out).toContain('--no-color')
    expect(out).toContain('2>/dev/null')
  })
})

describe('dbmd init', () => {
  test('writes a model directory that reads back with no diagnostics', async () => {
    const directory = await vacantPath()

    const { code, out, err } = await run('init', directory)
    expect(code).toBe(0)
    expect(out).toBe('')
    expect(err).toContain(directory)

    const { model, diagnostics } = await readModel(directory)
    expect(diagnostics).toEqual([])
    // Both halves, because `dbmd check` is both halves. The reader's list alone
    // leaves the scaffold free to grow a `primary-key-missing` or a `group-empty`
    // and say so on every new user's first command, which is a validator
    // warning, exits 0, and moves nothing this test used to look at.
    expect(validate(model)).toEqual([])
    expect(model.name).toBe('example')
    expect(model.tables.map((table) => table.name)).toEqual(['accounts', 'api_keys'])
    expect(model.notes).toHaveLength(1)
  })

  test('what it wrote is already canonical, so writing the model back writes nothing', async () => {
    const directory = await vacantPath()
    await run('init', directory)

    const { written, skipped } = await writeModel(directory, exampleModel())
    expect(written).toEqual([])
    expect(skipped.every((skip) => skip.reason === 'unchanged')).toBe(true)
  })

  test('the example demonstrates a ref and carries its prose', async () => {
    const directory = await vacantPath()
    await run('init', directory)

    const text = await readFile(join(directory, 'tables', 'api_keys.md'), 'utf8')
    expect(text).toContain('ref: accounts.id')
    expect(text).toContain('Revoking a key does not delete its row')

    const { model } = await readModel(directory)
    expect(model.referencesTo.get('accounts')).toEqual([
      {
        from: { table: 'api_keys', column: 'account_id' },
        to: { table: 'accounts', column: 'id' },
      },
    ])
  })

  test('it narrates every file it wrote, on stderr, in a stable order', async () => {
    const first = await run('init', await vacantPath())
    const second = await run('init', await vacantPath())
    const lines = (text: string) => text.split('\n').filter((line) => line.startsWith('  '))

    expect(lines(first.err)).toEqual([
      '  _model.md',
      '  notes/there-are-no-passwords-here.md',
      '  tables/accounts.md',
      '  tables/api_keys.md',
    ])
    expect(lines(second.err)).toEqual(lines(first.err))
  })

  test('it refuses a directory that already has something in it', async () => {
    const directory = await vacantPath()
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'notes.txt'), 'mine\n', 'utf8')

    const { code, out, err } = await run('init', directory)
    expect(code).toBe(1)
    expect(out).toBe('')
    expect(err).toContain('is not empty')

    expect(await readdir(directory)).toEqual(['notes.txt'])
  })

  test('a path that is a file rather than a directory is refused as a file', async () => {
    const path = await vacantPath()
    await writeFile(path, 'mine\n', 'utf8')

    const { code, err } = await run('init', path)
    expect(code).toBe(1)
    // The wording is the whole assertion. This used to say the path was a
    // directory that was not empty, which was three false clauses about one
    // file, and the exit code was already 1 before that was true of anything.
    expect(err).toContain(`${path} is not a directory, so init has left it alone.`)
    expect(err).toContain('Move it aside, or give init a different directory.')
    expect(err).not.toContain('is not empty')
    expect(await readFile(path, 'utf8')).toBe('mine\n')
  })

  test('an empty file is not told that it is not empty', async () => {
    const path = await vacantPath()
    await writeFile(path, '', 'utf8')

    const { code, err } = await run('init', path)
    expect(code).toBe(1)
    expect(err).toContain(`${path} is not a directory`)
    expect(err).not.toContain('is not empty')
  })

  // The refusal for a file offers no advice a developer can follow twice and
  // still be refused, which the one before it did: it said to empty the file,
  // and emptying a file leaves a file.
  test('emptying the file does not turn the refusal into a run, and is not suggested', async () => {
    const path = await vacantPath()
    await writeFile(path, 'content\n', 'utf8')

    const first = await run('init', path)
    expect(first.err).not.toContain('Empty it')

    await writeFile(path, '', 'utf8')
    const second = await run('init', path)

    expect(second.code).toBe(1)
    expect(second.err).toBe(first.err)
  })

  // The counterfactual. Every clause of the older refusal is true of a real
  // directory with entries in it, including "Empty it", which does then work,
  // so that message stays exactly as it was for the case it was written for.
  test('a directory with entries in it keeps the refusal that was right about it', async () => {
    const directory = await vacantPath()
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'notes.txt'), 'mine\n', 'utf8')

    const refused = await run('init', directory)
    expect(refused.code).toBe(1)
    expect(refused.err).toContain(
      `${directory} already exists and is not empty, so init has left it alone.`,
    )
    expect(refused.err).toContain('Empty it, move it aside, or give init a different directory.')

    await rm(join(directory, 'notes.txt'))
    const emptied = await run('init', directory)

    expect(emptied.code).toBe(0)
    expect(await readdir(directory)).toContain('_model.md')
  })

  test('an existing empty directory is fine', async () => {
    const directory = await vacantPath()
    await mkdir(directory, { recursive: true })

    const { code } = await run('init', directory)
    expect(code).toBe(0)
    expect(await readdir(directory)).toContain('_model.md')
  })

  test('an unknown flag exits non-zero and writes nothing', async () => {
    const directory = await vacantPath()

    const { code, out, err } = await run('init', '--force', directory)
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('unknown option "--force"')
    expect(err).toContain('dbmd init --help')

    await expect(readdir(directory)).rejects.toThrow()
  })

  test('a second directory is a mistake worth naming', async () => {
    const { code, err } = await run('init', 'one', 'two')
    expect(code).toBe(2)
    expect(err).toContain('at most one directory')
  })
})

describe('dbmd init --json', () => {
  test('reports the directory and the files it wrote, sorted, and nothing on stderr', async () => {
    const directory = await vacantPath()

    const { code, out, err } = await run('init', '--json', directory)
    expect(code).toBe(0)
    expect(err).toBe('')
    expect(JSON.parse(out)).toEqual({
      schema: 1,
      ok: true,
      directory,
      files: [
        '_model.md',
        'notes/there-are-no-passwords-here.md',
        'tables/accounts.md',
        'tables/api_keys.md',
      ],
      // Everything the prose points at, the JSON points at too. An agent should
      // never have to read the text form to find out where the format is
      // written down.
      format: 'https://github.com/BlakeHastings/dbmd/blob/main/docs/format.md',
    })
  })

  test('the refusal is JSON too, with the same exit code the prose has', async () => {
    const directory = await vacantPath()
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'notes.txt'), 'mine\n', 'utf8')

    const text = await run('init', directory)
    const json = await run('init', '--json', directory)

    expect(json.code).toBe(text.code)
    expect(json.code).toBe(1)
    expect(json.err).toBe('')
    expect(JSON.parse(json.out)).toEqual({
      schema: 1,
      ok: false,
      directory,
      error: {
        code: 'directory-not-empty',
        message: `${directory} already exists and is not empty`,
      },
    })
  })

  test('a file gets its own code, so a caller is not told the directory was full', async () => {
    const path = await vacantPath()
    await writeFile(path, '', 'utf8')

    const text = await run('init', path)
    const json = await run('init', '--json', path)

    expect(json.code).toBe(text.code)
    expect(json.code).toBe(1)
    expect(JSON.parse(json.out)).toEqual({
      schema: 1,
      ok: false,
      directory: path,
      error: { code: 'not-a-directory', message: `${path} is not a directory` },
    })
  })

  test('a usage error is JSON too, so a caller never has to parse prose', async () => {
    const { code, out, err } = await run('init', '--json', '--force')
    expect(code).toBe(2)
    expect(err).toBe('')
    const parsed = JSON.parse(out) as { ok: boolean; error: { code: string; message: string } }
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('usage')
    expect(parsed.error.message).toContain('unknown option "--force"')
  })

  test('--json anywhere in the arguments means the same thing', async () => {
    const directory = await vacantPath()
    const { out } = await run('--json', 'init', directory)
    expect(JSON.parse(out)).toMatchObject({ ok: true, directory })
  })

  test('a token after -- is a positional, even one spelled like a global flag', async () => {
    const { code, out, err } = await run('init', '--', '--json', 'two')

    // Prose on stderr rather than JSON on stdout is the assertion: the `--json`
    // after the `--` reached the command as a directory name, which is what a
    // caller is asking for when they type it there.
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('at most one directory')
    expect(err).toContain('--json two')
  })
})
