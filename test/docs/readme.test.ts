/**
 * `README.md`'s import walkthrough is run, and has to print what it shows.
 *
 * The page said this, near the top of "The commands": *every block below is
 * real output*. All but one of them was, which is what made the exception
 * expensive. `dbmd import --file next-release.json --dir shop-model` was shown
 * answering "4 tables, nothing to change" over a model the walkthrough above it
 * had just built with two tables in it, and the block beside it, listing a
 * delta, could never have been run at all: `next-release.json` is a database
 * that changed, not a file in this repository. A reader had no way to tell the
 * two apart, because a block that was run and a block that was imagined are the
 * same six lines of monospace (dbmd-wie).
 *
 * Correcting the number fixes it until the fixture next changes. So the blocks
 * that can be run are run here, the same way `docs/format.md`'s examples are
 * inputs rather than illustrations, and the one that cannot is marked in the
 * page's own prose as a sketch.
 *
 * Four info strings are picked up, and all four are invisible on GitHub, so the
 * page reads exactly as it did:
 *
 *   ```dbmd-run
 *   ```markdown dbmd-file:shop-model/tables/orders.md
 *   ```dbmd-sketch
 *   ```markdown dbmd-head:examples/shop/tables/shipments.md
 *
 * A `dbmd-run` block is a shell session. Every `$ dbmd ...` line in it is run,
 * in order, and the lines under it must equal what that command wrote to
 * stderr, which is where every command's narration goes. A `dbmd-file:` block
 * must equal the file at that path once the session has run. A `dbmd-sketch`
 * block is not run, and the only thing asserted about it is that it exists,
 * because the assertion a reader needs is the sentence beside it.
 *
 * A `dbmd-head:` block is a committed file in this repository, quoted from the
 * top and stopping wherever the page stops, which is what a page showing a file
 * to make a point about it does. It is read from the repository rather than
 * from the sandbox, and it is the one tag whose blocks are looked for on the
 * whole page rather than inside the `dbmd import` walkthrough: a file quoted
 * anywhere goes stale the same way, and the walkthrough's boundary is about
 * where the page promised that every block was run (ADR 0056).
 *
 * `layout:` is compared as a key and not as a value, and that exception is the
 * whole reason this tag exists rather than `dbmd-file:` with a wider scope. The
 * coordinates are what the studio rewrites when somebody drags a box, and
 * ADR 0003 calls that the line a reviewer learns to skip. A test that turned a
 * drag into a red build would make the one line nobody reads the one line that
 * can break the build, and `examples/shop` exists to be arranged. Everything
 * else in the block is a claim about the model and is held to the byte.
 *
 * WHY THE COMMANDS RUN FROM A SANDBOX RATHER THAN WITH ABSOLUTE PATHS
 * A command prints the directory it was given (ADR 0006), so a run passing
 * `--dir C:\Users\...\shop-model` prints that, and the page shows `shop-model`
 * because that is what a reader types. Rewriting the paths and then editing the
 * absolute one back out of the output would make the assertion agree with the
 * page about a string neither of them ran. So the working directory moves
 * instead: the fixtures are copied to the path the page names, `process.chdir`
 * puts the session in a directory where every relative path in the block means
 * what the page means, and the command is run exactly as written.
 *
 * Only `test/import/fixtures/` is copied in. A block naming a file outside it
 * fails to read that file, loudly, which is the question the author should be
 * answering: either it is a committed fixture, or the block is a sketch.
 *
 * ADR 0056 is the whole argument, including which blocks on that page are left
 * out of this on purpose and why.
 */

import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runCli } from '../cli/harness.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url))
const fixtures = fileURLToPath(new URL('../import/fixtures', import.meta.url))

/** Where the fixtures have to land for the paths the page prints to be the paths it runs. */
const FIXTURES_IN_PAGE = 'test/import/fixtures'

/**
 * The lines a `dbmd-head:` block may disagree with its file about.
 *
 * One entry, and adding a second one needs the argument this one has: a
 * `layout:` is rewritten by dragging a box, says nothing a reader of the page
 * came for, and is the line ADR 0003 says a reviewer learns to skip. A key that
 * a person changes on purpose does not belong here, because then the page can
 * be wrong about it and nothing says so.
 */
const VOLATILE = /^\s*layout:/

type Kind = 'run' | 'file' | 'sketch' | 'head'

