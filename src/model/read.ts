/**
 * Reading a `db-model/` directory into a `Model`.
 *
 * Three properties hold everywhere in this file, and they are the reason it is
 * shaped the way it is.
 *
 * **It never throws.** A bad file is a diagnostic carrying the file's path and,
 * where it is honestly derivable, a line. The studio has to show a broken file
 * rather than fail to start, and `dbmd check` has to report every problem in
 * one run rather than the first one.
 *
 * **The body is opaque.** Everything after the closing `---` is sliced out of
 * the file and carried untouched, carriage returns included. It is never parsed
 * as markdown and never normalised. If it were, every save on a Windows
 * checkout would rewrite every line of every file and the format would stop
 * being reviewable, which is the only thing it is for.
 *
 * **YAML is read through nodes, not through values.** `parseDocument` rather
 * than `parse`, because the traps ADR 0003 names are invisible in a plain JS
 * value. A scalar that resolved to a boolean is the only evidence that someone
 * wrote a column of type `on`, and a key whose resolved value is `null` is the
 * only evidence that someone wrote the retired `null:` key rather than a column
 * named `null`. Where a string is expected, this file checks that a string
 * arrived and diagnoses rather than coercing.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLParseError } from 'yaml'
// `byText` is `compareCodeUnits` under a name that reads at a sort call. It is
// aliased rather than redefined because the reader and the import contract have
// to agree on byte order forever, not only today. ADR 0014.
//
// `messageOf` is `errnoText` under the name this file's three catch blocks have
// always called it. Only the errno reaches a diagnostic, never the system
// message, because that carries the absolute path ADR 0006 rule 4 forbids in
// output; `errnoText` is where that rule and the words beside the errno live,
// shared with `dbmd import`, which raises `file-unreadable` from its own read.
import {
  compareCodeUnits as byText,
  compareDiagnostics,
  errnoText as messageOf,
  inDirectory,
  inFile,
} from '../diagnostics.js'
import { KIND_DIRECTORIES, MODEL_FILE } from './paths.js'
import { REFERENTIAL_ACTIONS } from './types.js'
import type {
  Column,
  Diagnostic,
  Group,
  Index,
  IndexKey,
  Layout,
  Model,
  ModelDiagnosticCode,
  Note,
  ObjectKind,
  ReadResult,
  Ref,
  RefEdge,
  RefusedFile,
  ReferentialAction,
  Severity,
  Table,
} from './types.js'

/**
 * Read a model directory. `dir` is the model root itself, the directory that
 * holds `_model.md` and `tables/`, not the repository root.
 */
export async function readModel(dir: string): Promise<ReadResult> {
  const diagnostics: Diagnostic[] = []
  const tables: Table[] = []
  const notes: Note[] = []
  const groups: Group[] = []
  /**
   * Every object file this read complained about instead of building. It is on
   * the model because the questions it answers are asked after the read is over
   * and somewhere else: ADR 0090.
   */
  const refused: RefusedFile[] = []
  /** Deferred because a `group:` cannot be checked until every group is read. */
  const declaredGroups: { table: string; path: string; group: string; line?: number }[] = []

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    push(diagnostics, {
      code: 'model-directory-unreadable',
      severity: 'error',
      at: inDirectory('.'),
      message: `cannot read the model directory: ${messageOf(error)}`,
    })
    return { model: emptyModel(), diagnostics }
  }

  let name: string | undefined
  let engine: string | undefined
  let body = ''
  let complete = true

  const listing = [...entries].sort((a, b) => byText(a.name, b.name))
  const modelFile = entries.find((entry) => entry.name === MODEL_FILE)

  if (modelFile !== undefined && !modelFile.isDirectory()) {
    const text = await readText(join(dir, MODEL_FILE), MODEL_FILE, diagnostics)
    if (text === undefined) {
      // The file is there and unreadable, so what it says is unknown rather
      // than absent, and a save must not put an empty one over the top of it.
      complete = false
    } else {
      const read = readModelFile(text, diagnostics)
      name = read.name
      engine = read.engine
      body = read.body
      complete = read.complete
    }
  } else if (modelFile === undefined) {
    // The clause after the semicolon is the fix, because every other refusal in
    // this tool names one and this is the message a first-run reader is most
    // likely to meet. It says what to write rather than which command to run,
    // and that is deliberate: `dbmd init` refuses a directory that is not empty,
    // so by the time somebody has a `tables/` and no `_model.md` (which is
    // exactly what the studio leaves behind, since it can create tables, notes
    // and groups and cannot create this file) the command that would have
    // helped no longer will. Writing the file works in both cases. ADR 0068.
    //
    // Both cases are the two ADR 0068 enumerated: an empty directory, and a
    // model whose `_model.md` was deleted. A third state reaches this `else` and
    // is not one of them, which is why it has a branch of its own below.
    push(diagnostics, {
      code: 'model-file-missing',
      severity: 'warning',
      at: inFile(MODEL_FILE),
      message:
        `no ${MODEL_FILE}, so the model has no name and no engine; ` +
        `add one with \`kind: model\`, a \`name:\` and an \`engine:\``,
    })
  } else {
    // `_model.md` exists and is a directory. The warning above would be false
    // twice here: the name is taken, and its fix cannot be followed, because
    // writing a file over a directory fails with `EISDIR`. So the fix is the
    // opposite one and it is named the same way.
    //
    // A directory location, where `model-file-missing` takes a file one. The
    // difference is what is at the path: there, nothing, so the location is
    // where the fix goes; here, a directory, which is what the message is about
    // and what `dbmd check` would otherwise count as a file two lines under a
    // sentence calling it a directory. ADR 0086.
    push(diagnostics, {
      code: 'model-file-not-a-file',
      severity: 'warning',
      at: inDirectory(MODEL_FILE),
      message:
        `\`${MODEL_FILE}\` is a directory rather than a file, so the model has no name and ` +
        `no engine; move it aside, then write \`${MODEL_FILE}\` with \`kind: model\`, a ` +
        `\`name:\` and an \`engine:\``,
    })
  }

  // A `Dirent` answers from the `lstat` `readdir` already did, so it describes
  // the entry and not what the entry points at: a symlink to a directory, and a
  // Windows junction, both answer `isDirectory()` false and `isSymbolicLink()`
  // true. Measured on Windows 11 with Node 24, a junctioned `tables` reports
  // `isDirectory=false isFile=false isSymbolicLink=true`, and the guard this
  // replaced skipped it in silence: a model whose tables were right there was
  // read as a model with no tables and reported as having no problems.
  //
  // So `isDirectory()` is not asked. `isFile()` is, because a plain file is the
  // one answer that settles the question on its own: it is not a directory, it
  // does not point at one, and it never will. Everything else is handed to
  // `readdir`, which follows a link and is the only thing that can tell a link
  // to a directory from a link to nothing. That costs no extra call: it is the
  // `readdir` this loop was going to make anyway. ADR 0038.
  for (const entry of listing) {
    const entryName = entry.name
    const kind = KIND_DIRECTORIES.get(entryName)
    if (kind === undefined) {
      // Still `isDirectory()` here, and deliberately: `_model.md`, a `README`
      // and a `.gitignore` are all files at the model root that are nobody's
      // business, and warning about a name only because it is not a directory
      // would warn about all of them.
      if (!entry.isDirectory()) continue
      // A `_model.md` that is a directory already has `model-file-not-a-file`
      // above, which names the same directory and says what to do about it.
      // Saying "not a kind of object dbmd knows" as well would be the second
      // complaint about one mistake that ADR 0017 exists to prevent, and it is
      // the weaker of the two: it advises ignoring what the other says to move.
      if (entryName === MODEL_FILE) continue
      push(diagnostics, {
        code: 'unknown-kind-directory',
        severity: 'warning',
        at: inDirectory(entryName),
        message: `\`${entryName}/\` is not a kind of object dbmd knows; its files are ignored`,
      })
      continue
    }

    if (entry.isFile()) {
      push(diagnostics, {
        code: 'kind-not-a-directory',
        severity: 'error',
        at: inFile(entryName),
        message: `\`${entryName}\` is a file rather than a directory, so the model's ${entryName} were not read; a \`${entryName}/\` symlink checked out where symlinks are unsupported looks exactly like this`,
      })
      continue
    }

    const found = await markdownFiles(join(dir, entryName), entryName, kind, diagnostics)
    for (const file of found.directories) {
      refused.push(refusedFile(kind, entryName, file))
    }
    for (const file of found.files) {
      const relative = `${entryName}/${file}`
      const text = await readText(join(dir, entryName, file), relative, diagnostics)
      if (text === undefined) {
        // Listed and unopenable, which for a `.md` name in a kind directory is
        // a dangling link. Something is at the path, the reader has said so,
        // and what it holds is unknown rather than absent.
        refused.push(refusedFile(kind, entryName, file))
        continue
      }
      const object = readObjectFile(kind, relative, file.slice(0, -'.md'.length), text, diagnostics)
      if (object === undefined) {
        refused.push(refusedFile(kind, entryName, file))
        continue
      }
      if (object.kind === 'table') {
        tables.push(object)
        if (object.group !== undefined) {
          declaredGroups.push({
            table: object.name,
            path: object.path,
            group: object.group,
            ...(object.groupLine === undefined ? {} : { line: object.groupLine }),
          })
        }
      } else if (object.kind === 'note') {
        notes.push(object)
      } else {
        groups.push(object)
      }
    }
  }

  tables.sort((a, b) => byText(a.name, b.name))
  notes.sort((a, b) => byText(a.name, b.name))
  groups.sort((a, b) => byText(a.name, b.name))

  refused.sort((a, b) => byText(a.path, b.path))

  const groupNames = new Set(groups.map((group) => group.name))
  // The group files this read complained about instead of building. A `group:`
  // naming one of them is not naming nothing: the file is there, this run has
  // already said what is wrong with it, and fixing that file is what makes the
  // membership work. Saying "names no file at groups/billing.md" four lines
  // under a heading reading `groups/billing.md` is the reader contradicting
  // itself in one run, and it is the reader's own rule about `_model.md` above:
  // one mistake, one complaint, and the complaint is the one that names the fix.
  // ADR 0090.
  const brokenGroups = new Set(
    refused.filter((file) => file.kind === 'group').map((file) => file.name),
  )
  for (const declared of declaredGroups) {
    if (groupNames.has(declared.group) || brokenGroups.has(declared.group)) continue
    push(diagnostics, {
      code: 'group-unknown',
      severity: 'error',
      at: inFile(declared.path, declared.line),
      message: `\`group: ${declared.group}\` names no file at groups/${declared.group}.md`,
    })
  }

  const model: Model = {
    ...(name === undefined ? {} : { name }),
    ...(engine === undefined ? {} : { engine }),
    body,
    complete,
    tables: tables.map(stripInternals),
    notes,
    groups,
    referencesTo: buildReferencesTo(tables),
    groupMembers: buildGroupMembers(groups, declaredGroups),
    refused,
  }
  return { model, diagnostics: diagnostics.sort(compareDiagnostics) }
}

