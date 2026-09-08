/**
 * The release rehearsal's drift check, broken on purpose.
 *
 * WHY THIS IS A SEPARATE FILE
 * ADR 0034 asks that every guard be seen to fail, and `broken-on-purpose.test.ts`
 * is where the cheap ones are broken. This one is beside it rather than in it
 * for a reason that is about today rather than about design:
 * `node scripts/held.mjs` reports that file as held by three other worktrees at
 * the moment this was written, and a mutation appended to a file three branches
 * are already editing is a rebase somebody pays for. A new file collides with
 * nobody and runs in the same suite on the same command, which is the whole of
 * what ADR 0034 asks for. ADR 0097 records the choice so the next sweep of that
 * record's list finds it named rather than missing.
 *
 * WHY THE CONTROL RUN IS HERE AND NOT IN `package.json`
 * `scripts/check-release-rehearsal.mjs` has no entry in the `check:` chain. It
 * reads two files and imports nothing, so it costs milliseconds, and ADR 0034's
 * split puts the cheap guards in `npm test`, which `npm run check` runs. The
 * first test below is the control: the real script over the real tree, asserted
 * green. Everything after it is a mutation in a scratch copy.
 *
 * NOTHING HERE TOUCHES `.github/workflows/release.yml`.
 * Every mutation is performed on a copy in a temporary directory. That file is
 * the one place in this repository where a wrong edit is expensive and stays
 * unobservable until somebody is trying to ship, and a test that edited it in
 * place and restored it afterwards would be one crash away from doing exactly
 * that.
 *
 * WHY EVERY ASSERTION READS THE WORDS
 * A scratch tree that failed to assemble makes the script exit 1 too, and an
 * exit code cannot tell that apart from the guard working. So each case pins a
 * clause of the sentence it should have printed. ADR 0034.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = 'check-release-rehearsal.mjs'
const RELEASE = 'release.yml'
const REHEARSAL = 'rehearse-release-ancestry.yml'

const temporaries: string[] = []

afterAll(async () => {
  for (const path of temporaries) await rm(path, { recursive: true, force: true })
})

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}

/** The guard, run from a root, with both streams captured. `execFileSync` would give one. */
function run(root: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts', SCRIPT)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
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
  })
}

/**
 * A scratch tree holding the guard and both workflows, with one of the two
 * rewritten by `edit`. The guard resolves `.github/workflows/` from its own
 * location, so a copy of the script beside a copy of the workflows is the whole
 * of what it needs.
 */
async function scratch(file: string, edit: (text: string) => string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dbmd-rehearsal-'))
  temporaries.push(root)
  await mkdir(join(root, 'scripts'), { recursive: true })
  await mkdir(join(root, '.github', 'workflows'), { recursive: true })
  await cp(join(ROOT, 'scripts', SCRIPT), join(root, 'scripts', SCRIPT))
  for (const name of [RELEASE, REHEARSAL]) {
    const source = join(ROOT, '.github', 'workflows', name)
    const target = join(root, '.github', 'workflows', name)
    const text = await readFile(source, 'utf8')
    await writeFile(target, name === file ? edit(text) : text)
  }
  return root
}

describe('the release rehearsal has not drifted from the release', () => {
  it('says so over the real tree, and says what it did not look at', async () => {
    const ran = await run(ROOT)
    expect(ran.err).toBe('')
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('still rehearses')
    expect(ran.out).toContain('character for character')
    // The summary says its own reach, for the reason `check-duplication.mjs`
    // prints its margin: a check whose limits nobody can see gets credited with
    // more than it does.
    expect(ran.out).toContain('does not check the setup-node, npm ci or publish steps')
  })
})

describe('the drift check, broken on purpose', () => {
  it('refuses when release.yml pins a different checkout version', async () => {
    const root = await scratch(RELEASE, (text) =>
      text.replace('uses: actions/checkout@v7', 'uses: actions/checkout@v8'),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('checks out with a different action than the release does')
    expect(ran.err).toContain('actions/checkout@v8')
    expect(ran.err).toContain('actions/checkout@v7')
    expect(ran.err).toContain('Rehearsing a different one answers nothing')
  })

  it("refuses when release.yml changes the checkout's with: block", async () => {
    const root = await scratch(RELEASE, (text) =>
      text.replace(
        '          fetch-depth: 0\n',
        '          fetch-depth: 0\n          filter: tree:0\n',
      ),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('hands the checkout different settings than the release does')
    expect(ran.err).toContain('filter: tree:0')
    expect(ran.err).toContain('fetch-depth is why origin/main is expected to be there at all')
  })

  it('refuses when the ancestry shell changes by one word', async () => {
    const root = await scratch(RELEASE, (text) =>
      text.replace(
        'if ! git merge-base --is-ancestor "${GITHUB_SHA}" origin/main; then',
        'if ! git merge-base --is-ancestor "${GITHUB_SHA}" origin/master; then',
      ),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('runs a different shell than the release does')
    expect(ran.err).toContain('origin/master')
    expect(ran.err).toContain('first difference at line')
  })

  it('refuses a second copy of the comparison in the rehearsal', async () => {
    const root = await scratch(REHEARSAL, (text) =>
      text.replace(
        '          git update-ref -d refs/remotes/origin/main || true\n',
        '          git update-ref -d refs/remotes/origin/main || true\n' +
          '          git merge-base --is-ancestor "${GITHUB_SHA}" origin/main || true\n',
      ),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('outside the copied shell')
    expect(ran.err).toContain('right while the first is')
  })

  it('refuses tag patterns that could both match one tag', async () => {
    const root = await scratch(REHEARSAL, (text) =>
      text.replace("tags: ['rehearsal-*']", "tags: ['v-rehearsal-*']"),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('cannot rule out matching')
    expect(ran.err).toContain('a rehearsal that starts a release is not a')
  })

  it('refuses a rehearsal that could reach the registry', async () => {
    const root = await scratch(REHEARSAL, (text) =>
      text.replace(
        '      - name: what the rehearsal found\n',
        '      - name: what the rehearsal found\n        env:\n' +
          '          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n',
      ),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('NPM_TOKEN')
    expect(ran.err).toContain('must not name the publishing token')
    expect(ran.err).toContain('a release with a different name')
  })

  it('refuses a rehearsal that grew a second trigger', async () => {
    const root = await scratch(REHEARSAL, (text) =>
      text.replace('on:\n  push:', 'on:\n  workflow_dispatch:\n  push:'),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('triggers on something other than a tag push')
    expect(ran.err).toContain('workflow_dispatch:')
  })

  it('refuses when the step it copies has been renamed away', async () => {
    const root = await scratch(RELEASE, (text) =>
      text.replace(
        '- name: the tagged commit is on main',
        '- name: the tag is on a reviewed branch',
      ),
    )
    const ran = await run(root)
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('has no step named "the tagged commit is on main"')
    expect(ran.err).toContain('has lost its subject')
  })

  it('points the reader at the rehearsal rather than at the release', async () => {
    const root = await scratch(RELEASE, (text) =>
      text.replace('uses: actions/checkout@v7', 'uses: actions/checkout@v8'),
    )
    const ran = await run(root)
    expect(ran.err).toContain('Fix the rehearsal, not the release')
  })
})
