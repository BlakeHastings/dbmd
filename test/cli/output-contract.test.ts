/**
 * The gate. Nothing in `src/` writes to a stream except the output module.
 *
 * This is the part of dbmd-70 that is still working in six months. ADR 0006's
 * rule 1 is one sentence and breaking it is one keystroke: `console.log` writes
 * to stdout, `console.error` writes to stderr, and on a terminal they look
 * identical, so narration on stdout is invisible until it breaks somebody's
 * pipe. A reviewer cannot be expected to notice it either. This can.
 *
 * It is a test rather than a lint rule because `npm run check` is the only
 * mechanical gate this repository has (AGENTS.md) and vitest already runs
 * inside it. A lint rule would mean a linter, a config and a dependency, to
 * enforce four regular expressions.
 *
 * There are two rule sets, because there are two runtimes in `src/` and rule 1
 * is about only one of them. ADR 0011 has the argument. Node code may not
 * choose a stream for itself; browser code has no streams to choose and is held
 * to the opposite rule, that `process` must not appear in it at all.
 *
 * When this fails on a file you are writing, the fix is not an exemption. Take
 * an `Output` and call `report` or `data` on it; that is what it is for. If
 * your case genuinely is not one of those, the honest change is to add a method
 * to `src/cli/output.ts` and say why in the pull request, so the contract grows
 * on purpose rather than by leak.
 */

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { describe, expect, test } from 'vitest'

/** The one module allowed to write, relative to the repository root. */
const THE_WRITER = 'src/cli/output.ts'

interface Rule {
  readonly pattern: RegExp
  readonly instead: string
}

/**
 * For code that runs in Node, where the two streams are real and a caller is
 * reading one of them.
 */
