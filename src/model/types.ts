/**
 * The in-memory shape of a `db-model/` directory.
 *
 * The on-disk format is ADR 0003 (one markdown file per table, frontmatter plus
 * an opaque prose body) as extended by ADR 0005 (a directory per kind, and
 * membership declared by the member). These types are that format after
 * parsing, and nothing more: they hold what the files say, not what the files
 * ought to say. Deciding whether a `ref` points at a table that exists is
 * dbmd-12's job, not this module's.
 */

/** The kinds of object a model directory holds. The directory name decides. */
export type ObjectKind = 'table' | 'note' | 'group'

/**
 * A position on the canvas. `w` and `h` are a note's, because a note's size is
 * a design choice and a table's is a consequence of its columns (ADR 0005).
 * A group has no coordinates at all: its box is computed from its members.
 */
export interface Layout {
  readonly x: number
  readonly y: number
  readonly w?: number
  readonly h?: number
}

/** A foreign key target, written on the referring column as `table.column`. */
export interface Ref {
  readonly table: string
  readonly column: string
}

export interface Column {
  readonly name: string
  readonly type: string
  /** `pk: true`. Two columns with it are a composite primary key. */
  readonly pk?: boolean
  /**
   * The frontmatter key is literally `null`, so `null: false` here is
   * `nullable: false`. Absent means the file did not say.
   */
  readonly nullable?: boolean
  /**
   * The SQL default, verbatim, as the author wrote it inside the YAML scalar.
   * A SQL string literal keeps its quotes: `default: "'pending'"` arrives here
   * as `'pending'`, six characters, and is emitted into DDL-shaped output as
   * those six characters.
   */
  readonly default?: string
  readonly ref?: Ref
}

export interface Index {
  readonly name: string
  readonly columns: readonly string[]
}

/** What every object on the canvas has, whatever its kind. */
interface CanvasObjectBase {
  /**
   * The identity of the object, which is its file's base name without `.md`.
   * The path is the identity for the same reason for all three kinds: a table
   * is reached as `ref: customers.id` from `tables/customers.md`, and a group
   * as `group: billing` from `groups/billing.md`.
   */
  readonly name: string
  /** Slash-separated and relative to the model directory, so it is stable. */
  readonly path: string
  /**
   * Everything after the closing frontmatter delimiter, byte for byte, line
   * endings included. Never parsed as markdown, never reflowed, never trimmed.
   */
  readonly body: string
}

export interface Table extends CanvasObjectBase {
  readonly kind: 'table'
  readonly columns: readonly Column[]
  readonly indexes: readonly Index[]
  readonly layout?: Layout
  /** The group this table declares itself a member of, if any. */
  readonly group?: string
}

/** Prose with a position. The body is the note. */
export interface Note extends CanvasObjectBase {
  readonly kind: 'note'
  readonly layout?: Layout
  readonly color?: string
}

/** What the group is. Never who is in it: that is declared by the members. */
export interface Group extends CanvasObjectBase {
  readonly kind: 'group'
  readonly label?: string
  readonly color?: string
}

export type CanvasObject = Table | Note | Group

/** One `ref`, as an edge, so it can be read from either end. */
export interface RefEdge {
  readonly from: Ref
  readonly to: Ref
}

/**
 * A whole model directory.
 *
 * `referencesTo` and `groupMembers` are computed rather than declared. They are
 * built here, once, because the validator, the studio and the exporter all want
 * them and none of them should walk the tables again to get them. Every array
 * in the model is sorted, so two reads of the same bytes produce the same
 * order (ADR 0006 rule 4).
 */
export interface Model {
  /** From `_model.md`. Absent when the file is missing or does not say. */
  readonly name?: string
  readonly engine?: string
  /** The prose body of `_model.md`, verbatim. Empty when there is no such file. */
  readonly body: string
  readonly tables: readonly Table[]
  readonly notes: readonly Note[]
  readonly groups: readonly Group[]
  /**
   * Target table name to the edges pointing at it: the reverse of `ref`, which
   * ADR 0003 deliberately left uncomputed on disk. Keyed by the name written in
   * the `ref`, so an edge to a table that does not exist still appears here;
   * saying so is dbmd-12's job.
   */
  readonly referencesTo: ReadonlyMap<string, readonly RefEdge[]>
  /**
   * Group name to the names of the tables that declared membership in it. Every
   * group file gets an entry, possibly empty. A `group:` naming no group file
   * gets no entry, because a missing group is a diagnostic and not a reason to
   * invent one.
   */
  readonly groupMembers: ReadonlyMap<string, readonly string[]>
}

/**
 * `error` means the file did not load as it was declared and something is
 * missing from the model. `warning` means it loaded and something is likely
 * wrong anyway.
 */
export type Severity = 'error' | 'warning'

/**
 * The machine-readable half of a diagnostic. `dbmd check --json` will put these
 * on stdout, which makes them a contract under ADR 0006: adding a code is fine,
 * renaming one is a breaking change. The `message` is the half that is free to
 * be reworded, and a caller that switches on prose instead of `code` is holding
 * it wrong.
 */
export type DiagnosticCode =
  /** `readModel` was pointed at something that is not a readable directory. */
  | 'model-directory-unreadable'
  /** A file under the model directory could not be read at all. */
  | 'file-unreadable'
  /** There is no `_model.md`, so the model has no name and no engine. */
  | 'model-file-missing'
  /** A directory under the model root that is not a known kind. */
  | 'unknown-kind-directory'
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
  /** A key that means nothing to this kind of file. */
  | 'unknown-key'
  /** A `ref:` that is not `table.column`. */
  | 'ref-malformed'
  /** A `group:` naming a group file that does not exist. */
  | 'group-unknown'

/**
 * One problem with one file. `path` is relative to the model directory and
 * slash-separated, and there are no absolute paths and no timestamps anywhere
 * in here, so the same bytes on two machines produce the same diagnostics.
 *
 * `line` is 1-based and counts lines of the file, not of the frontmatter. It is
 * present only where it is honestly derivable: a problem with the file as a
 * whole, such as absent frontmatter, does not get one.
 */
export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly severity: Severity
  readonly path: string
  readonly line?: number
  readonly message: string
}

export interface ReadResult {
  readonly model: Model
  /** Sorted by path, then line, then code, then message. Never a throw. */
  readonly diagnostics: readonly Diagnostic[]
}
