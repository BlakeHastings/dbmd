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
 * enforce three regular expressions.
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

const RULES: ReadonlyArray<{
  readonly pattern: RegExp
  readonly instead: string
}> = [
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

interface Violation {
  readonly file: string
  readonly line: number
  readonly source: string
  readonly instead: string
}

/** Every violation in one file. Exported shape kept simple: the message is the product. */
function scan(file: string, source: string): Violation[] {
  if (file === THE_WRITER) return []
  const violations: Violation[] = []
  source.split('\n').forEach((text, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        violations.push({ file, line: index + 1, source: text.trim(), instead: rule.instead })
      }
    }
  })
  return violations
}

const root = fileURLToPath(new URL('../..', import.meta.url))

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
    const files = await typescriptFiles(join(root, 'src'))
    expect(files.length).toBeGreaterThan(0)

    const violations: Violation[] = []
    for (const path of files) {
      const file = relative(root, path).split(sep).join('/')
      violations.push(...scan(file, await readFile(path, 'utf8')))
    }

    expect(
      violations.map(
        (violation) =>
          `${violation.file}:${violation.line}\n    ${violation.source}\n    ${violation.instead}`,
      ),
    ).toEqual([])
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
})
