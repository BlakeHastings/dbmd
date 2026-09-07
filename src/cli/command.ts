/**
 * What a subcommand is, and the one error the entry point treats specially.
 *
 * Adding a subcommand is writing one of these and putting it in the `COMMANDS`
 * array in `main.ts`. `--help` and the unknown-flag and unknown-command
 * messages then work for it without it doing anything, because they are the
 * entry point's job rather than each command's.
 */

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
   */
  run(argv: readonly string[]): Promise<number>
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
