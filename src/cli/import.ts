/**
 * `dbmd import`: the JSON a developer pasted out of their own database client,
 * as a model directory.
 *
 * dbmd never connects to a database and never asks for a credential (ADR 0007).
 * A person runs the introspection query themselves, with whatever client they
 * already trust, and hands back the JSON it printed. This command is the other
 * end of that: it reads the file, or standard input so a pipe works, and writes
 * one markdown file per table through `writeModel`, which is the only thing in
 * this repository that knows how a model file is spelled (ADR 0012).
 *
 * What a table *becomes* is `src/import/model.ts`'s, so that those decisions are
 * testable without a filesystem. What this file owns is the four things around
 * it:
 *
 * 1. **The parse.** A provider never sees the raw text, so it cannot own the
 *    failure that arrives before there is a document at all: a file that is not
 *    JSON, because a client wrote a header above the value, a row count under it
 *    or because the copy stopped early. This is the call site that has the text,
 *    so this is where those are told apart, and told apart without knowing the
 *    engine, because sniffing one out of the characters would put an engine's
 *    name outside `src/import/providers/`. ADR 0045.
 * 2. **The two halves of the command**, which are one word apart on the command
 *    line and are not the same operation. Into an empty directory this writes a
 *    model. Over one that already holds a model, it computes a delta, prints it
 *    itemised, and writes nothing until `--confirm` says so. dbmd-42 asked for
 *    the second and ADR 0050 is what it decided; `src/import/delta.ts` owns
 *    what a change *is*, and this file owns when one is written.
 * 3. **Nothing prompts, and that is what makes `--confirm` a flag.** With no
 *    `--file` and a terminal on standard input there is nothing to read, and
 *    waiting would be a prompt with worse manners, so it is a usage error
 *    saying which flag supplies the answer. The confirmation of a delta is the
 *    same rule applied to a bigger question: the JSON is usually already on
 *    standard input, so there is no terminal left to ask at, and ADR 0006 rule
 *    2 says a command that needs a decision it does not have exits non-zero and
 *    names the flag that supplies it.
 * 4. **Turning a `WriteSkip` into a diagnostic.** A catalogue will hand you a
 *    table name a file cannot hold. The writer refuses it and says which object
 *    it was; ADR 0026 says the caller that built the model is the one that turns
 *    that into a diagnostic, and this is that caller.
 */

import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  errnoText,
  formatDiagnostics,
  hasErrors,
  inDocument,
  sortDiagnostics,
  type Diagnostic,
} from '../diagnostics.js'
import type { IntrospectionDocument } from '../import/contract.js'
import { deltaOf, type Delta, type DeltaItem } from '../import/delta.js'
import { modelFromIntrospection } from '../import/model.js'
import { readIntrospection } from '../import/read.js'
import { readModel } from '../model/read.js'
import type { Model } from '../model/types.js'
import { writeModel, type WriteSkip } from '../model/write.js'
import { EXIT_FAILURE, UsageError, messageOf, usageProblem, type Command } from './command.js'
import { sortedBy, type JsonValue, type Output, type Palette, type Report } from './output.js'

/** Where a model lives when nobody says otherwise. The same default `dbmd init` writes. */
const DEFAULT_DIRECTORY = 'db-model'

/** How the report spells "standard input", which is what a shell spells it too. */
const STDIN = '-'

/**
 * The byte-order mark "Save Results As" leaves on the front of a file in more
 * than one client, spelled rather than pasted: a literal one is invisible in
 * every editor, which is how it got into somebody's file in the first place.
 */
const BOM = String.fromCharCode(0xfeff)

/**
 * Where the introspection JSON comes from when it is not a file.
 *
 * A seam rather than a feature: a test hands in the text and the answer to "is
 * a person typing at this", which is a combination no suite can produce out of
 * the process it is itself running in.
 */
export interface Input {
  readonly isTty: boolean
  read(): Promise<string>
}

/** The real one. */
export function processStdin(): Input {
  return {
    isTty: process.stdin.isTTY === true,
    read: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
      return chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')
    },
  }
}

