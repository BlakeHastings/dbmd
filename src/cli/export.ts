/**
 * `dbmd export`: the model as a picture a reviewer can see without installing
 * anything.
 *
 * GitHub renders mermaid inside markdown, so a diagram committed beside the
 * model turns "the diff is the review" into something true for a developer who
 * does not read YAML. That is the whole of this command's reason to exist, and
 * `src/export/mermaid.ts` is where the diagram itself is decided.
 *
 * What this file owns is the three things around it, and ADR 0023 is the
 * argument for all three:
 *
 * 1. **It refuses a model that `dbmd check` would fail.** A model with an error
 *    in it is a model where something is missing or points nowhere, and a
 *    diagram drawn from it is wrong in a way its reader cannot see. Warnings
 *    are printed and do not stop it.
 * 2. **It writes between two markers and nothing else.** The rest of
 *    `README.md` is a place for a person to write, and a tool that reflowed it
 *    would be one nobody points at their repository twice.
 * 3. **It does not write a file it did not have to.** `writeModel` already has
 *    this property for the same reason: a tool that touches a file it did not
 *    need to touch puts noise in somebody's diff.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { sortDiagnostics } from '../diagnostics.js'
import { SECTION_BEGIN, SECTION_END, mermaidSection } from '../export/mermaid.js'
import { readModel } from '../model/read.js'
import { validate } from '../model/validate.js'
import { writeAtomically } from '../model/write.js'
import { EXIT_FAILURE, UsageError, messageOf, offendingOption, type Command } from './command.js'
import type { Output } from './output.js'

/** Where a model lives when nobody says otherwise. The same default `dbmd init` writes. */
const DEFAULT_DIRECTORY = 'db-model'

/** The file the diagram is written into, inside the model directory. */
const README = 'README.md'

/** Every format this command knows. One, and adding a second is its own work item. */
const FORMATS = ['mermaid'] as const
type Format = (typeof FORMATS)[number]

export const exportCommand: Command = {
  name: 'export',
  summary: 'write the model as a mermaid diagram GitHub will render',
  help: `Usage: dbmd export [directory] [options]

Write the model as a mermaid entity-relationship diagram, into
${DEFAULT_DIRECTORY}/${README}, between two HTML comment markers. GitHub renders
mermaid in markdown, so the diagram shows up in a pull request without anybody
installing anything.

  directory   the model directory, defaulting to ${DEFAULT_DIRECTORY}

Options:
      --format <name>   the diagram format. Only "mermaid", which is the default
      --stdout          print the generated section instead of writing the file

Everything between "${SECTION_BEGIN}" and "${SECTION_END}" is replaced on every
run and everything outside them is left alone, so the rest of that file is a
place to write. A file with neither marker gets the section appended; a file
with one of the pair and not the other, or with the closing one above the
opening one, is an error rather than a guess.

The file is not written at all when the diagram has not changed, so running
this in a loop leaves "git status" empty.

Exit codes:
  0   written, or already up to date
  1   the model has an error in it, or the file could not be written
  2   the command line was wrong

A model with an error is refused rather than drawn, because a diagram missing a
table that failed to load is wrong in a way its reader cannot see. Run
"dbmd check" to find out what is wrong. Warnings do not stop it.
`,
  run: runExport,
}

