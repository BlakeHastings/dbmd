/**
 * What a subcommand is, and the one error the entry point treats specially.
 *
 * Adding a subcommand is writing one of these and putting it in the `COMMANDS`
 * array in `main.ts`. `--help` and the unknown-flag and unknown-command
 * messages then work for it without it doing anything, because they are the
 * entry point's job rather than each command's.
 */

import type { ParseArgsOptionsConfig } from 'node:util'
import type { Output } from './output.js'

export interface Command {
  /** The word the user types. `dbmd init`. */
  readonly name: string
  /** One line, shown against the name in the root `--help`. */
  readonly summary: string
  /** The whole of `dbmd <name> --help`, printed verbatim, newline-terminated. */
  readonly help: string
  /**
   * `argv` is everything after the command name, with the entry point's global
   * flags already dealt with. The number returned is the process exit code, so
   * a command that reports a problem returns non-zero from the same place it
   * printed it: ADR 0006's consequence about `--json` exiting 0 because
   * printing succeeded starts with the exit code being a value, not a side
   * effect somewhere else.
   *
   * `out` is the only way a command writes. It is passed in rather than
   * imported so that `--json`, `--no-color` and the terminal detection are
   * decided once, by the entry point, for every command including the ones that
   * do not exist yet. `out.report` returns the code, so the usual last line of
   * a command is `return out.report(...)` and the two output forms cannot end
   * up disagreeing about whether the run failed.
   */
  run(argv: readonly string[], out: Output): Promise<number>
}

/**
 * The user asked for something that is not a thing to ask for: an unknown
 * command, an unknown flag, an argument that is not a number.
 *
 * It is separate from an ordinary failure because it means something different
 * to the person reading the exit code. `2` is "you typed it wrong, nothing
 * happened"; `1` is "what you asked for was reasonable and it did not work".
 */
export class UsageError extends Error {
  override readonly name = 'UsageError'
}

/** Wrong invocation. */
export const EXIT_USAGE = 2
/** The command ran and could not do what was asked. */
export const EXIT_FAILURE = 1

/**
 * What was wrong with the command line, as the fragment each command's own
 * sentence reads on from: one line, and no full stop on the end, because every
 * caller writes `. "dbmd <command>" takes ...` after it.
 *
 * `options` is the object the caller handed `parseArgs`, passed rather than
 * described again so the two cannot come to disagree about what the command
 * takes, and `argv` is what it was handed with it.
 *
 * It lives here rather than beside one command because every command parses its
 * own flags and each one would otherwise write this paragraph again.
 */
export function usageProblem(
  error: unknown,
  argv: readonly string[],
  options: ParseArgsOptionsConfig,
): string {
  return offendingOption(argv, options) ?? asFragment(messageOf(error))
}

/**
 * The flag `parseArgs` objected to, phrased for the person who typed it, or
 * `undefined` when what went wrong is not a flag this command has never heard
 * of.
 *
 * `parseArgs` says "To specify a positional argument starting with a '-', place
 * it at the end of the command after '--'", which is true, is about a thing
 * nobody here is doing, reads as a suggestion to try it, and does not close its
 * own quote. The token is the useful half of what it knows, and it is
 * recoverable from the same arguments.
 *
 * Recoverable from the arguments, and only from the arguments. Until 2026-09-08
 * this took `argv` alone and returned the first token with a dash on it,
 * accepted or not, so "dbmd query --engine postgres --bogus" answered
 * `unknown option "--engine"` and then, in the same sentence, listed --engine
 * as a flag the command takes. What it needed was the option table, and the
 * table is not on the error: `Object.getOwnPropertyNames` on what `parseArgs`
 * throws is `stack`, `code` and `message`, nothing structured says which token
 * offended, and the message is prose Node is free to reword. A helper that
 * matched on the phrase "Unknown option" would go quietly wrong on a Node
 * upgrade rather than loudly, and CI runs two Node versions.
 *
 * The types in that table are what tell a mistyped flag from a value: `-1` in
 * "dbmd studio --port -1" is not an unknown option at all, it is the value
 * `parseArgs` refused to read for a `type: 'string'` option, and the error it
 * threw about it names --port already. A dash token anywhere else is a flag
 * this command has never heard of, and saying so is the whole job.
 */
function offendingOption(
  argv: readonly string[],
  options: ParseArgsOptionsConfig,
): string | undefined {
  // A cluster like "-qz" is one token here and two options to `parseArgs`, and
  // only the parser knows which half of it was refused. No command declares a
  // short today, so this is the door rather than the room.
  const clustersPossible = Object.values(options).some((option) => option.short !== undefined)
  let valueExpected = false

  for (const token of argv) {
    // Everything after a bare `--` is a positional, however it is spelled.
    if (token === '--') return undefined

    if (token.startsWith('--')) {
      const equals = token.indexOf('=')
      const name = equals === -1 ? token.slice(2) : token.slice(2, equals)
      const option = options[name]
      if (option === undefined) return `unknown option "--${name}"`
      // `parseArgs` never reads a `--token` as a value, so the only thing left
      // waiting is an option written without its own `=value`.
      valueExpected = equals === -1 && option.type === 'string'
      continue
    }

    if (token !== '-' && token.startsWith('-')) {
      if (valueExpected || clustersPossible) return undefined
      return `unknown option "${token}"`
    }

    valueExpected = false
  }
  return undefined
}

/**
 * A sentence, or three of them over three lines, as something that can be
 * followed by the rest of a sentence.
 *
 * `parseArgs` writes prose: "Option '--port' argument is ambiguous." and two
 * more lines under it. Every call site puts `. "dbmd studio" takes ...` after
 * whatever it is given, which was written for a fragment, so what reached the
 * reader was a doubled stop in the middle of a paragraph. Folding the lines and
 * dropping the last stop is done here rather than to the message itself because
 * this is about the shape of one sentence rather than about what Node said, and
 * it holds whatever Node says next.
 */
function asFragment(message: string): string {
  return message.replace(/\s+/g, ' ').trim().replace(/\.+$/, '')
}

/** What was thrown, as prose, for the case where it was not an `Error`. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