export const importCommand: Command = {
  name: 'import',
  summary: 'turn introspection JSON from your database into a model directory',
  help: `Usage: dbmd import [options]

Read the JSON printed by the introspection query for your engine and write a
model directory from it: one markdown file per table, and _model.md.

dbmd never connects to your database. You run the query yourself, with the
client you already trust, and hand back what it printed, so no credential and no
database driver is ever this tool's business.

Options:
      --file <path>    the JSON to read, defaulting to standard input
      --dir <path>     the model directory to write, defaulting to ${DEFAULT_DIRECTORY}
      --engine <id>    read the file as this engine, whatever it says it is
      --confirm        make the changes an import over an existing model lists

The file says which engine produced it, so there is nothing to remember and
nothing to be told wrong. --engine overrides that, and says so when it does.

With no --file this reads standard input until it ends, which is what makes
the pipe work and is also the one way this command can wait. On a terminal it
says so and stops rather than sitting there. A caller that starts it with a
pipe it is not going to write to gets no such warning and no such stop, and
either closes that pipe or passes --file.

Over a directory that already holds a model this is a re-import. It compares
what the database says against what the files say, prints every difference as
an itemised list naming the file it is about, and writes nothing. Read the
list, then run it again with --confirm to make exactly those changes. An
unchanged database prints one line and exits 0, so a re-import is safe in CI.

Prose bodies, layout coordinates and group membership are never touched by a
re-import, and a file no item on the list names is never opened. A column or a
table that goes takes no paragraph with it: the list says which paragraphs will
then name something that is not there, and you decide what they should say.

Tables land on a grid, in name order, and there is no auto layout: arrange them
once in "dbmd studio" and the drag is what writes the coordinates. A table new
to a re-import lands below everything already placed and moves nothing.

Exit codes:
  0   written, or nothing to change, with any warnings printed
  1   the file could not be read or imported, a re-import found changes and
      --confirm was not given, the model already there could not be read, or a
      table could not be written
  2   the command line was wrong

Every table gets a one-line body saying nobody has documented it yet. That line
is a prompt and it is the point: replace it with what the schema cannot say.
`,
  run: runImport,
}

/**
 * `stdin` is a defaulted third parameter rather than part of `Command.run`,
 * because it is this one command's business and every other command would
 * otherwise have to carry it. A `run` that takes an extra optional argument is
 * still a `run`, so `main` calls it with two and a test calls it with three.
 *
 * Exported for that third argument. Everything else about the command goes
 * through `runCli`, which is the shape every other command's tests use.
 */
