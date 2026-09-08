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
 *
 * **The port it could not have.** The server binds and lets the error out, so
 * the seam is what this command does with a `listen` that rejected, and there
 * are two ways to reach it. A busy port is reached for real: a socket is opened
 * on an OS-assigned port and the command is pointed at that number, which is a
 * genuine `EADDRINUSE` from a genuine kernel and needs no fixed port and no
 * mock. The other refusals cannot be forced portably, because the gesture that
 * produces one is binding a privileged port and Windows has no such thing, so
 * `startStudio` is mocked for that one case, the way `test/cli/export.test.ts`
 * mocks `rename` and for the same reason. The mock passes through otherwise, so
 * everything else in this file is still driving the real server.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { main } from '../../src/cli/main.js'
import { UsageError } from '../../src/cli/command.js'
import { parseStudioArgs } from '../../src/cli/studio.js'
import { exampleShop, withCopy } from '../model/fixtures.js'
import { captureEnvironment, runCli, type Run } from './harness.js'

const fail = vi.hoisted(() => ({ startStudio: undefined as undefined | (() => unknown) }))

vi.mock('../../src/studio/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/studio/index.js')>()
  return {
    ...actual,
    startStudio: async (options: Parameters<typeof actual.startStudio>[0]) => {
      const thrown = fail.startStudio?.()
      if (thrown !== undefined) throw thrown
      return await actual.startStudio(options)
    },
  }
})

async function run(...argv: string[]): Promise<Run> {
  return await runCli(argv)
}

const temporaries: string[] = []

