/**
 * The blocks in `.claude/skills/dbmd/SKILL.md` that are tool output are run,
 * and have to still be what the tool prints.
 *
 * That file is the one page in this repository written to be obeyed rather than
 * read, and until this test it was the one page with nothing running against
 * it. `docs/format.md` has `test/docs/format.test.ts`, `README.md` has
 * `test/docs/readme.test.ts`, `docs/import-format.md` has
 * `test/import/docs.test.ts`. The skill had `scripts/check-commands.mjs`, which
 * resolves the commands and the flags it names and reads nothing else.
 *
 * WHY THIS SHAPE AND NOT A CHECK OVER THE PROSE
 * The page's stale claims divide into two kinds and only one of them is here.
 *
 * The first kind is a paraphrase: an author restating an argument that lives
 * somewhere else, in their own words, and the words drifting from the record.
 * ADR 0084 was written from five of those and its answer was a habit rather
 * than a mechanism, because "an error blocks the canonicalise step" is a
 * sentence and the rule that matched it would have to understand it.
 *
 * The second kind is what has actually been happening since. A sentence that
 * was true when it was written is falsified by a merge landing the same night,
 * so the page is describing a tree that moved under it. Nothing in the text
 * changed, which is why no check over the text can find one: the only mechanism
 * that finds this class is one that runs the claim. That is this file, and it
 * is deliberately narrow. It runs the blocks that are already exact tool
 * output, and it asserts nothing about any sentence's meaning.
 *
 * WHAT IS TAGGED, AND WHY THE TAGS ARE THE ONES THEY ARE
 * Three info strings, all invisible on GitHub, so the page reads exactly as it
 * did and still cannot lie:
 *
 *   ```dbmd-run
 *   ```javascript dbmd-script
 *   ```dbmd-script-out
 *
 * `dbmd-run` is `test/docs/readme.test.ts`'s tag, unchanged and meaning the
 * same thing: a shell session whose `$ dbmd ...` lines are run in order, with
 * the lines beneath each compared against what that command wrote to stderr,
 * which is where every command's narration goes (ADR 0006). It is shared rather
 * than reinvented because a second spelling of one idea is the thing ADR 0084
 * warns about, one layer down. The tag and the function that reads it are both
 * in `./sessions.ts`, which the two pages' readers import, so an author writing
 * a block does not have to learn a second convention and neither reader can
 * quietly grow one. ADR 0101 is the argument, and the divergence it was written
 * from was reproduced rather than imagined.
 *
 * `dbmd-script` and `dbmd-script-out` are new, because the thing they mark is
 * not a dbmd command. The skill hands an agent a complete node program, tells
 * it to paste that program into a scratch directory, and shows what the program
 * prints. That program is the most quietly fragile thing on the page: it
 * constructs no `Model` today, so it survived `Model` gaining a required
 * `refused` field in #231 by luck rather than by test, and the next field to
 * arrive is a coin toss. Here it is extracted from the fence and run, twice,
 * once for each answer the page shows.
 *
 * The output blocks carry a tag rather than being paired by counting because
 * they are plain fences, and the page has plain fences everywhere. What the tag
 * does not carry is the fixture: which model directory, in what state, and
 * which file the disk refuses. That is a filesystem state, it has no business
 * in a page's info string, and a marker language rich enough to hold one is a
 * language nobody has designed. So the tag says *this block is script output*
 * and `SCRIPT_RUNS` below says which run produced it, paired in document order
 * with the count asserted, the same discipline `test/docs/payloads.test.ts`
 * uses for the payload blocks it claims.
 *
 * The `--json` envelope block carries no tag at all, for
 * `test/docs/payloads.test.ts`'s reason (ADR 0066): the only thing an author
 * could write in the tag is the command line, which is long, has a flag on it,
 * and is already in the prose above the block. Exhaustiveness is bought by
 * counting instead, so a second ` ```json ` fence on this page turns this file
 * red until somebody says which command it came from.
 *
 * WHAT VARIES BETWEEN RUNS, AND WHAT WAS DONE ABOUT EACH
 * Four things, and none of them is the thing a block was demonstrating.
 *
 * `shop` is a directory the page types and the commands echo rather than
 * resolve (ADR 0006), so the fixtures are copied to the names the page uses and
 * the working directory moves to sit above them, exactly as
 * `test/docs/readme.test.ts` argues. Nothing rewrites a path in a block.
 *
 * JSON whitespace is compared as a value and not as bytes. Prettier formats
 * `.claude/` even though `.prettierignore` holds it off `docs/`, the script
 * prints with `JSON.stringify(..., null, 2)`, and the page shows the short
 * answer on one line. Key order, key set and every value are still held
 * exactly, because `JSON.stringify` of a parsed document preserves the order it
 * was written in. This is `test/docs/payloads.test.ts`'s convention, taken for
 * its reason.
 *
 * The temporary file's name and the absolute paths in a refused write are
 * elided on the page with `...`, and the page has said so since it was written.
 * Each fragment either side of an elision still has to appear, in order, in
 * what the run printed, so the two paths and the arrow between them are held
 * and only the parts nobody can reproduce are dropped. Path separators are
 * folded to `/` on both sides: the block was measured on Windows and CI here
 * runs on Linux, and the separator is the one part of that string the platform
 * owns rather than dbmd.
 *
 * The refusal itself is injected rather than produced by a real read-only file.
 * `test/cli/export.test.ts` made this decision first and its reasoning is the
 * reasoning here: the Windows gesture is `attrib +R`, which answers `EPERM`,
 * and the POSIX equivalent is a permission bit which answers `EACCES` and does
 * nothing at all when the suite runs as root. The seam is not the disk. It is
 * what the script does with a write that rejected, and the injection reaches
 * that on any platform. What that costs is named where it is paid, below: the
 * words `EPERM: operation not permitted` are the injection's here and the
 * operating system's on the measured run, so what this holds is not that
 * sentence but which two paths dbmd handed to `rename`, and in which order.
 *
 * WHY THE SCRIPT RUNS AS A CHILD PROCESS AGAINST A BUILT CHECKOUT
 * The page's whole claim about it is that it is a complete program somebody can
 * paste and run, and a program run in the test's own module graph is not that.
 * So it is written out and given to `node`, with `process.argv` carrying the
 * three arguments the page's own usage line names.
 *
 * Its first argument is a dbmd checkout, and it imports `dist/index.js` out of
 * it, which cannot be this repository's `dist/`: `npm run check` runs `test`
 * before `build`, so on a fresh clone there is no `dist/` when this file runs.
 * A checkout is built into the sandbox with esbuild instead, from `src/`, in
 * about seventy milliseconds. That is the same source `npm run build` compiles,
 * so the contract under test is the same one; what is given up is the tsc
 * output, which `test/cli/*.test.ts` does not exercise either.
 *
 * WHICH BLOCK IS NOT HERE, AND WHY
 * The rename recipe's step 1 shows two lines of a `dbmd refs addresses shop`
 * run, inside `#` comments, with the trailing `required` and `on delete`
 * columns dropped, the alignment widened by a space, and a `<- a self-ref
 * counts` pointer added that no run prints. It is an annotated excerpt and not
 * output, so there is nothing to compare it to byte for byte. Quoting the whole
 * run instead would put that command's three-line legend into the recipe a
 * second time, which is a page getting worse to make a test possible. What is
 * held instead is the claim the excerpt exists to make, at the bottom of this
 * file: that both referrers are there and the self-ref is one of them.
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runCli } from '../cli/harness.js'
import { DBMD_RUN, sessionIn } from './sessions.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const PAGE = '.claude/skills/dbmd/SKILL.md'
const skillPath = join(repoRoot, PAGE)

type Kind = 'run' | 'script' | 'script-out'

interface Block {
  readonly kind: Kind
  readonly text: string
  /** The line the fence opened on, for a failure that says where to look. */
  readonly line: number
}

