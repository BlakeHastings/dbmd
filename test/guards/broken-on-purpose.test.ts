/**
 * The guards, broken on purpose.
 *
 * WHAT THIS IS FOR
 * ADR 0001 makes a handful of scripts the layer that decides what lands, and
 * every one of them was mutation-tested by hand on 2026-09-07. Every one failed
 * correctly. That is the problem rather than the reassurance: it was true
 * because somebody spent an hour breaking things on purpose, and nothing
 * repeated it the next day.
 *
 * A guard that never fires looks exactly like a guard that cannot. This
 * repository has already found four tests that had stopped testing something,
 * and one of them is in this file's subject matter: `pk: true` was missing from
 * the `dbmd init` scaffold for weeks with 622 tests green, until dbmd-54 noticed
 * by hand. So each test below breaks one guard's subject on purpose and asserts
 * the guard says so.
 *
 * WHY EVERY ASSERTION READS THE WORDS AND NOT ONLY THE CODE
 * dbmd-54 is the precedent and its title is the lesson: the smoke test could not
 * see a warning, so it was made to read the words. A guard that exits 1 for the
 * wrong reason is still broken, and an exit-code-only assertion cannot tell the
 * difference, and it matters more here than anywhere, because these mutations
 * are performed in a scratch copy that could itself be wrong. A scratch tree
 * that failed to assemble makes the guard exit 1 too. The sentence it prints is
 * what separates the two, so the sentence is what is asserted.
 *
 * WHY NOTHING HERE MUTATES THE WORKING TREE
 * Every mutation happens in a temporary directory holding a copy of the script
 * under test, or on a value in memory. Nothing is edited in place and restored,
 * so a red test here cannot leave the checkout dirty and make every later run in
 * the session meaningless. On Windows a half-restored file is easy to produce
 * and hard to notice.
 *
 * The NUL byte the reviewable check is fed is written at run time from a
 * `Buffer`, never committed. A fixture carrying one would make this very file
 * binary to git and fail `check:reviewable` on its own build, which would be a
 * funny way to fail and not a good one.
 *
 * WHAT IS NOT HERE, AND WHY
 * `scripts/smoke-pack.mjs` is mutated by `scripts/check-pack-guard.mjs` instead.
 * It packs a tarball, installs it and starts the studio, which costs about nine
 * seconds: too much for the `npm test` loop, and cheap enough for the gate.
 * ADR 0034.
 *
 * `guard-merge.mjs --probe` is absent on purpose. What the probe detects is
 * whether a PreToolUse hook is loaded in the harness process, which is a fact
 * about the CLI session and not about anything in this tree. A test can only
 * observe that running the file directly prints "NOT loaded", which it would
 * print in a session where the guard is perfectly fine, so the test would pass
 * whatever the answer. Its deny rules are a different thing and are covered
 * below.
 *
 * `scripts/merge-pr.mjs` and `scripts/check-main-provenance.mjs` were both
 * absent until 2026-09-07, and the second one was not even listed here. There
 * are two network-dependent guards and this section named one, which is the
 * failure this repository keeps paying for: a list that presents itself as
 * exhaustive and is not. The provenance audit is the detection half of the
 * merge gate, the layer that answers "was one of the preventive ones bypassed",
 * and nothing had ever proved it detects. Both are covered below now. ADR 0058.
 *
 * What is still not covered in either is the shell around the decision: the
 * `gh` invocations, the argument parsing and the exit codes. Reaching those
 * needs the network and a pull request in a particular state, which is the wall
 * ADR 0034 described. It now stands in front of a great deal less.
 *
 * ONE THING THIS DIRECTORY IS EXEMPT FROM
 * `scripts/check-commands.mjs` does not scan `test/guards/`, and this file is
 * why: the fixtures below name `dbmd fmt`, run `npm run bogus` and mark a
 * command that exists as hypothetical, because each of those is a case that
 * check refuses. Pointing it at them would fail the build on the evidence that
 * it works. ADR 0036.
 */

import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { exampleModel } from '../../src/cli/example.js'
import type { Column, Model } from '../../src/model/types.js'
import { readModel } from '../../src/model/read.js'
import { validate } from '../../src/model/validate.js'
import { writeModel } from '../../src/model/write.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPTS = join(ROOT, 'scripts')

const temporaries: string[] = []

afterEach(async () => {
  for (const directory of temporaries.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/**
 * A scratch directory holding one of the guard scripts under its own `scripts/`.
 *
 * `nodeModules` links the repository's own, for a script that imports a
 * devDependency: `check-scene-classes.mjs` parses the two scene files with the
 * TypeScript compiler, and a bare specifier resolved from a temporary directory
 * has nothing above it to resolve against. A junction on Windows and a symbolic
 * link everywhere else, and `rm` unlinks either rather than descending into it,
 * so the cleanup above cannot reach the real one. That was checked rather than
 * assumed, because the alternative is deleting the checkout's `node_modules`
 * from a test run.
 */
async function scratchWith(script: string, { nodeModules = false } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dbmd-guard-'))
  temporaries.push(root)
  await mkdir(join(root, 'scripts'), { recursive: true })
  await cp(join(SCRIPTS, script), join(root, 'scripts', script))
  if (nodeModules) {
    await symlink(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'junction')
  }
  return root
}

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}

/** One of the guard scripts, run in a scratch root, with an optional stdin payload. */
function runScript(root: string, script: string, stdin?: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts', script)], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (out += chunk))
    child.stderr.on('data', (chunk: string) => (err += chunk))
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, out, err }))
    child.stdin.end(stdin ?? '')
  })
}

// ---------------------------------------------------------------------------
// check-reviewable.mjs: a tracked file git would treat as binary
// ---------------------------------------------------------------------------

describe('check:reviewable, broken on purpose', () => {
  /**
   * A real git repository, because the check reads `git ls-files` rather than
   * the directory. A file on disk that git does not track is not this check's
   * business, and a test that wrote one without adding it would pass while
   * proving nothing. No commit is made: `git ls-files` reads the index.
   */
  async function repository(files: Record<string, Buffer | string>): Promise<string> {
    const root = await scratchWith('check-reviewable.mjs')
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, contents)
    }
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' })
    return root
  }

  /**
   * The byte, assembled at run time.
   *
   * `Buffer.from([0])` rather than a `\0` in a string literal, so that the
   * source of this test is itself text. Two files in this repository have been
   * lost to a literal NUL and the second one was the largest new module on its
   * branch; writing a third into the test that exists to catch them would be a
   * poor joke.
   */
  function withNulOnTheThirdLine(): Buffer {
    return Buffer.concat([
      Buffer.from('const first = 1\nconst second = 2\nconst third = '),
      Buffer.from([0]),
      Buffer.from('\n'),
    ])
  }

  test('a tracked source file with a NUL byte fails, and is named with its offset', async () => {
    const root = await repository({
      'src/fine.ts': 'export const fine = true\n',
      'src/broken.ts': withNulOnTheThirdLine(),
    })

    const ran = await runScript(root, 'check-reviewable.mjs')

    expect(ran.code).toBe(1)
    // The file, so a reader knows which one to open, and the offset and line, so
    // they can find the byte in a file whose contents grep will refuse to search.
    expect(ran.err).toContain('src/broken.ts')
    expect(ran.err).toContain('NUL byte at offset 47, line 3')
    // The sentence that says why this is worth failing a build over. Without it
    // the check is a mystery exit code in CI.
    expect(ran.err).toContain('has no diff')
    // And it is the only offender: a check that reported every file would also
    // have exited 1 here.
    expect(ran.err).toContain('1 tracked file git will treat as binary')
    expect(ran.err).not.toContain('src/fine.ts')
  })

  test('the same tree without the byte passes, so the failure was the byte', async () => {
    const root = await repository({
      'src/fine.ts': 'export const fine = true\n',
      'src/broken.ts': 'const third = 3\n',
    })

    const ran = await runScript(root, 'check-reviewable.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('none of them binary to git')
  })

  test('a NUL in a file that is binary by nature is not a finding', async () => {
    const root = await repository({
      'src/fine.ts': 'export const fine = true\n',
      'docs/logo.png': withNulOnTheThirdLine(),
    })

    const ran = await runScript(root, 'check-reviewable.mjs')

    // "This PNG has no diff" is true and uninteresting, and a check that says it
    // is a check people turn off. The skip list is behaviour, so it is asserted.
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('none of them binary to git')
  })
})

// ---------------------------------------------------------------------------
// check-adr-numbers.mjs: two records claiming one number
// ---------------------------------------------------------------------------

