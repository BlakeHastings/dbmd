// Break the tarball on purpose, and fail unless `check:pack` notices.
//
// WHAT THIS PREVENTS
// `scripts/smoke-pack.mjs` is the only thing in this repository that looks at
// the artefact users get, and it is also the least exercised code here: it has
// passed on every commit it has ever run on. A guard that never fires looks
// exactly like a guard that cannot, and this repository has already found four
// tests that had quietly stopped testing anything. So this one is fired
// deliberately, once per `npm run check`.
//
// The mutation is the failure that check was pointed at. `dist/studio/client/`
// is generated at build time rather than checked in, so it is exactly the kind
// of path a `files` entry forgets, and forgetting it produces a package that
// installs, starts, opens a port and serves a blank page. Adding
// `"!dist/studio/client/**"` to `files` reproduces that in one line.
//
// WHY THE SENTENCE IS ASSERTED AND NOT ONLY THE EXIT CODE
// Everything below happens in a copy of this tree, and a copy that failed to
// assemble makes `smoke-pack.mjs` exit 1 as well. An exit-code-only assertion
// cannot tell "the guard caught the mutation" from "the harness is broken", so
// what is asserted is the clause the guard prints about the client bundle. That
// is the same lesson dbmd-54's title carries: a check that cannot see the words
// is not checking what it claims to.
//
// WHY THERE IS NO CONTROL RUN
// A second, unmutated run would cost another nine seconds to prove that the
// scratch copy packs cleanly. It is not needed: `npm run check:pack` runs
// immediately before this in `npm run check` and is that control, over the real
// tree, and the clause asserted below cannot be produced by a scratch tree that
// did not build.
//
// WHY IT COPIES RATHER THAN EDITING package.json IN PLACE
// A mutate-and-restore would leave the checkout dirty on any failure, and on
// Windows a half-restored file is easy to produce and hard to notice. One dirty
// `package.json` makes every later run in that session meaningless. So the
// mutation happens to a copy and the real tree is never written to.
//
// `node_modules` is a junction rather than a copy, because `npm pack` runs
// `prepack`, which runs the build, which needs `tsc` and `esbuild`. Copying
// them would cost more than the whole check.
//
//   node scripts/check-pack-guard.mjs
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Long enough for a build plus an `npm install` of the tarball on a cold cache. */
const TIMEOUT_MS = 300_000

// The mutation. One entry, at the end of `files`, negating the directory the
// build generates.
const MUTATION = '!dist/studio/client/**'

// The clause `smoke-pack.mjs` prints when the bundle is not in the tarball. Not
// the whole sentence: the rest of it counts bytes and names a URL with a
// randomly chosen port, and pinning those would make this fail on a reworded
// message that still says the right thing.
const EXPECTED = 'the studio client bundle is not in the tarball'

// Everything the build and the pack read. Named rather than globbed, so that a
// file the pack starts needing is a loud failure here rather than a silent
// difference between this copy and the real tree.
const NEEDED = [
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.client.json',
  'README.md',
  'LICENSE',
  'src',
  join('scripts', 'build-client.mjs'),
  join('scripts', 'smoke-pack.mjs'),
]

const scratch = mkdtempSync(join(tmpdir(), 'dbmd-pack-guard-'))
let ran
try {
  assemble(scratch)
  mutate(join(scratch, 'package.json'))
  console.log(`Copied the tree to ${scratch} and added ${MUTATION} to "files".`)
  ran = await run(process.execPath, [join(scratch, 'scripts', 'smoke-pack.mjs')], scratch)
} finally {
  // The junction first and by name, so that nothing recursive can ever be
  // pointed at the real `node_modules`.
  try {
    unlinkSync(join(scratch, 'node_modules'))
  } catch {
    // Never created, or already gone. Either way there is nothing to protect.
  }
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
  } catch (error) {
    console.error(`could not remove ${scratch}: ${error.message}`)
  }
}

const said = `${ran.stdout}\n${ran.stderr}`

if (ran.code === 0) {
  console.error('`check:pack` passed a tarball with no studio client bundle in it.\n')
  console.error(`\`files\` was given ${MUTATION}, so \`dist/studio/client/main.js\` did not ship`)
  console.error('and the studio page would render nothing. The check said the packed tarball')
  console.error('was fine, which means it is no longer looking at the page.\n')
  console.error('What it printed:\n')
  console.error(said.trimEnd())
  process.exit(1)
}

if (!said.includes(EXPECTED)) {
  console.error(`\`check:pack\` failed, but not for the reason it was broken (exit ${ran.code}).\n`)
  console.error(`Expected it to say: ${EXPECTED}\n`)
  console.error('An exit code alone cannot tell a guard that caught the mutation from a')
  console.error('harness that did not assemble, which is why this reads the words. If the')
  console.error('message below is about the mutation and has merely been reworded, update')
  console.error('EXPECTED in this file. If it is about anything else, this script is broken')
  console.error('and the guard it checks is unproven.\n')
  console.error('What it printed:\n')
  console.error(said.trimEnd())
  process.exit(1)
}

console.log(`\`check:pack\` refused the mutated tarball (exit ${ran.code}) and said why:`)
console.log(`  ${EXPECTED}`)

/** The subset of the tree a pack reads, plus a junction to the installed dependencies. */
function assemble(into) {
  for (const path of NEEDED) {
    cpSync(join(ROOT, path), join(into, path), { recursive: true })
  }
  // 'junction' on Windows, where it needs no privilege; ignored elsewhere, where
  // a directory symlink needs none either.
  symlinkSync(join(ROOT, 'node_modules'), join(into, 'node_modules'), 'junction')
}

/** `files` with the client bundle negated, written back with the same shape. */
function mutate(manifest) {
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!Array.isArray(parsed.files)) {
    throw new Error('package.json has no "files" array, so there is nothing to negate')
  }
  parsed.files = [...parsed.files, MUTATION]
  writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`)
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, timeout: TIMEOUT_MS, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}