/**
 * A tagged fence, opened on its own line and closed by the next line that is
 * only backticks. None of these blocks nests a fence.
 *
 * The tag sits where a language would when there is no language to write, and
 * after the language when there is one, which is `test/docs/readme.test.ts`'s
 * convention and `docs/format.md`'s before it.
 *
 * `DBMD_RUN` comes from `./sessions.js` rather than being spelled here, because
 * `README.md` carries the same tag and the function that reads a block carrying
 * it now lives there too. The other two are this page's own.
 */
const TAGS = [DBMD_RUN, 'dbmd-script', 'dbmd-script-out']
const OPENING = new RegExp(`^\`\`\`(?:(\\S+)\\s+)?(${TAGS.join('|')})\\s*$`)

function blocksIn(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const opening = OPENING.exec(lines[i] ?? '')
    if (opening === null) continue
    const end = lines.indexOf('```', i + 1)
    if (end === -1) throw new Error(`unterminated fence at ${PAGE}:${i + 1}`)
    blocks.push({
      kind: (opening[2] as string).slice('dbmd-'.length) as Kind,
      text: `${lines.slice(i + 1, end).join('\n')}\n`,
      line: i + 1,
    })
    i = end
  }
  return blocks
}

/** Every plain ` ```json ` fence, which is how the envelope block is found. */
function payloadsIn(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '```json') continue
    const end = lines.indexOf('```', i + 1)
    if (end === -1) throw new Error(`unterminated fence at ${PAGE}:${i + 1}`)
    blocks.push({ kind: 'run', text: lines.slice(i + 1, end).join('\n'), line: i + 1 })
    i = end
  }
  return blocks
}

