/**
 * The diagnostic contract. One type, for every part of dbmd that complains.
 *
 * ADR 0008 made a diagnostic structured output, and ADR 0006 makes structured
 * output public the moment `--json` prints it, so this shape is a contract:
 * adding a `DiagnosticCode` is additive, renaming one is breaking, and
 * `message` is the half that stays free to be reworded. ADR 0014 is why the two
 * types that used to live in `model/types.ts` and `import/diagnostics.ts` are
 * one type here instead.
 *
 * **Where a diagnostic points is a discriminated union, not a string.** The
 * model reader points at a file, by a slash-separated path relative to the model
 * directory, usually with a 1-based line. The import contract points into a JSON
 * document, by a JSONPath rooted at `$`, and its input has no lines to point at.
 * Those are different things and `at.in` says which you are holding, so a
 * consumer that wants to open an editor at a line has to ask, and a consumer
 * that only wants to print a location calls `locationText` and never asks.
 *
 * **Message convention, stated once: one sentence, no leading capital, no
 * trailing full stop, legible without the file open.** A caller pastes it after
 * a location, so it is a clause rather than a paragraph, and a caller that
 * switches on prose rather than on `code` is holding it wrong.
 */

/**
 * `error` means something did not make it through: a file did not load as
 * declared, or an import stops here. `warning` means it loaded and is likely
 * wrong anyway.
 */
export type Severity = 'error' | 'warning'

/**
 * The closed set of things reading or validating a model directory can complain
 * about.
 *
 * Both halves are one union, and that is deliberate: nothing downstream needs
 * to know whether `src/model/read.ts` or `src/model/validate.ts` raised a code.
 * `CanvasObject.complete` already carries the only distinction that turned out
 * to matter, which is whether a file lost something on the way in. ADR 0017.
 *
 * `docs/format.md` has a row for every member and `test/docs/format.test.ts`
 * reads this union out of this file to prove it, so adding a member here
 * without adding a row there is a red build, and so is deleting one and leaving
 * the row behind. Format this declaration however reads best: that test slices
 * it at the next top-level `export`, so a blank line in it costs nothing. It
 * used to slice at the first blank line, and dbmd-8ms is what that cost.
 */
