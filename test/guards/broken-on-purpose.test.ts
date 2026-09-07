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
 * `scripts/merge-pr.mjs` is absent too, and that one is a gap rather than a
 * decision. See ADR 0034.
 *
 * ONE THING THIS DIRECTORY IS EXEMPT FROM
 * `scripts/check-commands.mjs` does not scan `test/guards/`, and this file is
 * why: the fixtures below name `dbmd fmt`, run `npm run bogus` and mark a
 * command that exists as hypothetical, because each of those is a case that
 * check refuses. Pointing it at them would fail the build on the evidence that
 * it works. ADR 0036.
 */

import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/** A scratch directory holding one of the guard scripts under its own `scripts/`. */
async function scratchWith(script: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dbmd-guard-'))
  temporaries.push(root)
  await mkdir(join(root, 'scripts'), { recursive: true })
  await cp(join(SCRIPTS, script), join(root, 'scripts', script))
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
   */
  async function repository(files: Record<string, string>): Promise<string> {
    const root = await scratchWith('check-commands.mjs')
    const base: Record<string, string> = {
      'package.json': `${JSON.stringify({ scripts: { check: 'true', build: 'true' } }, null, 2)}\n`,
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

  test('the command list comes from the CLI, so adding a command is enough', async () => {
    const page = 'Run `dbmd export --stdout` when you are done.\n'

    const before = await repository({ 'docs/guide.md': page })
    expect((await runScript(before, 'check-commands.mjs')).code).toBe(1)

    // The same page, against a registry that now has the command in it, with
    // nothing in the checker edited. A hand-written list of commands inside the
    // check would be one more fact that can disagree with the truth, which is
    // the defect the check exists for.
    const after = await repository({
      'docs/guide.md': page,
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
