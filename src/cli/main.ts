/**
 * The entry point's logic, with the shebang and the exit left to `src/cli.ts`.
 *
 * There is no argument-parsing library here and there will not be one. The
 * surface is four commands and a handful of flags, `parseArgs` is in the
 * standard library, and this is a tool people run with `npx`, where install
 * time is a feature (AGENTS.md).
 *
 * Global flags are handled here rather than by each command, so that `--help`,
 * `--json`, `--no-color` and the message for an unknown flag are the same for
 * every command including the ones that do not exist yet. `parseArgs` has no
 * notion of subcommands, so the split is done by hand: the first word is the
 * command, everything after it belongs to the command, and a command's own
 * flags are parsed by the command.
 */

import { createRequire } from 'node:module'
import { EXIT_FAILURE, EXIT_USAGE, UsageError, type Command } from './command.js'
import { initCommand } from './init.js'
import {
  createOutput,
  processEnvironment,
  type Environment,
  type GlobalFlags,
  type Output,
  type Palette,
  type Report,
} from './output.js'

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
      --json      report on stdout as JSON instead of as prose on stderr
      --no-color  never colour the narration, whatever the terminal says

Data goes to stdout and narration goes to stderr, in every context, so
"dbmd <command> 2>/dev/null" is the quiet flag this CLI does not have.

Run "dbmd <command> --help" for one command.
`
}

/**
 * Run the CLI. The number returned is the process exit code.
 *
 * It returns rather than calling `process.exit`, because `process.exit` on a
 * pipe truncates whatever has not been flushed, which is the failure that looks
 * like a bug in the consumer.
 *
 * `environment` is a seam rather than a feature: the real one reads
 * `process.env` and the two streams, and a test hands in the combination of
 * `NO_COLOR` and terminal detection it wants to pin down.
 */
export async function main(
  argv: readonly string[],
  environment: Environment = processEnvironment(),
): Promise<number> {
  const { argv: rest, flags } = takeGlobalFlags(argv)
  const out = createOutput(environment, flags)
  try {
    return await dispatch(rest, out)
  } catch (error) {
    return out.report(failure(error, out.style))
  }
}

/**
 * Pull the flags that mean the same thing to every command out of the argument
 * list, wherever they appear, and hand the rest to the command.
 *
 * Everything after a bare `--` is left alone: that is the caller saying the
 * tokens after it are positional, and a file really can be named `--json`.
 */
function takeGlobalFlags(argv: readonly string[]): {
  readonly argv: string[]
  readonly flags: GlobalFlags
} {
  const rest: string[] = []
  let json = false
  let noColor = false
  let positionalsOnly = false

  for (const token of argv) {
    if (positionalsOnly) {
      rest.push(token)
    } else if (token === '--') {
      positionalsOnly = true
      rest.push(token)
    } else if (token === '--json') {
      json = true
    } else if (token === '--no-color') {
      noColor = true
    } else {
      rest.push(token)
    }
  }

  return { argv: rest, flags: { json, noColor } }
}

async function dispatch(argv: readonly string[], out: Output): Promise<number> {
  const first = argv[0]

  // Help and the version are documents the caller asked for rather than a
  // report about a run, so they are data, they go to stdout verbatim, and
  // `--json` does not change them: there is nothing there to structure. Help
  // printed because something was wrong is a different thing and is a report,
  // below.
  if (first === undefined || first === '--help' || first === '-h') {
    out.data(rootHelp())
    return 0
  }
  if (first === '--version' || first === '-v') {
    out.data(`${version()}\n`)
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
    out.data(command.help)
    return 0
  }
  return await command.run(rest, out)
}

/**
 * Anything that was thrown, as a report.
 *
 * A caller that always passes `--json` should never have to parse prose to
 * learn that it typed the command wrong, so a usage error is JSON too, with the
 * same exit code the text form has. `error.code` is the stable half: the
 * message is prose and ADR 0006 lets prose change wording.
 */
function failure(error: unknown, style: Palette): Report {
  const usage = error instanceof UsageError
  const message = error instanceof Error ? error.message : String(error)
  return {
    code: usage ? EXIT_USAGE : EXIT_FAILURE,
    text: `${style.bad('dbmd:')} ${message}\n`,
    json: { error: { code: usage ? 'usage' : 'failed', message } },
  }
}

function commandList(): string {
  return COMMANDS.map((command) => command.name).join(', ')
}
