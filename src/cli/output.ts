/**
 * The output contract: the one module in the CLI that is allowed to write.
 *
 * ADR 0006 has four rules about what a caller sees, and they are the kind of
 * rule that is easy to state and easy to break by habit. `console.log` writes
 * to stdout, `console.error` writes to stderr, and on a terminal both look the
 * same, so narrating to stdout is a mistake nobody notices until it breaks
 * somebody's pipe. This module exists so that the rules are a property of the
 * code rather than a thing every command has to remember, and
 * `test/cli/output-contract.test.ts` is what keeps it the only writer.
 *
 * ADR 0011 is the argument. The one sentence to remember is that **stdout
 * carries exactly one thing per run**: a command's data, or its `--json`
 * report. Everything else, the text form of a report included, is narration
 * and goes to stderr, because ADR 0006 lets prose change wording in a patch
 * release and anything on stdout is a contract.
 */

/** Anything `JSON.stringify` round-trips. `undefined` is deliberately not here. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/**
 * A command's own fields in the `--json` form.
 *
 * `schema` and `ok` belong to the envelope, so the type refuses them rather
 * than letting a command quietly disagree with its own exit code.
 */
export type Payload = { readonly [key: string]: JsonValue } & {
  readonly schema?: never
  readonly ok?: never
}

/**
 * The version of the JSON contract, not of the package.
 *
 * ADR 0006 makes these shapes public API from the first release: adding a field
 * is fine, renaming one is breaking. This number is here before it is needed
 * because a consumer cannot start checking it later than we start emitting it.
 */
export const JSON_SCHEMA_VERSION = 1

/**
 * What a command has to say, in both forms, with the exit code they share.
 *
 * The code lives on the report rather than beside it because ADR 0006 names the
 * classic bug: `--json` exits 0 because printing succeeded. Here the text form,
 * the JSON form and the exit code come out of one value, so the two forms
 * cannot disagree about whether the command failed.
 */
export interface Report {
  /** The process exit code. `0` is success; `EXIT_FAILURE` and `EXIT_USAGE` are the others. */
  readonly code: number
  /** The human form, newline-terminated. Narration: it goes to stderr. */
  readonly text: string
  /** The machine form's command-specific fields. Wrapped in the envelope on the way out. */
  readonly json: Payload
}

/**
 * Narration styling, named for what it means rather than for what colour it is.
 *
 * These do not nest: each one ends with a reset, so a styled string inside
 * another loses the outer style from that point on. Style leaves, not
 * sentences.
 */
export interface Palette {
  /** Something went wrong. */
  bad(text: string): string
  /** A path or a name: the thing the reader is looking for in the line. */
  strong(text: string): string
  /** Detail that is worth printing and not worth reading twice. */
  faint(text: string): string
}

/** Everything the CLI writes goes through one of these. */
export interface Output {
  /** Whether `--json` was asked for. A command needs this only to skip work it will not print. */
  readonly json: boolean
  /** For narration. Never for data: stdout is bytes for another program. */
  readonly style: Palette
  /**
   * Data on stdout, verbatim: a document the caller asked for, such as `--help`
   * or an exported diagram. Not for narration and not for a report.
   */
  data(text: string): void
  /** Render a command's answer, in whichever form was asked for, and return its exit code. */
  report(report: Report): number
}

/**
 * The facts about the process that the contract reads, behind an interface so
 * that the interesting combinations are testable without spawning anything.
 *
 * Colour is three inputs to one decision and the bug is always in the
 * combination, so the combination has to be reachable from a test.
 */
export interface Environment {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdoutIsTty: boolean
  readonly stderrIsTty: boolean
  writeOut(text: string): void
  writeErr(text: string): void
}

/** The real one. The only place in `src/` that touches the process streams. */
export function processEnvironment(): Environment {
  return {
    env: process.env,
    stdoutIsTty: process.stdout.isTTY === true,
    stderrIsTty: process.stderr.isTTY === true,
    writeOut: (text) => {
      process.stdout.write(text)
    },
    writeErr: (text) => {
      process.stderr.write(text)
    },
  }
}