const NODE_RULES: readonly Rule[] = [
  {
    // A call, not a mention: prose about `console.log` in a comment is fine and
    // useful, and prose does not have an open bracket after it.
    pattern: /(?<![\w$.])console\s*\.\s*\w+\s*\(/,
    instead: `route it through ${THE_WRITER}: data is out.data, an answer is out.report, and narration is stderr`,
  },
  {
    pattern: /process\s*\.\s*std(out|err)\s*\.\s*write\s*\(/,
    instead: `${THE_WRITER} owns the process streams, so that which stream a line goes to is decided in one place`,
  },
  {
    pattern: /process\s*\.\s*exit\s*\(/,
    instead:
      'return the exit code instead, and let src/cli.ts set process.exitCode: process.exit truncates a pipe that has not flushed',
  },
]

/**
 * For code that runs in a browser, which has no stdout, no pipe and no exit
 * code, so none of rule 1's reasoning reaches it. `console.error` in a page is
 * an ordinary way to report an error and is allowed here.
 *
 * What is not allowed is `process`, and that is stricter than the Node rules
 * rather than looser: a `process.env` or a `process.stdout` that reaches the
 * bundle is a crash in the browser rather than a style problem, and esbuild
 * will happily bundle it.
 */
const BROWSER_RULES: readonly Rule[] = [
  {
    // No open bracket required: `process.env.API_URL` is exactly as broken as
    // `process.exit()`. Prose in this directory should say "the process"
    // without the dot.
    pattern: /(?<![\w$.])process\s*\./,
    instead:
      'a browser has no `process`, so this is a crash rather than a contract problem. Node-only code belongs on the server side of src/studio/',
  },
]

interface Violation {
  readonly file: string
  readonly line: number
  readonly source: string
  readonly instead: string
}

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Which files are the browser's, taken from `tsconfig.client.json` rather than
 * from a list kept here.
 *
 * That file is where this repository already says "this is the browser": it is
 * the one that swaps `node` types for `DOM`. A second list would be a second
 * answer to the same question, and the day they disagree is the day somebody
 * adds browser code and gets the wrong rules with no error.
 */
async function browserPrefixes(): Promise<string[]> {
  const path = join(root, 'tsconfig.client.json')
  const config = JSON.parse(await readFile(path, 'utf8')) as { include?: string[] }
  return (config.include ?? []).map((pattern) => {
    const wildcard = pattern.indexOf('*')
    return wildcard === -1 ? pattern : pattern.slice(0, wildcard)
  })
}

function rulesFor(file: string, browser: readonly string[]): readonly Rule[] {
  return browser.some((prefix) => file.startsWith(prefix)) ? BROWSER_RULES : NODE_RULES
}

/** Every violation in one file, under whichever rules that file's runtime gets. */
function scan(file: string, source: string, browser: readonly string[] = []): Violation[] {
  if (file === THE_WRITER) return []
  const rules = rulesFor(file, browser)
  const violations: Violation[] = []
  source.split('\n').forEach((text, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        violations.push({ file, line: index + 1, source: text.trim(), instead: rule.instead })
      }
    }
  })
  return violations
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await typescriptFiles(path)))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('the output contract', () => {
  test('nothing shipped writes to a stream except the output module', async () => {
    const browser = await browserPrefixes()
    const files = await typescriptFiles(join(root, 'src'))
    expect(files.length).toBeGreaterThan(0)

    const violations: Violation[] = []
    for (const path of files) {
      const file = relative(root, path).split(sep).join('/')
      violations.push(...scan(file, await readFile(path, 'utf8'), browser))
    }

    expect(
      violations.map(
        (violation) =>
          `${violation.file}:${violation.line}\n    ${violation.source}\n    ${violation.instead}`,
      ),
    ).toEqual([])
  })

  test('the browser seam is real, and a rename fails here rather than silently', async () => {
    // If `tsconfig.client.json` stops naming the client, every file falls back
    // to the Node rules and the client starts failing on its own `console.error`
    // with no explanation. Better to fail on this line, which says why.
    const browser = await browserPrefixes()
    expect(browser).toEqual(['src/studio/client/'])
  })

  test('it catches the mistake it is for, which is how we know it is looking', () => {
    const caught = (source: string) => scan('src/cli/somewhere.ts', source).length

    expect(caught('console.log("wrote 12 files")')).toBe(1)
    expect(caught('  console.error(`${count} problems`)')).toBe(1)
    expect(caught('await Promise.resolve().then(() => console.info("hi"))')).toBe(1)
    expect(caught('process.stdout.write(text)')).toBe(1)
    expect(caught('process.stderr.write(text)')).toBe(1)
    expect(caught('process.exit(1)')).toBe(1)
  })

  test('it does not catch prose, which is where the reason for the rule is written', () => {
    const caught = (source: string) => scan('src/cli/somewhere.ts', source).length

    expect(caught(' * `console.log` writes to stdout and `console.error` to stderr.')).toBe(0)
    expect(caught(' * process.exitCode rather than process.exit, so stdout flushes.')).toBe(0)
    expect(caught('const consoleLike = { log: (text: string) => text }')).toBe(0)
    expect(caught('process.exitCode = await main(process.argv.slice(2))')).toBe(0)
  })

  test('the writer itself is exempt, and is the only thing that is', () => {
    expect(scan(THE_WRITER, 'process.stdout.write(text)')).toEqual([])
    expect(scan('src/cli/main.ts', 'process.stdout.write(text)')).toHaveLength(1)
  })

  test('the browser may use its console, and may not use process', () => {
    const client = 'src/studio/client/main.ts'
    const browser = ['src/studio/client/']
    const caught = (source: string) => scan(client, source, browser).length

    expect(caught("console.error('studio client error', err)")).toBe(0)
    expect(caught("console.warn('dropped a frame')")).toBe(0)

    expect(caught('process.stdout.write(text)')).toBe(1)
    expect(caught('process.exit(1)')).toBe(1)
    expect(caught('const url = process.env.API_URL')).toBe(1)

    // And the same two lines the other way round, so the split is a decision
    // rather than a hole: what the browser may do, the CLI may not.
    expect(scan('src/cli/somewhere.ts', "console.error('x')", browser)).toHaveLength(1)
  })
})