export type ModelDiagnosticCode =
  /** `readModel` was pointed at something that is not a readable directory. */
  | 'model-directory-unreadable'
  /** A file under the model directory could not be read at all. */
  | 'file-unreadable'
  /** There is no `_model.md`, so the model has no name and no engine. */
  | 'model-file-missing'
  /** A directory under the model root that is not a known kind. */
  | 'unknown-kind-directory'
  /**
   * `tables`, `notes` or `groups` is there and is a plain file, so the kind it
   * names can never be read. ADR 0038.
   *
   * Distinct from `file-unreadable`, which means a filesystem call failed.
   * Nothing failed here: the entry was listed successfully and it is simply not
   * the sort of thing that holds files.
   */
  | 'kind-not-a-directory'
  /**
   * A name ending in `.md` inside `tables/`, `notes/` or `groups/` that is a
   * directory rather than a file, so the object it names was never read. Its
   * link-shaped form is why it exists: a junction or a symlink resolving to a
   * directory. ADR 0040.
   *
   * The mirror of `kind-not-a-directory` one level down, and distinct from
   * `file-unreadable` for the same reason: nothing failed. The entry was listed
   * and then followed, successfully, to a directory.
   */
  | 'object-not-a-file'
  /** The file does not begin with a `---` line. */
  | 'frontmatter-absent'
  /** `---` on the first line and no closing `---` anywhere after it. */
  | 'frontmatter-unterminated'
  /** The delimiters are there with nothing but whitespace between them. */
  | 'frontmatter-empty'
  /** The YAML parser rejected the frontmatter. */
  | 'frontmatter-invalid'
  /** The frontmatter parsed, but to a scalar or a list rather than to keys. */
  | 'frontmatter-not-a-map'
  /** Two keys in one mapping resolve to the same name. */
  | 'duplicate-key'
  /** A `kind:` that disagrees with the directory the file is in. */
  | 'kind-mismatch'
  /** No `kind:` key at all. */
  | 'kind-missing'
  /** A `table:` that disagrees with the file's own name. */
  | 'name-mismatch'
  /** A table file with no `table:` key. */
  | 'name-missing'
  /** A required key is absent. */
  | 'field-missing'
  /** A key holds the wrong sort of value: a boolean where a string was wanted. */
  | 'field-wrong-type'
  /**
   * A required name or list is present and says nothing: `name: ""`, a name
   * that is only whitespace, or an index whose `columns` is `[]`.
   *
   * It is a warning and never an error, and that is a decision rather than a
   * default. An error from the reader means the object is missing something its
   * file has, which is what makes the writer refuse to save over the file, and
   * an empty name loses nothing: the reader carries the empty string exactly as
   * written. It is also what a model looks like halfway through being edited,
   * since `Add column` writes an empty row the moment it is clicked. ADR 0027.
   */
  | 'empty-value'
  /** A key that means nothing to this kind of file. */
  | 'unknown-key'
  /**
   * A key dbmd recognises but does not accept, because the format spells that
   * fact under another name or in another place. The message says which.
   *
   * It is an error rather than a warning, and that is the whole point of having
   * it: the fact the author wrote is a real one, and a warning would leave the
   * object complete, so the next save would write the file back without it.
   */
  | 'superseded-key'
  /** A `ref:` that is not `table.column`. */
  | 'ref-malformed'
  /** A `group:` naming a group file that does not exist. */
  | 'group-unknown'
  // Everything below is the validator's. A reader code is about one file and
  // usually carries a line; a validator code is about the model, so it carries
  // a path and no line, because the model it is given holds no offsets and
  // searching the file for a column name is how you get a confidently wrong
  // line. ADR 0017.
  /** A `ref:` whose table half names no table in the model. */
  | 'ref-table-unknown'
  /** A `ref:` whose table exists and whose column half is not one of its columns. */
  | 'ref-column-unknown'
  /**
   * A `ref:` at a column nothing in the model declares unique: not a whole
   * primary key, and not covered by a single-column unique index. Usually a
   * typo, occasionally deliberate, which is why it is a warning.
   */
  | 'ref-target-not-unique'
  /** Two tables in one model under one name. Reachable by import, not by reading. */
  | 'duplicate-table'
  /** Two columns of one table under one name. */
  | 'duplicate-column'
  /** Two indexes of one table under one name. */
  | 'duplicate-index'
  /** An `indexes:` entry naming a column its own table does not have. */
  | 'index-column-unknown'
  /** A table that has columns and puts `pk: true` on none of them. */
  | 'primary-key-missing'
  /** A group file that no table declares itself a member of. */
  | 'group-empty'

/**
 * The closed set of things reading an introspection file can complain about.
 * Prefixed, because these travel in the same array as the model's in a mixed
 * run and a reader should not have to know which module owns a bare name.
 */
