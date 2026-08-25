// The whole path from a pasted file to a canonical document, in one call.
//
//   envelope -> registry -> provider.parse -> contract validator
//
// Each stage is separately testable and this is the order they go in. `dbmd
// import` calls this and nothing else, which is what keeps engine names out of
// the CLI.

import type { IntrospectionDocument } from './contract.js'
import { readEnvelope, validateIntrospectionDocument } from './contract.js'
import type { Diagnostic, Result } from './diagnostics.js'
import { hasErrors } from './diagnostics.js'
import type { ProviderRegistry } from './providers/index.js'
import { registry as defaultRegistry, resolveProvider } from './providers/index.js'

export interface ReadOptions {
  /** Which engines exist. Injected so tests can supply their own. */
  readonly registry?: ProviderRegistry
  /**
   * `--engine`, which overrides what the file says about itself. ADR 0007 puts
   * it here as an escape hatch and calls using it diagnostic-worthy, so using it
   * always produces a warning naming both engines.
   */
  readonly engine?: string
}

export function readIntrospection(
  raw: unknown,
  options: ReadOptions = {},
): Result<IntrospectionDocument> {
  const providers = options.registry ?? defaultRegistry
  const diagnostics: Diagnostic[] = []

  const envelope = readEnvelope(raw)
  if (!envelope.ok) return envelope
  diagnostics.push(...envelope.diagnostics)

  let wanted = envelope.value
  if (options.engine !== undefined && options.engine !== envelope.value.engine) {
    diagnostics.push({
      code: 'import/engine-overridden',
      severity: 'warning',
      path: '$.engine',
      message: `this file says it came from '${envelope.value.engine}' and --engine says '${options.engine}', so it is being read as '${options.engine}'`,
    })
    wanted = { ...envelope.value, engine: options.engine }
  }

  const provider = resolveProvider(wanted, providers)
  if (!provider.ok) return { ok: false, diagnostics: [...diagnostics, ...provider.diagnostics] }

  const parsed = provider.value.parse(wanted.body)
  diagnostics.push(...parsed.diagnostics)
  if (!parsed.ok) return { ok: false, diagnostics }

  // The provider's output goes through the contract on the way out. That is what
  // lets a provider build a document by hand without also owning determinism, and
  // it means a provider bug reads as a diagnostic with a path on it.
  const validated = validateIntrospectionDocument(parsed.value)
  diagnostics.push(...validated.diagnostics)
  if (!validated.ok || hasErrors(diagnostics)) return { ok: false, diagnostics }

  return { ok: true, value: validated.value, diagnostics }
}
