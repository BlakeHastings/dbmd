/**
 * `dbmd studio`, from the argument list to the interrupt.
 *
 * The server has its own suite; this one is about the join. Two things it is
 * pointed at in particular:
 *
 * **`--no-open` in both directions.** A suite that starts a server has to pass
 * `--no-open` every time, so a flag wired backwards is invisible to it. The
 * argument parse is therefore a pure function and is driven with the flag and
 * without it, which is the only place the default can be asserted without a
 * browser window opening on whoever is running the tests.
 *
 * **The interrupt.** `startStudio` installs no signal handler, deliberately, so
 * the handler is this command's and a test has to drive it. `process.emit` is
 * how a signal is delivered without one, and the assertion is that the command
 * returns and the port is free afterwards.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { main } from '../../src/cli/main.js'
import { UsageError } from '../../src/cli/command.js'
import { parseStudioArgs } from '../../src/cli/studio.js'
import { exampleShop, withCopy } from '../model/fixtures.js'
import { captureEnvironment, runCli, type Run } from './harness.js'

async function run(...argv: string[]): Promise<Run> {
  return await runCli(argv)
}

const temporaries: string[] = []

afterEach(async () => {
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** A path with nothing at it, inside a directory that exists. */
async function missingPath(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dbmd-studio-'))
  temporaries.push(parent)
  return join(parent, 'db-model')
}

describe('the arguments', () => {
  test('with nothing said, it is db-model, an OS-assigned port, and a browser', () => {
    expect(parseStudioArgs([])).toEqual({ dir: 'db-model', port: 0, open: true })
  })

  test('--no-open is the only thing that turns the browser off', () => {
    expect(parseStudioArgs(['--no-open']).open).toBe(false)
    expect(parseStudioArgs(['--port', '8080']).open).toBe(true)
    expect(parseStudioArgs(['some/model']).open).toBe(true)
  })

  test('a directory is a positional and a port is a number', () => {
    expect(parseStudioArgs(['some/model', '--port', '8080'])).toEqual({
      dir: 'some/model',
      port: 8080,
      open: true,
    })
  })

  test('a port that is not a number is a usage error rather than a NaN', () => {
    for (const value of ['banana', '8080abc', '-1', '65536', '80.5', '']) {
      expect(() => parseStudioArgs(['--port', value])).toThrow(UsageError)
    }
  })

  test('0 is a port, because it is the default rather than a mistake', () => {
    expect(parseStudioArgs(['--port', '0']).port).toBe(0)
  })
})

describe('dbmd studio, as a command', () => {
  test('the root help lists it', async () => {
    const { out } = await run('--help')
    expect(out).toContain('studio')
  })

  test('it has its own help, on stdout, naming both flags', async () => {
    const { code, out, err } = await run('studio', '--help')
    expect(code).toBe(0)
    expect(out).toContain('Usage: dbmd studio')
    expect(out).toContain('--port')
    expect(out).toContain('--no-open')
    expect(err).toBe('')
  })

  test('a bad port exits 2 and starts nothing', async () => {
    const { code, out, err } = await run('studio', '--port', 'banana')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('"--port" takes a number from 0 to 65535')
  })

  test('an unknown flag exits 2 in the same words init uses', async () => {
    const { code, err } = await run('studio', '--public')
    expect(code).toBe(2)
    expect(err).toContain('unknown option "--public"')
    expect(err).toContain('dbmd studio --help')
  })

  test('a directory that is not there is refused rather than served empty', async () => {
    const directory = await missingPath()
    const { code, out, err } = await run('studio', directory)
    expect(code).toBe(1)
    expect(out).toBe('')
    expect(err).toContain(`no model directory at ${directory}`)
    expect(err).toContain('dbmd init')
  })

  test('the refusal is JSON too, with the same exit code', async () => {
    const directory = await missingPath()
    const { code, out, err } = await run('studio', '--json', directory)
    expect(code).toBe(1)
    expect(err).toBe('')
    expect(JSON.parse(out)).toEqual({
      schema: 1,
      ok: false,
      directory,
      error: {
        code: 'no-model-directory',
        message: `there is no model directory at ${directory}`,
      },
    })
  })
})

describe('running until interrupted', () => {
  test('it serves, and an interrupt closes it and reports', async () => {
    await withCopy(exampleShop, async (dir) => {
      const { environment, written } = captureEnvironment()
      // Whatever the test runner has on SIGINT already, so that the wait below
      // is waiting for this command's listener rather than for that one.
      const before = process.listenerCount('SIGINT')
      const narrated = captureStderr()
      try {
        // No `--port`, so this is the default: the OS picks, and the line the
        // server narrates is the only way this test learns which port it got.
        const running = main(['studio', dir, '--no-open'], environment)
        const url = await urlOnce(narrated.text, before)
        narrated.restore()

        const answered = await fetch(new URL('api/model', url))
        expect(answered.status).toBe(200)

        process.emit('SIGINT', 'SIGINT')
        expect(await running).toBe(0)

        // The report, on stderr, naming the URL it was serving.
        expect(written.out).toBe('')
        expect(written.err).toContain('Stopped')
        expect(written.err).toContain(url)

        // And the port is nobody's any more.
        await expect(fetch(new URL('api/model', url))).rejects.toThrow()

        // The listener went with it: a command that ran and returned should
        // leave the process exactly as it found it.
        expect(process.listenerCount('SIGINT')).toBe(before)
      } finally {
        narrated.restore()
      }
    })
  }, 20000)
})

/**
 * The URL the server narrated, once it has also installed the signal handler.
 *
 * Both halves matter. The URL says the socket is bound, and the listener count
 * says the interrupt this test is about to send has somewhere to land, which is
 * otherwise a race between two microtasks that would fail once a month.
 */
async function urlOnce(text: () => string, listenersBefore: number): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const found = /http:\/\/127\.0\.0\.1:\d+\//.exec(text())
    if (found !== null && process.listenerCount('SIGINT') > listenersBefore) return found[0]
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`the studio never printed a URL. It said: ${text()}`)
}

/**
 * What `narrate` writes, captured.
 *
 * The server takes a `log` and this command deliberately does not pass one, so
 * that the URL goes where ADR 0011 sends narration. That leaves the real stream
 * as the only place to read it from, which is the same thing a script starting
 * the studio has to do.
 */
function captureStderr(): { text: () => string; restore: () => void } {
  let captured = ''
  const spy = vi.spyOn(process.stderr, 'write')
  spy.mockImplementation(((chunk: unknown) => {
    captured += typeof chunk === 'string' ? chunk : String(chunk)
    return true
  }) as unknown as typeof process.stderr.write)
  return { text: () => captured, restore: () => spy.mockRestore() }
}