/** A JSON document with only the whitespace taken out of it. Key order survives. */
function reindented(json: string, what: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch (error) {
    throw new Error(`${what} is not JSON: ${(error as Error).message}`)
  }
}

const page = await readFile(skillPath, 'utf8')
const lines = page.split('\n')
const tagged = blocksIn(lines)
const sessions = tagged.filter((block) => block.kind === 'run')
const scripts = tagged.filter((block) => block.kind === 'script')
const scriptOut = tagged.filter((block) => block.kind === 'script-out')
const payloads = payloadsIn(lines)

let sandbox = ''
let original = ''

/**
 * A run of the page's own script, and the block that says what it printed.
 *
 * `paths` is the argument list after the checkout and the model directory, so
 * it is what the page's `only` bullet is about. `refuses` names the file whose
 * rename is made to fail, and is the fixture the second block was measured
 * with; `undefined` is a disk that does not refuse anything.
 */
interface ScriptRun {
  /** The model directory in the sandbox, and the state it is put in. */
  readonly directory: string
  readonly paths: readonly string[]
  readonly refuses?: string
  readonly code: number
  /** Keys whose value is compared as an elided claim rather than as a value. */
  readonly elided?: readonly string[]
}

const SCRIPT_RUNS: readonly ScriptRun[] = [
  // The ordinary answer, over a model with one edited file in it. The page
  // shows this block under the script and immediately after step 3 of the loop,
  // which is "hand what you edited to the writer": a file nobody edited comes
  // back `skipped` as `unchanged`, which is the block's next bullet rather than
  // this block. So the fixture carries the edit the loop is about, and it is
  // the edit the page names two sections later: a column added in flow style,
  // which passes `dbmd check` with zero diagnostics and is not canonical.
  { directory: 'edited', paths: ['tables/products.md'], code: 0 },

  // The refused write. Two files, sorted, with the second one's rename
  // rejected, which is the state the page says it measured.
  {
    directory: 'keys',
    paths: ['tables/accounts.md', 'tables/api_keys.md'],
    refuses: 'api_keys.md',
    code: 1,
    elided: ['message'],
  },
]

/**
 * The `--json` payload blocks, and the command each one came from.
 *
 * One block, and the page does not name its command in a fence: it says
 * "`--json` moves the report to stdout under a versioned envelope" and shows an
 * envelope whose `directory` is `shop`. `dbmd check shop --json` is that
 * command, and it is the one the loop three sections down types.
 *
 * `keys` is how far the block goes. It ends in `...`, which is the page saying
 * there are more keys, so the claim is that these are the first three of them,
 * in this order, with these values. Everything after the elision is the
 * envelope's own business and `test/cli/check.test.ts` holds it.
 */