async function runExport(argv: readonly string[], out: Output): Promise<number> {
  const { directory, stdout } = parseExportArgs(argv, out.json)

  // Both halves, as `dbmd check` runs them, because the question here is the
  // same question: is this model completely known? A file that did not parse is
  // missing from the model rather than reported by it, so the reader's list and
  // the validator's list are one list, and either kind of error is a reason to
  // stop.
  const { model, diagnostics: read } = await readModel(directory)
  const diagnostics = sortDiagnostics([...read, ...validate(model)])
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors

  if (errors > 0) {
    return out.report({
      code: EXIT_FAILURE,
      text:
        `${out.style.bad('dbmd:')} ${out.style.strong(directory)} has ` +
        `${plural(errors, 'error')} in it, so there is nothing safe to draw.\n` +
        `Run "dbmd check ${directory}" to see them.\n`,
      json: {
        directory,
        counts: { errors, warnings },
        error: {
          code: 'model-has-errors',
          message: `${directory} has ${plural(errors, 'error')} in it`,
        },
      },
    })
  }

  const section = mermaidSection(model)
  const inventory = `${plural(section.tables, 'table')}, ${plural(section.relationships, 'relationship')}`

  if (stdout) {
    // ADR 0006 rule 1, in the sentence it is written with: "dbmd export
    // --stdout > diagram.md produces a diagram and no chatter". So there is no
    // narration here, not even a success line.
    out.data(section.text)
    return out.report({ code: 0, text: '', json: { directory, format: 'mermaid', stdout: true } })
  }

  const path = join(directory, README)
  const before = await currentText(path)
  let after: string
  try {
    after = splice(before, section.text)
  } catch (error) {
    if (error instanceof MarkersOutOfOrder) {
      return out.report({
        code: EXIT_FAILURE,
        text:
          `${out.style.bad('dbmd:')} ${out.style.strong(slashed(path))} has ${SECTION_END} ` +
          `above ${SECTION_BEGIN}, so export cannot tell which part of it is generated.\n` +
          `Move the closing marker below the opening one, or delete both and let the next run ` +
          `append a fresh section.\n`,
        json: {
          directory,
          format: 'mermaid',
          file: slashed(path),
          error: { code: 'markers-out-of-order', message: error.message },
        },
      })
    }
    if (!(error instanceof LonelyMarker)) throw error
    return out.report({
      code: EXIT_FAILURE,
      text:
        `${out.style.bad('dbmd:')} ${out.style.strong(slashed(path))} has ${error.found} and not ` +
        `${error.missing}, so export cannot tell which part of it is generated.\n` +
        `Add the missing marker, or delete the one that is there.\n`,
      json: {
        directory,
        format: 'mermaid',
        file: slashed(path),
        error: { code: 'markers-unbalanced', message: error.message },
      },
    })
  }

  const written = after !== before
  if (written) {
    try {
      // Through a temporary file and a rename, which is what lets the refusal
      // below say nothing was changed. `writeFile` truncates at open, so a
      // failure part way through the write would leave this file holding half a
      // diagram and none of the prose somebody wrote around it, under a message
      // promising the opposite. That is the same argument `writeModel` makes
      // for a model file, so it is the same function rather than a second one.
      await writeAtomically(slashed(path), path, after)
    } catch (error) {
      // ADR 0083, reaching the CLI: lead with the file the developer was
      // working on and keep the system's own words, because a read-only
      // attribute, an ACL, a lock, antivirus and a full disk all arrive here
      // and naming one of them would be wrong often enough to be worse than
      // the raw error. What can be said without guessing is which file, that
      // nothing was changed, and that clearing whatever the system is refusing
      // is the thing to do.
      //
      // The second line is that record's other half. Every failure this can
      // report happened to the temporary file or to the rename, so the system's
      // words always open with a name the reader has never seen, and the
      // sentence in front of them exists so that name is explained rather than
      // met cold. Trimming it out of the message was rejected there: the paths
      // are the only part that can say the write went to a network share.
      const message = messageOf(error)
      return out.report({
        code: EXIT_FAILURE,
        text:
          `${out.style.bad('dbmd:')} Could not write ${out.style.strong(slashed(path))}. ` +
          `Nothing was changed, so clearing whatever the system is refusing and running the ` +
          `command again is enough.\n` +
          `The write goes through a temporary file in the same directory, which is why the ` +
          `system names that one first: ${out.style.faint(message)}\n`,
        json: {
          directory,
          format: 'mermaid',
          file: slashed(path),
          error: { code: 'write-failed', message },
        },
      })
    }
  }

  return out.report({
    code: 0,
    text: written
      ? `Wrote ${out.style.strong(slashed(path))}: ${inventory}.\n`
      : `${out.style.strong(slashed(path))} is already up to date: ${inventory}.\n`,
    json: {
      directory,
      format: 'mermaid',
      file: slashed(path),
      written,
      tables: section.tables,
      relationships: section.relationships,
    },
  })
}

/**
 * The new file: everything outside the markers exactly as it was, and the
 * generated section between them.
 *
 * A file with neither marker has the section appended rather than being
 * replaced, because the prose already in it is somebody's and the first run of
 * this command is not the moment to decide it was in the way. Where they want
 * the diagram is then a matter of moving two comments.
 *
 * Bytes outside the markers are copied, line endings included, for the reason
 * `src/model/write.ts` gives about a body: this command does not know which
 * ending the file arrived with, and normalising one would be a diff nobody
 * asked for.
 */