/** One file the reader listed, complained about, and did not turn into an object. */
function refusedFile(kind: ObjectKind, directory: string, file: string): RefusedFile {
  return { kind, name: file.slice(0, -'.md'.length), path: `${directory}/${file}` }
}

// --------------------------------------------------------------------------
// The computed indexes. ADR 0003 declares a relationship on the foreign key
// column and ADR 0005 declares membership on the member, both so that a change
// touches one file. Both directions then have to be computed, and this is the
// one place that does it.
// --------------------------------------------------------------------------

function buildReferencesTo(tables: readonly Table[]): ReadonlyMap<string, readonly RefEdge[]> {
  const edges = new Map<string, RefEdge[]>()
  for (const table of tables) edges.set(table.name, [])
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.ref === undefined) continue
      const list = edges.get(column.ref.table)
      const edge: RefEdge = { from: { table: table.name, column: column.name }, to: column.ref }
      if (list === undefined) edges.set(column.ref.table, [edge])
      else list.push(edge)
    }
  }
  return sortedMap(edges, (list) =>
    list.sort(
      (a, b) =>
        byText(a.from.table, b.from.table) ||
        byText(a.from.column, b.from.column) ||
        byText(a.to.column, b.to.column),
    ),
  )
}

function buildGroupMembers(
  groups: readonly Group[],
  declared: readonly { table: string; group: string }[],
): ReadonlyMap<string, readonly string[]> {
  const members = new Map<string, string[]>()
  for (const group of groups) members.set(group.name, [])
  for (const entry of declared) members.get(entry.group)?.push(entry.table)
  return sortedMap(members, (list) => list.sort(byText))
}

/** Keys inserted in sorted order, so iterating the map is deterministic. */
function sortedMap<T>(
  source: Map<string, T[]>,
  sortValues: (values: T[]) => T[],
): ReadonlyMap<string, readonly T[]> {
  const out = new Map<string, readonly T[]>()
  for (const key of [...source.keys()].sort(byText)) {
    out.set(key, sortValues(source.get(key) ?? []))
  }
  return out
}

// --------------------------------------------------------------------------
// Frontmatter: finding it, and keeping the body intact.
// --------------------------------------------------------------------------

type Split =
  | { readonly outcome: 'ok'; readonly yaml: string; readonly body: string }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'unterminated' }
  | { readonly outcome: 'empty'; readonly body: string }

const DELIMITER = '---'

/**
 * Split a file into its frontmatter and its body.
 *
 * The body is `text` from the character after the closing delimiter's line
 * break to the end of the file, sliced and not otherwise touched. Nothing is
 * trimmed, including the blank line that conventionally follows the closing
 * `---`, so that a writer can reproduce the file as `--- + yaml + --- + body`
 * and get the original bytes back. A `\r\n` file stays a `\r\n` file.
 *
 * Absent, unterminated and empty are three different answers because they are
 * three different mistakes: a file that is not a dbmd object at all, a file
 * whose delimiter was mistyped, and a file whose frontmatter was emptied.
 */
