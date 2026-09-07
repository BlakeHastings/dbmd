// The registry. ADR 0007: adding an engine is one file in this directory and one
// line in the list below, and nothing outside this directory learns its name.
//
// An empty list stays a state the code has to survive, because it is what a
// build with a provider removed looks like, and the diagnostic for it is tested
// against a registry built by hand rather than against this one.

import { postgresProvider } from './postgres.js'
import { sqlserverProvider } from './sqlserver.js'
import type { EngineProvider } from '../provider.js'
import type { Diagnostic, Result } from '../diagnostics.js'
import { compareCodeUnits, inDocument } from '../diagnostics.js'
import type { Envelope } from '../contract.js'

/**
 * Every engine this build knows. One line per engine, and the import above it.
 *
 *   import { postgresProvider } from './postgres.js'
 *   export const engineProviders = [postgresProvider, sqlserverProvider]
 */
export const engineProviders: readonly EngineProvider[] = [postgresProvider, sqlserverProvider]

export interface ProviderRegistry {
  /** Sorted, so anything that prints them is deterministic. ADR 0006. */
  readonly ids: readonly string[]
  readonly providers: readonly EngineProvider[]
  get(id: string): EngineProvider | undefined
}

/**
 * Build a registry from a list of providers.
 *
 * Taking the list as an argument rather than reaching for the module-level one is
 * what lets the tests dispatch a real envelope through a real registry without a
 * real engine in the build.
 */
export function createRegistry(providers: readonly EngineProvider[]): ProviderRegistry {
  const byId = new Map<string, EngineProvider>()
  for (const provider of providers) {
    if (byId.has(provider.id)) {
      // A duplicate id is a mistake in this file, not in a user's input, so it
      // fails at construction rather than becoming a diagnostic nobody can act on.
      throw new Error(`two providers both claim the engine id '${provider.id}'`)
    }
    byId.set(provider.id, provider)
  }
  const sorted = [...providers].sort((a, b) => compareCodeUnits(a.id, b.id))
  return {
    ids: sorted.map((p) => p.id),
    providers: sorted,
    get: (id) => byId.get(id),
  }
}

/** The registry the CLI uses. */
export const registry: ProviderRegistry = createRegistry(engineProviders)

/**
 * Choose the provider an envelope asks for.
 *
 * This is the only place an unknown engine is diagnosed, because it is the only
 * place that knows which engines exist. The message names them, so a user who
 * typed `postgresql` is told what to type instead rather than being told that
 * something was unknown.
 */
export function resolveProvider(
  envelope: Envelope,
  providers: ProviderRegistry = registry,
): Result<EngineProvider> {
  const provider = providers.get(envelope.engine)
  if (provider) return { ok: true, value: provider, diagnostics: [] }

  const known =
    providers.ids.length === 0
      ? 'this build has no engine providers at all'
      : `this build knows ${providers.ids.join(', ')}`
  const diagnostic: Diagnostic = {
    code: 'import/unknown-engine',
    severity: 'error',
    at: inDocument('$.engine'),
    message: `no provider claims the engine '${envelope.engine}', and ${known}`,
  }
  return { ok: false, diagnostics: [diagnostic] }
}