afterEach(async () => {
  fail.startStudio = undefined
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/**
 * A socket holding a port on loopback, and the port it got.
 *
 * The OS picks it, so this test does not have to, which is the same argument
 * `--port 0` makes for the studio itself: several checkouts run this suite at
 * once and a number written here would make them collide with each other rather
 * than with this socket.
 */
async function heldPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server: Server = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('the holding socket bound to something that is not a TCP address'))
        return
      }
      resolve(address.port)
    })
  })
  return {
    port,
    release: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

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

  test('the unknown flag is named even when a good flag was typed first', async () => {
    // The whole sentence, because the whole sentence is this project's: it used
    // to answer `unknown option "--no-open"` and then list --no-open as a flag
    // the command takes, which is the report test/cli/unknown-option.test.ts
    // exists for.
    const { code, out, err } = await run('studio', '--no-open', '--bogus')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toBe(
      'dbmd: unknown option "--bogus". "dbmd studio" takes an optional directory, ' +
        '--port and --no-open; run "dbmd studio --help".\n',
    )
  })

  /**
   * The reason clause, which is either this project's sentence or the one
   * `parseArgs` threw, without the tail every message here ends in.
   *
   * The three cases below are value problems rather than unknown flags, so the
   * clause is Node's own wording and this suite deliberately does not pin it:
   * that wording is not a contract, it has changed before, and CI runs two Node
   * versions. What is pinned is what this project promises about it, that the
   * flag it is about is the flag that was wrong, that nothing is called an
   * unknown option when nothing is one, and that it arrives as one line that
   * reads into the rest of the sentence.
   */
  function reasonOf(err: string): string {
    const tail = err.indexOf('. "dbmd studio" takes')
    return tail === -1 ? err : err.slice(0, tail)
  }

  /** One line, and it joins the tail with one full stop rather than two. */
  function readsAsOneSentence(err: string): void {
    expect(err.trimEnd()).not.toContain('\n')
    expect(err).not.toContain('..')
    expect(err).toContain('. "dbmd studio" takes an optional directory')
    expect(err).toContain('run "dbmd studio --help".\n')
  }

  test('--port with no value is about --port, and is not called an unknown option', async () => {
    const { code, out, err } = await run('studio', '--port')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(reasonOf(err)).toContain('--port')
    expect(err).not.toContain('unknown option')
    readsAsOneSentence(err)
  })

  test('--port -1 is about --port, not about the flag in front of it', async () => {
    // parseArgs reads "-1" as a dash token rather than as a value, so the error
    // is about --port having no argument. The old message called --no-open an
    // unknown option here, which was wrong twice over. Node says it over three
    // lines and ends on a full stop, which is why the sentence used to reach
    // the reader with ".." in the middle of it.
    const { code, out, err } = await run('studio', '--no-open', '--port', '-1')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(reasonOf(err)).toContain('--port')
    expect(reasonOf(err)).not.toContain('--no-open')
    expect(err).not.toContain('unknown option')
    readsAsOneSentence(err)
  })

  test('--no-open=yes is about --no-open taking no argument', async () => {
    const { code, out, err } = await run('studio', '--no-open=yes')
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(reasonOf(err)).toContain('--no-open')
    expect(err).not.toContain('unknown option')
    readsAsOneSentence(err)
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

describe('a port it cannot have', () => {
  test("a busy port is refused in this command's voice, and points at the default", async () => {
    const held = await heldPort()
    try {
      await withCopy(exampleShop, async (dir) => {
        const { code, out, err } = await run('studio', dir, '--no-open', '--port', `${held.port}`)
        expect(code).toBe(1)
        expect(out).toBe('')

        // The whole sentence, because the whole defect was that there was not
        // one: a test on the exit code alone passed before this landed.
        expect(err).toContain(`Could not start the studio: port ${held.port} is already taken.`)
        expect(err).toContain('Nothing was started')
        expect(err).toContain('"--port 0", the default, lets the operating system pick a free one.')

        // And the system's own words are still there, unreplaced.
        expect(err).toContain("The system's own words: listen EADDRINUSE")
        expect(err).toContain(`127.0.0.1:${held.port}`)
      })
    } finally {
      await held.release()
    }
  }, 20000)

  test('the busy port is JSON too, with a code a caller can branch on', async () => {
    const held = await heldPort()
    try {
      await withCopy(exampleShop, async (dir) => {
        const { code, out, err } = await run(
          'studio',
          '--json',
          dir,
          '--no-open',
          '--port',
          `${held.port}`,
        )
        expect(code).toBe(1)
        expect(err).toBe('')

        const report = JSON.parse(out) as {
          schema: number
          ok: boolean
          directory: string
          port: number
          error: { code: string; message: string }
        }
        expect(report.schema).toBe(1)
        expect(report.ok).toBe(false)
        expect(report.directory).toBe(dir)
        // The port that was asked for. `ok: false` is what says nothing was
        // bound, which is the difference from the same key on a clean stop.
        expect(report.port).toBe(held.port)
        expect(report.error.code).toBe('port-in-use')
        // The operating system's message, not a sentence written here.
        expect(report.error.message).toContain('EADDRINUSE')
        expect(report.error.message).toContain(`127.0.0.1:${held.port}`)
      })
    } finally {
      await held.release()
    }
  }, 20000)

  test('a refusal that is not a busy port offers no remedy it cannot check', async () => {
    // Shaped as Node shapes one: the message, the errno as a string, and the
    // call it came from. No numeric `errno`, because nothing reads it and the
    // number for EACCES differs between Linux and Windows, so writing one would
    // be inventing a fact this test does not have.
    fail.startStudio = () =>
      Object.assign(new Error('listen EACCES: permission denied 127.0.0.1:80'), {
        code: 'EACCES',
        syscall: 'listen',
        address: '127.0.0.1',
        port: 80,
      })

    await withCopy(exampleShop, async (dir) => {
      const { code, out, err } = await run('studio', dir, '--no-open', '--port', '80')
      expect(code).toBe(1)
      expect(out).toBe('')
      expect(err).toContain('Could not start the studio: the operating system refused port 80.')
      expect(err).toContain('clearing whatever it is refusing and running the command again')
      expect(err).toContain("The system's own words: listen EACCES: permission denied")

      // The busy-port advice would be wrong here: a port the machine will not
      // let this process have is not a port somebody else is holding, and ADR
      // 0083 is about not naming a cause that was not checked.
      expect(err).not.toContain('already taken')
      expect(err).not.toContain('--port 0')
    })
  })

  test('the refusal that is not a busy port is its own JSON code', async () => {
    fail.startStudio = () =>
      Object.assign(new Error('listen EADDRNOTAVAIL: address not available 127.0.0.1:8080'), {
        code: 'EADDRNOTAVAIL',
        syscall: 'listen',
        address: '127.0.0.1',
        port: 8080,
      })

    await withCopy(exampleShop, async (dir) => {
      const { code, out, err } = await run('studio', '--json', dir, '--no-open', '--port', '8080')
      expect(code).toBe(1)
      expect(err).toBe('')
      expect(JSON.parse(out)).toEqual({
        schema: 1,
        ok: false,
        directory: dir,
        port: 8080,
        error: {
          code: 'listen-failed',
          message: 'listen EADDRNOTAVAIL: address not available 127.0.0.1:8080',
        },
      })
    })
  })

  test("anything that is not listen refusing is still the entry point's to report", async () => {
    // The catch is `syscall === "listen"` and nothing wider, so a failure on
    // the way to the bind keeps the behaviour it had. This one is shaped like
    // a directory that could not be read, which is `Edits.open`'s to throw.
    fail.startStudio = () =>
      Object.assign(new Error("EACCES: permission denied, scandir 'db-model'"), {
        code: 'EACCES',
        syscall: 'scandir',
      })

    await withCopy(exampleShop, async (dir) => {
      const { code, out, err } = await run('studio', dir, '--no-open')
      expect(code).toBe(1)
      expect(out).toBe('')
      expect(err).toBe("dbmd: EACCES: permission denied, scandir 'db-model'\n")
    })
  })

  test('the help says what each exit code means', async () => {
    const { out } = await run('studio', '--help')
    expect(out).toContain('Exit codes:')
    expect(out).toContain('0   it served, and an interrupt stopped it')
    expect(out).toContain('1   there is no model directory there, or the port could not be bound')
    expect(out).toContain('2   the command line was wrong')
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