interface Block {
  readonly kind: Kind
  /** On a `dbmd-file:` or `dbmd-head:` block, the path it claims to be. */
  readonly path?: string
  readonly text: string
  /** The line the fence opened on, for a failure that says where to look. */
  readonly line: number
}

/**
 * A tagged fence, opened on its own line and closed by the next line that is
 * only backticks. None of these blocks nests a fence.
 *
 * The tag sits where a language would when there is no language to write, which
 * is the case for a shell session, and after the language when there is one.
 * Either way GitHub shows nothing, and `docs/format.md` has the same convention
 * for the same reason.
 */
const OPENING = /^```(?:(\S+)\s+)?(dbmd-run|dbmd-sketch|dbmd-file:\S+|dbmd-head:\S+)\s*$/

function blocksIn(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const opening = OPENING.exec(lines[i] ?? '')
    if (opening === null) continue
    const end = lines.indexOf('```', i + 1)
    if (end === -1) throw new Error(`unterminated fence at README.md:${i + 1}`)
    const text = `${lines.slice(i + 1, end).join('\n')}\n`
    const tag = opening[2] as string
    if (tag === 'dbmd-run') blocks.push({ kind: 'run', text, line: i + 1 })
    else if (tag === 'dbmd-sketch') blocks.push({ kind: 'sketch', text, line: i + 1 })
    else if (tag.startsWith('dbmd-head:'))
      blocks.push({ kind: 'head', path: tag.slice('dbmd-head:'.length), text, line: i + 1 })
    else blocks.push({ kind: 'file', path: tag.slice('dbmd-file:'.length), text, line: i + 1 })
    i = end
  }
  return blocks
}

/**
 * The file's opening, as many lines as the block claims, with the volatile
 * lines replaced by what the block says about them.
 *
 * Written as one string to compare against another so that a failure is a diff
 * of the block against the file rather than a line number and a boolean, which
 * is the failure ADR 0034 asks a guard to produce. A file shorter than the
 * block comes out shorter and fails the same way.
 */
function openingOf(file: string, block: Block): string {
  const claimed = block.text.slice(0, -1).split('\n')
  const found = file.split('\n').slice(0, claimed.length)
  return found
    .map((line, i) => {
      const claim = claimed[i] ?? ''
      return VOLATILE.test(line) && VOLATILE.test(claim) ? claim : line
    })
    .join('\n')
}

/**
 * The walkthrough, as line numbers.
 *
 * An entry under "The commands" opens a paragraph with the command in bold
 * code, which is the convention `scripts/check-commands.mjs` already reads the
 * page by, so the import entry runs to the start of the next one. Anchoring on
 * that rather than on a heading means the region moves when the entry moves.
 */
function walkthroughOf(lines: readonly string[]): { readonly from: number; readonly to: number } {
  const entry = /^\*\*`dbmd [a-z][a-z0-9-]*/
  const from = lines.findIndex((line) => line.startsWith('**`dbmd import'))
  if (from === -1) throw new Error('README.md has no `dbmd import` entry to read')
  const after = lines.slice(from + 1).findIndex((line) => entry.test(line))
  return { from, to: after === -1 ? lines.length : from + 1 + after }
}

const page = await readFile(readmePath, 'utf8')
const lines = page.split('\n')
const walkthrough = walkthroughOf(lines)

// The page is scanned once and the blocks are then sorted by where they are,
// because the two mechanisms have different scopes on purpose. A session and
// the file it wrote only mean anything inside the walkthrough that ran them; a
// file quoted from this repository means the same thing anywhere on the page.
const tagged = blocksIn(lines)
const inWalkthrough = (block: Block): boolean =>
  block.line - 1 >= walkthrough.from && block.line - 1 < walkthrough.to
const blocks = tagged.filter((block) => block.kind !== 'head' && inWalkthrough(block))
const heads = tagged.filter((block) => block.kind === 'head')

