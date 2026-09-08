/**
 * `dbmd studio`: the local web view onto a model directory.
 *
 * This file is a join and deliberately has no opinions of its own. The server
 * is `startStudio` (ADR 0013), the command shape is `Command` plus one line in
 * `main.ts`'s `COMMANDS` (ADR 0012's house style), and everything printed goes
 * through `Output` (ADR 0011). A third opinion here would be the failure mode
 * rather than the feature.
 *
 * Two things it does own, because they are the caller's decision rather than
 * the server's:
 *
 * 1. **It does not print the URL.** `startStudio` narrates the line it bound,
 *    and with `--port 0` as the default that line is the only way anybody
 *    learns the real port. A second one printed from here would be a second
 *    thing to keep true.
 * 2. **It closes on an interrupt.** The server installs no signal handler on
 *    purpose, and there may be a debounced write that has not fired yet, which
 *    is somebody's work. `close()` flushes it and then stops listening.
 */

import { stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { EXIT_FAILURE, UsageError, messageOf, offendingOption, type Command } from './command.js'
import { startStudio, type StudioOptions } from '../studio/index.js'
import type { Output } from './output.js'

/** Where a model lives when nobody says otherwise. The same default `dbmd init` writes. */
const DEFAULT_DIRECTORY = 'db-model'

/** The signals a developer stops a foreground command with. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const

export const studioCommand: Command = {
  name: 'studio',
  summary: 'open the local web view onto a model directory',
  help: `Usage: dbmd studio [directory] [options]

Serve a model directory on loopback and open it in a browser. Every edit made
in the page is written back to the markdown, debounced, so the model on disk is
the state and "git diff" is what you changed.

It watches the directory while it runs, so editing a file in your editor is the
same feature seen from the other side: the page redraws from what you saved,
between your own edits rather than in the middle of one. If a file changes on
disk while the studio has an unwritten edit to it, or while the page is showing
a model the files have moved on from, the studio keeps the change on disk, drops
its own edit and says so in the page rather than writing over your work.

  directory       the model directory, defaulting to ${DEFAULT_DIRECTORY}

Options:
      --port N    the port to bind, defaulting to 0, which lets the OS pick
      --no-open   bind and print the URL, but do not open a browser

The URL it bound to is printed to stderr. With the default port that line is
the only way to learn the port, so do not discard stderr when a script starts
this. It listens on 127.0.0.1 only and there is no flag to change that.

It runs until interrupted. Ctrl-C flushes any edit still waiting to be written
and then stops listening.
`,
  run: runStudio,
}

async function runStudio(argv: readonly string[], out: Output): Promise<number> {
  const options = parseStudioArgs(argv)

  if (!(await isDirectory(options.dir))) {
    return out.report({
      code: EXIT_FAILURE,
      text:
        `${out.style.bad('dbmd:')} there is no model directory at ${options.dir}.\n` +
        `Run "dbmd init" to create one, or give studio the directory to open.\n`,
      json: {
        directory: options.dir,
        error: {
          code: 'no-model-directory',
          message: `there is no model directory at ${options.dir}`,
        },
      },
    })
  }

  // No `log`: the server defaults to `narrate`, which is this repository's one
  // answer to which stream a line goes to.
  const studio = await startStudio(options)
  const signal = await untilStopped()
  await studio.close()

  return out.report({
    code: 0,
    // Newline first, because the interrupt was typed at a prompt that has
    // `^C` on it and this line is the answer to it.
    text: `\nStopped ${out.style.strong(studio.url)} on ${signal}.\n`,
    json: { directory: options.dir, url: studio.url, port: studio.port, signal },
  })
}

/**
 * Everything the server needs, from what was typed. Pure, and exported for the
 * test that drives `--no-open` both ways.
 *
 * That test is the reason this is a function rather than four lines inside
 * `runStudio`: a boolean flag wired backwards is invisible to a suite that
 * passes `--no-open` every time, which is what any suite that starts a server
 * has to do.
 */
export function parseStudioArgs(argv: readonly string[]): StudioOptions & {
  readonly port: number
  readonly open: boolean
} {
  let values: { port?: string; 'no-open'?: boolean }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options: {
        // A string, then checked here: `parseArgs` has no number type, and
        // "--port banana" has to be a usage error rather than a NaN that binds
        // to whatever the OS makes of it.
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${offendingOption(argv, ['port', 'no-open']) ?? messageOf(error)}. "dbmd studio" takes an optional directory, ` +
        `--port and --no-open; run "dbmd studio --help".`,
    )
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `"dbmd studio" takes at most one directory, and got ${positionals.length}: ` +
        `${positionals.join(' ')}.`,
    )
  }

  return {
    dir: positionals[0] ?? DEFAULT_DIRECTORY,
    port: parsePort(values.port),
    open: values['no-open'] !== true,
  }
}

/**
 * A port number, or the refusal.
 *
 * 0 is not a mistake here, it is the default: it asks the OS for a free port,
 * which is what lets several worktrees run this at once.
 */
function parsePort(value: string | undefined): number {
  if (value === undefined) return 0
  // `Number` rather than `parseInt`, which reads "8080abc" as 8080 and would
  // bind a port the caller did not type. Its one lie is that the empty string
  // is 0, and `--port ""` is somebody's shell expanding a variable that was
  // not set, which is the case where silently taking a random port is worst.
  const port = value.trim() === '' ? Number.NaN : Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(
      `"--port" takes a number from 0 to 65535, and got "${value}". ` +
        `0, the default, lets the operating system pick a free one.`,
    )
  }
  return port
}

/**
 * Resolves with the signal that asked this to stop.
 *
 * `once` rather than `on`, so that a second Ctrl-C from somebody who is done
 * waiting removes the last listener and gets Node's default action, which is
 * the immediate exit they are asking for. The first one is given the chance to
 * flush a pending write.
 */
function untilStopped(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const listeners = new Map<NodeJS.Signals, () => void>()
    for (const signal of STOP_SIGNALS) {
      const listener = (): void => {
        for (const [other, registered] of listeners) process.off(other, registered)
        resolve(signal)
      }
      listeners.set(signal, listener)
      process.once(signal, listener)
    }
  })
}

/**
 * Whether there is a directory there at all.
 *
 * `readModel` turns an unreadable directory into a diagnostic and an empty
 * model rather than an error, which is right for a reader and wrong for this
 * command: `dbmd studio` typed in the wrong directory would otherwise open a
 * page showing an empty model, and an edit made in it would write files into a
 * directory nobody meant. Anything other than "not there" is thrown, because a
 * permission error is a fact about the machine and the entry point reports it.
 */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory()
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
}