const ENVELOPES: readonly { readonly argv: readonly string[]; readonly code: number }[] = [
  { argv: ['check', 'shop', '--json'], code: 0 },
]

/** Text somebody wrote with `...` in it, as the fragments it still claims. */
function fragmentsOf(shown: string): string[] {
  return shown
    .split('...')
    .map((part) => part.replaceAll('\\', '/'))
    .filter((part) => part !== '')
}

/**
 * Whether every fragment appears in `actual`, in order and without overlapping.
 *
 * Returned as the fragment that failed rather than as a boolean, so a failure
 * names the part of the string that moved instead of printing two long paths
 * and leaving the reader to diff them.
 */
function missingFragment(actual: string, fragments: readonly string[]): string | null {
  let at = 0
  for (const fragment of fragments) {
    const found = actual.indexOf(fragment, at)
    if (found === -1) return fragment
    at = found + fragment.length
  }
  return null
}

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}

function node(args: readonly string[], env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...args],
      { cwd: sandbox, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const failed = error as (Error & { code?: unknown }) | null
        const code = failed === null ? 0 : typeof failed.code === 'number' ? failed.code : 1
        resolve({ code, out: stdout, err: stderr })
      },
    )
  })
}

/** A one-column table whose file is not in canonical form, so a write happens. */
function flowTable(name: string): string {
  return `---\nkind: table\ntable: ${name}\ncolumns:\n  - { name: id, type: uuid, pk: true }\n---\n`
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dbmd-skill-'))

  // The directory the page types, under the name it types, so that every
  // command in a session block runs exactly as written and prints what the page
  // shows. `dbmd export` writes a README into the directory it is given and the
  // owner works in `examples/shop`, so this is a copy and never the original.
  await cp(join(repoRoot, 'examples/shop'), join(sandbox, 'shop'), { recursive: true })
  await rm(join(sandbox, 'shop/README.md'), { force: true })

  // The same model with one file edited, which is the state step 3 of the loop
  // is about. The edit is a column in flow style: canonical enough for the
  // reader, not what the writer emits, so the file is rewritten rather than
  // skipped as unchanged.
  await cp(join(sandbox, 'shop'), join(sandbox, 'edited'), { recursive: true })
  const products = join(sandbox, 'edited/tables/products.md')
  const before = await readFile(products, 'utf8')
  await writeFile(
    products,
    before.replace('\nindexes:', '\n  - { name: tasting_notes, type: text, nullable: true }\nindexes:'),
    'utf8',
  )

  // The two-file model the refused write was measured on. Both files are
  // non-canonical, so both are jobs, and `tables/accounts.md` sorts first.
  await mkdir(join(sandbox, 'keys/tables'), { recursive: true })
  await writeFile(join(sandbox, 'keys/_model.md'), '---\nkind: model\nname: keys\nengine: postgres\n---\n', 'utf8')
  await writeFile(join(sandbox, 'keys/tables/accounts.md'), flowTable('accounts'), 'utf8')
  await writeFile(join(sandbox, 'keys/tables/api_keys.md'), flowTable('api_keys'), 'utf8')

  // The checkout the script's first argument names. Built from `src/` because
  // `npm run check` runs the suite before it builds, so this repository's own
  // `dist/` may not exist yet. `yaml` is bundled in so the sandbox needs no
  // `node_modules`, and the banner is esbuild's own answer to a CommonJS
  // dependency reaching for `require` inside an ES module.
  await build({
    entryPoints: [join(repoRoot, 'src/index.ts')],
    outfile: join(sandbox, 'checkout/dist/index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire as ___cr } from 'node:module'\nconst require = ___cr(import.meta.url)",
    },
  })
  await writeFile(join(sandbox, 'checkout/package.json'), '{ "type": "module" }\n', 'utf8')

  // The script itself, verbatim out of the fence, under the name its own usage
  // line gives it.
  const program = scripts[0]
  if (program !== undefined) await writeFile(join(sandbox, 'canonicalise.mjs'), program.text, 'utf8')

  // The refusal, preloaded ahead of everything the script imports. See the
  // header: this stands in for a read-only file, which no one gesture produces
  // on both platforms this suite runs on.
  await writeFile(
    join(sandbox, 'refuse.mjs'),
    [
      "import { createRequire } from 'node:module'",
      '',
      "const target = process.env['DBMD_REFUSE'] ?? ''",
      "const promises = createRequire(import.meta.url)('node:fs/promises')",
      'const real = promises.rename',
      'promises.rename = async (from, to) => {',
      '  if (String(to).endsWith(target)) {',
      "    throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), {",
      "      code: 'EPERM',",
      "      syscall: 'rename',",
      '    })',
      '  }',
      '  return await real(from, to)',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  original = process.cwd()
  process.chdir(sandbox)
})

afterAll(async () => {
  // Restored before the directory goes, and before any other file in this
  // worker runs: a working directory left pointing at a deleted temporary is a
  // failure somewhere else entirely.
  if (original !== '') process.chdir(original)
  if (sandbox !== '') await rm(sandbox, { recursive: true, force: true })
})

describe('SKILL.md has the blocks this file thinks it has', () => {
  test('there is one of each kind to read', () => {
    // Without this a refactor that broke the info strings leaves a green suite
    // asserting nothing at all, which is the shape of the problem it exists to
    // catch. Both pages that already do this carry the same floor.
    expect(sessions.length, '`dbmd-run` blocks in SKILL.md').toBeGreaterThanOrEqual(1)
    expect(scripts.length, '`dbmd-script` blocks in SKILL.md').toBe(1)
    expect(scriptOut.length, '`dbmd-script-out` blocks in SKILL.md').toBe(SCRIPT_RUNS.length)
    expect(payloads.length, 'plain ```json fences in SKILL.md').toBe(ENVELOPES.length)
  })

  test('the script the page hands an agent is the one that runs here', () => {
    // The tag says which fence is the program. This says the program is still
    // the program: a second `dbmd-script` block, or a fence that stopped being
    // one, would otherwise run whatever came first.
    const program = scripts[0]
    expect(program?.text, 'the `dbmd-script` block').toContain('canonicalise.mjs')
    expect(program?.text, 'the `dbmd-script` block').toContain('writeModel')
  })
})

describe('a session block in SKILL.md prints what it shows', () => {
  for (const block of sessions) {
    test(`the session at ${PAGE}:${block.line} prints its own output`, async () => {
      for (const { argv, expected } of sessionIn(PAGE, block)) {
        const command = `dbmd ${argv.join(' ')}`
        const run = await runCli(argv)
        expect(run.err, `\`${command}\`, against the block at ${PAGE}:${block.line}`).toBe(expected)
        expect(run.code, `the exit code of \`${command}\``).toBe(0)
        // The page shows one half of the terminal. A command that started
        // putting data on stdout would turn the block into half a transcript
        // with nothing on the page saying so.
        expect(run.out, `what \`${command}\` put on stdout, which the block does not show`).toBe('')
      }
    })
  }
})

describe('the `--json` envelope in SKILL.md is what the command printed', () => {
  for (const [index, envelope] of ENVELOPES.entries()) {
    const block = payloads[index]
    const command = `dbmd ${envelope.argv.join(' ')}`
    const where = block === undefined ? PAGE : `${PAGE}:${block.line}`

    test(`${where} opens the way \`${command}\` opens`, async () => {
      if (block === undefined) throw new Error(`${PAGE} has no payload block for \`${command}\``)
      expect(block.text.trimEnd(), `${where} ends in an elision`).toMatch(/,\s*\.\.\.\s*\}$/)

      const run = await runCli([...envelope.argv])
      expect(run.code, `the exit code of \`${command}\``).toBe(envelope.code)

      const shown = JSON.parse(block.text.replace(/,\s*\.\.\.\s*\}\s*$/, '}')) as Record<string, unknown>
      const printed = JSON.parse(run.out) as Record<string, unknown>
      const opening = Object.fromEntries(Object.entries(printed).slice(0, Object.keys(shown).length))

      // Compared as one document rather than key by key, so a failure is a diff
      // of the block against the run: a key that moved, a key that was renamed
      // and a value that changed all read the same way.
      expect(JSON.stringify(opening, null, 2), `${where}, against \`${command}\``).toBe(
        JSON.stringify(shown, null, 2),
      )
    })
  }
})