export type ImportDiagnosticCode =
  /** The value, or the value at the location, is not a JSON object. */
  | 'import/not-an-object'
  /** A required field is absent, or present and null. */
  | 'import/missing-field'
  /** A field is present but is the wrong JSON type. */
  | 'import/wrong-type'
  /** A string or list is present but empty where emptiness cannot be meant. */
  | 'import/empty-value'
  /** `dbmdIntrospection` names a version this build does not read. */
  | 'import/unsupported-version'
  /** `engine` names an engine no provider in this build claims. */
  | 'import/unknown-engine'
  /** `--engine` disagreed with the envelope and won. Never silent: ADR 0007. */
  | 'import/engine-overridden'
  /** A field nothing in this version reads. Kept as a warning, never fatal. */
  | 'import/unknown-field'
  /** Two things that must be distinguishable are byte-identical. */
  | 'import/duplicate'
  /** A foreign key's local and referenced column lists are different lengths. */
  | 'import/mismatched-columns'
  /** A value is outside a closed vocabulary the contract defines. */
  | 'import/not-in-vocabulary'
  /**
   * Two fields are given where the shape allows exactly one of them, so there
   * is no fact to keep. An index key saying both `column` and `expression` is
   * the case it was added for.
   */
  | 'import/conflicting-fields'
  // The three below are raised by `dbmd import` rather than by the contract:
  // they are about the model the document became, which is a thing only the
  // caller that builds one can see. ADR 0029.
  /**
   * A catalogue name that no filesystem would accept as a file, so the table
   * has nowhere to be written.
   *
   * ADR 0026 says why this code exists here and nowhere else. The writer
   * reports it as a `WriteSkip` because a name is a fact about the model rather
   * than about the disk, and no *reader* can ever raise it, because the
   * filesystem refuses the name before dbmd is involved. An importer takes its
   * names from a database catalogue, which has no such rule, so it is the one
   * caller that can hold a table called `Ledger: Entry`.
   */
  | 'import/unsafe-name'
  /**
   * A foreign key whose referenced table is not in the file, so there is no
   * `ref:` to write. A partial export rather than a broken model, which is why
   * it is a warning and why the ref is dropped instead of being written and
   * left for `dbmd check` to find.
   */
  | 'import/reference-not-exported'
  /**
   * Two tables that would be written to one file. A model directory is flat
   * (ADR 0003), so two schemas with a table of the same name collide, and
   * writing both would silently keep whichever was written last.
   */
  | 'import/name-collision'

/**
 * Every code dbmd can emit. `dbmd check --json` prints diagnostics from both
 * halves into one array, so the two unions meet here rather than at the point
 * of printing.
 */
export type DiagnosticCode = ModelDiagnosticCode | ImportDiagnosticCode

/**
 * Where the problem is.
 *
 * `in` is the discriminant and it is the whole reason this is not a string.
 * A file location can be opened in an editor at a line; a document location
 * cannot, because the input is a JSON file whose lines dbmd never saw. Nothing
 * derives one from the other and nothing guesses.
 */
export type DiagnosticLocation =
  | {
      readonly in: 'file'
      /** Slash-separated, relative to the model directory. Never absolute: ADR 0006. */
      readonly path: string
      /**
       * 1-based, counting lines of the file rather than of the frontmatter.
       * Present only where it is honestly derivable: a problem with the file as
       * a whole, such as absent frontmatter, does not get one.
       */
      readonly line?: number
    }
  | {
      readonly in: 'document'
      /**
       * A JSONPath-style expression rooted at `$`, such as
       * `$.tables[3].columns[1].name`. Paths from a provider's `parse` point
       * into the engine's file; paths from the contract validator point into
       * the canonical document.
       */
      readonly jsonPath: string
    }

/**
 * One problem, from anywhere in dbmd.
 *
 * A type alias rather than an `interface`, and that is load-bearing rather than
 * a style choice: TypeScript gives an object type alias an implicit index
 * signature and never gives one to an interface, so an interface with exactly
 * these fields is not assignable to `Payload` in `src/cli/output.ts` and cannot
 * be handed to `report({ json })`. A diagnostic is a thing that goes in the
 * `--json` envelope, so it has to be a type the envelope accepts.
 * `test/diagnostics.test.ts` is what stops that regressing.
 */
export type Diagnostic = {
  readonly code: DiagnosticCode
  readonly severity: Severity
  readonly at: DiagnosticLocation
  readonly message: string
}

/** A file location, with the optional line handled once rather than at every call. */
export function inFile(path: string, line?: number): DiagnosticLocation {
  // Spread rather than `line` directly: `exactOptionalPropertyTypes` makes
  // `line: undefined` a different thing from an absent `line`, and an absent one
  // is what `JSON.stringify` should see.
  return { in: 'file', path, ...(line === undefined ? {} : { line }) }
}

/** A location inside a JSON document, written as a JSONPath rooted at `$`. */
export function inDocument(jsonPath: string): DiagnosticLocation {
  return { in: 'document', jsonPath }
}

