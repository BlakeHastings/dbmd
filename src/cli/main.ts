/**
 * The entry point's logic, with the shebang and the exit left to `src/cli.ts`.
 *
 * There is no argument-parsing library here and there will not be one. The
 * surface is four commands and a handful of flags, `parseArgs` is in the
 * standard library, and this is a tool people run with `npx`, where install
 * time is a feature (AGENTS.md).
 *
 * Global flags are handled here rather than by each command, so that `--help`
 * and the message for an unknown flag are the same for every command including
 * the ones that do not exist yet. `parseArgs` has no notion of subcommands, so
 * the split is done by hand: the first word is the command, everything after it
 * belongs to the command, and a command's own flags are parsed by the command.
 */

import { createRequire } from 'node:module'
import { EXIT_FAILURE, EXIT_USAGE, UsageError, type Command } from './command.js'
import { initCommand } from './init.js'
import { writeErr, writeOut } from './streams.js'

/**
 * Every subcommand. Adding one is writing a `Command` and adding it here.
 *
 * `check`, `export` and `studio` are their own work items and land in this
 * array when they do.
 */
const COMMANDS: readonly Command[] = [initCommand]

/**
 * From the installed package's own `package.json`, so `--version` cannot
 * disagree with what npm installed. `../../` from both `src/cli/main.ts` and
 * `dist/cli/main.js`, which is the same depth on purpose.
 */
function version(): string {
  const require = createRequire(import.meta.url)
  const manifest = require('../../package.json') as { version: string }
  return manifest.version
}

function rootHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length))
  const commands = COMMANDS.map(
    (command) => `  ${command.name.padEnd(width)}   ${command.summary}`,
  ).join('\n')
  return `dbmd: your database model, in your repository, as markdown.

Usage: dbmd <command> [options]

Commands:
${commands}

Options:
  -h, --help      show this and exit
  -v, --version   print the version and exit

Run "dbmd <command> --help" for one command.
`
}

/**
 * Run the CLI. The number returned is the process exit code.
 *
 * It returns rather than calling `process.exit`, because `process.exit` on a
 * pipe truncates whatever has not been flushed, which is the failure that looks
 * like a bug in the consumer.
 */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await dispatch(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      writeErr(`dbmd: ${error.message}\n`)
      return EXIT_USAGE
    }
    writeErr(`dbmd: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT_FAILURE
  }
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const first = argv[0]

  // Help and the version are what the caller asked for, so they are data and
  // they go to stdout with a zero exit (ADR 0006 rule 1). Help printed because
  // something was wrong is a different thing and goes to stderr, below.
  if (first === undefined || first === '--help' || first === '-h') {
    writeOut(rootHelp())
    return 0
  }
  if (first === '--version' || first === '-v') {
    writeOut(`${version()}\n`)
    return 0
  }
  if (first.startsWith('-')) {
    throw new UsageError(`unknown option "${first}". Expected a command: ${commandList()}.`)
  }

  const command = COMMANDS.find((candidate) => candidate.name === first)
  if (command === undefined) {
    throw new UsageError(`unknown command "${first}". Expected one of: ${commandList()}.`)
  }

  const rest = argv.slice(1)
  if (rest.includes('--help') || rest.includes('-h')) {
    writeOut(command.help)
    return 0
  }
  return await command.run(rest)
}

function commandList(): string {
  return COMMANDS.map((command) => command.name).join(', ')
}