export async function runImport(
  argv: readonly string[],
  out: Output,
  stdin: Input = processStdin(),
): Promise<number> {
  const { file, directory, engine, confirm } = parseImportArgs(argv)
  const source = file ?? STDIN
  // `-` is what a report calls standard input and what a shell calls it; prose
  // that says it out loud reads better in the one place a person is reading.
  const label = file ?? 'standard input'

  // ADR 0006: nothing prompts. With no --file and a terminal on standard input
  // this would sit there looking like it had hung, so it says which flag
  // answers the question and stops.
  //
  // A terminal and not a pipe, and ADR 0063 is why: a pipe nobody writes to
  // waits here too, and it is the same value as a pipe somebody is about to
  // write to slowly. Refusing it would refuse the documented default.
  if (file === undefined && stdin.isTty) {
    throw new UsageError(
      `"dbmd import" reads the introspection JSON from --file or from standard input, and ` +
        `standard input is a terminal, so there is nothing there to read. Pass --file, or ` +
        `pipe the JSON in; run "dbmd import --help".`,
    )
  }

  // Before anything is read, because a directory that cannot be written to is a
  // refusal whatever the file turns out to say, and being told that after
  // pasting a schema is a worse minute than being told it first. The model
  // already there is read here for the same reason: a re-import over a model
  // that does not parse cannot produce a truthful delta, and finding that out
  // before the paste is read is the difference between a refusal and a waste.
  const occupancy = await occupancyOf(directory)
  if (occupancy === 'not-a-directory') {
    const reason = `${directory} is a file rather than a directory`
    return out.report({
      code: EXIT_FAILURE,
      text:
        `${out.style.bad('dbmd:')} ${out.style.strong(directory)} is a file rather than a ` +
        `directory, so a model cannot be written there.\n` +
        `Pass --dir with somewhere a directory can go.\n`,
      json: { directory, source, error: { code: 'not-a-directory', message: reason } },
    })
  }

  let existing: Model | undefined
  if (occupancy === 'occupied') {
    const read = await readModel(directory)
    // Errors only. A warning is a model with something worth saying about it and
    // a delta over it is still true; an error means a file's contents are partly
    // unknown, and an unknown table reads from here as a table that is not
    // there, which is the one mistake this whole command is arranged to avoid.
    if (hasErrors(read.diagnostics)) {
      return out.report(unreadableModel(read.diagnostics, directory, source, out))
    }
    existing = read.model
  }

  const text = await sourceText(file, { source, label }, stdin, directory, out)
  if (!text.ok) return out.report(text.report)

  const parsed = parseJson(text.value, { source, label }, directory, out)
  if (!parsed.ok) return out.report(parsed.report)

  const read = readIntrospection(parsed.value, engine === undefined ? {} : { engine })
  if (!read.ok) {
    return out.report(refused(read.diagnostics, directory, { source, label }, out))
  }

  const built = modelFromIntrospection(read.value)

  if (existing !== undefined) {
    return await reimport({
      delta: deltaOf(existing, built.model),
      confirm,
      directory,
      source,
      stdinWasTheSource: file === undefined,
      engine: read.value.engine,
      document: read.value,
      found: [...read.diagnostics, ...built.diagnostics],
      out,
    })
  }

  const { written, skipped } = await writeModel(directory, built.model)

  const diagnostics = sortDiagnostics([
    ...read.diagnostics,
    ...built.diagnostics,
    ...unwritableNames(skipped, read.value),
  ])
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const files = sortedBy(written)
  // Counted from the files that exist rather than from the model, so a table
  // the writer refused is not claimed as imported in the same sentence that
  // does not list its file.
  const tables = files.filter((path) => path.startsWith('tables/')).length

  return out.report({
    code: errors > 0 ? EXIT_FAILURE : 0,
    text:
      `Imported ${plural(tables, 'table')} from ` +
      `${out.style.strong(read.value.engine)} into ${out.style.strong(directory)}, ` +
      `${plural(files.length, 'file')}:\n` +
      files.map((path) => `  ${out.style.faint(path)}\n`).join('') +
      (diagnostics.length === 0 ? '' : `\n${formatDiagnostics(diagnostics).join('\n')}\n`) +
      (errors === 0
        ? `\nRun "dbmd check ${directory}" to read it, and "dbmd studio ${directory}" to ` +
          `arrange it.\n` +
          `Every table body says nobody has documented it yet. That line is the prompt.\n`
        : `\n${out.style.bad('dbmd:')} ${plural(errors, 'error')}, so ${directory} is ` +
          `missing a table.\n` +
          `Empty it and import again once the export is one this can be written from.\n`),
    json: {
      directory,
      source,
      engine: read.value.engine,
      files,
      counts: { tables, errors, warnings },
      diagnostics,
    },
  })
}

// --------------------------------------------------------------------------
// The re-import: the delta, the list, and the one flag that writes it
// --------------------------------------------------------------------------

interface Reimport {
  readonly delta: Delta
  readonly confirm: boolean
  readonly directory: string
  readonly source: string
  /** Whether the JSON came off standard input, which decides one sentence. */
  readonly stdinWasTheSource: boolean
  readonly engine: string
  readonly document: IntrospectionDocument
  /** What reading and building the document had to say, before anything is written. */
  readonly found: readonly Diagnostic[]
  readonly out: Output
}

/**
 * An import over a directory that already holds a model.
 *
 * Three answers, and they are the whole of the contract a script reads:
 *
 * - **Nothing to change.** One line, exit 0, nothing written. Re-importing an
 *   unchanged database is a no-op that is safe to leave in CI.
 * - **Changes, and nobody has confirmed them.** The itemised list, exit 1,
 *   nothing written, and the flag named. ADR 0006 rule 2 is why this is not a
 *   question asked at a terminal: the JSON is usually already on standard
 *   input, so there is no terminal left to ask at, and a command that needs a
 *   decision it does not have exits non-zero and says which flag supplies it.
 * - **Changes, and `--confirm`.** Exactly the files the list named, and nothing
 *   else opened.
 */