export function splitFrontmatter(text: string): Split {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const firstBreak = source.indexOf('\n')
  const firstLine = firstBreak === -1 ? source : source.slice(0, firstBreak)
  if (firstLine.trimEnd() !== DELIMITER) return { outcome: 'absent' }
  if (firstBreak === -1) return { outcome: 'unterminated' }

  const yamlStart = firstBreak + 1
  let cursor = yamlStart
  while (cursor <= source.length) {
    const nextBreak = source.indexOf('\n', cursor)
    const lineEnd = nextBreak === -1 ? source.length : nextBreak
    if (source.slice(cursor, lineEnd).trimEnd() === DELIMITER) {
      const yaml = source.slice(yamlStart, cursor)
      const body = nextBreak === -1 ? '' : source.slice(nextBreak + 1)
      return yaml.trim() === '' ? { outcome: 'empty', body } : { outcome: 'ok', yaml, body }
    }
    if (nextBreak === -1) break
    cursor = nextBreak + 1
  }
  return { outcome: 'unterminated' }
}

// --------------------------------------------------------------------------
// Reading one file.
// --------------------------------------------------------------------------

/**
 * A table plus the line its `group:` key was on, which is needed later to point
 * at the right line when the group turns out not to exist. It is stripped
 * before the table reaches the model.
 */
type TableInProgress = Table & { readonly groupLine?: number }

function stripInternals(table: TableInProgress): Table {
  const { groupLine: _groupLine, ...rest } = table
  return rest
}

/** Everything one file's diagnostics need to know about where they are. */
interface Ctx {
  readonly path: string
  readonly yaml: string
  readonly out: Diagnostic[]
}

/**
 * The file line for an offset into the frontmatter YAML. The YAML always starts
 * on file line 2, because line 1 is the opening delimiter.
 */
function lineAt(ctx: Ctx, offset: number | null | undefined): number | undefined {
  if (offset === null || offset === undefined) return undefined
  let line = 2
  for (let i = 0; i < offset && i < ctx.yaml.length; i++) {
    if (ctx.yaml.charCodeAt(i) === 10) line++
  }
  return line
}

function report(
  ctx: Ctx,
  code: ModelDiagnosticCode,
  severity: Severity,
  message: string,
  offset?: number | null,
): void {
  const line = lineAt(ctx, offset)
  push(ctx.out, {
    code,
    severity,
    at: inFile(ctx.path, line),
    message,
  })
}

function readModelFile(
  text: string,
  out: Diagnostic[],
): { name?: string; engine?: string; body: string; complete: boolean } {
  // Diagnostics land in a sink of this file's own, so that "did reading this
  // file lose anything" is a question the reader answers rather than one the
  // caller has to reconstruct from a shared list.
  const raised: Diagnostic[] = []
  try {
    const split = splitFrontmatter(text)
    // `_model.md` is allowed to be prose only: it is the one file whose whole
    // reason to exist can be the paragraph about the model.
    if (split.outcome === 'absent') return { body: text, complete: true }
    if (split.outcome === 'unterminated') {
      reportSplit(raised, MODEL_FILE, split.outcome)
      return { body: '', complete: false }
    }
    if (split.outcome === 'empty') {
      reportSplit(raised, MODEL_FILE, split.outcome)
      return { body: split.body, complete: false }
    }

    const ctx: Ctx = { path: MODEL_FILE, yaml: split.yaml, out: raised }
    const map = parseFrontmatter(ctx)
    if (map === undefined) return { body: split.body, complete: false }

    const fields = fieldsOf(ctx, map)
    checkKind(ctx, fields, 'model')
    const name = takeString(ctx, fields, 'name')
    const engine = takeString(ctx, fields, 'engine')
    fields.reportUnknown('the model')
    return {
      ...(name === undefined ? {} : { name }),
      ...(engine === undefined ? {} : { engine }),
      body: split.body,
      complete: intact(raised),
    }
  } finally {
    out.push(...raised)
  }
}

function readObjectFile(
  kind: ObjectKind,
  path: string,
  name: string,
  text: string,
  out: Diagnostic[],
): TableInProgress | Note | Group | undefined {
  const raised: Diagnostic[] = []
  try {
    return buildObject(kind, path, name, text, raised)
  } finally {
    out.push(...raised)
  }
}

/**
 * An error raised while building an object from its file means the file holds
 * something the object does not, so the object is not complete and the writer
 * leaves the file alone. Errors raised anywhere else, such as a `group:` naming
 * no group file, are about the model rather than about this file: nothing in
 * the file was lost, and saving it back is safe.
 */
function intact(raised: readonly Diagnostic[]): boolean {
  return !raised.some((diagnostic) => diagnostic.severity === 'error')
}

function buildObject(
  kind: ObjectKind,
  path: string,
  name: string,
  text: string,
  out: Diagnostic[],
): TableInProgress | Note | Group | undefined {
  const split = splitFrontmatter(text)
  if (split.outcome !== 'ok') {
    // A file in `tables/` with no frontmatter is a plain markdown file that
    // happens to be in the directory, and that is exactly the problem: the
    // directory says it is a table and it says nothing at all. It contributes
    // no object, because inventing a nameless table from a file name would put
    // a phantom box on the canvas and in every export.
    reportSplit(out, path, split.outcome)
    return undefined
  }

  const ctx: Ctx = { path, yaml: split.yaml, out }
  const map = parseFrontmatter(ctx)
  if (map === undefined) return undefined

  const fields = fieldsOf(ctx, map)
  if (!checkKind(ctx, fields, kind)) return undefined

  switch (kind) {
    case 'table':
      return readTable(ctx, fields, path, name, split.body)
    case 'note':
      return readNote(ctx, fields, path, name, split.body)
    case 'group':
      return readGroup(ctx, fields, path, name, split.body)
  }
}

function reportSplit(
  out: Diagnostic[],
  path: string,
  outcome: 'absent' | 'unterminated' | 'empty',
) {
  const messages = {
    absent: 'no frontmatter: the file does not start with a `---` line',
    unterminated: 'the frontmatter opens with `---` and is never closed by a `---` line',
    empty: 'the frontmatter is empty, so the file declares nothing',
  } as const
  const codes = {
    absent: 'frontmatter-absent',
    unterminated: 'frontmatter-unterminated',
    empty: 'frontmatter-empty',
  } as const
  push(out, {
    code: codes[outcome],
    severity: 'error',
    at: inFile(path),
    message: messages[outcome],
  })
}

