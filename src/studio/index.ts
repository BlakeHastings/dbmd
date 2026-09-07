/**
 * The studio, as one import.
 *
 * `startStudio` is the whole surface. It is a function rather than a CLI
 * subcommand because the subcommand is dbmd-35's, and because a server whose
 * caller learns the bound port from a return value is one a test can start
 * twenty of without picking ports.
 */

export { startStudio } from './server.js'
export type { Studio, StudioOptions } from './server.js'
export type {
  GroupPatch,
  NotePatch,
  TablePatch,
  WireConflict,
  WireModel,
  WireModelResponse,
  WireStatus,
  WireWrite,
} from './wire.js'