/**
 * The location as one printable string: `tables/orders.md:4`, or `$.tables[0]`.
 *
 * This is the consumer that does not care which it has. One that does care asks
 * `at.in` and gets a typed answer; there is deliberately no way to reach `line`
 * without asking.
 */
export function locationText(at: DiagnosticLocation): string {
  if (at.in === 'document') return at.jsonPath
  return at.line === undefined ? at.path : `${at.path}:${at.line}`
}

/**
 * What a filesystem error says, in words a reader can act on, with the errno
 * next to them.
 *
 * **Only the errno is taken from the error, and that is the point.** A Node
 * filesystem error's `message` carries the path the call was made with, which
 * for a model read is absolute, and ADR 0006 rule 4 forbids an absolute path in
 * output because it makes two machines disagree about identical input. An errno
 * is the same eight letters everywhere, so it is the only half of the error
 * that may be printed, and anything richer has to be written here rather than
 * lifted from the system.
 *
 * The words are here because a bare `EACCES` is not a sentence. `docs/format.md`
 * tells a reader of `file-unreadable` to check permissions, which is advice
 * they can only follow once they know that is what they are looking at, and
 * half the errnos below are not about permissions at all.
 *
 * An errno with no entry falls back to itself rather than to a guess, and a
 * thrown non-`Error` has no errno to fall back to.
 */
export function errnoText(error: unknown): string {
  if (!(error instanceof Error) || !('code' in error)) return 'unknown error'
  const code = String(error.code)
  const reason = ERRNO_REASON.get(code)
  return reason === undefined ? code : `${reason} (${code})`
}

/**
 * The errnos a read of a model directory or an import file can actually end at,
 * each in one clause with no leading capital, so it reads after a colon.
 *
 * Deliberately short. This is not a copy of `errno.h`: a code that has never
 * been seen here would be words invented for a case nobody has met, and the
 * fallback already prints the code itself.
 */
const ERRNO_REASON = new Map<string, string>([
  ['EACCES', 'permission denied'],
  ['EPERM', 'the operation is not permitted'],
  ['ENOENT', 'no such file or directory'],
  ['EISDIR', 'it is a directory'],
  ['ENOTDIR', 'a directory in the path is not a directory'],
  ['ELOOP', 'too many symbolic links'],
  ['ENAMETOOLONG', 'the path is too long'],
  ['EMFILE', 'this process has too many files open'],
  ['ENFILE', 'the system has too many files open'],
  ['EBUSY', 'the file is in use'],
  ['EIO', 'the filesystem reported an I/O error'],
])

/** Byte-order comparison. Never `localeCompare`: ADR 0006 wants the same bytes on every machine. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Deterministic order: by location, then line, then code, then message.
 *
 * The line is compared as a number and never as text, so line 9 comes before
 * line 10, which is why this does not sort on `locationText`. It orders a mixed
 * array too: a JSONPath starts with `$` and a model path starts with a file
 * name, so the two halves of a mixed run land in blocks without the comparator
 * having to say so.
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    compareCodeUnits(pathOf(a.at), pathOf(b.at)) ||
    lineOf(a.at) - lineOf(b.at) ||
    compareCodeUnits(a.code, b.code) ||
    compareCodeUnits(a.message, b.message)
  )
}

function pathOf(at: DiagnosticLocation): string {
  return at.in === 'file' ? at.path : at.jsonPath
}

function lineOf(at: DiagnosticLocation): number {
  return at.in === 'file' ? (at.line ?? 0) : 0
}

/** Sorted, in a new array, so a caller's accumulator is not reordered under it. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics)
}

/** True when anything in the list is fatal to whatever produced it. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}

/**
 * One line per diagnostic, sorted, with no colour and no stream opinion. Choosing
 * a stream and colouring the result belongs to the output contract (dbmd-70);
 * this is only the text.
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  return sortDiagnostics(diagnostics).map(
    (d) => `${d.severity} ${locationText(d.at)} [${d.code}] ${d.message}`,
  )
}