describe('check:adr, broken on purpose', () => {
  async function decisions(names: readonly string[]): Promise<string> {
    const root = await scratchWith('check-adr-numbers.mjs')
    const dir = join(root, 'docs', 'architecture', 'decisions')
    await mkdir(dir, { recursive: true })
    // A README lives in the real directory and is skipped by name. Present here
    // so that a check which stopped skipping it fails this suite rather than
    // main.
    await writeFile(join(dir, 'README.md'), '# Decision records\n')
    for (const name of names) await writeFile(join(dir, name), `# ${name}\n`)
    return root
  }

  test('two records claiming one number fail, and both files are named', async () => {
    const root = await decisions([
      '0001-the-first-thing.md',
      '0002-the-second-thing.md',
      '0002-somebody-elses-second-thing.md',
    ])

    const ran = await runScript(root, 'check-adr-numbers.mjs')

    expect(ran.code).toBe(1)
    // Both, because the fix is to renumber one of them and the author has to be
    // able to tell which is theirs.
    expect(ran.err).toContain('0002 is claimed twice')
    expect(ran.err).toContain('0002-the-second-thing.md')
    expect(ran.err).toContain('0002-somebody-elses-second-thing.md')
    expect(ran.err).toContain('Renumber one of them')
    // And not the number that is fine.
    expect(ran.err).not.toContain('0001')
  })

  test('a record whose name carries no number fails for that reason', async () => {
    const root = await decisions(['0001-the-first-thing.md', 'draft-notes.md'])

    const ran = await runScript(root, 'check-adr-numbers.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('draft-notes.md')
    expect(ran.err).toContain('not NNNN-kebab-title.md')
  })

  test('the same directory without the collision passes', async () => {
    const root = await decisions(['0001-the-first-thing.md', '0002-the-second-thing.md'])

    const ran = await runScript(root, 'check-adr-numbers.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('2 decision records, no number claimed twice')
  })
})

// ---------------------------------------------------------------------------
// check-commands.mjs: a page naming a command that is not there
// ---------------------------------------------------------------------------

describe('check:commands, broken on purpose', () => {
  /**
   * A real git repository again, for the same reason: the check reads
   * `git ls-files`, so a page written but not added proves nothing.
   *
   * The tree carries a CLI registry and a `package.json` rather than pointing
   * at the real ones, because the point of most of these cases is what the
   * check does with a name that is *not* on the list, and a scratch list is the
   * only way to know what that list is. The registry is the shape
   * `src/cli/main.ts` has: an array of imported `Command` values, each one
   * declaring the word a user types.
   *
   * The `README.md` is there because the check reads both directions: a command
   * on the registry with no entry in it is a failure too, so a tree without one
   * would fail every case below for a reason none of them is about.
   */
  async function repository(files: Record<string, string>): Promise<string> {
    const root = await scratchWith('check-commands.mjs')
    const base: Record<string, string> = {
      'package.json': `${JSON.stringify({ version: '0.1.0', scripts: { check: 'true', build: 'true' } }, null, 2)}\n`,
      'README.md': [
        '# scratch',
        '',
        '## The commands',
        '',
        '**`dbmd init`** writes a model to start from.',
        '',
        '**`dbmd check`** says whether it is still good.',
        '',
      ].join('\n'),
      'src/cli/main.ts': [
        "import { checkCommand } from './check.js'",
        "import { initCommand } from './init.js'",
        '',
        'const COMMANDS: readonly Command[] = [initCommand, checkCommand]',
        '',
      ].join('\n'),
      'src/cli/init.ts': "export const initCommand: Command = {\n  name: 'init',\n}\n",
      'src/cli/check.ts': "export const checkCommand: Command = {\n  name: 'check',\n}\n",
    }
    for (const [path, contents] of Object.entries({ ...base, ...files })) {
      const full = join(root, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, contents)
    }
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' })
    // The checker is the tool here, not part of the tree it is pointed at. Its
    // own header names `dbmd query` and `dbmd import`, which are real in this
    // repository and are not on the two-command registry above, so leaving it
    // tracked would fail every case whose point is that nothing is wrong.
    execFileSync('git', ['rm', '--cached', '-q', 'scripts/check-commands.mjs'], {
      cwd: root,
      stdio: 'ignore',
    })
    return root
  }

  test('a page naming a command that does not exist fails, with the file and the line', async () => {
    const root = await repository({
      'docs/guide.md': [
        '# Guide',
        '',
        'Run `dbmd check` first.',
        '',
        'Then run `dbmd fmt`.',
        '',
      ].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    // The line, because "something in the docs names a command that does not
    // exist" is worse than the defect it caught.
    expect(ran.err).toContain('docs/guide.md:5')
    expect(ran.err).toContain('`dbmd fmt` is not a dbmd command')
    // And what the commands actually are, so the fix does not need a second
    // command to find out.
    expect(ran.err).toContain('There are init, check')
    // The convention, in the failure, because a rule you meet as a bare exit
    // code is a rule you resent.
    expect(ran.err).toContain('<!-- hypothetical: dbmd fmt -->')
    // Not the line that was fine.
    expect(ran.err).not.toContain('docs/guide.md:3')
  })

  test('the same page naming a real command passes, so the failure was the name', async () => {
    const root = await repository({ 'docs/guide.md': 'Run `dbmd check` first.\n' })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('reference resolves')
  })

  test('prose is not a reference, which is half of what this guard is', async () => {
    // The false positives the hand sweep hit. A check that failed these would
    // pass every case above and be unusable, so this is as load bearing as they
    // are. The fenced block is the other half: a block is not always a shell,
    // and both of these lines are in this repository.
    const root = await repository({
      'docs/guide.md': [
        'dbmd reads the model, dbmd describes what it found, and dbmd can print it.',
        '',
        '```',
        'error this build of dbmd reads version 1, so re-run the query',
        '# dbmd model files. Prettier rewrites the prose.',
        '```',
        '',
      ].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('reference resolves')
  })

  test('a hypothetical is excused by the marker, and only by the marker', async () => {
    const sentence = 'A future `dbmd fmt` will bring a directory into shape.'

    const excused = await repository({
      'docs/guide.md': `${sentence} <!-- hypothetical: dbmd fmt -->\n`,
    })
    expect((await runScript(excused, 'check-commands.mjs')).code).toBe(0)

    // The same sentence without it, so the marker is what did the work rather
    // than the words "a future" in front of it. Inferring from those words is
    // the design this rejected. ADR 0036.
    const bare = await repository({ 'docs/guide.md': `${sentence}\n` })
    expect((await runScript(bare, 'check-commands.mjs')).code).toBe(1)
  })

  test('a marker for something that exists is stale and fails', async () => {
    const root = await repository({
      'docs/guide.md': 'A future `dbmd check` will do more. <!-- hypothetical: dbmd check -->\n',
    })

    const ran = await runScript(root, 'check-commands.mjs')

    // The half worth having: on the day the command is written, the build names
    // every page still talking about it in the future tense.
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('docs/guide.md:1')
    expect(ran.err).toContain('the marker for `dbmd check` is stale')
  })

  test('a marker whose reference has gone fails too, so markers cannot pile up', async () => {
    const root = await repository({
      'docs/guide.md': 'Nothing here names it. <!-- hypothetical: dbmd fmt -->\n',
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('the marker for `dbmd fmt` excuses nothing in this file')
  })

  test('npm scripts and scripts/ files are checked the same way', async () => {
    const root = await repository({
      'docs/guide.md': ['Run `npm run check`.', '', 'Then `npm run bogus`.', ''].join('\n'),
      'CONTRIBUTING.md': 'Land it with `node scripts/absent.mjs`.\n',
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('`npm run bogus` is not a script in package.json')
    expect(ran.err).toContain('`node scripts/absent.mjs` is not a file in scripts/')
    expect(ran.err).not.toContain('npm run check`')
  })

  test('a bare path into scripts/ is a reference too, without a runner in front of it', async () => {
    // The shape ADR 0036's revisit entry asked for, and it is here because one
    // was found rather than because the list looked short. guard-merge.mjs
    // named a sibling test in a comment, as the thing catching drift between
    // the copies of its command reader, and that file exists only in the
    // repository the guard is installed from. Nobody was being told to run it,
    // so no runner appeared in front of it, so the three shapes that read an
    // invocation walked straight past a comment claiming a safety net that was
    // not there. ADR 0059 is what came of reading it.
    const root = await repository({
      'scripts/build.mjs': '// a script that is really there\n',
      'docs/guide.md': [
        '# Guide',
        '',
        'Drift between the copies is caught by `scripts/command-reader.test.mjs`.',
        '',
        'The client is built by `scripts/build.mjs`.',
        '',
      ].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('docs/guide.md:3')
    expect(ran.err).toContain('`scripts/command-reader.test.mjs` is not a file in scripts/')
    // And not the sibling that is there, which is the difference between this
    // and a rule against writing a path down.
    expect(ran.err).not.toContain('docs/guide.md:5')
  })

  test('a path in the middle of a code span is not a reference, which is what makes it safe', async () => {
    // The one false positive the measurement produced. A template literal is a
    // code span by this checker's own rule, and this repository writes its
    // failure messages as paragraphs of prose inside one:
    // check-main-provenance.mjs ends a sentence with "Add the case to
    // scripts/guard-merge.mjs." Unanchored, the sweep read the full stop as
    // part of the filename and called the file missing. Requiring the path to
    // begin the code removes that without a second rule about punctuation.
    const root = await repository({
      'scripts/build.mjs': [
        'export const advice =',
        '  `Something in the tree is wrong.\\n` +',
        '  `Add the case to scripts/guard-merge.mjs.\\n`',
        '',
      ].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('reference resolves')
  })

  test('a bare path that does not exist yet is excused by the marker, like every other shape', async () => {
    const sentence = 'Drift will be caught by `scripts/drift.test.mjs`.'

    const excused = await repository({
      'docs/guide.md': `${sentence}\n\n<!-- hypothetical: scripts/drift.test.mjs -->\n`,
    })
    expect((await runScript(excused, 'check-commands.mjs')).code).toBe(0)

    // The same sentence without it, so the marker did the work. A fourth shape
    // that could not be marked would be a fourth shape people worked around.
    const bare = await repository({ 'docs/guide.md': `${sentence}\n` })
    expect((await runScript(bare, 'check-commands.mjs')).code).toBe(1)
  })

  test('the command list comes from the CLI, so adding a command is enough', async () => {
    const page = 'Run `dbmd export --stdout` when you are done.\n'

    const before = await repository({ 'docs/guide.md': page })
    expect((await runScript(before, 'check-commands.mjs')).code).toBe(1)

    // The same page, against a registry that now has the command in it, with
    // nothing in the checker edited. A hand-written list of commands inside the
    // check would be one more fact that can disagree with the truth, which is
    // the defect the check exists for.
    //
    // The `README.md` grows an entry at the same time, because a command on the
    // registry owes one. That is the case below, met here from the other side.
    const after = await repository({
      'docs/guide.md': page,
      'README.md': [
        '# scratch',
        '',
        '## The commands',
        '',
        '**`dbmd init`** writes a model to start from.',
        '',
        '**`dbmd check`** says whether it is still good.',
        '',
        '**`dbmd export [directory]`** draws it.',
        '',
      ].join('\n'),
      'src/cli/main.ts': [
        "import { checkCommand } from './check.js'",
        "import { exportCommand } from './export.js'",
        "import { initCommand } from './init.js'",
        '',
        'const COMMANDS: readonly Command[] = [initCommand, checkCommand, exportCommand]',
        '',
      ].join('\n'),
      'src/cli/export.ts': "export const exportCommand: Command = {\n  name: 'export',\n}\n",
    })
    expect((await runScript(after, 'check-commands.mjs')).code).toBe(0)
  })

  test('a decision record naming something that does not exist is not a finding', async () => {
    const root = await repository({
      'docs/architecture/decisions/0001-a-thing.md': 'Somebody will want a `dbmd fmt`.\n',
    })

    const ran = await runScript(root, 'check-commands.mjs')

    // A record says what was true when it was decided and is never edited, so
    // failing one is asking an author to falsify history. The exclusion is
    // behaviour and it is a real hole: ADR 0007 was one of the seven places
    // that named `dbmd query`. ADR 0036 says so out loud rather than leaving it
    // as a quiet line in the script.
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('reference resolves')
  })

  test('a page teaching the convention passes, because it uses it', async () => {
    // The false positive this shipped with, met while writing AGENTS.md: a page
    // explaining the marker names the marker, and the checker reads the words
    // rather than knowing what a page is for. Documenting the rule and obeying
    // it are the same act here, which is the resolution rather than a special
    // case, and this locks it in.
    const root = await repository({
      'AGENTS.md': [
        'A command in backticks has to exist.',
        '',
        'If you mean a future `dbmd fmt`, say so on the line you wrote it:',
        '`<!-- hypothetical: dbmd fmt -->` in markdown, or `hypothetical: dbmd fmt`',
        'in a source comment.',
        '',
      ].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('reference resolves')
  })

  test('a runner in front of the command is read wherever it appears', async () => {
    // `npx --yes dbmd@0.1.0 check db-model` is in `docs/ci.md`, inside a YAML
    // block, indented under `- run:`. The bare word has to begin the code
    // because `dbmd` is also this project's name; a runner does not, because
    // nobody writes one by accident.
    const root = await repository({
      'docs/ci.md': ['```yaml', '      - run: npx --yes dbmd@0.1.0 fmt db-model', '```', ''].join(
        '\n',
      ),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('docs/ci.md:2')
    expect(ran.err).toContain('`dbmd fmt` is not a dbmd command')
  })

  /**
   * The registry with a third command on it, and the README the tree had
   * before it arrived. This is the shape of both failures the other direction
   * has already produced: `dbmd import` and `dbmd query` each shipped over a
   * README that had not heard of them.
   */
  async function withUndocumentedExport(readme?: string): Promise<string> {
    return await repository({
      ...(readme === undefined ? {} : { 'README.md': readme }),
      'src/cli/main.ts': [
        "import { checkCommand } from './check.js'",
        "import { exportCommand } from './export.js'",
        "import { initCommand } from './init.js'",
        '',
        'const COMMANDS: readonly Command[] = [initCommand, checkCommand, exportCommand]',
        '',
      ].join('\n'),
      'src/cli/export.ts': "export const exportCommand: Command = {\n  name: 'export',\n}\n",
    })
  }

  test('a command on the registry with no entry in README.md fails, and is named', async () => {
    const root = await withUndocumentedExport()

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    // The file, because this is the one rule that is about a file rather than a
    // line, and the command, because "the README is incomplete" is not a fix.
    expect(ran.err).toContain('1 command exists and README.md does not document it')
    expect(ran.err).toContain('dbmd export')
    // The shape of an entry, in the failure, so the fix does not need this test
    // or the script to be read first.
    expect(ran.err).toContain('**`dbmd refs <table> [directory]`**')
    // And not the two that are documented, which is the difference between a
    // guard that names a defect and a guard that names a file.
    expect(ran.err).not.toContain('dbmd init')
    expect(ran.err).not.toContain('dbmd check')
  })

  test('being mentioned is not being documented', async () => {
    // The near miss worth pinning: a README that talks about the command in
    // passing looks fine to a grep and leaves a reader with nowhere to go. Both
    // sentences below name `dbmd export` in backticks, so the other direction
    // of this check is satisfied and only this one is not.
    const mentioned = await withUndocumentedExport(
      [
        '# scratch',
        '',
        '## The commands',
        '',
        '**`dbmd init`** writes a model to start from.',
        '',
        '**`dbmd check`** says whether it is still good. Run it before',
        '`dbmd export`, which is fussier about a broken model than it is.',
        '',
      ].join('\n'),
    )
    expect((await runScript(mentioned, 'check-commands.mjs')).code).toBe(1)

    // The same tree with an entry rather than a mention. Nothing else moved.
    const documented = await withUndocumentedExport(
      [
        '# scratch',
        '',
        '## The commands',
        '',
        '**`dbmd init`** writes a model to start from.',
        '',
        '**`dbmd check`** says whether it is still good.',
        '',
        '**`dbmd export [directory]`** draws the model as a mermaid diagram.',
        '',
      ].join('\n'),
    )
    const ran = await runScript(documented, 'check-commands.mjs')
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('README.md documents all 3 commands')
  })

  // -------------------------------------------------------------------------
  // The version after `dbmd@`, which is a number rather than a name
  // -------------------------------------------------------------------------

  test('a pin naming a version this package is not fails, with the line and both numbers', async () => {
    const root = await repository({
      'docs/ci.md': ['```yaml', '      - run: npx --yes dbmd@0.9.9 check db-model', '```', ''].join(
        '\n',
      ),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('docs/ci.md:2')
    // Both numbers, because "the pin is wrong" is not a fix: which of the two
    // moved is the whole of what the reader has to decide.
    expect(ran.err).toContain('pins 0.9.9 and package.json says 0.1.0')
    // And not the other half of this check. `check` is a real command on the
    // scratch registry, so the reference resolved and only the number did not.
    expect(ran.err).not.toContain('is not a dbmd command')
  })

  test('the same block pinning what package.json says passes, so the failure was the number', async () => {
    const root = await repository({
      'docs/ci.md': ['```yaml', '      - run: npx --yes dbmd@0.1.0 check db-model', '```', ''].join(
        '\n',
      ),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    // The count, on the page, because a sweep that quietly stopped finding
    // anything prints the same success line as one that swept.
    expect(ran.out).toContain('1 pinned version names 0.1.0')
  })

  test('the release moving package.json under the pages is the same failure', async () => {
    // The direction that actually bites, and the one nothing could see before.
    // No page was edited. The number underneath them moved, which is what a
    // release is, and every recipe a reader copies now installs the version
    // before it.
    const root = await repository({
      'package.json': `${JSON.stringify({ version: '0.2.0', scripts: { check: 'true', build: 'true' } }, null, 2)}\n`,
      'docs/ci.md': ['```yaml', '      - run: npx --yes dbmd@0.1.0 check db-model', '```', ''].join(
        '\n',
      ),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('docs/ci.md:2')
    expect(ran.err).toContain('pins 0.1.0 and package.json says 0.2.0')
  })

  test('a pin with no command after it is read, because one of the four is written that way', async () => {
    // `docs/ci.md` says `node dist/cli.js` goes wherever the recipe says
    // `npx --yes dbmd@<version>`, and the sentence stops there. Every other
    // shape this script knows reads the word after the version, so a rule built
    // out of those would have read three of the four pins in the tree.
    const root = await repository({
      'docs/ci.md': [
        '# ci',
        '',
        'Use `node dist/cli.js` wherever the recipe says `npx --yes dbmd@0.9.9`.',
        '',
      ].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('docs/ci.md:3')
    expect(ran.err).toContain('pins 0.9.9 and package.json says 0.1.0')
  })

  test('a range is not the version either, and is named as what it says', async () => {
    const root = await repository({
      'docs/ci.md': ['Run `npx --yes dbmd@^0.1.0 check db-model`.', ''].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('pins ^0.1.0 and package.json says 0.1.0')
  })

  test('a dist-tag is not a version and is not read', async () => {
    // `docs/ci.md` writes one, in the paragraph that exists to say not to use
    // it. There is nothing in `package.json` for a moving tag to equal, so it
    // is skipped. This is the hole ADR 0080 names rather than a case it closes:
    // the same word arriving in the recipe would pass here too.
    const root = await repository({
      'docs/ci.md': ['`npx dbmd@latest check db-model` is the thing not to do.', ''].join('\n'),
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('0 pinned versions name 0.1.0')
  })

  test('a decision record pinning an old version is not a finding', async () => {
    // The same exclusion the commands half relies on, and the reason this rule
    // lives inside that script rather than in a second one beside it: three
    // records in the real tree name a pin as history, and failing one would ask
    // an author to falsify it. A second script would keep a second copy of the
    // exclusion list, and one of the two would eventually be edited alone.
    const root = await repository({
      'docs/architecture/decisions/0001-a-thing.md': 'The recipe pinned `dbmd@0.0.1` then.\n',
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('0 pinned versions name 0.1.0')
  })

  test('a manifest with no version fails rather than comparing against nothing', async () => {
    // A skip here is the guard that stopped guarding: every pin would pass, the
    // success line would print, and nothing would say the comparison had not
    // happened. ADR 0034.
    const root = await repository({
      'package.json': `${JSON.stringify({ scripts: { check: 'true', build: 'true' } }, null, 2)}\n`,
    })

    const ran = await runScript(root, 'check-commands.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('package.json has no version')
  })
})

// ---------------------------------------------------------------------------
// check-scene-classes.mjs: a class name both studio scenes use, with a rule
// that belongs to neither
// ---------------------------------------------------------------------------

describe('check:scenes, broken on purpose', () => {
  /**
   * A scratch studio: a page with a stylesheet, and the two scene files.
   *
   * Written rather than copied, because every case here is about a stylesheet
   * that is wrong on purpose and the real one is not. Three files is the whole
   * of what the check reads, so a synthetic tree is the same subject and a
   * readable one: each case shows the rule and the two lines that make it a
   * collision, side by side, which the real 800-line page cannot.
   *
   * No git repository. Unlike the two checks above, this one reads three named
   * paths rather than `git ls-files`, so a file on disk is all it needs. It
   * does need `node_modules`, because it parses the two scene files with the
   * TypeScript compiler rather than reading them as lines.
   */
  async function studio(files: {
    rules: string[]
    canvas?: string[]
    inspector?: string[]
  }): Promise<string> {
    const root = await scratchWith('check-scene-classes.mjs', { nodeModules: true })
    await mkdir(join(root, 'src', 'studio', 'client'), { recursive: true })
    const write = (name: string, lines: string[]) =>
      writeFile(join(root, 'src', 'studio', 'client', name), `${lines.join('\n')}\n`)

    // The rules start on line 5 of the page, which is what the line assertions
    // below are counted from.
    await write('index.html', [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <style>',
      ...files.rules,
      '    </style>',
      '  </head>',
      '</html>',
    ])

    // The canvas writes its classes with `className`, including the ternary the
    // real one uses for a table box, because `box` is the class that anchors
    // half the rules in the real stylesheet and reading only the first literal
    // of an assignment would miss it.
    await write(
      'canvas.ts',
      files.canvas ?? [
        "scene.className = 'scene'",
        "layer.className = 'notes'",
        "element.className = table.complete ? 'box' : 'box broken'",
        "type.className = 'type'",
      ],
    )

    // The inspector writes almost none of its classes with `className`: they go
    // through two helpers, and the check is told about both by name. `el` takes
    // the class as its second argument; `textField` passes its key on to `el`,
    // which is how an input ends up as `.type`.
    await write(
      'inspector.ts',
      files.inspector ?? [
        'function el(tag: string, className = ""): HTMLElement {',
        '  return make(tag, className)',
        '}',
        'function textField(parent: HTMLElement, key: string): HTMLInputElement {',
        "  return el('input', key)",
        '}',
        "const said = el('p', 'notes')",
        "const kind = textField(item, 'type')",
      ],
    )
    return root
  }

  test('the defect that started this: a bare rule on a shared name fails, with the line', async () => {
    // dbmd-49, reduced. `.notes` is the canvas note layer and the inspector's
    // red validation paragraph, and the bare rule positioned every one of the
    // paragraphs at the corner of the page, behind the toolbar.
    const root = await studio({
      rules: [
        '      .notes {',
        '        position: absolute;',
        '        top: 0;',
        '      }',
        '      #inspector .notes {',
        '        color: red;',
        '      }',
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(1)
    // The line of the rule, not of the class or of the `<style>` block: this
    // stylesheet is 800 lines long and half of it is comment.
    expect(ran.err).toContain('src/studio/client/index.html:5')
    expect(ran.err).toContain('`.notes`')
    // Both halves of the collision, because the fix is a choice between them
    // and neither file is wrong on its own.
    expect(ran.err).toContain('canvas.ts:2')
    expect(ran.err).toContain('inspector.ts:7')
    // The convention, in the failure, so it is learnt where it is broken.
    expect(ran.err).toContain('.scene > .notes')
    expect(ran.err).toContain('#inspector .notes')
    // And it is the only offender: the scoped rule two lines down is fine, and
    // a check that reported both would also have exited 1 here.
    expect(ran.err).toContain('1 rule on a class name')
    expect(ran.err).not.toContain('index.html:9')
  })

  test('the same stylesheet with the rule scoped passes, so the failure was the scope', async () => {
    const root = await studio({
      rules: [
        '      .scene > .notes {',
        '        position: absolute;',
        '        top: 0;',
        '      }',
        '      #inspector .notes {',
        '        color: red;',
        '      }',
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(0)
    // The list is the finding whether or not anything is wrong, so the passing
    // run names what it looked at rather than saying nothing.
    expect(ran.out).toContain('.notes')
    expect(ran.out).toContain('.type')
    expect(ran.out).toContain('every rule naming one is anchored')
  })

  test('the first collision, one character along, is the same finding', async () => {
    // dbmd-34. The canvas element was `note` and `#inspector .note` was already
    // the panel's explanatory paragraph. Singular and plural were found hours
    // apart by two agents who did not know about each other, which is why the
    // check is about the shape rather than about either name.
    const root = await studio({
      rules: [
        '      .note {',
        '        position: absolute;',
        '      }',
        '      #inspector .note {',
        '        color: gray;',
        '      }',
      ],
      canvas: ["card.className = 'note'"],
      inspector: [
        'function el(tag: string, className = ""): HTMLElement {',
        '  return make(tag, className)',
        '}',
        'function textField(parent: HTMLElement, key: string): HTMLInputElement {',
        "  return el('input', key)",
        '}',
        "const paragraph = el('p', 'note')",
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('src/studio/client/index.html:5')
    expect(ran.err).toContain('`.note`')
    expect(ran.err).toContain('canvas.ts:1 and inspector.ts:7')
  })

  test('a name only one scene uses needs no scope, which is half of what this guard is', async () => {
    // The check that failed this would ask for the canvas half of the
    // stylesheet to be rewritten, and a check that asks for that gets turned
    // off. `box`, `broken` and `scene` are the canvas's alone and stay bare.
    const root = await studio({
      rules: [
        '      .box {',
        '        position: absolute;',
        '      }',
        '      .box.broken {',
        '        border-color: red;',
        '      }',
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('every rule naming one is anchored')
  })

  test('a class only one scene uses anchors the rule, which is why `.box li .type` stands', async () => {
    // `type` is shared: the canvas writes it on a column's type cell and the
    // inspector writes it on the input that edits one. The rule is safe anyway,
    // because it has already said `.box`, and the two scenes are siblings in
    // the page. Requiring `.scene` in front of it as well would be a
    // specificity change to a rule that was never wrong.
    const root = await studio({
      rules: ['      .box li .type {', '        color: gray;', '      }'],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('every rule naming one is anchored')
  })

  test('one part of a selector list is judged on its own', async () => {
    // `.scene > .notes, .notes` is half the convention and half the defect, and
    // a check that read the list as one string would see the anchor and pass.
    const root = await studio({
      rules: ['      .scene > .notes,', '      .notes {', '        position: absolute;', '      }'],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(1)
    // The second part, on its own line, which is the one that is wrong.
    expect(ran.err).toContain('src/studio/client/index.html:6')
    expect(ran.err).toContain('1 rule on a class name')
  })

  test('a rule written inside a comment is not a rule', async () => {
    // The two collisions are each described in a comment beside the fix, in the
    // words that would fail this check if it read them. Blanking comments is
    // what lets the stylesheet explain itself.
    const root = await studio({
      rules: [
        '      /* `.notes` was bare here once, and the panel paid for it. */',
        '      .scene > .notes {',
        '        position: absolute;',
        '      }',
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('every rule naming one is anchored')
  })

  test('a renamed helper throws rather than quietly seeing fewer classes', async () => {
    // The failure this check itself is most exposed to. It learns the
    // inspector's class names from two helpers it knows by name, so a rename
    // would leave it reading an inspector with no classes, finding no shared
    // names, and passing everything. It says so instead.
    const root = await studio({
      rules: ['      .notes {', '        position: absolute;', '      }'],
      inspector: [
        'function el(tag: string, className = ""): HTMLElement {',
        '  return make(tag, className)',
        '}',
        "const said = el('p', 'notes')",
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('no longer declares textField()')
    expect(ran.err).toContain('see fewer classes than there are')
    // And not a finding, which is the point: an exit code of 1 for the wrong
    // reason is what this assertion separates from the real one.
    expect(ran.err).not.toContain('1 rule on a class name')
  })

  /** The `el` and `textField` the check is told about, as the fixtures declare them. */
  const HELPERS = [
    'function el(tag: string, className = ""): HTMLElement {',
    '  return make(tag, className)',
    '}',
    'function textField(parent: HTMLElement, key: string): HTMLInputElement {',
    "  return el('input', key)",
    '}',
  ]

  test('a helper call wrapped over four lines is read, because a class name does not live on a line', async () => {
    // dbmd-86c, and the reason this check now parses the two files. It read a
    // line at a time, and the inspector writes its `ref` field through a
    // `textField(...)` call a formatter wraps, so the class and the call were
    // never on one line and the name was not seen written at all. `ref` was
    // then a name only the canvas used, which made it an anchor, and this bare
    // rule passed. Nothing in the source decided that except where the
    // newlines fall, which is a guard one Prettier setting away from silence.
    const rules = ['      .ref {', '        grid-column: 1 / -1;', '      }']
    const canvas = ["cell.className = 'ref'"]
    const wrapped = await studio({
      rules,
      canvas,
      inspector: [...HELPERS, 'const reference = textField(', '  item,', "  'ref',", ')'],
    })

    const ran = await runScript(wrapped, 'check-scene-classes.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('`.ref`')
    // The line of the literal, not of the open bracket two lines above it.
    expect(ran.err).toContain('canvas.ts:1 and inspector.ts:9')

    // The same call on one line is the same finding, which is the property
    // rather than the fix: the check's answer no longer depends on the shape of
    // the call that writes the class.
    const collapsed = await studio({
      rules,
      canvas,
      inspector: [...HELPERS, "const reference = textField(item, 'ref')"],
    })

    const again = await runScript(collapsed, 'check-scene-classes.mjs')

    expect(again.code).toBe(1)
    expect(again.err).toContain('`.ref`')
    expect(again.err).toContain('canvas.ts:1 and inspector.ts:7')
  })

  test('a wrapped `classList` call and a wrapped `className` assignment are read too', async () => {
    // The hazard is general and it is not hypothetical on the canvas side
    // either: `this.edgePaths[index]?.classList.toggle(` is already wrapped over
    // four lines, and every one of these sites gets wrapped the moment it gains
    // an argument.
    const rules = ['      .related {', '        stroke: red;', '      }']
    const inspector = [...HELPERS, "const mark = el('span', 'related')"]

    const byClassList = await studio({
      rules,
      canvas: ['path.classList.toggle(', "  'related',", '  from === table,', ')'],
      inspector,
    })

    const first = await runScript(byClassList, 'check-scene-classes.mjs')

    expect(first.code).toBe(1)
    expect(first.err).toContain('`.related`')
    expect(first.err).toContain('canvas.ts:2 and inspector.ts:7')

    const byAssignment = await studio({
      rules,
      canvas: ['path.className =', "  from === table ? 'related' : 'related dim'"],
      inspector,
    })

    const second = await runScript(byAssignment, 'check-scene-classes.mjs')

    expect(second.code).toBe(1)
    expect(second.err).toContain('`.related`')
    expect(second.err).toContain('canvas.ts:2 and inspector.ts:7')
  })

  test('a class name written in a comment is not a class, which reading a tree gets for free', async () => {
    // The other direction, and the reason the fix was not a wider regular
    // expression. Both scene files describe the two collisions in prose, in the
    // words that would be findings if prose were code. If this comment were
    // read, `notes` would be shared and the bare rule below would fail.
    const root = await studio({
      rules: ['      .notes {', '        position: absolute;', '      }'],
      canvas: ["layer.className = 'notes'"],
      inspector: [
        ...HELPERS,
        "// The canvas layer is `notes` as well, so el('p', 'notes') here would",
        '// put every validation paragraph behind the toolbar. dbmd-49.',
        "const said = el('p', 'said')",
      ],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(0)
    expect(ran.out).toContain('share no class name')
  })

  test('a scene file that did not parse is said out loud rather than read as having no classes', async () => {
    // The same failure mode as the renamed helper, one layer down. A file the
    // parser could not finish yields a partial tree, a partial tree yields
    // fewer class names than there are, and fewer class names yields a passing
    // run. `npm run typecheck` would have caught this first, which is not a
    // reason for the guard to be quiet when it is run on its own.
    const root = await studio({
      rules: ['      .notes {', '        position: absolute;', '      }'],
      inspector: [...HELPERS, "const said = el('p', 'notes'"],
    })

    const ran = await runScript(root, 'check-scene-classes.mjs')

    expect(ran.code).toBe(1)
    expect(ran.err).toContain('did not parse')
    expect(ran.err).toContain('see fewer classes than there are')
    expect(ran.err).not.toContain('1 rule on a class name')
  })
})

// ---------------------------------------------------------------------------
// The init scaffold's guard: the first thing a new user sees, checked
// ---------------------------------------------------------------------------

describe('the init scaffold guard, broken on purpose', () => {
  /**
   * `src/cli/example.ts` with `, pk: true` removed from the first column of the
   * first table, expressed on the value rather than on the source text.
   *
   * The scaffold is a `Model` value and not a folder of templates (ADR 0012), so
   * deleting those two words from the source and deleting the key from the
   * object it builds are the same mutation. Doing it here rather than by editing
   * a file means no scratch checkout, no second vitest process, and no way for a
   * failing run to leave `src/` altered.
   */
  function withoutTheFirstPrimaryKey(model: Model): Model {
    const [first, ...otherTables] = model.tables
    if (first === undefined) throw new Error('the scaffold has no tables to mutate')
    const [id, ...otherColumns] = first.columns
    if (id?.pk !== true) throw new Error('the first scaffold column is not a primary key')
    const stripped: Column = { ...id }
    delete (stripped as { pk?: boolean }).pk
    return {
      ...model,
      tables: [{ ...first, columns: [stripped, ...otherColumns] }, ...otherTables],
    }
  }

  async function writtenAndReadBack(model: Model) {
    const parent = await mkdtemp(join(tmpdir(), 'dbmd-guard-model-'))
    temporaries.push(parent)
    const dir = join(parent, 'db-model')
    await writeModel(dir, model)
    const read = await readModel(dir)
    return { diagnostics: read.diagnostics, problems: validate(read.model) }
  }

  test('the scaffold as it stands has nothing to report, which is what init promises', async () => {
    const { diagnostics, problems } = await writtenAndReadBack(exampleModel())

    expect(diagnostics).toEqual([])
    expect(problems).toEqual([])
  })

  test('a scaffold whose first table has no primary key is reported, so the guard can fail', async () => {
    const { diagnostics, problems } = await writtenAndReadBack(
      withoutTheFirstPrimaryKey(exampleModel()),
    )

    // Still a well-formed set of files: the mutation is semantic, so the reader
    // has nothing to say and `test/cli/cli.test.ts` would still see `[]` from
    // its first assertion. It is the second one, over `validate`, that carries
    // the claim, and that is the half dbmd-54 had to add.
    expect(diagnostics).toEqual([])
    expect(problems.map((problem) => problem.code)).toContain('primary-key-missing')

    const missing = problems.find((problem) => problem.code === 'primary-key-missing')
    expect(missing?.severity).toBe('warning')
    expect(missing?.at).toEqual({ in: 'file', path: 'tables/accounts.md' })
    // The remedy, in the words a first-time user would need. `dbmd check` exits
    // 0 on a warning by design (ADR 0020), so this sentence is the whole of what
    // that user is given.
    expect(missing?.message).toContain('has no primary key')
    expect(missing?.message).toContain('pk: true')

    // And the knock-on, which is why this mutation is worth more than one
    // assertion: `api_keys.account_id` refs a column that no longer identifies a
    // row, so the scaffold would ship a model that disagrees with itself twice.
    expect(problems.map((problem) => problem.code)).toContain('ref-target-not-unique')
  })
})

// ---------------------------------------------------------------------------
// guard-merge.mjs: the deny rules, judged on a command line
// ---------------------------------------------------------------------------

describe('the merge guard, asked to judge', () => {
  /**
   * One PreToolUse payload, and what the guard did with it.
   *
   * This is the whole of the guard's interface: a JSON object on stdin, and
   * either a deny object on stdout or nothing at all. Nothing is merged, pushed
   * or contacted; `judge()` reads the command line and never runs it.
   */
  async function judge(command: string): Promise<{ denied: boolean; reason: string }> {
    const root = await scratchWith('guard-merge.mjs')
    const ran = await runScript(
      root,
      'guard-merge.mjs',
      JSON.stringify({ tool_input: { command } }),
    )
    expect(ran.code).toBe(0)
    if (ran.out === '') return { denied: false, reason: '' }
    const verdict = JSON.parse(ran.out) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string }
    }
    return {
      denied: verdict.hookSpecificOutput.permissionDecision === 'deny',
      reason: verdict.hookSpecificOutput.permissionDecisionReason,
    }
  }

  test('gh pr merge is refused, and the refusal names the sanctioned path', async () => {
    const { denied, reason } = await judge('gh pr merge 42 --squash')

    expect(denied).toBe(true)
    expect(reason).toContain('bypasses the green-checks requirement')
    // A refusal that does not say what to do instead is a refusal people route
    // around, and routing around this one is the thing it exists to stop.
    expect(reason).toContain('node scripts/merge-pr.mjs')
  })

  test('the same merge through gh api is refused too', async () => {
    const { denied, reason } = await judge(
      'gh api --method PUT repos/{owner}/{repo}/pulls/42/merge -f merge_method=squash',
    )

    expect(denied).toBe(true)
    expect(reason).toContain('merging through `gh api` is still merging')
  })

  test('a push whose own arguments name the default branch is refused', async () => {
    const { denied, reason } = await judge('git push origin HEAD:main')

    expect(denied).toBe(true)
    expect(reason).toContain('pushing to main skips review and CI entirely')
    expect(reason).toContain('git push -u origin HEAD')
  })

  test('an assignment or a wrapper word in front of it does not get past', async () => {
    // Both of these were holes once: a segment presenting a command named
    // `GH_TOKEN=x` walked past every rule, and so did one inside an `if`.
    expect((await judge('GH_TOKEN=x gh pr merge 42')).denied).toBe(true)
    expect((await judge('if gh pr checks 42; then gh pr merge 42; fi')).denied).toBe(true)
  })

  test('pushing a feature branch is allowed', async () => {
    expect(await judge('git push -u origin HEAD')).toEqual({ denied: false, reason: '' })
  })

  test('a dry run is allowed even when it names the default branch', async () => {
    expect(await judge('git push --dry-run origin main')).toEqual({ denied: false, reason: '' })
  })

  test('writing about the blocked command is allowed, which is half of what a guard is', async () => {
    // The false positive this guard shipped with, and it fired within seconds of
    // being installed: a comment quoting the blocked command was refused, so
    // recording that the guard worked was the first thing it would not allow.
    // A guard that denies everything passes every test above and is broken, so
    // this case is as load bearing as they are.
    const quoted = await judge('gh issue comment 42 --body "we do not run `gh pr merge` here"')
    expect(quoted).toEqual({ denied: false, reason: '' })

    const heredoc = await judge(
      'gh pr create --body-file - <<BODY\nDo not run gh pr merge on this.\nBODY\n',
    )
    expect(heredoc).toEqual({ denied: false, reason: '' })
  })
})

// ---------------------------------------------------------------------------
// merge-pr.mjs: its refusals, and the cost the merge did not name
// ---------------------------------------------------------------------------

/**
 * A guard script, imported rather than spawned.
 *
 * The two scripts below hold their decisions in exported functions and their
 * `gh` calls in a `main()` that runs only when the file is the entry point
 * (ADR 0058), so a test reaches the real rules by importing the real file. That
 * is why these two sections copy nothing into a scratch directory: there is no
 * mutation to isolate, because the fabricated facts are the mutation and they
 * are values in memory.
 *
 * A file URL rather than a path, because `import()` of a bare Windows path is
 * not a specifier Node accepts. The specifier is a variable, so TypeScript
 * cannot resolve the `.mjs` and hands back `any`; the cast is what puts the
 * shape back, and a cast that disagrees with the script fails here at run time
 * rather than silently in a merge.
 */
async function guardModule<T>(script: string): Promise<T> {
  return (await import(pathToFileURL(join(SCRIPTS, script)).href)) as T
}

interface RollupEntry {
  readonly name: string
  readonly conclusion?: string
  readonly state?: string
}

interface PullRequestFacts {
  readonly number: number
  readonly title: string
  readonly state: string
  readonly isDraft: boolean
  readonly mergeable: string
  readonly mergeStateStatus: string
  readonly reviewDecision: string | null
  readonly baseRefName: string
  readonly headRefName: string
  readonly headRefOid: string
  readonly statusCheckRollup: readonly RollupEntry[]
}

interface MergeDecision {
  readonly merge: boolean
  readonly why: string | null
  readonly notes: readonly string[]
  readonly warnings: readonly string[]
}

interface OpenPull {
  readonly number: number
  readonly headRefName: string
  readonly baseRefName: string
}

interface CheckoutFacts {
  readonly linked: boolean
  readonly here: string
  readonly main: string
}

const mergePr = await guardModule<{
  decideMerge: (input: {
    pr: PullRequestFacts
    behind: number | null
    reviewed?: string | null
    checkout?: CheckoutFacts | null
    required?: readonly string[]
    refuseWhenBehind?: boolean
    waitedSeconds?: number
  }) => MergeDecision
  readCheckout: (input: {
    gitDir?: string | null
    gitCommonDir?: string | null
    topLevel?: string | null
    cwd?: string | null
  }) => CheckoutFacts | null
  stalenessNotice: (input: {
    pr: { number: number; baseRefName: string }
    others: readonly OpenPull[] | null
  }) => string | null
}>('merge-pr.mjs')

describe('merge-pr.mjs, broken on purpose', () => {
  /** The head of the fixture pull request, and the sha the fixture reviewer read. */
  const HEAD = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432'

  /** An open pull request with one green required check, level with its base. */
  function pullRequest(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
    return {
      number: 128,
      title: 'A change that is ready',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: null,
      baseRefName: 'main',
      headRefName: 'tooling/a-branch',
      headRefOid: HEAD,
      statusCheckRollup: [{ name: 'check', conclusion: 'SUCCESS' }],
      ...overrides,
    }
  }

  /** The main checkout, which is the only place a merge is allowed to run. */
  const MAIN_CHECKOUT: CheckoutFacts = {
    linked: false,
    here: 'C:/Users/someone/source/repos/proj-db-md',
    main: 'C:/Users/someone/source/repos/proj-db-md',
  }

  /** An agent's worktree, which is where the accident of 2026-09-08 happened. */
  const AGENT_WORKTREE: CheckoutFacts = {
    linked: true,
    here: 'C:/Users/someone/source/repos/proj-db-md/.claude/worktrees/agent-a9ba51',
    main: 'C:/Users/someone/source/repos/proj-db-md',
  }

  /**
   * A decision taken by a reviewer who read the head, in the main checkout,
   * which is the ordinary case.
   *
   * The reviewed sha and the checkout default here for the same reason the pull
   * request above defaults: every case below is meant to differ from the control
   * in one fact, and a case that had to restate them would be stating three. The
   * cases that are about the sha or about the directory pass their own.
   */
  function decide(input: Parameters<typeof mergePr.decideMerge>[0]): MergeDecision {
    return mergePr.decideMerge({ reviewed: HEAD, checkout: MAIN_CHECKOUT, ...input })
  }

  test('the pull request this script exists to let through is let through', () => {
    // The control. Every case below differs from this one in a single fact, so
    // a refusal reported there is that fact and not the fixture.
    const decision = decide({ pr: pullRequest(), behind: 0 })

    expect(decision.merge).toBe(true)
    expect(decision.why).toBe(null)
    expect(decision.warnings).toEqual([])
  })

  test('a pull request that is not open is refused, and the state is named', () => {
    const decision = decide({ pr: pullRequest({ state: 'CLOSED' }), behind: 0 })

    expect(decision.merge).toBe(false)
    // The state itself, because "not OPEN" covers closed, merged and a number
    // that belongs to an issue, and the reader needs to know which.
    expect(decision.why).toContain('state is CLOSED, not OPEN')
  })

  test('a draft is refused', () => {
    const decision = decide({ pr: pullRequest({ isDraft: true }), behind: 0 })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('it is a draft')
  })

  test('a conflicting pull request is refused and sent back rather than resolved here', () => {
    const decision = decide({
      pr: pullRequest({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
      behind: 2,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('it conflicts with main')
    // Who does the rebase is the load-bearing half: resolving somebody's
    // conflict makes you the author of a change you are about to review.
    expect(decision.why).toContain('Send it back to rebase and re-verify')
  })

  test('a red required check is refused, and merging around it is named as the wrong fix', () => {
    const decision = decide({
      pr: pullRequest({ statusCheckRollup: [{ name: 'check', conclusion: 'FAILURE' }] }),
      behind: 0,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('check: FAILURE')
    expect(decision.why).toContain('Fix the run, do not merge around it')
  })

  test('a required check that never ran reads as never ran, not as green', () => {
    // The safe direction, and the one a typo in REQUIRED lands on. A rollup
    // full of green checks that are not the required one is this case.
    const decision = decide({
      pr: pullRequest({ statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }] }),
      behind: 0,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('check: never ran')
  })

  test('a rerun is judged on its latest conclusion rather than its first', () => {
    // A red run followed by a green rerun arrives as two entries under one
    // name. Judging the first would refuse every branch that ever went red.
    const decision = decide({
      pr: pullRequest({
        statusCheckRollup: [
          { name: 'check', conclusion: 'FAILURE' },
          { name: 'check', conclusion: 'SUCCESS' },
        ],
      }),
      behind: 0,
    })

    expect(decision.merge).toBe(true)
  })

  test('a green that is stale is refused, which is the refusal that costs the most', () => {
    const decision = decide({ pr: pullRequest(), behind: 3 })

    expect(decision.merge).toBe(false)
    // The count, because "behind" without a number reads as an opinion.
    expect(decision.why).toContain('behind\n  main by 3 commit(s), so that green is stale')
    expect(decision.why).toContain('It was produced against the')
    expect(decision.why).toContain('Send it back')
    expect(decision.why).toContain('you\n  do not rebase it for them')
  })

  test('BEHIND is refused even when the branch could not be compared', () => {
    // A fork's head branch is not in this repository, so the compare is a 404
    // and `behind` is null. GitHub's own answer is still enough to refuse, and
    // the sentence degrades to one without a number rather than to "by null".
    const decision = decide({
      pr: pullRequest({ mergeStateStatus: 'BEHIND' }),
      behind: null,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('the branch is behind\n  main, so that green is stale')
    expect(decision.why).not.toContain('null')
  })

  test('the stale refusal is a setting, so turning it off lets the same branch through', () => {
    // REFUSE_WHEN_BEHIND is documented as a choice with a cost. If this passed
    // whatever the flag said, the flag would be decoration.
    const decision = decide({
      pr: pullRequest(),
      behind: 3,
      refuseWhenBehind: false,
    })

    expect(decision.merge).toBe(true)
  })

  test('BLOCKED says what it can rule out and that it is not BEHIND', () => {
    const decision = decide({
      pr: pullRequest({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }),
      behind: 0,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('reviewDecision is REVIEW_REQUIRED')
    // The clue that saves a wasted rebase: staleness is ruled out by name.
    expect(decision.why).toContain('It is not behind main, so staleness is not the cause')
    // And the sentence that stops "BLOCKED" being read as "rebase it".
    expect(decision.why).toContain('BLOCKED is not BEHIND')
  })

  test('UNSTABLE proceeds, and says which contract it is honouring', () => {
    const decision = decide({
      pr: pullRequest({
        mergeStateStatus: 'UNSTABLE',
        statusCheckRollup: [
          { name: 'check', conclusion: 'SUCCESS' },
          { name: 'optional', conclusion: 'FAILURE' },
        ],
      }),
      behind: 0,
    })

    expect(decision.merge).toBe(true)
    expect(decision.notes.join('\n')).toContain('Merge state is UNSTABLE')
  })

  test('UNKNOWN proceeds and names what it did not verify', () => {
    // Refusing on "GitHub has not answered yet" would refuse at random, and a
    // wrapper that refuses at random gets worked around. Saying so is the whole
    // of what this case does, so the words are the behaviour.
    const decision = decide({
      pr: pullRequest({ mergeStateStatus: 'UNKNOWN' }),
      behind: 0,
      waitedSeconds: 15,
    })

    expect(decision.merge).toBe(true)
    const said = decision.warnings.join('\n')
    expect(said).toContain('still UNKNOWN after 15s')
    expect(said).toContain('Unverified: whether main has moved under this branch')
    expect(said).toContain('Proceeding on the check rollup alone')
  })

  // The refusal this section grew for. Everything above is a fact about the
  // branch; these are about whether the person merging read the commit. The
  // incident is in the script's header: a body describing an eleven line change
  // was read and reported on, its agent force-pushed, and the merge twenty
  // minutes later was of a commit nobody had seen. Nothing was red and nothing
  // was stale, so every assertion above would have passed on it.

  test('a merge that names no commit is refused, and the head is not handed over', () => {
    const decision = decide({ pr: pullRequest(), behind: 0, reviewed: null })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('you have not said which commit you read')
    // Where to read it, at the moment reading it means something.
    expect(decision.why).toContain('gh pr view 128 --json headRefOid --jq .headRefOid')
    // And the load-bearing omission: a refusal that printed the head would be
    // satisfied by copying it, which is a control that asks for nothing.
    expect(decision.why).not.toContain(HEAD)
    expect(decision.why).toContain('deliberately not printed here')
  })

  test('a second argument that is not a sha says so, rather than reading as a mismatch', () => {
    // Two ways to fail and the reader is told which (ADR 0060). "main" is the
    // plausible mistake: it is what somebody types when they mean the branch.
    const decision = decide({ pr: pullRequest(), behind: 0, reviewed: 'main' })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('is not a commit sha')
    expect(decision.why).toContain('"main"')
    expect(decision.why).toContain('at least 7 hexadecimal characters')
  })

  test('a prefix too short to be unambiguous is refused rather than matched loosely', () => {
    const decision = decide({ pr: pullRequest(), behind: 0, reviewed: HEAD.slice(0, 4) })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('is not a commit sha')
  })

  test('a head that moved since the review is refused, with both shas to compare', () => {
    const read = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    const decision = decide({ pr: pullRequest(), behind: 0, reviewed: read })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('the commit you named is not the head of this pull request')
    // Both, adjacent, whole: the fix is a copy, which is what makes this a
    // control rather than an obstacle.
    expect(decision.why).toContain(`you read     ${read}`)
    expect(decision.why).toContain(`would merge  ${HEAD}`)
    // The sentence that stops this being read as a fault in the branch.
    expect(decision.why).toContain('A moved\n  head is an unreviewed pull request')
    // And the one that refuses to pretend copying the line is a review.
    expect(decision.why).toContain('without running the first satisfies this script and')
  })

  test('the common case is a short prefix, typed, in whatever case it was copied in', () => {
    // The control for the four above. A rule that demands forty characters, or
    // a lookup before every merge, is a rule people route around, and a control
    // people route around is worse than none because it looks like safety.
    const decision = decide({
      pr: pullRequest(),
      behind: 0,
      reviewed: ` ${HEAD.slice(0, 7).toUpperCase()} `,
    })

    expect(decision.merge).toBe(true)
    expect(decision.why).toBe(null)
  })

  test('a merge names in its output the commit it merged', () => {
    // The terminal is the record. A merge that printed only the number leaves
    // the reviewed sha nowhere a later reader can find it.
    const decision = decide({ pr: pullRequest(), behind: 0 })

    expect(decision.merge).toBe(true)
    expect(decision.notes.join('\n')).toContain(`Head ${HEAD}, which is the commit you named`)
  })

  test('a pull request with no head sha is refused rather than let through unchecked', () => {
    // An absent field takes this branch too: the comparison is unmakeable
    // either way, and a check that passes by being unable to run is the disease
    // ADR 0034 is about.
    const decision = decide({ pr: pullRequest({ headRefOid: '' }), behind: 0 })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('did not answer with a head sha')
    expect(decision.why).toContain('Refusing is the safe direction')
  })

  test('a branch that is broken as well as unnamed is told about the branch first', () => {
    // Deliberate ordering. The sha question is asked last, so a caller who
    // forgot it and whose checks are red spends one round trip rather than two.
    const decision = decide({
      pr: pullRequest({ statusCheckRollup: [{ name: 'check', conclusion: 'FAILURE' }] }),
      behind: 0,
      reviewed: null,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('check: FAILURE')
    expect(decision.why).not.toContain('which commit you read')
  })

  // The refusal about the directory. Everything above is about the pull request
  // or about the person; this one is about whether the person is allowed to
  // merge anything at all. On 2026-09-08 an agent merged its own pull request
  // from its worktree, meaning to run a read-only harness. Every assertion above
  // would have passed on that merge, which is why none of them caught it.

  test('a merge from an agent worktree is refused, with both directories named', () => {
    const decision = decide({ pr: pullRequest(), behind: 0, checkout: AGENT_WORKTREE })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('this is a linked git worktree rather than the main checkout')
    // Both, adjacent: the reader has to be able to see where they are and where
    // to go, and the second one is the whole of "what to do instead".
    expect(decision.why).toContain(`running in     ${AGENT_WORKTREE.here}`)
    expect(decision.why).toContain(`main checkout  ${AGENT_WORKTREE.main}`)
  })

  test('the refusal says nothing else objected, which is the reason it exists', () => {
    // The sentence that stops this being read as a fault in the branch. The
    // branch is fine. It was fine on the night of the accident too.
    const decision = decide({ pr: pullRequest(), behind: 0, checkout: AGENT_WORKTREE })

    expect(decision.why).toContain('Nothing above objected')
    expect(decision.why).toContain('Every gate was satisfied')
  })

  test('the refusal answers both callers, because either one can be reading it', () => {
    const decision = decide({ pr: pullRequest(), behind: 0, checkout: AGENT_WORKTREE })

    // The agent is told the rule it is about to break and what to do instead.
    expect(decision.why).toContain('"You do not\n  merge. Ever."')
    expect(decision.why).toContain('push the branch,\n  open the pull request, report, and stop')
    // The orchestrator is told the refusal is not a wall, and why running the
    // same command in the main checkout does not break the read-only rule.
    expect(decision.why).toContain('run the same command from the main checkout')
    expect(decision.why).toContain('writes no file')
  })

  test('the refusal says there is no way to turn it off, and why none is needed', () => {
    // The escape hatch that is deliberately absent. A hatch reachable from a
    // brief ends up in briefs, and the only legitimate use of this script from
    // a worktree is watching a refusal fire, which the ordering below keeps.
    const decision = decide({ pr: pullRequest(), behind: 0, checkout: AGENT_WORKTREE })

    expect(decision.why).toContain('There is no flag that turns this off')
    expect(decision.why).toContain('Every refusal above still fires from a worktree')
  })

  test('a checkout nothing could identify is refused rather than assumed to be the main one', () => {
    // git absent, or a cwd outside any checkout. The same direction as the
    // missing head sha above: a control that passes by being unable to run is
    // the disease ADR 0034 is about.
    const decision = decide({ pr: pullRequest(), behind: 0, checkout: null })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('could tell whether this is the main checkout or a git worktree')
    // Two causes, and the reader is told both rather than one guess (ADR 0060).
    expect(decision.why).toContain('git is not on PATH')
    expect(decision.why).toContain('did not run from inside a checkout')
    expect(decision.why).toContain('Refusing here is the safe direction')
  })

  test('a run from the main checkout is not refused for the directory it is in', () => {
    // The control for the four above, and the whole scope of the refusal: it is
    // about which directory the command ran in and about nothing else.
    const decision = decide({ pr: pullRequest(), behind: 0, checkout: MAIN_CHECKOUT })

    expect(decision.merge).toBe(true)
    expect(decision.why).toBe(null)
  })

  test('a worktree run still reports a red check, so a refusal can be watched from one', () => {
    // Deliberate ordering, and the reason there is no escape hatch. The
    // orchestrator runs this from an agent's worktree against a live pull
    // request to watch a control refuse without merging anything. A worktree
    // refusal raised first would make every other refusal unreachable from
    // there and turn one demonstration into none.
    const decision = decide({
      pr: pullRequest({ statusCheckRollup: [{ name: 'check', conclusion: 'FAILURE' }] }),
      behind: 0,
      checkout: AGENT_WORKTREE,
    })

    expect(decision.merge).toBe(false)
    expect(decision.why).toContain('check: FAILURE')
    expect(decision.why).not.toContain('linked git worktree')
  })

  test('a worktree run still reports a stale green and an unnamed commit', () => {
    // The same ordering, against the other two refusals somebody would want to
    // watch. Staleness first.
    const stale = decide({ pr: pullRequest(), behind: 3, checkout: AGENT_WORKTREE })

    expect(stale.why).toContain('that green is stale')
    expect(stale.why).not.toContain('linked git worktree')

    const unnamed = decide({
      pr: pullRequest(),
      behind: 0,
      reviewed: null,
      checkout: AGENT_WORKTREE,
    })

    expect(unnamed.why).toContain('you have not said which commit you read')
    expect(unnamed.why).not.toContain('linked git worktree')
  })
})

// ---------------------------------------------------------------------------
// Which checkout the merge is running in, which is the fact the refusal above
// is made of. It is read from git rather than from a path pattern, so these
// cases are the answers `git rev-parse` actually gives, measured on this
// machine on 2026-09-08 rather than assumed.
// ---------------------------------------------------------------------------

describe('the checkout a merge is running in, broken on purpose', () => {
  /**
   * The fixture paths, written without a drive letter on purpose.
   *
   * `readCheckout` resolves what git said against the working directory, which
   * is the platform's own `path.resolve`, and this suite runs on Windows and on
   * two Linux runners. A first version of these cases used the real measured
   * `C:/Users/...` answers and went green here and red in CI: on Linux `C:/x`
   * is a *relative* path, so it was joined onto the runner's directory and two
   * answers that are one directory on the machine this script runs on became
   * two. The lesson is the one this whole file is about, arriving from the
   * other side: a fixture that encodes the platform tests the platform.
   *
   * So these are rooted paths, which resolve to one directory on both, and the
   * assertions are about `linked`, which is the load-bearing answer and is
   * exact everywhere. The one case that is genuinely about Windows says so and
   * asserts what the platform it is running on actually does.
   */
  const MAIN = '/repos/proj-db-md'
  const WORKTREE = `${MAIN}/.claude/worktrees/agent-a9ba51`

  test('the main checkout, asked from its root, is not a worktree', () => {
    // Measured: git answers `.git` for both, relative to the root.
    const checkout = mergePr.readCheckout({
      gitDir: '.git',
      gitCommonDir: '.git',
      topLevel: MAIN,
      cwd: MAIN,
    })

    expect(checkout).not.toBe(null)
    expect(checkout?.linked).toBe(false)
  })

  test('the main checkout, asked one directory down, is still not a worktree', () => {
    // The case a string comparison gets wrong, and the reason both answers are
    // resolved against the cwd first. Measured from `scripts/`: `--git-dir` is
    // absolute and `--git-common-dir` is the relative `../.git`. Compared as
    // typed they differ, and every subdirectory of the main checkout would be
    // refused as a worktree, which is a refusal aimed at the only caller
    // allowed to merge.
    const checkout = mergePr.readCheckout({
      gitDir: `${MAIN}/.git`,
      gitCommonDir: '../.git',
      topLevel: MAIN,
      cwd: `${MAIN}/scripts`,
    })

    expect(checkout?.linked).toBe(false)
  })

  test('a linked worktree is one, because its git directory lives inside the shared one', () => {
    // Measured inside an agent worktree: the two answers are different absolute
    // paths, and the second is the repository's own git directory.
    const checkout = mergePr.readCheckout({
      gitDir: `${MAIN}/.git/worktrees/agent-a9ba51`,
      gitCommonDir: `${MAIN}/.git`,
      topLevel: WORKTREE,
      cwd: WORKTREE,
    })

    expect(checkout?.linked).toBe(true)
    // Straight through, unresolved, because it is what the caller will read in
    // the refusal and compare against their own prompt.
    expect(checkout?.here).toBe(WORKTREE)
    // What the refusal tells the caller to go and do instead, so it has to be
    // the checkout and not the git directory inside it. Asserted by shape
    // rather than as a literal: on Windows the resolved answer carries the
    // drive letter of whatever directory the suite ran in.
    expect(checkout?.main.endsWith('/repos/proj-db-md')).toBe(true)
  })

  test('a worktree outside the repository is one too, because the test is not a path pattern', () => {
    // The orchestrator's throwaway rebase worktrees live in a scratch directory
    // rather than under `.claude/worktrees/`. A refusal written as a path match
    // would let a merge run from one of those, and would be turned off by a
    // rename nobody connected to it.
    const checkout = mergePr.readCheckout({
      gitDir: `${MAIN}/.git/worktrees/rb128`,
      gitCommonDir: `${MAIN}/.git`,
      topLevel: '/scratch/rb128',
      cwd: '/scratch/rb128',
    })

    expect(checkout?.linked).toBe(true)
  })

  test('the same directory spelled two ways does not make the main checkout look linked', () => {
    // A false refusal is the expensive direction here, because the caller it
    // refuses is the only one allowed to merge. Windows is the platform this
    // script runs on and `C:/x`, `c:\x` and `C:\X` are one directory there, so
    // the comparison is case-insensitive and on forward slashes. On POSIX a
    // backslash is an ordinary character in a name, so the second half of that
    // is meaningless there and only the case half is asserted.
    const spelledTwoWays =
      process.platform === 'win32'
        ? { gitDir: 'C:/repos/proj-db-md/.git', gitCommonDir: 'c:\\repos\\proj-db-md\\.git' }
        : { gitDir: `${MAIN}/.git`, gitCommonDir: '/REPOS/PROJ-DB-MD/.git' }

    const checkout = mergePr.readCheckout({ ...spelledTwoWays, topLevel: MAIN, cwd: MAIN })

    expect(checkout?.linked).toBe(false)
  })

  test('an answer git did not give reads as unknown rather than as the main checkout', () => {
    // Each of the four is required, because a missing one is a question that
    // was not answered rather than a no.
    expect(mergePr.readCheckout({ gitCommonDir: '.git', topLevel: MAIN, cwd: MAIN })).toBe(null)
    expect(mergePr.readCheckout({ gitDir: '.git', topLevel: MAIN, cwd: MAIN })).toBe(null)
    expect(mergePr.readCheckout({ gitDir: '.git', gitCommonDir: '.git', cwd: MAIN })).toBe(null)
    expect(mergePr.readCheckout({ gitDir: '.git', gitCommonDir: '.git', topLevel: MAIN })).toBe(
      null,
    )
    expect(
      mergePr.readCheckout({ gitDir: '  ', gitCommonDir: '.git', topLevel: MAIN, cwd: MAIN }),
    ).toBe(null)
  })
})

describe('the cost a merge did not name, broken on purpose', () => {
  const merging = { number: 128, baseRefName: 'main' }

  test('every other open branch into the same base is named, with what it now owes', () => {
    const notice = mergePr.stalenessNotice({
      pr: merging,
      others: [
        { number: 128, headRefName: 'tooling/the-one-being-merged', baseRefName: 'main' },
        { number: 129, headRefName: 'tooling/86c-a-check-that-reads-lines', baseRefName: 'main' },
        { number: 130, headRefName: 'docs/wie-a-number-that-was-never-run', baseRefName: 'main' },
      ],
    })

    // The whole point is that the cost is legible before it is paid, so the
    // count, both branch names and the sentence naming what each one owes are
    // behaviour rather than formatting.
    expect(notice).toBe(
      [
        'Merging #128 will make 2 other branches stale:',
        '  #129  tooling/86c-a-check-that-reads-lines',
        '  #130  docs/wie-a-number-that-was-never-run',
        'Each needs a rebase and a re-verify before it can land.',
      ].join('\n'),
    )
  })

  test('the pull request being merged is not one of its own casualties', () => {
    // It is in the open list it comes back in, and counting it would make every
    // merge cost one more rebase than it does. Off by one here reads as right.
    const notice = mergePr.stalenessNotice({
      pr: merging,
      others: [{ number: 128, headRefName: 'tooling/the-one-being-merged', baseRefName: 'main' }],
    })

    expect(notice).toContain('No other pull request is open against main')
  })

  test('a pull request aimed at another base is not made stale by this merge', () => {
    // A branch stacked on another branch does not go behind main when main
    // moves under a different base, and telling its agent to rebase would be
    // sending them to do work that fixes nothing.
    const notice = mergePr.stalenessNotice({
      pr: merging,
      others: [
        { number: 129, headRefName: 'tooling/stacked-on-130', baseRefName: 'docs/some-branch' },
        { number: 131, headRefName: 'tooling/into-main', baseRefName: 'main' },
      ],
    })

    expect(notice).toContain('will make 1 other branch stale')
    expect(notice).toContain('#131  tooling/into-main')
    expect(notice).not.toContain('stacked-on-130')
    // One branch is not "each".
    expect(notice).toContain('It needs a rebase and a re-verify')
  })

  test('nothing else open is a sentence, because a reader cannot hear silence', () => {
    const notice = mergePr.stalenessNotice({ pr: merging, others: [] })

    expect(notice).toBe(
      'No other pull request is open against main, so this merge makes nothing stale.',
    )
  })

  test('a listing that failed says nothing, and nothing is what the merge waits on', () => {
    // The second API call is information, not a gate. `null` is what the
    // wrapper's catch hands over, and the only correct answer to it is silence:
    // inventing "no other branches" out of a question that was never answered
    // would be worse than the gap this closes.
    expect(mergePr.stalenessNotice({ pr: merging, others: null })).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// check-main-provenance.mjs: a commit on main with no pull request behind it
// ---------------------------------------------------------------------------

interface AssociatedPull {
  readonly number: number
  readonly state: string
  readonly merged_at: string | null
  readonly base: { readonly ref: string }
}

interface Violation {
  readonly sha: string
  readonly subject: string
  readonly author: string
  readonly date: string
  readonly near: string
}

interface AuditResult {
  readonly accounted: readonly string[]
  readonly violations: readonly Violation[]
  readonly exempt: number
  readonly checked: number
}

const provenance = await guardModule<{
  landedPulls: (pulls: readonly AssociatedPull[], defaultBranch?: string) => AssociatedPull[]
  auditCommits: (
    shas: readonly string[],
    io: {
      pullsFor: (sha: string) => Promise<readonly AssociatedPull[]>
      describe: (sha: string) => { subject: string; author: string; date: string }
      predatesBaseline: (sha: string) => boolean
      attemptsFor?: (sha: string) => number
      wait?: () => Promise<void>
      defaultBranch?: string
    },
  ) => Promise<AuditResult>
  violationReport: (result: AuditResult, defaultBranch?: string) => string
  accountedReport: (result: AuditResult, defaultBranch?: string) => string
}>('check-main-provenance.mjs')

describe('the provenance audit, broken on purpose', () => {
  const sha = (prefix: string) => prefix.padEnd(40, '0')

  const LANDED = sha('aa11bb22')
  const PUSHED = sha('cc33dd44')
  const ANCIENT = sha('ee55ff66')

  const mergedIntoMain: AssociatedPull = {
    number: 11,
    state: 'MERGED',
    merged_at: '2026-09-07T09:00:00Z',
    base: { ref: 'main' },
  }

  /**
   * The git and the API, as values.
   *
   * `answers` maps a commit to what the API says on each successive attempt, so
   * a lagging association is an array of answers rather than a wait. `wait`
   * resolves immediately: the retry is being exercised, the thirty seconds are
   * not.
   */
  function io(
    answers: Record<string, readonly (readonly AssociatedPull[])[]>,
    { exempt = [] as readonly string[], attempts = 1 } = {},
  ) {
    const asked = new Map<string, number>()
    return {
      pullsFor: async (commit: string) => {
        const script = answers[commit] ?? [[]]
        const seen = asked.get(commit) ?? 0
        asked.set(commit, seen + 1)
        return script[Math.min(seen, script.length - 1)] ?? []
      },
      describe: (commit: string) => ({
        subject: `whatever ${commit.slice(0, 8)} changed`,
        author: 'Somebody <somebody@example.com>',
        date: '2026-09-07T10:11:12+00:00',
      }),
      predatesBaseline: (commit: string) => exempt.includes(commit),
      attemptsFor: () => attempts,
      wait: async () => {},
      asked,
    }
  }

  test('a commit with no pull request behind it is a violation, named and dated', async () => {
    const result = await provenance.auditCommits(
      [LANDED, PUSHED],
      io({ [LANDED]: [[mergedIntoMain]] }),
    )

    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.sha).toBe(PUSHED)

    const said = provenance.violationReport(result)
    // The count and the denominator, because "a commit reached main" without
    // them reads as a broken build rather than as an audit finding.
    expect(said).toContain('A commit reached main outside the pull request flow (1 of 2):')
    expect(said).toContain(PUSHED)
    expect(said).toContain('whatever cc33dd44 changed')
    // Attributable and dated, which is what makes this an audit rather than a
    // rumour. Both are in the record so somebody can go and ask.
    expect(said).toContain('Somebody <somebody@example.com>  2026-09-07T10:11:12+00:00')
    expect(said).toContain('No associated pull request.')
    // The sentence that stops the obvious wrong fix, and the reason this script
    // says not to move BASELINE forward.
    expect(said).toContain('Do not silence this by moving the baseline in this script forward')
    // And not the commit that was fine: a check that reported every commit
    // would also have found this one.
    expect(said).not.toContain(LANDED)
  })

  test('the same commits, both accounted for, pass — so the failure was the missing PR', async () => {
    const result = await provenance.auditCommits(
      [LANDED, PUSHED],
      io({ [LANDED]: [[mergedIntoMain]], [PUSHED]: [[{ ...mergedIntoMain, number: 12 }]] }),
    )

    expect(result.violations).toEqual([])
    const said = provenance.accountedReport(result)
    expect(said).toContain('Every new commit on main came through a pull request (2 checked)')
    expect(said).toContain('aa11bb22  #11  whatever aa11bb22 changed')
  })

  test('an open pull request associates a commit without landing it, so it is still a violation', async () => {
    // The narrowing is the rule. A commit can be associated with a PR that is
    // open, or one aimed at another branch, and neither explains how it got
    // onto main. Dropping either filter turns this check green for the exact
    // case it exists to catch.
    const openIntoMain: AssociatedPull = {
      number: 21,
      state: 'OPEN',
      merged_at: null,
      base: { ref: 'main' },
    }
    const mergedElsewhere: AssociatedPull = {
      number: 22,
      state: 'MERGED',
      merged_at: '2026-09-07T09:30:00Z',
      base: { ref: 'release/1.x' },
    }

    const result = await provenance.auditCommits(
      [PUSHED],
      io({ [PUSHED]: [[openIntoMain, mergedElsewhere]] }),
    )

    expect(result.violations).toHaveLength(1)
    const said = provenance.violationReport(result)
    // Both near misses are named, because "no associated pull request" would be
    // a lie here and would send the reader looking for one that exists.
    expect(said).toContain('Associated pull requests, none of them merged into main:')
    expect(said).toContain('#21 (OPEN, into main)')
    expect(said).toContain('#22 (MERGED, into release/1.x)')
    expect(said).not.toContain('No associated pull request.')
  })

  test('the rule itself: merged, and into the default branch, is the whole of it', () => {
    const pulls: readonly AssociatedPull[] = [
      { number: 21, state: 'OPEN', merged_at: null, base: { ref: 'main' } },
      { number: 22, state: 'MERGED', merged_at: '2026-09-07T09:00:00Z', base: { ref: 'other' } },
      mergedIntoMain,
    ]

    expect(provenance.landedPulls(pulls, 'main').map((pull) => pull.number)).toEqual([11])
    // And it is the default branch that is asked about, not the word "main".
    expect(provenance.landedPulls(pulls, 'other').map((pull) => pull.number)).toEqual([22])
  })

  test('an association that arrives late is waited for rather than reported', async () => {
    // The API lists the pull request a moment after the merge, not always
    // during it. A check that cried wolf once a month would stop being read, so
    // the retry is behaviour, and without this the loop could be deleted with
    // every other case still green.
    const facts = io({ [LANDED]: [[], [], [mergedIntoMain]] }, { attempts: 5 })
    const result = await provenance.auditCommits([LANDED], facts)

    expect(result.violations).toEqual([])
    expect(facts.asked.get(LANDED)).toBe(3)
  })

  test('a young commit that never gets an association is a violation after the waiting', async () => {
    const facts = io({}, { attempts: 5 })
    const result = await provenance.auditCommits([PUSHED], facts)

    expect(result.violations).toHaveLength(1)
    // Every attempt spent, so the failure is the answer rather than impatience.
    expect(facts.asked.get(PUSHED)).toBe(5)
  })

  test('a commit below the baseline is not judged, and is counted rather than hidden', async () => {
    // Eleven commits predate the rule. Judging them would make this check's
    // output mostly noise, and a check whose output is mostly noise gets muted.
    const result = await provenance.auditCommits(
      [ANCIENT, LANDED],
      io({ [LANDED]: [[mergedIntoMain]] }, { exempt: [ANCIENT] }),
    )

    expect(result.violations).toEqual([])
    expect(result.exempt).toBe(1)
    const said = provenance.accountedReport(result)
    expect(said).toContain('(1 checked, 1 predating the baseline)')
    // Exempt is not the same as asked about and cleared, so it is not listed
    // among the commits this run stands behind.
    expect(said).not.toContain(ANCIENT)
  })
})