/**
 * The one parser complaint worth reporting, out of however many it made.
 *
 * A single syntax error cascades: an unterminated `[` swallows the rest of the
 * document and one tab in place of two spaces derails the parser's state
 * machine, and either way YAML then has a true and different thing to say about
 * nearly every remaining line. One tab produced fifteen. Past the first, the
 * parser is describing the wreckage rather than the mistake, so reporting the
 * first and stopping is a truer statement than reporting fifteen. ADR 0017
 * decided that; this function decides *which* one, which turned out to be the
 * harder half.
 *
 * **It is the earliest one in the file, and that is neither the parser's own
 * order nor the printed order.** `doc.errors` is emission order, and the
 * composer's complaints are pushed before the lexer's: an unterminated flow
 * sequence reports `Block collections are not allowed within flow collections`,
 * the message that names the actual fault, *last*. The printed order is
 * `compareDiagnostics`, which sorts equal lines by message text, so a tab is
 * reported by `Implicit keys need to be on a single line` and
 * `Nested mappings are not allowed in compact mappings` before
 * `Tabs are not allowed as indentation` ever gets a look in. Taking either
 * "first" hands the reader a confidently wrong explanation of their file, which
 * is worse than fifteen true ones. Position is the only order that puts the
 * mistake before its consequences, because that is what a consequence is.
 *
 * Ties keep the parser's order, and there is nothing better available: two
 * complaints about the same character are one point of failure described twice.
 */
function firstFailure(errors: readonly YAMLParseError[]): YAMLParseError | undefined {
  let first: YAMLParseError | undefined
  for (const error of errors) {
    if (first === undefined || error.pos[0] < first.pos[0]) first = error
  }
  return first
}

/**
 * Say how many were dropped. It costs a clause and it stops a reader believing
 * a file with fifteen complaints has one, which is the failure mode of a cap
 * that says nothing: the second `dbmd check` reports a mistake the first hid,
 * and looks like it moved. The count is in the message rather than in a field
 * because `message` is the half ADR 0008 leaves free, and a field would be
 * `--json` API for a number nothing consumes.
 */
function withSuppressedCount(message: string, suppressed: number): string {
  if (suppressed <= 0) return message
  const plural = suppressed === 1 ? 'error' : 'errors'
  return `${message} (and ${suppressed} more parse ${plural}, not reported: they follow from this one)`
}

function parseFrontmatter(ctx: Ctx): YAMLMap<unknown, unknown> | undefined {
  // `prettyErrors: false` keeps the message a single line: the source excerpt a
  // pretty error carries is a terminal convenience, and it would be noise in
  // `--json`. The position is recovered from `pos` instead, which is what makes
  // the line number the file's rather than the frontmatter's.
  const doc = parseDocument(ctx.yaml, { prettyErrors: false })
  const failure = firstFailure(doc.errors)
  if (failure !== undefined) {
    // Everything else the parser said, warnings included: the document did not
    // parse, so a warning about it is describing the wreckage too.
    const suppressed = doc.errors.length - 1 + doc.warnings.length
    report(
      ctx,
      'frontmatter-invalid',
      'error',
      withSuppressedCount(failure.message, suppressed),
      failure.pos[0],
    )
    return undefined
  }
  // Only reached when the parse succeeded, so there is no cascade to cap: a
  // warning here is one fact about a document YAML did read.
  for (const warning of doc.warnings) {
    report(ctx, 'frontmatter-invalid', 'warning', warning.message, warning.pos[0])
  }

  if (doc.contents === null) {
    push(ctx.out, {
      code: 'frontmatter-empty',
      severity: 'error',
      at: inFile(ctx.path),
      message: 'the frontmatter is empty, so the file declares nothing',
    })
    return undefined
  }
  if (!isMap(doc.contents)) {
    report(
      ctx,
      'frontmatter-not-a-map',
      'error',
      'the frontmatter must be a mapping of keys to values',
      offsetOf(doc.contents),
    )
    return undefined
  }
  return doc.contents
}

/**
 * The directory already decided the kind. This checks what the file says
 * against it. A disagreement stops the file loading rather than reinterpreting
 * it as the directory's kind, because a table's keys read as a note produce a
 * page of secondary complaints that bury the one-line fix.
 */
function checkKind(ctx: Ctx, fields: FieldSet, expected: ObjectKind | 'model'): boolean {
  const field = fields.take('kind')
  if (field === undefined) {
    push(ctx.out, {
      code: 'kind-missing',
      severity: 'error',
      at: inFile(ctx.path),
      message: `no \`kind:\` key; the directory says this is a ${expected}`,
    })
    return true
  }
  const declared = stringValue(field.node)
  if (declared === expected) return true
  report(
    ctx,
    'kind-mismatch',
    'error',
    `\`kind: ${rawOf(ctx, field.node)}\` in a directory of ${expected}s; the directory decides, so this file is not loaded`,
    field.valueOffset,
  )
  return false
}

function readTable(
  ctx: Ctx,
  fields: FieldSet,
  path: string,
  name: string,
  body: string,
): TableInProgress {
  // The file name is the table's identity (ADR 0008), so this is the one name
  // in the format with no key to point at and no line to carry. `markdownFiles`
  // already skips a dot-file, so `.md` cannot reach here and only the
  // whitespace case is live; both are said, because the rule is about the name
  // and not about which directory listing produced it.
  reportBlank(
    ctx,
    'the file name',
    name,
    'this table has no name, and the file name is what a `ref` resolves against; rename the file, and its `table:` key with it',
  )

  const declaredName = fields.take('table')
  if (declaredName === undefined) {
    push(ctx.out, {
      code: 'name-missing',
      severity: 'error',
      at: inFile(ctx.path),
      message: `no \`table:\` key; the file name says this table is \`${name}\``,
    })
  } else {
    const declared = stringValue(declaredName.node)
    if (declared !== name) {
      report(
        ctx,
        'name-mismatch',
        'error',
        `\`table: ${rawOf(ctx, declaredName.node)}\` in a file named ${name}.md; the file name is the table's identity, because that is what a \`ref\` resolves against`,
        declaredName.valueOffset,
      )
    }
  }

  const columns: Column[] = []
  const columnsField = fields.take('columns')
  if (columnsField !== undefined) {
    for (const item of seqItems(ctx, 'columns', columnsField)) {
      const column = readColumn(ctx, item)
      if (column !== undefined) columns.push(column)
    }
  }

  const indexes: Index[] = []
  const indexesField = fields.take('indexes')
  if (indexesField !== undefined) {
    for (const item of seqItems(ctx, 'indexes', indexesField)) {
      const index = readIndex(ctx, item)
      if (index !== undefined) indexes.push(index)
    }
  }

  const layout = takeLayout(ctx, fields, false)
  const groupField = fields.take('group')
  const group = groupField === undefined ? undefined : stringOf(ctx, 'group', groupField)
  const groupLine = groupField === undefined ? undefined : lineAt(ctx, groupField.valueOffset)
  fields.reportUnknown('a table')

  return {
    kind: 'table',
    name,
    path,
    body,
    columns,
    indexes,
    complete: intact(ctx.out),
    ...(layout === undefined ? {} : { layout }),
    ...(group === undefined ? {} : { group }),
    ...(group === undefined || groupLine === undefined ? {} : { groupLine }),
  }
}

