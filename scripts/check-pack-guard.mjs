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
// The second mutation is the other invisible one. `"private": true` was in this
// manifest on purpose until the owner decided to release (ADR 0051), and putting
// it back is a one-word edit that packs, installs and runs exactly like the real
// thing. `npm publish --dry-run` does not object to it either. The day it would
// be noticed is a release day, in the job that publishes, after everything else
// has already gone green.
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

// The mutations. One entry at the end of `files`, negating the directory the
// build generates, and `"private": true` put back into the manifest.
const MUTATIONS = ['!dist/studio/client/** in "files"', '"private": true']

// The clause `smoke-pack.mjs` prints for each one. Not the whole sentence: the
// bundle's counts bytes and names a URL with a randomly chosen port, and pinning
// those would make this fail on a reworded message that still says the right
// thing.
const EXPECTED = [
  'the studio client bundle is not in the tarball',
  'says "private": true, so npm publish would refuse this tarball',
]

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
  console.log(`Copied the tree to ${scratch} and gave it ${MUTATIONS.join(' and ')}.`)
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
  console.error('`check:pack` passed a tarball it should have refused twice over.\n')
  console.error(`It was given ${MUTATIONS.join(' and ')}, so \`dist/studio/client/main.js\``)
  console.error('did not ship and the studio page would render nothing, and npm would refuse')
  console.error('to publish the package at all. The check said the packed tarball was fine,')
  console.error('which means it is no longer looking at what it claims to.\n')
  console.error('What it printed:\n')
  console.error(said.trimEnd())
  process.exit(1)
}

const missed = EXPECTED.filter((clause) => !said.includes(clause))
if (missed.length > 0) {
  console.error(`\`check:pack\` failed, but not for every reason it was broken (exit ${ran.code}).\n`)
  console.error('Expected it to say, and it did not:\n')
  for (const clause of missed) console.error(`  ${clause}`)
  console.error('\nAn exit code alone cannot tell a guard that caught the mutation from a')
  console.error('harness that did not assemble, and with two mutations in one run it cannot')
  console.error('tell one caught from both, which is why this reads the words. If the message')
  console.error('below is about the mutation and has merely been reworded, update EXPECTED in')
  console.error('this file. If it is about anything else, this script is broken and the guard')
  console.error('it checks is unproven.\n')
  console.error('What it printed:\n')
  console.error(said.trimEnd())
  process.exit(1)
}

console.log(`\`check:pack\` refused the mutated tarball (exit ${ran.code}) and said why:`)
for (const clause of EXPECTED) console.log(`  ${clause}`)

/** The subset of the tree a pack reads, plus a junction to the installed dependencies. */
function assemble(into) {
  for (const path of NEEDED) {
    cpSync(join(ROOT, path), join(into, path), { recursive: true })
  }
  // 'junction' on Windows, where it needs no privilege; ignored elsewhere, where
  // a directory symlink needs none either.
  symlinkSync(join(ROOT, 'node_modules'), join(into, 'node_modules'), 'junction')
}

/**
 * `files` with the client bundle negated and `private` put back, written to the
 * copy with the same shape.
 *
 * Two mutations in one copy rather than two runs, because each run costs about
 * nine seconds and the gate pays for this once per push. They are independent:
 * a negated `files` entry has nothing to do with a manifest flag, `smoke-pack`
 * collects its failures rather than returning on the first, and both clauses are
 * asserted separately above. So one caught and one missed is a red build here
 * and not a green one.
 */
function mutate(manifest) {
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!Array.isArray(parsed.files)) {
    throw new Error('package.json has no "files" array, so there is nothing to negate')
  }
  if (parsed.private === true) {
    throw new Error('package.json already says "private": true, so this mutation proves nothing')
  }
  parsed.files = [...parsed.files, '!dist/studio/client/**']
  parsed.private = true
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
