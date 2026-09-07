/**
 * Running the CLI in a test, with the facts the output contract reads supplied
 * as data rather than discovered from the process.
 *
 * `main` takes an `Environment` for exactly this reason. Colour is three inputs
 * to one decision, and a test that can only run in whatever terminal happens to
 * be attached can check one of the combinations. Here every combination is a
 * value, on every platform, including the ones this machine cannot produce.
 */

import { main } from '../../src/cli/main.js'
import type { Environment } from '../../src/cli/output.js'

/** What the process looks like. Anything not said is "not a terminal, nothing in the environment". */
export interface ProcessFacts {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly stdoutIsTty?: boolean
  readonly stderrIsTty?: boolean
}

export interface Run {
  readonly code: number
  /** Everything written to stdout. Data, and nothing else. */
  readonly out: string
  /** Everything written to stderr. Narration. */
  readonly err: string
}

/** An `Environment` over two strings, so a test can read what was written where. */
export function captureEnvironment(facts: ProcessFacts = {}): {
  readonly environment: Environment
  readonly written: { out: string; err: string }
} {
  const written = { out: '', err: '' }
  const environment: Environment = {
    env: facts.env ?? {},
    stdoutIsTty: facts.stdoutIsTty ?? false,
    stderrIsTty: facts.stderrIsTty ?? false,
    writeOut: (text) => {
      written.out += text
    },
    writeErr: (text) => {
      written.err += text
    },
  }
  return { environment, written }
}

export async function runCli(argv: readonly string[], facts: ProcessFacts = {}): Promise<Run> {
  const { environment, written } = captureEnvironment(facts)
  const code = await main(argv, environment)
  return { code, out: written.out, err: written.err }
}