async function reimport(run: Reimport): Promise<number> {
  const { delta, directory, source, engine, out } = run

  if (delta.items.length === 0) {
    const diagnostics = sortDiagnostics([...run.found])
    return out.report({
      code: 0,
      text:
        `${out.style.strong(directory)} already says what this ${out.style.strong(engine)} ` +
        `import says: ${plural(delta.model.tables.length, 'table')}, nothing to change.\n` +
        (diagnostics.length === 0 ? '' : `\n${formatDiagnostics(diagnostics).join('\n')}\n`),
      json: {
        directory,
        source,
        engine,
        reimport: true,
        confirmed: false,
        changes: [],
        files: [],
        removed: [],
        counts: { changes: 0, errors: 0, warnings: diagnostics.length },
        diagnostics,
      },
    })
  }

  if (!run.confirm) {
    const diagnostics = sortDiagnostics([...run.found])
    const reason = `${plural(delta.items.length, 'change')} in ${directory} were not confirmed`
    return out.report({
      code: EXIT_FAILURE,
      text:
        `Re-importing ${out.style.strong(directory)} from ${out.style.strong(engine)} would ` +
        `make ${plural(delta.items.length, 'change')}:\n\n` +
        `${itemised(delta.items, out.style)}` +
        (diagnostics.length === 0 ? '' : `\n${formatDiagnostics(diagnostics).join('\n')}\n`) +
        `\n${out.style.bad('dbmd:')} nothing has been written, because nothing above has ` +
        `been confirmed.\n` +
        `Read the list, then run the same command again with ${out.style.strong('--confirm')}\n` +
        `to make exactly those changes.\n` +
        (run.stdinWasTheSource
          ? `The JSON came from standard input and has been read, so the thing to run again\n` +
            `is the whole pipeline.\n`
          : '') +
        `Prose bodies, layout and group membership are not touched either way.\n`,
      json: {
        directory,
        source,
        engine,
        reimport: true,
        confirmed: false,
        changes: delta.items.map(asJson),
        files: [],
        removed: [],
        counts: { changes: delta.items.length, errors: 0, warnings: diagnostics.length },
        diagnostics,
        error: { code: 'changes-not-confirmed', message: reason },
      },
    })
  }

  // `only` is the point of the whole feature. Every path in it is one an item on
  // the list named, so a table nobody said anything about is not opened, and the
  // paragraph somebody wrote into it this morning is not at risk from a command
  // that was told to look at a different table.
  const { written, skipped } = await writeModel(directory, delta.model, { only: delta.write })

  // `writeModel` deliberately does not delete, so this does, and only against
  // the list the user has just read. `force`, because a file the reader saw and
  // the filesystem no longer has is not worth stopping a confirmed run for.
  for (const path of delta.remove) {
    await rm(join(directory, ...path.split('/')), { force: true })
  }

  const diagnostics = sortDiagnostics([...run.found, ...unwritableNames(skipped, run.document)])
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const files = sortedBy(written)

  return out.report({
    code: errors > 0 ? EXIT_FAILURE : 0,
    text:
      `Re-imported ${out.style.strong(directory)} from ${out.style.strong(engine)}, ` +
      `${plural(delta.items.length, 'change')}:\n\n` +
      `${itemised(delta.items, out.style)}` +
      `\n${plural(files.length, 'file')} written:\n` +
      files.map((path) => `  ${out.style.faint(path)}\n`).join('') +
      (delta.remove.length === 0
        ? ''
        : `${plural(delta.remove.length, 'file')} deleted:\n` +
          delta.remove.map((path) => `  ${out.style.faint(path)}\n`).join('')) +
      (diagnostics.length === 0 ? '' : `\n${formatDiagnostics(diagnostics).join('\n')}\n`) +
      (errors === 0
        ? `\nEvery other file in ${out.style.strong(directory)} was left exactly as it was.\n` +
          `Read what changed with "git diff".\n`
        : `\n${out.style.bad('dbmd:')} ${plural(errors, 'error')}, so ${directory} is ` +
          `missing a table the database has.\n`),
    json: {
      directory,
      source,
      engine,
      reimport: true,
      confirmed: true,
      changes: delta.items.map(asJson),
      files,
      removed: [...delta.remove],
      counts: { changes: delta.items.length, errors, warnings: diagnostics.length - errors },
      diagnostics,
    },
  })
}

/**
 * The list, grouped under the file each item is about.
 *
 * The same shape `dbmd check` gives a list of diagnostics, because it is the
 * same question asked one step earlier: which file, and what about it. The
 * headline is the owner's own vocabulary and is what the eye runs down; the
 * sentences under it are what somebody reads once they have found the line they
 * did not expect.
 */
