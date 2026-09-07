// The import module's view of the diagnostic contract.
//
// There used to be a `Diagnostic` here and another in `src/model/types.ts`, two
// agents having converged on nearly the same shape without being able to see
// each other. There is now one, in `src/diagnostics.ts`, and ADR 0014 says why
// it had to happen before `--json` shipped rather than after. What is left here
// is the re-export, so that the import module's own files keep importing from
// their own module, and `Result<T>`, which is import's alone.
//
// Import diagnostics point into a JSON document rather than at a file, so they
// are built with `inDocument('$.tables[0].name')` and never carry a line: the
// input is a value dbmd was handed, and dbmd never saw its lines.

export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticLocation,
  ImportDiagnosticCode,
  Severity,
} from '../diagnostics.js'
export {
  compareCodeUnits,
  compareDiagnostics,
  formatDiagnostics,
  hasErrors,
  inDocument,
  locationText,
  sortDiagnostics,
} from '../diagnostics.js'

import type { Diagnostic } from '../diagnostics.js'

/**
 * The outcome of anything that turns an untrusted value into a known shape.
 * Diagnostics are carried on success too, because a warning does not stop an
 * import and still has to reach the caller.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
