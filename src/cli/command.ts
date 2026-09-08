/**
 * What a subcommand is, and the one error the entry point treats specially.
 *
 * Adding a subcommand is writing one of these and putting it in the `COMMANDS`
 * array in `main.ts`. `--help` and the unknown-flag and unknown-command
 * messages then work for it without it doing anything, because they are the
 * entry point's job rather than each command's.
 */

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
 * The flag `parseArgs` objected to, phrased for the person who typed it, or
 * `undefined` when nothing in `argv` is a flag this command has never heard of.
 *
 * `parseArgs` says "To specify a positional argument starting with a '-', place
 * it at the end of the command after '--'", which is true, is about a thing
 * nobody here is doing, and reads as a suggestion to try it. The token is the
 * useful half of what it knows, and it is recoverable from the same arguments.
 *
 * `accepted` is the option names the caller handed `parseArgs`, spelled the
 * same way and without their dashes, and it is the whole of what keeps this
 * honest: until 2026-09-08 this took `argv` alone and named the first token
 * with a dash on it, so "dbmd query --engine postgres --bogus" reported
 * `--engine` as unknown and then, in the same sentence, listed `--engine` as
 * the flag the command takes.
 *
 * The set is passed in rather than read off the error because the error has
 * nothing structured on it to read: `Object.getOwnPropertyNames` on what
 * `parseArgs` throws is `stack`, `code` and `message`, and the message is prose
 * that Node is free to reword. A helper that matched on the phrase "Unknown
 * option" would go quietly wrong on a Node upgrade rather than loudly, and CI
 * runs two Node versions.
 *
 * It speaks only about a `--long` token, which in strict mode `parseArgs` can
 * only have read as an option: one that is not in `accepted` is unknown, and
 * one that is in it never gets named here again. Every other shape stays
 * silent and the caller falls back to what `parseArgs` said, because a token
 * like the `-1` in "dbmd studio --port -1" is not an unknown option at all,
 * telling it apart from a mistyped short flag means re-implementing the parser,
 * and the error thrown about it already names the right flag.
 *
 * It lives here rather than beside one command because every command parses its
 * own flags and each one would otherwise write this paragraph again.
 */
export function offendingOption(
  argv: readonly string[],
  accepted: readonly string[],
): string | undefined {
  for (const token of argv) {
    // Everything after a bare `--` is a positional, however it is spelled.
    if (token === '--') return undefined
    if (!token.startsWith('--')) {
      if (token !== '-' && token.startsWith('-')) return undefined
      continue
    }
    const equals = token.indexOf('=')
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals)
    if (!accepted.includes(name)) return `unknown option "--${name}"`
  }
  return undefined
}

/** What was thrown, as prose, for the case where it was not an `Error`. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
