export { mermaidDiagram, mermaidSection } from './export/mermaid.js'
export type { MermaidSection } from './export/mermaid.js'
export { readModel } from './model/read.js'
export { validate } from './model/validate.js'
export { serialiseModelFile, serialiseObject, writeModel } from './model/write.js'
export type { SkipReason, WriteOptions, WriteResult, WriteSkip } from './model/write.js'
export type {
  CanvasObject,
  Column,
  Group,
  Index,
  IndexExpression,
  IndexKey,
  Layout,
  Model,
  Note,
  ObjectKind,
  ReadResult,
  Ref,
  RefEdge,
  Table,
} from './model/types.js'
// The diagnostic contract is one type for the whole tool, model reader and
// import contract alike. ADR 0014, and `locationText` is the reason a consumer
// that only prints a diagnostic does not have to know which it is holding.
export {
  compareDiagnostics,
  formatDiagnostics,
  hasErrors,
  locationText,
  sortDiagnostics,
} from './diagnostics.js'
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticLocation,
  ImportDiagnosticCode,
  ModelDiagnosticCode,
  Severity,
} from './diagnostics.js'