/**
 * One line of narration, for a caller that is not a command and has no
 * `Output`: `startStudio` takes a `log` and this is what it defaults to.
 *
 * It is here rather than where it is used because the point of this module is
 * that the choice of stream is made in one file. Narration on stderr is always
 * allowed; deciding for yourself which stream it goes to is not.
 */
export function narrate(line: string): void {
  process.stderr.write(`${line}\n`)
}

/** The global flags, parsed once by the entry point and handed here. */
export interface GlobalFlags {
  readonly json: boolean
  readonly noColor: boolean
}

/**
 * Whether to colour, in precedence order. Highest first:
 *
 * 1. `--no-color`, because somebody typed it and detection is the thing they
 *    are overriding.
 * 2. `NO_COLOR` set to anything other than the empty string (no-color.org: the
 *    value is not read, only its presence).
 * 3. `TERM=dumb`. A dumb terminal is a TTY and cannot render an escape code.
 * 4. Otherwise on when stdout is a terminal, which is ADR 0006's rule, **and**
 *    stderr is one too.
 *
 * The second half of rule 4 is not in ADR 0006 and is the difference between
 * `dbmd init 2> log.txt` capturing narration and capturing escape codes.
 * Narration is written to stderr, so stderr's own answer to "is a person
 * looking at this" has to count.
 */
export function colorEnabled(environment: Environment, flags: GlobalFlags): boolean {
  if (flags.noColor) return false
  const noColor = environment.env['NO_COLOR']
  if (noColor !== undefined && noColor !== '') return false
  if (environment.env['TERM'] === 'dumb') return false
  return environment.stdoutIsTty && environment.stderrIsTty
}

/**
 * The escape character, spelled rather than pasted. A literal escape byte in a
 * source file is invisible in every editor and survives no copy and paste.
 */
const ESC = String.fromCharCode(0x1b)
const RESET = `${ESC}[0m`
const BAD = `${ESC}[31m`
const STRONG = `${ESC}[1m`
const FAINT = `${ESC}[2m`

const PLAIN: Palette = {
  bad: (text) => text,
  strong: (text) => text,
  faint: (text) => text,
}

const COLOURED: Palette = {
  bad: (text) => `${BAD}${text}${RESET}`,
  strong: (text) => `${STRONG}${text}${RESET}`,
  faint: (text) => `${FAINT}${text}${RESET}`,
}

/** The `Output` for a run, given what the process looks like and what was typed. */
export function createOutput(environment: Environment, flags: GlobalFlags): Output {
  const style = colorEnabled(environment, flags) ? COLOURED : PLAIN
  return {
    json: flags.json,
    style,
    data(text) {
      environment.writeOut(text)
    },
    report(report) {
      if (flags.json) {
        environment.writeOut(`${JSON.stringify(envelope(report), null, 2)}\n`)
      } else if (report.text !== '') {
        environment.writeErr(report.text)
      }
      return report.code
    },
  }
}

/**
 * The envelope every `--json` answer arrives in.
 *
 * `ok` is derived from the exit code rather than asserted by the command, which
 * is the whole reason the exit code travels with the report: a caller can
 * branch on `ok` or on `$?` and get the same answer.
 */
function envelope(report: Report): JsonValue {
  return { schema: JSON_SCHEMA_VERSION, ok: report.code === 0, ...report.json }
}

/**
 * The one sort, for everything the CLI emits as a list. ADR 0006 rule 4.
 *
 * JavaScript's own string order, which is UTF-16 code-unit order: it is the
 * same on every machine and in every locale, which is exactly what
 * `localeCompare` is not. Equal keys keep the order they arrived in, because
 * `Array.prototype.sort` is specified to be stable, so a key that does not
 * distinguish two items leaves the caller's order showing through.
 */
export function sortedBy<T>(items: Iterable<T>, key: (item: T) => string = String): T[] {
  return [...items].sort((left, right) => {
    const a = key(left)
    const b = key(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}
