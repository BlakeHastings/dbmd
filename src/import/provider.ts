// What an engine has to implement to be an engine here. ADR 0007.
//
// Four methods and two strings. If a third engine needs a fifth method, adding
// one is fine and expected; an `if (engine === ...)` anywhere outside
// `src/import/providers/` is the signal that this seam is in the wrong place.

import type { Result } from './diagnostics.js'
import type { IntrospectionDocument, NormalisedType } from './contract.js'

/** What `parse` returns: a canonical document, or the reasons it could not build one. */
export type ParseResult = Result<IntrospectionDocument>

export interface EngineProvider {
  /**
   * Matched against the `engine` field of the envelope, so this string is user
   * facing and permanent. Lower case, no spaces: `postgres`, `sqlserver`.
   */
  readonly id: string
  /** How the engine is spelled when a human reads it: `PostgreSQL`, `SQL Server`. */
  readonly displayName: string

  /**
   * The SQL a human runs themselves, as one statement returning one JSON value
   * in the envelope shape. It is printed for somebody who may be about to run it
   * against production, so it is read as often as it is executed.
   */
  introspectionQuery(): string

  /**
   * Engine-shaped JSON to canonical. Pure: no I/O, no clock, no database, which
   * is what lets a provider be developed against a committed fixture by somebody
   * who has never run that engine.
   *
   * A provider does not have to validate what it builds. `readIntrospection`
   * puts the result through the contract validator, so a provider bug surfaces
   * as a diagnostic with a path rather than as a crash further downstream.
   */
  parse(raw: unknown): ParseResult

  /**
   * One engine-native type name to the closed vocabulary. Narrower than ADR
   * 0007's `string`: an open return type cannot be switched on, which is the
   * only reason the normalised name exists.
   */
  normaliseType(native: string): NormalisedType

  /** `"name"` for Postgres, `[name]` for SQL Server, with the engine's own escaping. */
  quoteIdentifier(name: string): string
}
