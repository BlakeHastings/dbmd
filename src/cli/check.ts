/**
 * `dbmd check`: read the model, validate it, say what is wrong, and exit
 * non-zero when it matters.
 *
 * This is the command a team puts in CI, so the exit code is the contract and
 * the prose is a convenience. Nothing here decides what a problem *is*:
 * `readModel` (ADR 0008) says whether a file says what it claims to say,
 * `validate` (ADR 0017) says whether the files agree with each other, and both
 * hand back the one `Diagnostic` type (ADR 0014), which drops into the `--json`
 * envelope unaltered.
 *
 * What this file owns is the three things those records deliberately left to
 * it, and ADR 0020 is the argument for all three:
 *
 * 1. **When a run fails.** An error fails, a warning prints, `--strict`
 *    promotes. Severity is a fact about a diagnostic; stopping is a decision
 *    about a run, and it is made here and nowhere else.
 * 2. **A file that did not parse does not stop the run.** `readModel` never
 *    throws, and a file that failed to load is simply missing from the model,
 *    so the validator still runs over everything that did load. One broken file
 *    hiding the other nine is the failure this command exists to prevent.
 * 3. **How a list of diagnostics reads.** Grouped under the file they are in,
 *    named once, so four broken files are scanned rather than counted.
 */

import { parseArgs } from 'node:util'
import {
  locationText,
  sortDiagnostics,
  type Diagnostic,
  type DiagnosticLocation,
} from '../diagnostics.js'
import { readModel } from '../model/read.js'
import type { Model } from '../model/types.js'
import { validate } from '../model/validate.js'
import { EXIT_FAILURE, UsageError, usageProblem, type Command } from './command.js'
import type { Output, Palette } from './output.js'

/** Where a model lives when nobody says otherwise. The same default `dbmd init` writes. */
const DEFAULT_DIRECTORY = 'db-model'

export const checkCommand: Command = {
  name: 'check',
  summary: 'read the model, report every problem, and fail if any is an error',
  help: `Usage: dbmd check [directory] [options]

Read a model directory, check every file against the format and the files
against each other, and print what is wrong, grouped by the file it is in.

  directory   the model directory, defaulting to ${DEFAULT_DIRECTORY}

Options:
      --strict   treat warnings as errors, so any diagnostic at all fails

Exit codes:
  0   nothing, or nothing worse than a warning without --strict
  1   at least one error, or with --strict at least one warning
  2   the command line was wrong

A file that does not parse is reported and then skipped, and every other file
is still checked, so one broken file does not hide the rest.

Diagnostics are prose on stderr and the exit code is the answer a script reads.
--json puts them on stdout instead, sorted, with the same exit code: the codes
and severities there are documented in docs/format.md and are a contract.
`,
  run: runCheck,
}

async function runCheck(argv: readonly string[], out: Output): Promise<number> {
  const { directory, strict } = parseCheckArgs(argv)

  // Both halves, in one list, always. The reader's diagnostics are not a reason
  // to skip the validator: a model missing a table that failed to load still
  // has nine tables whose refs and indexes are worth an opinion, and the run
  // that reports one broken file and stops is the one that wastes a CI cycle.
  const { model, diagnostics: read } = await readModel(directory)
  const diagnostics = sortDiagnostics([...read, ...validate(model)])

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const failed = errors > 0 || (strict && warnings > 0)

  const rows = diagnostics.map((d) => row(d, directory))
  const files = new Set(rows.map((r) => r.heading)).size

  return out.report({
    code: failed ? EXIT_FAILURE : 0,
    text:
      rows.length === 0
        ? `${out.style.strong(directory)}: ${inventory(model)}, no problems.\n`
        : `${render(rows, out.style)}\n` +
          `${out.style.strong(directory)}: ${tally(errors, warnings, out.style)} ` +
          `across ${plural(files, 'file')}.\n` +
          (strict && warnings > 0 ? `--strict: warnings count as errors.\n` : ''),
    // The severities here are the ones the reader and the validator produced,
    // never the ones --strict would make of them. A severity is a fact about
    // the model and belongs to whoever found it; whether this run failed is
    // `ok` on the envelope, which is derived from the exit code, so a consumer
    // has both and they cannot disagree.
    json: { directory, strict, counts: { errors, warnings }, diagnostics },
  })
}