describe('the import walkthrough in README.md says which of its blocks were run', () => {
  test('every block in it is tagged, one way or the other', () => {
    // The defect was not the wrong number. It was that nothing on the page
    // distinguished a block that had been run from one that had not, so nobody
    // knew which numbers to trust. A new block here has to answer that, and an
    // untagged fence is the author not having answered it yet.
    const untagged: number[] = []
    let fenced = false
    for (let i = walkthrough.from; i < walkthrough.to; i++) {
      const line = lines[i] ?? ''
      if (!line.startsWith('```')) continue
      if (fenced) {
        fenced = false
        continue
      }
      fenced = true
      if (!OPENING.test(line)) untagged.push(i + 1)
    }
    expect(untagged, 'fences in the `dbmd import` walkthrough with no dbmd- tag').toEqual([])
  })

  test('there are blocks of each kind to read', () => {
    // Without this a refactor that broke the info strings leaves a green suite
    // asserting nothing at all, which is the shape of the problem it exists to
    // catch. `docs/format.md`'s test carries the same floor for the same reason.
    expect(blocks.filter((block) => block.kind === 'run').length).toBeGreaterThanOrEqual(2)
    expect(blocks.filter((block) => block.kind === 'file').length).toBeGreaterThanOrEqual(1)
    expect(blocks.filter((block) => block.kind === 'sketch').length).toBeGreaterThanOrEqual(1)
  })

  test('the sketch is called a sketch where a reader will see it', () => {
    // The tag is invisible on GitHub, so on its own it tells a reader nothing.
    // What tells them is the prose above the fence, and this is the only part
    // of the mark that a reader ever reads.
    for (const block of blocks.filter((sketch) => sketch.kind === 'sketch')) {
      const before = lines.slice(Math.max(walkthrough.from, block.line - 9), block.line - 1)
      expect(before.join('\n'), `the prose above README.md:${block.line}`).toContain('sketch')
    }
  })
})

describe('a block in README.md that quotes a committed file is that file', () => {
  test('there is a block to read', () => {
    // The same floor the walkthrough carries, for the same reason: a refactor
    // that broke the info string would otherwise leave this suite green while
    // asserting nothing about any file at all.
    expect(heads.length).toBeGreaterThanOrEqual(1)
  })

  for (const block of heads) {
    const path = block.path as string

    test(`README.md:${block.line} is the opening of ${path}`, async () => {
      const file = await readFile(join(repoRoot, path), 'utf8')
      expect(openingOf(file, block), `${path}, against the block at README.md:${block.line}`).toBe(
        block.text.slice(0, -1),
      )
    })
  }
})

/**
 * A block outside the walkthrough that quotes what a command narrated.
 *
 * "The commands" opens by promising that every block below it is output, and
 * the tags above keep that promise for one entry. The blocks either side of it
 * are quoted by hand, and one of them drifted: the
 * `dbmd query --engine postgres` block said the PostgreSQL introspection query
 * was 9827 characters while the command printed 12403, off by a quarter, on the
 * front page, in the block that shows a first-time reader their first command
 * (dbmd-53w).
 *
 * The number was never the maintained thing. `runQuery` computes it from the
 * SQL it has just printed, `test/cli/query.test.ts` holds it to that length,
 * and `--json` carries it as `characters`. Only the page's transcription of it
 * was written by hand, so taking it off the page would have left the block
 * showing a line the command does not print, which is the shape of the defect
 * ADR 0056 exists to end rather than a fix for it. ADR 0056's revisit rule says
 * as much directly: a block outside the walkthrough going stale is evidence
 * that the region is drawn too small, and the answer is to widen it rather than
 * to fix the block. ADR 0069.
 *
 * WHY THIS IS NOT A FIFTH TAG
 * The command is named here instead, the way `test/docs/payloads.test.ts` names
 * the command over a plain ` ```json ` fence. A tag buys exhaustiveness, and
 * exhaustiveness over this page's remaining fences is what ADR 0056's first
 * revisit already declined, because most of them are prose. Naming the command
 * costs the page nothing, so the block stays a plain shell session and reads as
 * one.
 *
 * The `$` line is written out beside the argument list rather than parsed into
 * it, because it ends in `> introspect.sql` and `sessionIn` below would hand
 * `>` to `parseArgs` as a directory. The page shows that redirect on purpose:
 * stdout is the SQL, and this block is the narration that went the other way.
 *
 * WHY ONLY A COMMAND THAT READS AND WRITES NOTHING
 * `dbmd query` takes no directory, opens no file and binds no socket, so
 * running it needs neither a sandbox nor a working directory. The other blocks
 * on this page outside the walkthrough each need one: `dbmd init` and
 * `dbmd check` want a directory in a known state, and `dbmd studio` prints a
 * port the kernel chose, which is the reason ADR 0056 already gives for leaving
 * that one alone. All four were read against a run by hand on 2026-09-07 and
 * were exact to the byte. Widening to them is a sandbox, and the sandbox is
 * what the walkthrough below already owns.
 */
