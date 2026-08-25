// Diagnostics produced while reading an introspection file.
//
// These are output, so ADR 0006 applies to them: the shape is a contract before
// it is a convenience, and a list of them sorts deterministically before anybody
// prints it. `code` is the part a machine reads and `message` is the part a human
// reads; neither is derived from the other, so the wording can change without
// breaking a caller that switched on the code.
//
// Scoped to import on purpose. dbmd-12 has model diagnostics that carry a file
// path and a line number, which is a different enough thing that sharing one type
// today would mean a union of fields where half are always absent.

/** A diagnostic that stops the import, or one that only warns. */
export type DiagnosticSeverity = 'error' | 'warning'

/**
 * The closed set of things reading an introspection file can complain about.
 * Adding a member is additive; renaming one is a breaking change to the `--json`
 * output, per ADR 0006.
 */
export type DiagnosticCode =
  /** The value, or the value at `path`, is not a JSON object. */
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

export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly severity: DiagnosticSeverity
  /**
   * Where in the document the problem is, as a JSONPath-style expression rooted
   * at `$`. Paths from a provider's `parse` point into the engine's file; paths
   * from the contract validator point into the canonical document.
   */
  readonly path: string
  /** One sentence, no trailing full stop, readable without the file open. */
  readonly message: string
}

/**
 * The outcome of anything that turns an untrusted value into a known shape.
 * Diagnostics are carried on success too, because a warning does not stop an
 * import and still has to reach the caller.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/** Byte-order comparison. Never `localeCompare`: ADR 0006 wants the same bytes on every machine. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Deterministic order for a diagnostic list: by path, then code, then message.
 * Returns a new array so a caller's accumulator is not reordered under it.
 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      compareCodeUnits(a.path, b.path) ||
      compareCodeUnits(a.code, b.code) ||
      compareCodeUnits(a.message, b.message),
  )
}

/** True when anything in the list would stop the import. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}

/**
 * One line per diagnostic, sorted, with no colour and no stream opinion. Choosing
 * a stream and colouring the result belongs to the output contract (dbmd-70);
 * this is only the text.
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  return sortDiagnostics(diagnostics).map((d) => `${d.severity} ${d.path} [${d.code}] ${d.message}`)
}
