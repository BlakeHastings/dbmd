/**
 * `dbmd query`: the SQL a person runs against their own database, printed.
 *
 * This is the first step of the journey `dbmd import` finishes, and until
 * dbmd-7nb it was the step that did not exist: ADR 0007 described it,
 * `docs/import-format.md` opened with it, and four messages in
 * `src/import/contract.ts` told a user to run it, while `dbmd query` itself was
 * an unknown command. The SQL was real the whole time and reachable only from
 * TypeScript.
 *
 * dbmd never connects to a database and never asks for a credential (ADR 0007,
 * whose whole shape is "the SQL a human runs"). This prints SQL and stops. What
 * happens next is the user's, with
 * the client they already trust, which is also why the query is written to be
 * read: the comment block on top of each one says what it touches and how to
 * save its result without truncating it, and that block is printed with it
 * because it is the instructions.
 *
 * Four things this file owns:
 *
 * 1. **stdout is the whole point.** The output is redirected to a file or piped
 *    into a client, so the SQL is the only thing on stdout and every word about
 *    it goes to stderr. ADR 0006 and ADR 0011, and
 *    `test/cli/output-contract.test.ts` is the gate.
 * 2. **`--engine` is required.** `dbmd import` reads the engine out of the file
 *    and there is no file yet, so there is nothing here to read it from and
 *    guessing would mean printing one engine's SQL to somebody running another.
 * 3. **It resolves through the provider registry**, so no engine's name is
 *    written in this file, the help, or any message it prints. dbmd-44 added
 *    SQL Server without touching `contract.ts` or `provider.ts`; an
 *    `if (engine === ...)` outside `src/import/providers/` is what ADR 0007
 *    exists to prevent, and a hard-coded list in a help string is one.
 * 4. **There is no model directory.** Every other command takes one and this one
 *    has nothing to do with a checkout, so a bare word is a usage error saying
 *    so rather than a path silently ignored.
 */

import { parseArgs } from 'node:util'
import { registry, type ProviderRegistry } from '../import/providers/index.js'
import { UsageError, usageProblem, type Command } from './command.js'
import type { Output } from './output.js'

/**
 * The engines, as the help lists them: id first, because the id is what gets
 * typed, and the display name after it, because the id is not always what the
 * engine is called.
 *
 * Built from the registry at module load rather than written down, so the day a
 * third provider is added the help is already right. ADR 0007.
 */
function engineTable(providers: ProviderRegistry): string {
  if (providers.providers.length === 0) return '  (this build has no engine providers at all)'
  const width = Math.max(...providers.providers.map((provider) => provider.id.length))
  return providers.providers
    .map((provider) => `  ${provider.id.padEnd(width)}   ${provider.displayName}`)
    .join('\n')
}

/** How every message here says which engines exist. The registry's own sentence. */
function knownEngines(providers: ProviderRegistry): string {
  return providers.ids.length === 0
    ? 'this build has no engine providers at all'
    : `this build knows ${providers.ids.join(', ')}`
}

/** An engine id to put in an example. The first one, or the flag's own placeholder. */
function exampleEngine(providers: ProviderRegistry): string {
  return providers.ids[0] ?? '<id>'
}

function help(providers: ProviderRegistry): string {
  return `Usage: dbmd query --engine <id>

Print the introspection query for one engine, on stdout, and nothing else.

dbmd never connects to your database and never asks for a credential. You run
this query yourself, with the client you already trust, save what it printed,
and hand that file to "dbmd import".

Engines:
${engineTable(providers)}

Options:
      --engine <id>   which engine's query to print. Required

--engine is required here and optional on "dbmd import". That is not an
inconsistency: the file import reads says which engine produced it, and here
there is no file yet, so there is nothing to read it from.

This is the one command with no model directory. It reads nothing and writes
nothing; it prints SQL.

Exit codes:
  0   printed
  2   the command line was wrong, or no engine goes by that name

The query is read before it is run. The comment block at the top of it says what
it touches, that it cannot write, and how to save its result without cutting it
short, which is the mistake "dbmd import" sees most. Print it and read it.

The whole journey:

  dbmd query --engine ${exampleEngine(providers)} > introspect.sql
  # run introspect.sql with your client, save the one value it returns
  dbmd import --file introspection.json
  dbmd check db-model
`
}