function readColumn(ctx: Ctx, node: unknown): Column | undefined {
  if (!isMap(node)) {
    report(ctx, 'field-wrong-type', 'error', 'a column must be a mapping', offsetOf(node))
    return undefined
  }
  const fields = fieldsOf(ctx, node)
  const name = requiredString(
    ctx,
    fields,
    'name',
    offsetOf(node),
    'this column has no name; name it, or delete the row',
  )
  const type = requiredString(
    ctx,
    fields,
    'type',
    offsetOf(node),
    "this column has no type; write the engine's own spelling of one",
  )
  const pk = takeBoolean(ctx, fields, 'pk')
  const nullable = takeBoolean(ctx, fields, 'nullable')
  fields.reject(
    'null',
    '`null` is now `nullable` and means the same thing: write `nullable: false`',
  )
  fields.reject(
    'unique',
    `\`unique\` is declared on an index and not on a column, because a unique constraint has a name and a column has nowhere to put one; write it as an \`indexes:\` entry with \`columns: [${name ?? 'this column'}]\` and \`unique: true\``,
  )
  const defaultField = fields.take('default')
  const columnDefault =
    defaultField === undefined
      ? undefined
      : stringOf(
          ctx,
          'default',
          defaultField,
          'quote it so that it survives as SQL text, and quote it twice if it is a SQL string literal: `default: "\'pending\'"`',
        )
  const refField = fields.take('ref')
  const ref = refField === undefined ? undefined : readRef(ctx, refField)
  const actions = readActions(ctx, fields, refField)
  fields.reportUnknown('a column')

  if (name === undefined || type === undefined) return undefined
  return {
    name,
    type,
    ...(pk === undefined ? {} : { pk }),
    ...(nullable === undefined ? {} : { nullable }),
    ...(columnDefault === undefined ? {} : { default: columnDefault }),
    ...(ref === undefined ? {} : { ref: { ...ref, ...actions } }),
  }
}

/**
 * `on delete:` and `on update:`, which are facts about the `ref:` beside them.
 *
 * Two keys and not one, because they are two clauses of one constraint and both
 * catalogues report both; answering only the first would have left the import
 * dropping half of what the contract already holds. ADR 0046.
 *
 * They are read whether or not there is a `ref:` to hang them on, so that a
 * column with an action and no reference is reported rather than quietly
 * losing the line: an action with nothing to be about is a fact the object
 * cannot hold, which is what makes it an error and the file unwritable.
 */
function readActions(
  ctx: Ctx,
  fields: FieldSet,
  refField: Field | undefined,
): { onDelete?: ReferentialAction; onUpdate?: ReferentialAction } {
  const read = (key: 'on delete' | 'on update', when: string) => {
    const field = fields.take(key)
    if (field === undefined) return undefined
    // Asked before the value is looked at, because without a `ref:` the value
    // cannot matter, and a word this reader does not know is not worth a second
    // sentence about a key that is about nothing.
    if (refField === undefined) {
      report(
        ctx,
        'field-missing',
        'error',
        `\`${key}\` says what happens to this row when ${when}, and this column has no \`ref:\` for it to be about; add the \`ref:\`, or delete this key`,
        field.keyOffset,
      )
      return undefined
    }
    // Whether the action makes sense on this column is deliberately not asked.
    // `on delete: set null` on a `nullable: false` column is a database that
    // fails at the first delete, and Postgres creates it without complaint, so
    // the file is describing something real; saying otherwise would be dbmd
    // ruling on engine behaviour, which is the half of a migration tool ADR
    // 0046 refuses. It carries `type: banana` for the same reason.
    return actionOf(ctx, key, field)
  }

  const onDelete = read('on delete', 'the row it points at is deleted')
  const onUpdate = read('on update', 'the key it points at changes')
  return {
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  }
}

/**
 * One of the five referential actions, or a diagnostic naming all five.
 *
 * The one closed vocabulary in the format, and the reader refuses a word outside
 * it rather than carrying it. A column type is the opposite case and is carried
 * untouched, because the set of types is the engine's and dbmd does not know it;
 * these five are the standard's, are the same in both catalogues, and a sixth is
 * something nothing downstream could map. ADR 0046.
 */
function actionOf(ctx: Ctx, key: string, field: Field): ReferentialAction | undefined {
  const known = REFERENTIAL_ACTIONS.map((action) => `\`${action}\``).join(', ')
  const value = stringOf(ctx, key, field, `write one of ${known}`)
  if (value === undefined) return undefined
  const action = REFERENTIAL_ACTIONS.find((candidate) => candidate === value)
  if (action !== undefined) return action
  report(
    ctx,
    'not-in-vocabulary',
    'error',
    `\`${key}: ${value}\` is not a referential action; write one of ${known}`,
    field.valueOffset,
  )
  return undefined
}

function readIndex(ctx: Ctx, node: unknown): Index | undefined {
  if (!isMap(node)) {
    report(ctx, 'field-wrong-type', 'error', 'an index must be a mapping', offsetOf(node))
    return undefined
  }
  const fields = fieldsOf(ctx, node)
  const name = requiredString(
    ctx,
    fields,
    'name',
    offsetOf(node),
    'this index has no name; name it what the database calls it',
  )
  const columnsField = fields.take('columns')
  const columns: IndexKey[] = []
  if (columnsField === undefined) {
    report(ctx, 'field-missing', 'error', 'an index needs a `columns` key', offsetOf(node))
  } else {
    const items = seqItems(ctx, 'columns', columnsField)
    for (const item of items) {
      const key = readIndexKey(ctx, item)
      if (key !== undefined) columns.push(key)
    }
    // The list as written, not the keys that survived it: a `columns: [123]`
    // that lost its only key has already been reported once, and saying the
    // index covers nothing on top of that is two complaints about one mistake.
    // A table's `columns: []` is deliberately not the same case; see
    // `docs/format.md`.
    if (isSeq(columnsField.node) && items.length === 0) {
      report(
        ctx,
        'empty-value',
        'warning',
        '`columns` is empty, so this index covers no columns; list its keys, or delete the index',
        columnsField.valueOffset,
      )
    }
  }
  const unique = takeBoolean(ctx, fields, 'unique')
  fields.reportUnknown('an index')
  if (name === undefined || columnsField === undefined) return undefined
  return { name, columns, ...(unique === undefined ? {} : { unique }) }
}

/**
 * One entry of an index's `columns` list: a column name, or an expression.
 *
 * A string is always a column name and a mapping is always engine SQL, so the
 * two cannot be confused in either direction. That is the point: a column may
 * legally be called `lower(email)`, and before this an index on one and an
 * index on the other were the same characters in the same place. ADR 0022.
 */