function splice(before: string | undefined, section: string): string {
  if (before === undefined || before.trim() === '') return section

  const begin = before.indexOf(SECTION_BEGIN)
  // The closing marker that ends the section is the first one after the opening
  // one, so a file that has a stray closing marker above a well-formed pair
  // still has one unambiguous generated region and is spliced rather than
  // refused.
  const end = before.indexOf(SECTION_END, begin < 0 ? 0 : begin)
  if (begin < 0 && end < 0) return `${before.replace(/\n*$/, '')}\n\n${section}`
  if (begin < 0) throw new LonelyMarker(SECTION_END, SECTION_BEGIN)
  if (end < 0) {
    // Nothing closes the opening marker, and the two ways that happens are
    // different things to be told. A file that has the closing marker above the
    // opening one has both, so "add the missing marker" would be a lie to it.
    if (before.includes(SECTION_END)) throw new MarkersOutOfOrder()
    throw new LonelyMarker(SECTION_BEGIN, SECTION_END)
  }

  const head = before.slice(0, begin)
  const tail = before.slice(end + SECTION_END.length)
  // The section is newline-terminated and the closing marker took its own line
  // with it, so the newline that ended that line is dropped rather than doubled.
  return head + section + tail.replace(/^\r?\n/, '')
}

/**
 * Both markers, in the wrong order: the closing one above the opening one.
 *
 * It is a third state rather than a wording of `LonelyMarker`, because both of
 * that error's instructions are wrong for this file. It has both markers, so
 * there is no missing one to add, and deleting the one the message would name
 * as present leaves the other one behind and lands the reader in the opposite
 * error. It carries no fields: which marker is where is the whole of what
 * happened and the pair is only ever this way round.
 *
 * It stays an error rather than becoming a guess. A closing marker above an
 * opening one splits the file into two regions and nothing in it says which one
 * the developer meant to be generated, so writing into either is a rewrite of
 * somebody's prose. That is the property this command's file comment opens with.
 */
class MarkersOutOfOrder extends Error {
  override readonly name = 'MarkersOutOfOrder'
  constructor() {
    super(`the file has ${SECTION_END} above ${SECTION_BEGIN}`)
  }
}

/** One marker of the pair, with no partner. Its own type so the report can name both. */
class LonelyMarker extends Error {
  override readonly name = 'LonelyMarker'
  constructor(
    readonly found: string,
    readonly missing: string,
  ) {
    super(`the file has ${found} and not ${missing}`)
  }
}

async function currentText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * A path as the report prints it. `join` uses a backslash on Windows and the
 * same run on Linux would then print a different string for the same file,
 * which is ADR 0006 rule 4 about a machine rather than about a hash map.
 */
function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** One optional positional and two flags. `parseArgs` with `strict` rejects the rest. */
function parseExportArgs(
  argv: readonly string[],
  json: boolean,
): { readonly directory: string; readonly stdout: boolean } {
  let values: { format?: string; stdout?: boolean }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options: { format: { type: 'string' }, stdout: { type: 'boolean' } },
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${offendingOption(argv) ?? messageOf(error)}. "dbmd export" takes an optional directory, ` +
        `--format and --stdout; run "dbmd export --help".`,
    )
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `"dbmd export" takes at most one directory, and got ${positionals.length}: ` +
        `${positionals.join(' ')}.`,
    )
  }

  const format = values.format ?? 'mermaid'
  if (!isFormat(format)) {
    throw new UsageError(
      `unknown format "${format}". "dbmd export" writes ${FORMATS.map((f) => `"${f}"`).join(', ')}.`,
    )
  }

  const stdout = values.stdout === true
  // ADR 0011: stdout carries exactly one thing per run. `--stdout` puts the
  // document there and `--json` puts the report there, so asking for both is
  // asking for a stream that has to be split by guessing.
  if (stdout && json) {
    throw new UsageError(
      `--stdout and --json both write to stdout, so they cannot be used together. ` +
        `Use --stdout for the diagram, or --json for the report.`,
    )
  }

  return { directory: positionals[0] ?? DEFAULT_DIRECTORY, stdout }
}

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value)
}