/** One diagnostic, split into the parts the layout needs. */
interface Row {
  /** The file it is in: printed once, above every row that shares it. */
  readonly heading: string
  /** Its own line, as text so that "no line" is a width rather than a case. */
  readonly line: string
  readonly severity: string
  readonly code: string
  readonly message: string
}

function row(d: Diagnostic, directory: string): Row {
  return { ...place(d.at, directory), severity: d.severity, code: d.code, message: d.message }
}

/**
 * A location split into the half a file shares and the half it does not.
 *
 * This is the branch ADR 0014 has in mind for a consumer that wants something a
 * location *affords* rather than only its text. A file location splits: the
 * path is a heading every diagnostic in that file sits under, and the line is
 * this one's alone. A document location does not split, so it is its own
 * heading with nothing left over, and `locationText` is the right way to spell
 * it. `dbmd check` reads a directory and so raises only file locations today;
 * `dbmd import` raises the other kind, and this is what it costs to be ready
 * for a mixed list rather than to be surprised by one.
 */
function place(at: DiagnosticLocation, directory: string): { heading: string; line: string } {
  if (at.in === 'document') return { heading: locationText(at), line: '' }
  // `.` is how the reader points at the model directory itself, which is what
  // it does when the directory is the thing that is wrong. A heading of "."
  // above "cannot read the model directory" is a riddle; the name the caller
  // typed is the answer to it.
  return {
    heading: at.path === '.' ? directory : at.path,
    line: at.line === undefined ? '' : String(at.line),
  }
}

/**
 * The rows, grouped under their file.
 *
 * The columns are as wide as the widest thing in the whole run rather than in
 * each block, so the severities line up down the terminal and a file with no
 * line numbers does not shift the block after it. `sortDiagnostics` has already
 * put every row for one file together, so a heading is printed whenever it
 * changes and grouping needs no map.
 */
function render(rows: readonly Row[], style: Palette): string {
  const lineWidth = Math.max(...rows.map((r) => r.line.length))
  const severityWidth = Math.max(...rows.map((r) => r.severity.length))

  const lines: string[] = []
  let heading: string | undefined
  for (const r of rows) {
    if (r.heading !== heading) {
      if (heading !== undefined) lines.push('')
      lines.push(style.strong(r.heading))
      heading = r.heading
    }
    // Padded before styling, because an escape code is characters that take no
    // width and `padEnd` cannot know that.
    const severity = r.severity === 'error' ? style.bad(r.severity) : r.severity
    const pad = ' '.repeat(severityWidth - r.severity.length)
    lines.push(
      `  ${r.line.padStart(lineWidth)}  ${severity}${pad}  ${r.message} ${style.faint(`(${r.code})`)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

/** What was read, so a clean run still says which model it was clean about. */
function inventory(model: Model): string {
  return (
    `${plural(model.tables.length, 'table')}, ` +
    `${plural(model.notes.length, 'note')}, ` +
    `${plural(model.groups.length, 'group')}`
  )
}

function tally(errors: number, warnings: number, style: Palette): string {
  const bad = style.bad(plural(errors, 'error'))
  if (errors === 0) return plural(warnings, 'warning')
  if (warnings === 0) return bad
  return `${bad} and ${plural(warnings, 'warning')}`
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** One optional positional and one flag. `parseArgs` with `strict` rejects the rest. */
function parseCheckArgs(argv: readonly string[]): {
  readonly directory: string
  readonly strict: boolean
} {
  const options = { strict: { type: 'boolean' } } as const
  let values: { strict?: boolean }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options,
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${usageProblem(error, argv, options)}. "dbmd check" takes an optional directory ` +
        `and --strict; run "dbmd check --help".`,
    )
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `"dbmd check" takes at most one directory, and got ${positionals.length}: ` +
        `${positionals.join(' ')}.`,
    )
  }

  return { directory: positionals[0] ?? DEFAULT_DIRECTORY, strict: values.strict === true }
}