function readIndexKey(ctx: Ctx, node: unknown): IndexKey | undefined {
  const column = stringValue(node)
  if (column !== undefined) return column
  if (!isMap(node)) {
    report(
      ctx,
      'field-wrong-type',
      'error',
      `an index key must be a column name or \`{ expression: ... }\`, but YAML read \`${rawOf(ctx, node)}\` as ${describe(node)}`,
      offsetOf(node),
    )
    return undefined
  }
  const fields = fieldsOf(ctx, node)
  const expression = requiredString(
    ctx,
    fields,
    'expression',
    offsetOf(node),
    'this index key is neither a column nor an expression; write the SQL, or name a column',
  )
  fields.reportUnknown('an index key')
  return expression === undefined ? undefined : { expression }
}

function readRef(ctx: Ctx, field: Field): Ref | undefined {
  const raw = stringOf(ctx, 'ref', field)
  if (raw === undefined) return undefined
  // The last dot separates the column, so a future `schema.table.column` needs
  // no change here. Whether the target exists is `validate`'s question.
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) {
    report(
      ctx,
      'ref-malformed',
      'error',
      `\`ref: ${raw}\` is not \`table.column\``,
      field.valueOffset,
    )
    return undefined
  }
  return { table: raw.slice(0, dot), column: raw.slice(dot + 1) }
}

function readNote(ctx: Ctx, fields: FieldSet, path: string, name: string, body: string): Note {
  const layout = takeLayout(ctx, fields, true)
  const color = takeString(ctx, fields, 'color')
  fields.reportUnknown('a note')
  return {
    kind: 'note',
    name,
    path,
    body,
    complete: intact(ctx.out),
    ...(layout === undefined ? {} : { layout }),
    ...(color === undefined ? {} : { color }),
  }
}

function readGroup(ctx: Ctx, fields: FieldSet, path: string, name: string, body: string): Group {
  const label = takeString(ctx, fields, 'label')
  const color = takeString(ctx, fields, 'color')
  const layoutField = fields.take('layout')
  if (layoutField !== undefined) {
    report(
      ctx,
      'unknown-key',
      'warning',
      'a group has no coordinates: its box is the bounding box of its members plus padding, computed at render time (ADR 0005). This `layout` is ignored',
      layoutField.keyOffset,
    )
  }
  fields.reportUnknown('a group')
  return {
    kind: 'group',
    name,
    path,
    body,
    complete: intact(ctx.out),
    ...(label === undefined ? {} : { label }),
    ...(color === undefined ? {} : { color }),
  }
}

/** `allowSize` is false for a table: `w` and `h` belong to a note (ADR 0005). */
function takeLayout(ctx: Ctx, fields: FieldSet, allowSize: boolean): Layout | undefined {
  const field = fields.take('layout')
  if (field === undefined) return undefined
  if (!isMap(field.node)) {
    report(
      ctx,
      'field-wrong-type',
      'error',
      '`layout` must be a mapping such as `{ x: 480, y: 120 }`',
      field.valueOffset,
    )
    return undefined
  }
  const inner = fieldsOf(ctx, field.node)
  const x = requiredNumber(ctx, inner, 'x', field.valueOffset)
  const y = requiredNumber(ctx, inner, 'y', field.valueOffset)
  const w = takeNumber(ctx, inner, 'w')
  const h = takeNumber(ctx, inner, 'h')
  if (!allowSize && (w !== undefined || h !== undefined)) {
    report(
      ctx,
      'unknown-key',
      'warning',
      "`w` and `h` belong to a note, not to a table: a note's size is a design choice and a table's is a consequence of its columns (ADR 0005). They are ignored",
      field.valueOffset,
    )
  }
  inner.reportUnknown('a layout')
  if (x === undefined || y === undefined) return undefined
  return {
    x,
    y,
    ...(allowSize && w !== undefined ? { w } : {}),
    ...(allowSize && h !== undefined ? { h } : {}),
  }
}

// --------------------------------------------------------------------------
// Typed access to YAML nodes. Every accessor here answers "is this the sort of
// value the format says it is", and diagnoses rather than coercing when it is
// not, because a coerced value is a wrong model that looks right.
// --------------------------------------------------------------------------

interface Field {
  readonly node: unknown
  readonly keyOffset: number | undefined
  readonly valueOffset: number | undefined
}

interface FieldSet {
  take(key: string): Field | undefined
  /**
   * A key the format understands well enough to say what to write instead.
   *
   * It is taken out of the mapping without joining the list of known keys that
   * `reportUnknown` offers, because the answer to `null:` is `nullable:` and
   * offering `null` back would be worse than the generic warning it replaces.
   */
  reject(key: string, message: string): void
  /** Every key not taken, as a warning. `what` names the thing, for the text. */
  reportUnknown(what: string): void
}

function fieldsOf(ctx: Ctx, map: YAMLMap<unknown, unknown>): FieldSet {
  const entries = new Map<string, Field>()
  for (const pair of map.items) {
    const key = keyText(ctx, pair.key)
    if (key === undefined) {
      report(ctx, 'field-wrong-type', 'error', 'a key must be a plain name', offsetOf(pair.key))
      continue
    }
    if (entries.has(key)) {
      report(
        ctx,
        'duplicate-key',
        'error',
        `\`${key}\` is given twice; the first one is used`,
        offsetOf(pair.key),
      )
      continue
    }
    entries.set(key, {
      node: pair.value,
      keyOffset: offsetOf(pair.key),
      valueOffset: offsetOf(pair.value) ?? offsetOf(pair.key),
    })
  }

  const taken = new Set<string>()
  return {
    take(key) {
      taken.add(key)
      return entries.get(key)
    },
    reject(key, message) {
      const field = entries.get(key)
      if (field === undefined) return
      entries.delete(key)
      report(ctx, 'superseded-key', 'error', message, field.keyOffset)
    },
    reportUnknown(what) {
      const known = [...taken].sort(byText).join(', ')
      for (const [key, field] of [...entries].sort(([a], [b]) => byText(a, b))) {
        if (taken.has(key)) continue
        report(
          ctx,
          'unknown-key',
          'warning',
          `\`${key}\` means nothing on ${what}; known keys are ${known}`,
          field.keyOffset,
        )
      }
    },
  }
}

/**
 * The name a key was written as.
 *
 * A quoted key is its resolved string. A plain key is its source text, which is
 * the whole point: `null:` resolves to the null value and `on:` resolves, under
 * a `%YAML 1.1` directive, to a boolean, and in both cases the four or two
 * characters the author typed are the name they meant.
 */
function keyText(ctx: Ctx, node: unknown): string | undefined {
  if (!isScalar(node)) return undefined
  if (typeof node.value === 'string') return node.value
  const raw = rawOf(ctx, node)
  return raw === '' ? undefined : raw
}

function stringValue(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined
  return typeof node.value === 'string' ? node.value : undefined
}

/**
 * `hint` is a clause and not a sentence: a diagnostic message is one sentence,
 * lower case, with no trailing full stop, so that a caller can paste it after a
 * location. `src/diagnostics.ts` states that convention once for all of dbmd.
 */