describe('the canonicalise script in SKILL.md runs and prints what it shows', () => {
  for (const [index, run] of SCRIPT_RUNS.entries()) {
    const block = scriptOut[index]
    const where = block === undefined ? PAGE : `${PAGE}:${block.line}`
    const shown = `node canonicalise.mjs <checkout> ${run.directory} ${run.paths.join(' ')}`

    test(`${where} is what \`${shown}\` printed`, async () => {
      if (block === undefined) throw new Error(`${PAGE} has no output block for \`${shown}\``)

      const argv = [
        ...(run.refuses === undefined ? [] : ['--import', pathToFileURL(join(sandbox, 'refuse.mjs')).href]),
        join(sandbox, 'canonicalise.mjs'),
        join(sandbox, 'checkout'),
        join(sandbox, run.directory),
        ...run.paths,
      ]
      const ran = await node(argv, run.refuses === undefined ? {} : { DBMD_REFUSE: run.refuses })

      // Read before anything else: a script that threw prints its stack here
      // and nothing on stdout, and the page's own next paragraph is about
      // exactly that, so a failure should say what node said rather than
      // "expected {} to be {...}".
      expect(ran.err, `what \`${shown}\` put on stderr`).toBe('')
      expect(ran.code, `the exit code of \`${shown}\``).toBe(run.code)

      const printed = JSON.parse(ran.out) as Record<string, unknown>
      const claimed = JSON.parse(block.text) as Record<string, unknown>
      expect(Object.keys(printed), `the keys of \`${shown}\`, against ${where}`).toEqual(Object.keys(claimed))

      const elided = new Set(run.elided ?? [])
      const without = (document: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(document).filter(([key]) => !elided.has(key)))
      expect(
        reindented(JSON.stringify(without(printed)), `the output of \`${shown}\``),
        `${where}, against \`${shown}\``,
      ).toBe(reindented(JSON.stringify(without(claimed)), where))

      for (const key of elided) {
        // What survives an elision is the order of the parts either side of it.
        // On `message` that is the whole of the page's claim about it: the
        // system's words name the temporary file first, and reach the file the
        // agent cares about only after an arrow, which is why the bullet above
        // says to report `error.path` instead. The words themselves are the
        // injection's here rather than the operating system's, so they are not
        // what this holds; the two paths and their order are, and dbmd chose
        // both.
        const actual = String(printed[key]).replaceAll('\\', '/')
        const fragments = fragmentsOf(String(claimed[key]))
        expect(fragments.length, `${where} shows \`${key}\` elided, and has to keep something`).toBeGreaterThan(1)
        expect(
          missingFragment(actual, fragments),
          `\`${key}\` from \`${shown}\`, against ${where}. It printed: ${actual}`,
        ).toBeNull()
      }
    })
  }
})

describe('SKILL.md says true things about a run it only quotes part of', () => {
  test('the rename recipe: both referrers are there, and one of them is the self-ref', async () => {
    // Step 1 of the rename recipe shows two lines of this run inside `#`
    // comments, annotated, with two columns dropped. The header says why that
    // block is not compared byte for byte. This is the claim it makes: the
    // self-ref counts, which is the whole reason the two lines are on the page,
    // and a fixture edit that dropped `addresses.superseded_by` would leave the
    // recipe teaching an agent to look for something that is not there.
    const run = await runCli(['refs', 'addresses', 'shop', '--json'])
    const report = JSON.parse(run.out) as {
      incoming: { from: { table: string; column: string }; path: string }[]
    }
    expect(
      report.incoming.map((ref) => `${ref.from.table}.${ref.from.column} ${ref.path}`),
      'what points at `addresses` in the page\'s own example model',
    ).toEqual([
      'addresses.superseded_by tables/addresses.md',
      'orders.shipping_address_id tables/orders.md',
    ])
  })
})
