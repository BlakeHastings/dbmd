/**
 * `dbmd init`: a model directory, with an example model in it.
 *
 * The files come out of `writeModel`, from the value in `example.ts`, rather
 * than out of a template. ADR 0012 has the argument; the short version is that
 * this repository has one thing that knows how a model file is spelled and a
 * scaffold is not allowed to be a second one.
 */

import { readdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { writeModel } from '../model/write.js'
import { EXIT_FAILURE, UsageError, type Command } from './command.js'
import { exampleModel } from './example.js'
import { writeErr } from './streams.js'

/** Where a model lives when nobody says otherwise. The README says so too. */
const DEFAULT_DIRECTORY = 'db-model'

export const initCommand: Command = {
  name: 'init',
  summary: 'create a model directory, with an example model in it',
  help: `Usage: dbmd init [directory]

Create a model directory and write an example model into it: two tables, a
sticky note, and the prose that says why they are the way they are. All of it
is meant to be read once and then replaced.

  directory   where to create it, defaulting to ${DEFAULT_DIRECTORY}

It refuses to write into a directory that already exists and is not empty,
because the files it writes are named after common tables and overwriting
somebody's model is not a thing to do by accident.
`,
  run: runInit,
}

async function runInit(argv: readonly string[]): Promise<number> {
  const directory = parseInitArgs(argv)

  if (!(await isVacant(directory))) {
    writeErr(
      `dbmd: ${directory} already exists and is not empty, so init has left it alone.\n` +
        `Empty it, move it aside, or give init a different directory.\n`,
    )
    return EXIT_FAILURE
  }

  const { written } = await writeModel(directory, exampleModel())
  writeErr(`Created ${directory}, ${written.length} files:\n`)
  for (const path of written) writeErr(`  ${path}\n`)
  writeErr(`\nRead _model.md first. It says what the rest of them are for.\n`)
  return 0
}

/**
 * One optional positional and no flags at all.
 *
 * `parseArgs` with `strict` is what rejects an unknown flag, which is a thing
 * the CLI has to do and not a thing worth a dependency: the whole surface is
 * four commands and a handful of flags.
 */
function parseInitArgs(argv: readonly string[]): string {
  let positionals: string[]
  try {
    ;({ positionals } = parseArgs({
      args: [...argv],
      options: {},
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${offendingOption(argv) ?? messageOf(error)}. "dbmd init" takes an optional directory ` +
        `and no flags; run "dbmd init --help".`,
    )
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `"dbmd init" takes at most one directory, and got ${positionals.length}: ` +
        `${positionals.join(' ')}.`,
    )
  }
  return positionals[0] ?? DEFAULT_DIRECTORY
}

/**
 * The flag `parseArgs` objected to, phrased for the person who typed it.
 *
 * `parseArgs` says "To specify a positional argument starting with a '-', place
 * it at the end of the command after '--'", which is true, is about a thing
 * nobody here is doing, and reads as a suggestion to try it. The token is the
 * useful half of what it knows, and it is recoverable from the same arguments.
 */
function offendingOption(argv: readonly string[]): string | undefined {
  const flag = argv.find((token) => token.startsWith('-') && token !== '-' && token !== '--')
  return flag === undefined ? undefined : `unknown option "${flag}"`
}

/**
 * Whether init may write here: nothing there at all, or an empty directory.
 *
 * `ENOTDIR` counts as occupied. `dbmd init README.md` has to refuse rather than
 * scatter a model around somebody's file, and a path that is not a directory is
 * not a directory this command is willing to make one.
 *
 * Anything else, a permission error most likely, is thrown: it is a fact about
 * the machine rather than about the model, and the entry point reports it.
 */
async function isVacant(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length === 0
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return true
    if (code === 'ENOTDIR') return false
    throw error
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