function stringOf(ctx: Ctx, key: string, field: Field, hint?: string): string | undefined {
  const value = stringValue(field.node)
  if (value !== undefined) return value
  report(
    ctx,
    'field-wrong-type',
    'error',
    `\`${key}\` must be a string, but YAML read \`${rawOf(ctx, field.node)}\` as ${describe(field.node)}; ${hint ?? 'quote it'}`,
    field.valueOffset,
  )
  return undefined
}

function takeString(ctx: Ctx, fields: FieldSet, key: string): string | undefined {
  const field = fields.take(key)
  return field === undefined ? undefined : stringOf(ctx, key, field)
}

/**
 * `remedy` is a clause, and it is not optional, because a string the format
 * requires and a string that says nothing are the same mistake made two ways
 * and every caller has to have an answer for the second one. Leaving it off
 * would let the next required key be added with the emptiness check silently
 * skipped, which is how `name: ""` got through in the first place.
 */
function requiredString(
  ctx: Ctx,
  fields: FieldSet,
  key: string,
  fallbackOffset: number | undefined,
  remedy: string,
): string | undefined {
  const field = fields.take(key)
  if (field === undefined) {
    report(ctx, 'field-missing', 'error', `\`${key}\` is required`, fallbackOffset)
    return undefined
  }
  const value = stringOf(ctx, key, field)
  reportBlank(ctx, `\`${key}\``, value, remedy, field.valueOffset)
  return value
}

/**
 * A required string that arrived saying nothing.
 *
 * A warning rather than an error, and the reason is mechanical rather than a
 * matter of taste: an error raised here would make the object incomplete, and
 * an incomplete object is one `writeModel` skips and the studio refuses to
 * edit. Nothing was lost reading `name: ""`, since the empty string is carried
 * exactly as written, so there is nothing here for the writer to protect and an
 * error would lock the table the studio's own `Add column` just wrote.
 * ADR 0027.
 *
 * Whitespace is the same mistake wearing a disguise, so `name: " "` is reported
 * as such rather than passing for a name nobody can see.
 */
function reportBlank(
  ctx: Ctx,
  what: string,
  value: string | undefined,
  remedy: string,
  offset?: number | null,
): void {
  if (value === undefined || value.trim() !== '') return
  report(
    ctx,
    'empty-value',
    'warning',
    `${what} is ${value === '' ? 'empty' : 'only whitespace'}, so ${remedy}`,
    offset,
  )
}

function takeBoolean(ctx: Ctx, fields: FieldSet, key: string): boolean | undefined {
  const field = fields.take(key)
  if (field === undefined) return undefined
  if (isScalar(field.node) && typeof field.node.value === 'boolean') return field.node.value
  report(
    ctx,
    'field-wrong-type',
    'error',
    `\`${key}\` must be true or false, but YAML read \`${rawOf(ctx, field.node)}\` as ${describe(field.node)}`,
    field.valueOffset,
  )
  return undefined
}

function takeNumber(ctx: Ctx, fields: FieldSet, key: string): number | undefined {
  const field = fields.take(key)
  if (field === undefined) return undefined
  return numberOf(ctx, key, field)
}

function requiredNumber(
  ctx: Ctx,
  fields: FieldSet,
  key: string,
  fallbackOffset: number | undefined,
): number | undefined {
  const field = fields.take(key)
  if (field === undefined) {
    report(ctx, 'field-missing', 'error', `\`layout\` needs \`${key}\``, fallbackOffset)
    return undefined
  }
  return numberOf(ctx, key, field)
}

function numberOf(ctx: Ctx, key: string, field: Field): number | undefined {
  if (isScalar(field.node) && typeof field.node.value === 'number') return field.node.value
  report(
    ctx,
    'field-wrong-type',
    'error',
    `\`${key}\` must be a number, but YAML read \`${rawOf(ctx, field.node)}\` as ${describe(field.node)}`,
    field.valueOffset,
  )
  return undefined
}

function seqItems(ctx: Ctx, key: string, field: Field): readonly unknown[] {
  if (isSeq(field.node)) return field.node.items
  report(ctx, 'field-wrong-type', 'error', `\`${key}\` must be a list`, field.valueOffset)
  return []
}

/** What YAML made of a node, for a message that explains rather than accuses. */
function describe(node: unknown): string {
  if (isSeq(node)) return 'a list'
  if (isMap(node)) return 'a mapping'
  if (!isScalar(node)) return 'nothing'
  const value = node.value
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'a boolean'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'string') return 'a string'
  return typeof value
}

/** The characters the author actually typed, which is often the only clue. */
function rawOf(ctx: Ctx, node: unknown): string {
  if (node === null || typeof node !== 'object' || !('range' in node)) return ''
  const range = (node as { range?: readonly number[] }).range
  const start = range?.[0]
  const end = range?.[1]
  if (start === undefined || end === undefined) return ''
  return ctx.yaml.slice(start, end).trim()
}

function offsetOf(node: unknown): number | undefined {
  if (node === null || typeof node !== 'object' || !('range' in node)) return undefined
  return (node as { range?: readonly number[] }).range?.[0]
}

// --------------------------------------------------------------------------
// Odds and ends.
// --------------------------------------------------------------------------

/**
 * The `*.md` files in one kind directory, and a diagnostic for the names that
 * claim to be objects and are not files.
 *
 * A `Dirent` answers from the `lstat` `readdir` already did, so `isFile()` is
 * false for a symlink whatever it points at. This filtered on `isFile()` alone
 * until dbmd-95n, which meant a symlinked `tables/orders.md` was dropped and the
 * model came back one table short with nothing said. That is ADR 0038's silence
 * one level down, and the fix is the same shape: stop asking a `Dirent` a
 * question it cannot answer.
 *
 * **A name ending in `.md` here has to open as a file, and a directory is an
 * error.** That is ADR 0040 and it is the question this had to answer, because
 * a link to a *directory* called `orders.md` is as easy to make as a link to a
 * file and both were silent. Reading it is impossible and skipping it is what
 * the bug was, so what is left is to say so: the file name is the object's
 * identity, `orders.md` is the whole of what makes a table `orders`, and a name
 * in that position that can never be an object is worth a sentence. A *real*
 * directory called `orders.md` gets the same sentence as a link to one, because
 * a rule that treated a link differently from the thing it points at would be
 * the same mistake in a new place.
 *
 * **A subdirectory holding markdown is an `object-in-subdirectory` error**, and
 * that is ADR 0054, which narrows the sentence 0040 wrote here. A name that is
 * not `*.md` still claims nothing on its own: an empty `tables/drafts/`, a
 * `tables/screenshots/` of PNGs, a `README.txt` are all silent, link or not,
 * exactly as a junctioned `sketches/` at the model root is silent. What is not
 * silent is a directory with an `orders.md` under it, because 0040's own rule
 * says that name is a claim to be the table `orders`, and the claim is the
 * file's rather than the directory's. It is one folder too deep and one error,
 * not one per file: a misplaced `node_modules` would otherwise be a page of
 * them.
 *
 * A directory whose name begins with `.` is skipped before any of this, as a
 * dot-file is, and that is the way to keep an archive beside a model without
 * dbmd having an opinion about it.
 *
 * **What it costs.** One `stat`, and only for an entry that is neither a plain
 * file nor a plain directory, which is to say only for a link. A model with no
 * links in it makes no call it did not make before, whatever its size, because
 * every entry takes the `isFile()` branch. Measured on a 2,000-table model on
 * Windows 11 with Node 24: zero `stat` calls, and 718 ms against 721 ms for the
 * reader this replaced, which is noise. The bound if every file were a link is
 * one `stat` each at 47 µs, so 94 ms on those 2,000. ADR 0040 has the numbers.
 */