function itemised(items: readonly DeltaItem[], style: Palette): string {
  const lines: string[] = []
  let heading: string | undefined
  for (const item of items) {
    if (item.path !== heading) {
      if (heading !== undefined) lines.push('')
      lines.push(style.strong(item.path))
      heading = item.path
    }
    lines.push(`  ${item.headline}`)
    for (const sentence of item.detail) {
      for (const line of wrapped(sentence)) lines.push(`      ${line}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** The width the rest of this command's prose is wrapped to, less the indent. */
const WRAP = 74

/**
 * One sentence as lines, wrapped on spaces and never mid-word.
 *
 * The sentences arrive from `src/import/delta.ts` unwrapped, on purpose: they
 * carry names out of somebody's database, so where one breaks is a fact about
 * this run rather than about the source file, and a test asserting on a break
 * would be asserting on the length of a table name.
 */
function wrapped(sentence: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of sentence.split(' ')) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= WRAP) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

/** One item as the `--json` form of it. The shape is public API: ADR 0006 rule 3. */
function asJson(item: DeltaItem): JsonValue {
  return { kind: item.kind, path: item.path, headline: item.headline, detail: [...item.detail] }
}

/**
 * The model already there could not be read, so there is no delta to compute.
 *
 * A table whose file failed to parse is missing from the model (ADR 0008), and
 * missing from the model reads from a delta's point of view as missing from the
 * database, which would put `database table removed` on the list about a table
 * that is sitting right there with a paragraph in it. Refusing is the only
 * honest answer, and the diagnostics are printed because they are what turns the
 * refusal into something somebody can act on.
 */
function unreadableModel(
  raw: readonly Diagnostic[],
  directory: string,
  source: string,
  out: Output,
): Report {
  const diagnostics = sortDiagnostics(raw)
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const reason = `${directory} has ${plural(errors, 'error')} and cannot be compared against an import`
  return {
    code: EXIT_FAILURE,
    text:
      `${formatDiagnostics(diagnostics).join('\n')}\n` +
      `${out.style.bad('dbmd:')} ${out.style.strong(directory)} holds a model this cannot ` +
      `read, so there is no list of changes to show and nothing was written.\n` +
      `A file that does not parse is missing from the model, and missing from the model\n` +
      `reads from here as a table the database dropped.\n` +
      `Fix what "dbmd check ${directory}" reports, then import again.\n`,
    json: {
      directory,
      source,
      counts: { errors, warnings: diagnostics.length - errors },
      diagnostics,
      error: { code: 'model-unreadable', message: reason },
    },
  }
}

// --------------------------------------------------------------------------
// Getting the text, and the one failure a provider cannot own
// --------------------------------------------------------------------------

/**
 * Where the text came from: `source` is what the report carries and `label` is
 * what a sentence says. They differ only for standard input, which a report
 * spells `-` and a person reads as three words.
 */
interface Source {
  readonly source: string
  readonly label: string
}

/** Either the value, or the whole report that says why there is not one. */
type Attempt<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly report: Report }

async function sourceText(
  file: string | undefined,
  where: Source,
  stdin: Input,
  directory: string,
  out: Output,
): Promise<Attempt<string>> {
  let text: string
  if (file === undefined) {
    text = await stdin.read()
  } else {
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      // `errnoText` rather than the `messageOf` every other catch in this file
      // uses. That one is Node's message, which repeats the path the call was
      // made with and is the right thing for a parse error; here it made the
      // one sentence name the file twice and gave `--json` nothing at all,
      // because the payload could not carry a message with a path in it. ADR
      // 0006 rule 4. dbmd-f3p.
      const reason = `${file} could not be read: ${errnoText(error)}`
      return {
        ok: false,
        report: {
          code: EXIT_FAILURE,
          text: `${out.style.bad('dbmd:')} ${reason}\n`,
          json: {
            directory,
            source: where.source,
            error: { code: 'file-unreadable', message: reason },
          },
        },
      }
    }
  }

  if (text.trim() === '') {
    return {
      ok: false,
      report: {
        code: EXIT_FAILURE,
        text:
          `${out.style.bad('dbmd:')} there was nothing in ${where.label}.\n` +
          `Run the introspection query for your engine and import the JSON it printed.\n`,
        json: {
          directory,
          source: where.source,
          error: { code: 'input-empty', message: `there was nothing in ${where.label}` },
        },
      },
    }
  }
  return { ok: true, value: text }
}

/**
 * The pasted text as JSON, and what went wrong when it is not.
 *
 * No provider can answer this, because a provider is handed a value and never
 * the characters, so the call site holding the text is the one that has to. It
 * is also not worth working out which engine it was before answering: the
 * engine's own query already says what its client writes round a result, in the
 * comment block on top of the SQL, which is the text the person about to save
 * one is certainly looking at. So this points there rather than repeating it,
 * which keeps it true for the engines that do not exist yet and keeps an
 * engine's name inside `src/import/providers/`. ADR 0007.
 */
function parseJson(text: string, where: Source, directory: string, out: Output): Attempt<unknown> {
  // A byte-order mark on the front is what more than one client's "save the
  // result" leaves behind, and `JSON.parse` refuses it with a message about
  // position 0 that says nothing about a character nobody can see.
  const body = text.startsWith(BOM) ? text.slice(1) : text
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch (error) {
    const cause = whyNotJson(body.trim())
    return {
      ok: false,
      report: {
        code: EXIT_FAILURE,
        text:
          `${out.style.bad('dbmd:')} ${out.style.strong(where.label)} is not JSON: ` +
          `${messageOf(error)}\n` +
          `The file to import is one value that begins { and ends }, with no header above\n` +
          `it, no row count under it and no padding round it.\n` +
          cause.lines.map((line) => `${line}\n`).join('') +
          `The comment above the query you ran says how to save it from your client.\n`,
        json: {
          directory,
          source: where.source,
          error: {
            code: 'input-not-json',
            message: `${where.label} is not JSON: ${messageOf(error)}`,
            likelyCause: cause.likelyCause,
          },
        },
      },
    }
  }
}

/** What the file's own two ends say about why it did not parse. */
interface NotJson {
  /** The one phrase a `--json` caller reads instead of the paragraph. */
  readonly likelyCause: string
  /** The paragraph, already wrapped, that says the same thing to a person. */
  readonly lines: readonly string[]
}

/**
 * Which of the four ways a file arrives wrong this one is, read off the file
 * rather than off the parser's message.
 *
 * The position `JSON.parse` reports is the obvious thing to branch on, and it is
 * not reliably there to branch on. A file with a column header in front of the
 * JSON, which is what psql writes without `-t`, fails with `Unexpected token
 * 'd', " dbmd_intro"... is not valid JSON` and names no position at all, so the
 * one case a position would settle most cleanly is the case it is missing from.
 * ADR 0045.
 *
 * What is always there is the text, and the shape it has to have is the one both
 * engines' comment blocks state: one value that begins `{` and ends `}`. So the
 * two ends are compared against that, and the pair the ends cannot separate, a
 * file that is too long at the back against one that stopped early, is separated
 * by parsing the prefix. That either is a whole value with something written
 * after it or it is not, which is a fact rather than a guess.
 */
function whyNotJson(body: string): NotJson {
  if (!body.startsWith('{')) {
    return {
      likelyCause: 'a header in front of the JSON',
      lines: [
        'This one does not begin with {, so the parse stopped in front of your schema',
        'rather than inside it and nothing in it was truncated. What is above the JSON is',
        "your client's own: a column header, a rule of dashes, or a frame round the value.",
      ],
    }
  }

  const close = body.lastIndexOf('}')
  if (close !== -1 && close < body.length - 1 && parses(body.slice(0, close + 1))) {
    return {
      likelyCause: 'a footer after the JSON',
      lines: [
        'This one holds a whole JSON value and then more, so it is too long rather than',
        'too short and nothing in it was truncated. What follows the last } is your',
        "client's own footer, usually a row count.",
      ],
    }
  }

  if (!body.endsWith('}')) {
    return {
      likelyCause: 'the paste stopped early',
      lines: [
        'This one begins { and does not end }, so the likeliest cause is a paste that',
        'stopped early: a client that hands a long result back in pieces, or a grid with a',
        'display cap of its own, gives you JSON that looks finished and is not.',
      ],
    }
  }

  return {
    likelyCause: 'a break inside the JSON',
    lines: [
      'This one begins { and ends }, so both ends are right and what is wrong is between',
      'them, where the position above says. A client that breaks a long value across',
      'lines writes something of its own into every break, and a copy that lost a piece',
      'in the middle looks the same from here.',
    ],
  }
}

/** Whether a slice of the file is a whole JSON value. Nothing is kept from it. */
function parses(slice: string): boolean {
  try {
    JSON.parse(slice)
    return true
  } catch {
    return false
  }
}

// --------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------

/**
 * A name a catalogue accepts and a filesystem does not, as a diagnostic.
 *
 * ADR 0026 gives `unsafe-name` no diagnostic code in the model reader, because
 * no read can produce one: the filesystem refuses such a name before dbmd is
 * involved, so no model on disk holds an object the writer would refuse. An
 * import is the caller that can, since a database catalogue has no such rule,
 * and dbmd-44 imported a table called `Ledger [Entry]` while looking for exactly
 * this. The `WriteSkip` names the object, which is the whole reason the writer
 * reports one instead of throwing, so this is a translation and not a decision.
 */
function unwritableNames(
  skipped: readonly WriteSkip[],
  document: IntrospectionDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const skip of skipped) {
    if (skip.reason !== 'unsafe-name') continue
    // `tables/<name>`, with no `.md`, because there is no such file. The kind is
    // in front of the name for the reader; the name is what points at a row of
    // the catalogue.
    const name = skip.path.slice(skip.path.indexOf('/') + 1)
    const index = document.tables.findIndex((table) => table.name === name)
    diagnostics.push({
      code: 'import/unsafe-name',
      severity: 'error',
      at: inDocument(index === -1 ? '$.tables' : `$.tables[${index}].name`),
      message:
        `the table \`${name}\` has no file it can be written to, because no filesystem ` +
        `accepts that name and a checkout could not hold it; rename it in the database or ` +
        `leave it out of the query`,
    })
  }
  return diagnostics
}