const NARRATED = [
  {
    shown: '$ dbmd query --engine postgres > introspect.sql',
    argv: ['query', '--engine', 'postgres'],
  },
] as const

describe('a block in README.md that narrates a command is what that command narrated', () => {
  for (const { shown, argv } of NARRATED) {
    const command = `dbmd ${argv.join(' ')}`

    test(`the block opening \`${shown}\` is what \`${command}\` wrote to stderr`, async () => {
      const at = lines.indexOf(shown)
      expect(at, `README.md shows \`${shown}\``).toBeGreaterThan(0)
      expect(lines[at - 1], `the line above README.md:${at + 1} opens a fence`).toBe('```')
      const end = lines.indexOf('```', at + 1)
      expect(end, `README.md:${at + 1} is inside a fence that closes`).toBeGreaterThan(at)

      const run = await runCli([...argv])
      expect(run.err, `\`${command}\`, against the block at README.md:${at + 2}`).toBe(
        `${lines.slice(at + 1, end).join('\n')}\n`,
      )
      // The redirect is why this block is here rather than in a `dbmd-run`, so
      // the thing being redirected is worth one assertion of its own. What the
      // page shows of this run is the narration, and that was just compared.
      expect(run.out.length, `what \`${command}\` put on stdout`).toBeGreaterThan(0)
      expect(run.code, `the exit code of \`${command}\``).toBe(0)
    })
  }
})

describe('the import walkthrough in README.md prints what it shows', () => {
  let sandbox = ''
  let original = ''

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'dbmd-readme-'))
    const landing = join(sandbox, FIXTURES_IN_PAGE)
    await mkdir(dirname(landing), { recursive: true })
    await cp(fixtures, landing, { recursive: true })
    original = process.cwd()
    process.chdir(sandbox)
  })

  afterAll(async () => {
    // Restored before the directory goes, and before any other file in this
    // worker runs: a working directory left pointing at a deleted temporary is
    // a failure somewhere else entirely.
    if (original !== '') process.chdir(original)
    if (sandbox !== '') await rm(sandbox, { recursive: true, force: true })
  })

  // In document order and in one sequence, because the second run's answer is
  // "nothing to change" only if the first one wrote the model, which is exactly
  // what the page is saying.
  for (const block of blocks) {
    if (block.kind === 'sketch') continue

    if (block.kind === 'run') {
      test(`the session at README.md:${block.line} prints its own output`, async () => {
        for (const { argv, expected } of sessionIn(block)) {
          const run = await runCli(argv)
          expect(run.err, `\`dbmd ${argv.join(' ')}\` at README.md:${block.line}`).toBe(expected)
          // Every command in the walkthrough succeeds. A block that needs a
          // failing one needs this tag to carry the code, and the sentence
          // above it to say why, rather than a silent exception here.
          expect(run.code, `the exit code of \`dbmd ${argv.join(' ')}\``).toBe(0)
        }
      })
    } else {
      test(`the file at README.md:${block.line} is the file that was written`, async () => {
        const written = await readFile(join(sandbox, block.path as string), 'utf8')
        expect(written, `${block.path as string}, after the session above it`).toBe(block.text)
      })
    }
  }
})

/**
 * A shell session as commands and the output each one claims.
 *
 * A line opening with `$ ` is a command and everything under it up to the next
 * one is what it printed. The prompt is dropped, `dbmd` is dropped because that
 * is the name of the binary rather than an argument, and what is left is the
 * argument list `main` is given.
 */
function sessionIn(block: Block): { readonly argv: string[]; readonly expected: string }[] {
  const session: { argv: string[]; output: string[] }[] = []
  for (const line of block.text.split('\n').slice(0, -1)) {
    if (line.startsWith('$ ')) {
      const words = line.slice(2).trim().split(/\s+/)
      if (words[0] !== 'dbmd') {
        throw new Error(`README.md:${block.line} runs \`${words[0] ?? ''}\`, and only dbmd runs here`)
      }
      session.push({ argv: words.slice(1), output: [] })
      continue
    }
    const current = session.at(-1)
    if (current === undefined) {
      throw new Error(`README.md:${block.line} has output above its first command`)
    }
    current.output.push(line)
  }
  if (session.length === 0) throw new Error(`README.md:${block.line} runs nothing`)
  return session.map(({ argv, output }) => ({
    argv,
    expected: output.length === 0 ? '' : `${output.join('\n')}\n`,
  }))
}
