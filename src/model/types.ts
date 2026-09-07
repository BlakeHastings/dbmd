/**
 * The in-memory shape of a `db-model/` directory.
 *
 * The on-disk format is ADR 0003 (one markdown file per table, frontmatter plus
 * an opaque prose body) as extended by ADR 0005 (a directory per kind, and
 * membership declared by the member). These types are that format after
 * parsing, and nothing more: they hold what the files say, not what the files
 * ought to say. Deciding whether a `ref` points at a table that exists is
 * `src/model/validate.ts`'s job, not this module's.
 */

import type { Diagnostic } from '../diagnostics.js'

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
  /** `nullable: false`. Absent means the file did not say. */
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

/**
 * Engine SQL standing where a column name could stand, written
 * `{ expression: "lower(email)" }` in an index's `columns` list.
 *
 * It is a mapping and not a string because the string is already taken: a
 * column may legally be called `lower(email)`, so a bare string that sometimes
 * meant a column and sometimes meant SQL would be a fact dbmd could not read
 * back. ADR 0022, and the reason it happened is dbmd-18.
 *
 * The text is carried and never interpreted. dbmd does not parse SQL, so it
 * cannot say which columns an expression mentions, and the validator therefore
 * says nothing about one rather than guessing.
 */
export interface IndexExpression {
  readonly expression: string
}

/**
 * One key of an index: a column of this table by name, or an expression.
 *
 * A plain string is the column, because that is what a hand-author types and
 * what nearly every index is. The introspection contract spells the same key
 * `{ column: 'email' }` (`IndexKey` in `src/import/contract.ts`), and the
 * asymmetry is deliberate: a file is written by a person and a wire format is
 * written by a provider, and an unlabelled string in the wire format is exactly
 * the bug this union exists to close.
 */
export type IndexKey = string | IndexExpression

export interface Index {
  readonly name: string
  readonly columns: readonly IndexKey[]
  /**
   * `unique: true`. Absent means the file did not say, which is a plain index.
   *
   * Uniqueness is an index's property and never a column's, even when the index
   * has one column. A unique constraint has a name, that name is what the engine
   * prints when the constraint fires, and a column has nowhere to put one.
   */
  readonly unique?: boolean
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
  /**
   * `false` when the reader raised an error building this object from its file,
   * which means the file holds something this object does not: a column whose
   * type YAML resolved to a boolean, a key given twice, a `table:` that
   * disagrees with the file name.
   *
   * It is a fact about the read rather than about the file, and it is on the
   * object rather than beside it because it has to survive every journey the
   * object takes. The writer refuses to write an incomplete object, since
   * writing it back would delete the lines the reader could not understand, and
   * a diagnostics array carried separately is exactly the thing that gets
   * dropped on the way through the studio's HTTP layer. ADR 0010.
   *
   * It is required rather than optional so that a model built from scratch, by
   * an importer or a test, has to say `complete: true` out loud. An omitted
   * field would default to safe-looking and destructive, which is the shape
   * this replaced.
   */
  readonly complete: boolean
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
  /**
   * The same fact as `CanvasObject.complete`, about `_model.md`. A missing
   * `_model.md` is complete: there is nothing in it to lose, and `dbmd init`
   * writing one is the point.
   */
  readonly complete: boolean
  readonly tables: readonly Table[]
  readonly notes: readonly Note[]
  readonly groups: readonly Group[]
  /**
   * Target table name to the edges pointing at it: the reverse of `ref`, which
   * ADR 0003 deliberately left uncomputed on disk. Keyed by the name written in
   * the `ref`, so an edge to a table that does not exist still appears here;
   * saying so is `src/model/validate.ts`'s job.
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
 * The diagnostic contract lives in `src/diagnostics.ts`: one type for the model
 * reader and the import contract both, because they become one thing the moment
 * `dbmd check --json` prints them into one array. ADR 0014.
 *
 * Re-exported here so that a caller holding a `Model` does not have to know
 * where the type moved to, and so the shape has exactly one definition.
 */
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticLocation,
  ModelDiagnosticCode,
  Severity,
} from '../diagnostics.js'

export interface ReadResult {
  readonly model: Model
  /** Sorted by path, then line, then code, then message. Never a throw. */
  readonly diagnostics: readonly Diagnostic[]
}