/** The report for a file that produced diagnostics and no model at all. */
function refused(
  raw: readonly Diagnostic[],
  directory: string,
  where: Source,
  out: Output,
): Report {
  const diagnostics = sortDiagnostics(raw)
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  return {
    code: EXIT_FAILURE,
    text:
      `${formatDiagnostics(diagnostics).join('\n')}\n` +
      `${out.style.bad('dbmd:')} ${out.style.strong(where.label)} was not imported, and ` +
      `${out.style.strong(directory)} was left alone.\n`,
    json: {
      directory,
      source: where.source,
      files: [],
      counts: { tables: 0, errors, warnings: diagnostics.length - errors },
      diagnostics,
    },
  }
}

/**
 * Which of the three the target is, which is which half of this command runs.
 *
 * `ENOTDIR` used to be folded into "occupied" because both answers were the same
 * refusal. They are not any more: an occupied directory is now a re-import and a
 * file is still nowhere a model can go, so the two are told apart here rather
 * than by a message that has to hedge. Anything else is thrown, because a
 * permission error is a fact about the machine and the entry point reports it.
 */
type Occupancy = 'empty' | 'occupied' | 'not-a-directory'

async function occupancyOf(directory: string): Promise<Occupancy> {
  try {
    return (await readdir(directory)).length > 0 ? 'occupied' : 'empty'
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') return 'empty'
    if (code === 'ENOTDIR') return 'not-a-directory'
    throw error
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Three string options, one flag, and no positionals. `parseArgs` with `strict`
 * rejects the rest.
 *
 * `--confirm` is accepted on every run and not only on the ones that have
 * something to confirm, which is deliberate: a scheduled job runs the same line
 * every week, and the week it imports into a directory that is empty because
 * somebody deleted it is not the week to fail on an argument. It confirms
 * whatever list this run produced, and an empty list needs no confirming.
 */
function parseImportArgs(argv: readonly string[]): {
  readonly file: string | undefined
  readonly directory: string
  readonly engine: string | undefined
  readonly confirm: boolean
} {
  const options = {
    file: { type: 'string' },
    dir: { type: 'string' },
    engine: { type: 'string' },
    confirm: { type: 'boolean' },
  } as const
  let values: { file?: string; dir?: string; engine?: string; confirm?: boolean }
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
      `${usageProblem(error, argv, options)}. "dbmd import" takes --file, --dir, ` +
        `--engine and --confirm; run "dbmd import --help".`,
    )
  }

  // Every other command takes its directory as a bare word. This one has two
  // paths, the file it reads and the directory it writes, and a bare word could
  // plausibly be either, so both are named and neither is positional.
  if (positionals.length > 0) {
    throw new UsageError(
      `"dbmd import" takes no positional arguments, and got ${positionals.join(' ')}. ` +
        `The file to read is --file and the directory to write is --dir.`,
    )
  }

  return {
    file: values.file,
    directory: values.dir ?? DEFAULT_DIRECTORY,
    engine: values.engine,
    confirm: values.confirm === true,
  }
}