export const queryCommand: Command = {
  name: 'query',
  summary: "print an engine's introspection SQL for you to run yourself",
  help: help(registry),
  run: runQuery,
}

/**
 * `providers` is a defaulted third parameter for the reason `runImport`'s
 * `stdin` is one: it is this command's business and no other command should
 * carry it. It is what lets a test drive the empty registry and a two-provider
 * registry through the real command, which is the same seam `createRegistry`
 * exists for.
 */
export async function runQuery(
  argv: readonly string[],
  out: Output,
  providers: ProviderRegistry = registry,
): Promise<number> {
  const engine = parseQueryArgs(argv, providers)

  const provider = providers.get(engine)
  if (provider === undefined) {
    throw new UsageError(
      `no engine goes by "${engine}", and ${knownEngines(providers)}. ` +
        `Run "dbmd query --help".`,
    )
  }

  // Newline-terminated, so the SQL is a whole last line whether it is
  // redirected to a file or landing on somebody's prompt. Every provider's
  // query ends with one already; this is here so that one that forgets is not
  // a bug a user sees.
  const sql = provider.introspectionQuery()
  const text = sql.endsWith('\n') ? sql : `${sql}\n`

  // ADR 0011: stdout carries exactly one thing per run. Without `--json` that
  // thing is the SQL, and everything said about it goes to stderr. With
  // `--json` it is the report, and the SQL travels inside it, because a caller
  // that asked for a report cannot also be handed a document on the same
  // stream and told to work out where one ends.
  if (!out.json) out.data(text)

  return out.report({
    code: 0,
    text:
      `The ${out.style.strong(provider.displayName)} introspection query, ` +
      `${text.length} characters, on stdout.\n` +
      `Read the comments at the top before you run it: they say what it touches,\n` +
      `and how to save its result without cutting it short.\n` +
      `Run it, save the one value it returns, then "dbmd import --file <that file>".\n`,
    json: {
      engine: provider.id,
      displayName: provider.displayName,
      characters: text.length,
      sql: text,
    },
  })
}

/**
 * One required option and nothing else. `parseArgs` with `strict` rejects the
 * rest, and the two things it cannot know are checked here: that `--engine` was
 * given at all, and that a bare word is not a model directory.
 */
function parseQueryArgs(argv: readonly string[], providers: ProviderRegistry): string {
  const options = { engine: { type: 'string' } } as const
  let values: { engine?: string }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options,
      allowPositionals: true,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(
      `${usageProblem(error, argv, options)}. "dbmd query" takes --engine and nothing ` +
        `else; run "dbmd query --help".`,
    )
  }

  // Every other command takes a model directory as a bare word, and a person
  // who has typed four of them will type a fifth. This one has no model and no
  // directory, so the word is named rather than ignored.
  if (positionals.length > 0) {
    throw new UsageError(
      `"dbmd query" takes no directory, and got ${positionals.join(' ')}. It prints SQL rather ` +
        `than reading or writing a model, so there is nothing for a path to mean here.`,
    )
  }

  const engine = values.engine
  if (engine === undefined) {
    throw new UsageError(
      `"dbmd query" prints one engine's query, so it needs --engine: ${knownEngines(providers)}. ` +
        `It is required here and optional on "dbmd import", which reads the engine out of the ` +
        `file it is given.`,
    )
  }
  if (engine === '') {
    throw new UsageError(`--engine was given an empty name, and ${knownEngines(providers)}.`)
  }
  return engine
}