async function markdownFiles(
  dir: string,
  relative: string,
  kind: ObjectKind,
  out: Diagnostic[],
): Promise<Listing> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    push(out, {
      code: 'file-unreadable',
      severity: 'error',
      at: inDirectory(relative),
      message: `cannot list the directory: ${messageOf(error)}`,
    })
    return { files: [], directories: [] }
  }

  const files: string[] = []
  const directories: string[] = []
  for (const entry of entries) {
    const name = entry.name
    if (name.startsWith('.')) continue

    if (!name.endsWith('.md')) {
      // A plain file settles it with no call and is nobody's business: a
      // `README`, a `notes.txt`, a `schema.sql`. Everything else may be a
      // directory, and a directory here may be holding objects. `isDirectory()`
      // settles a real one for free; only a link costs the `stat`, which is the
      // same bargain the `.md` branch below already struck.
      if (entry.isFile()) continue
      const path = join(dir, name)
      if (!entry.isDirectory() && !(await pointsAtADirectory(path))) continue
      const claim = await firstMarkdownUnder(path)
      if (claim === undefined) continue
      push(out, {
        code: 'object-in-subdirectory',
        severity: 'error',
        at: inDirectory(`${relative}/${name}`),
        message: `\`${name}/\` is a directory inside \`${relative}/\`, and dbmd reads only the files directly in \`${relative}/\`, so \`${relative}/${name}/${claim}\` is not a ${kind}; move the markdown up into \`${relative}/\``,
      })
      continue
    }

    if (entry.isFile()) {
      files.push(name)
      continue
    }
    // Not a plain file, so this is a link, a directory, or something exotic.
    // `isDirectory()` settles a real directory with no call; everything else
    // needs the call that follows the link, because nothing else can tell a
    // link to a file from a link to a directory.
    if (entry.isDirectory() || (await pointsAtADirectory(join(dir, name)))) {
      push(out, {
        code: 'object-not-a-file',
        severity: 'error',
        at: inDirectory(`${relative}/${name}`),
        message: `\`${name}\` is a directory rather than a file, so there is no ${kind} \`${name.slice(0, -'.md'.length)}\`; a link that resolves to a directory looks exactly like this`,
      })
      directories.push(name)
      continue
    }
    // A link to a file, or a link to nothing. The read that follows is the
    // judge either way: a link that dangles fails it with `ENOENT` and raises
    // `file-unreadable`, which is what a listed name that will not open has
    // always meant here.
    files.push(name)
  }
  return { files: files.sort(byText), directories: directories.sort(byText) }
}

/**
 * What one kind directory holds, split by whether reading it is even possible.
 *
 * Both halves are object paths and neither is an object yet. `files` is what
 * the caller goes on to open; `directories` is the names it never can, and they
 * are returned rather than dropped because "there is no `tables/orders.md`" is
 * false about every one of them and three diagnostics elsewhere used to say it.
 * ADR 0090.
 */
interface Listing {
  /** The `.md` names to read, sorted. */
  readonly files: readonly string[]
  /** The `.md` names that are directories, sorted. */
  readonly directories: readonly string[]
}

/**
 * Whether following `file` arrives at a directory.
 *
 * A failure is answered `false` rather than diagnosed, and deliberately: the
 * caller's next move is to read the file, which fails with the same errno and
 * says `file-unreadable` in the words `docs/format.md` already documents. A
 * diagnostic here would be a second sentence about one broken link, worded for
 * a call the user never asked for.
 */
async function pointsAtADirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory()
  } catch {
    return false
  }
}

/**
 * How far under a subdirectory of a kind directory the search for a claim goes.
 *
 * A cap rather than a cycle check, and that is the whole of the loop protection:
 * this descends into links, because a junctioned `tables/billing/` is exactly
 * the case ADR 0038 was written about and refusing to follow it would be that
 * silence again, and a link that points back at its own parent would otherwise
 * never return. Eight is far past any model anybody has: a subdirectory is
 * already the mistake, and eight of them is the same mistake said eight times.
 */
const SEARCH_DEPTH = 8

/**
 * The first markdown name under `dir`, relative to it, or `undefined` if there
 * is none.
 *
 * The *name* is the claim and nothing is opened, which is why a `Dirent` is
 * enough here and no `stat` is made: `orders.md` inside `tables/billing/` is a
 * claim to be the table `orders` whether it is a file, a link, or a directory,
 * and it is not going to be read either way. ADR 0054.
 *
 * It stops at the first one, so the usual cost is one `readdir`, and a
 * `node_modules` somebody has put in `tables/` costs the two or three it takes
 * to reach the first `README.md` rather than a walk of the whole tree. That is
 * also why the message names one file rather than counting them: counting means
 * finishing the walk, and one real path a person can open is the evidence they
 * need.
 *
 * Entries are sorted, so the file the message names is the same on every
 * platform and in every run. Files are looked at before subdirectories at each
 * level, because the shallowest claim is the one a person will recognise.
 */
async function firstMarkdownUnder(dir: string, depth = SEARCH_DEPTH): Promise<string | undefined> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // Unreadable, or a link to something that is not a directory after all.
    // Nothing is diagnosed: this directory is not part of the model and the
    // caller's question was only whether anything under it claimed to be.
    return undefined
  }

  const listing = [...entries]
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => byText(a.name, b.name))

  const claim = listing.find((entry) => entry.name.endsWith('.md'))
  if (claim !== undefined) return claim.name
  if (depth <= 1) return undefined

  for (const entry of listing) {
    if (entry.isFile()) continue
    const found = await firstMarkdownUnder(join(dir, entry.name), depth - 1)
    if (found !== undefined) return `${entry.name}/${found}`
  }
  return undefined
}

async function readText(
  file: string,
  relative: string,
  out: Diagnostic[],
): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    push(out, {
      code: 'file-unreadable',
      severity: 'error',
      at: inFile(relative),
      message: `cannot read the file: ${messageOf(error)}`,
    })
    return undefined
  }
}

function push(out: Diagnostic[], diagnostic: Diagnostic): void {
  out.push(diagnostic)
}

function emptyModel(): Model {
  return {
    body: '',
    complete: true,
    tables: [],
    notes: [],
    groups: [],
    referencesTo: new Map(),
    groupMembers: new Map(),
    // Nothing was refused because nothing was listed: the one caller is the
    // model directory that would not open at all.
    refused: [],
  }
}
