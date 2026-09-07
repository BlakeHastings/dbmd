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
// THE MUTATIONS
// The first is the failure that check was pointed at. `dist/studio/client/` is
// generated at build time rather than checked in, so it is exactly the kind of
// path a `files` entry forgets, and forgetting it produces a package that
// installs, starts, opens a port and serves a blank page. Adding
// `"!dist/studio/client/**"` to `files` reproduces that in one line.
//
// The second is the other invisible one. `"private": true` was in this manifest
// on purpose until the owner decided to release (ADR 0051), and putting it back
// is a one-word edit that packs, installs and runs exactly like the real thing.
// `npm publish --dry-run` does not object to it either. The day it would be
// noticed is a release day, in the job that publishes, after everything else has
// already gone green.
//
// The third is the newest and it is invisible in a different way. The studio's
// feedback overlay is React and `agentation`, it is a devDependency under a
// licence that is not open source, and the only thing keeping it out of the
// tarball is that `src/studio/client/main.ts` has no import path to it
// (ADR 0064). One `import './feedback.js'` line in that file undoes the whole
// arrangement, and the result type-checks, builds, packs, installs, starts and
// serves a page that works perfectly. It is three times the size and carrying
// somebody else's licence, and nothing but a check that reads the shipped
// bundle can see it.
//
// WHY THREE MUTATIONS ARE TWO RUNS
// The first two are independent of each other, so they share a copy: a negated
// `files` entry has nothing to do with a manifest flag, `smoke-pack` collects
// its failures rather than returning on the first, and both clauses are asserted
// separately below. So one caught and one missed is a red build here and not a
// green one.
//
// The third is not independent of the first. `!dist/studio/client/**` takes the
// client bundle out of the tarball, and the third mutation's whole assertion is
// about what is inside that bundle: put them in one copy and the overlay check
// has no file to read and passes trivially, which is the exact shape of a guard
// that has stopped guarding. So it gets its own copy, and the second run costs
// about nine seconds that buy an assertion that can actually fail.
//
// WHY THE SENTENCE IS ASSERTED AND NOT ONLY THE EXIT CODE
// Everything below happens in a copy of this tree, and a copy that failed to
// assemble makes `smoke-pack.mjs` exit 1 as well. An exit-code-only assertion
// cannot tell "the guard caught the mutation" from "the harness is broken", so
// what is asserted is the clause the guard prints for each mutation. That is the
// same lesson dbmd-54's title carries: a check that cannot see the words is not
// checking what it claims to.
//
// WHY THERE IS NO CONTROL RUN
// A further unmutated run would cost another nine seconds to prove that the
// scratch copy packs cleanly. It is not needed: `npm run check:pack` runs
// immediately before this in `npm run check` and is that control, over the real
// tree, and the clauses asserted below cannot be produced by a scratch tree that
// did not build.
//
// WHY IT COPIES RATHER THAN EDITING THE TREE IN PLACE
// A mutate-and-restore would leave the checkout dirty on any failure, and on
// Windows a half-restored file is easy to produce and hard to notice. One dirty
// `package.json`, or one stray import left in `main.ts`, makes every later run
// in that session meaningless. So the mutations happen to a copy and the real
// tree is never written to.
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

/**
 * What is broken, in which copy, and the clause `smoke-pack.mjs` prints for it.
 *
 * The clauses are not whole sentences: the bundle's counts bytes and names a
 * URL with a randomly chosen port, and pinning those would make this fail on a
 * reworded message that still says the right thing.
 */
const ROUNDS = [
  {
    what: 'the manifest',
    mutations: ['!dist/studio/client/** in "files"', '"private": true'],
    expected: [
      'the studio client bundle is not in the tarball',
      'says "private": true, so npm publish would refuse this tarball',
    ],
    apply: (scratch) => mutateTheManifest(join(scratch, 'package.json')),
  },
  {
    what: 'the release entry point',
    mutations: ['an import of the development overlay in src/studio/client/main.ts'],
    expected: ['the shipped studio client bundle carries the development feedback overlay'],
    apply: (scratch) => mutateTheEntryPoint(join(scratch, 'src', 'studio', 'client', 'main.ts')),
  },
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
  join('scripts', 'agentation-endpoint.mjs'),
  join('scripts', 'smoke-pack.mjs'),
]

for (const round of ROUNDS) await fire(round)

/** One copy of the tree, broken one way, and the refusal it has to produce. */
async function fire({ what, mutations, expected, apply }) {
  const scratch = mkdtempSync(join(tmpdir(), 'dbmd-pack-guard-'))
  let ran
  try {
    assemble(scratch)
    apply(scratch)
    console.log(`Copied the tree to ${scratch} and gave ${what} ${mutations.join(' and ')}.`)
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
    const count = mutations.length === 1 ? 'once' : `${mutations.length} times over`
    console.error(`\`check:pack\` passed a tarball it should have refused ${count}.\n`)
    console.error(`It was given ${mutations.join(' and ')}, and the check said the packed`)
    console.error('tarball was fine, which means it is no longer looking at what it claims to.\n')
    console.error('What it printed:\n')
    console.error(said.trimEnd())
    process.exit(1)
  }

  const missed = expected.filter((clause) => !said.includes(clause))
  if (missed.length > 0) {
    console.error(`\`check:pack\` failed, but not for every reason it was broken (exit ${ran.code}).\n`)
    console.error('Expected it to say, and it did not:\n')
    for (const clause of missed) console.error(`  ${clause}`)
    console.error('\nAn exit code alone cannot tell a guard that caught the mutation from a')
    console.error('harness that did not assemble, and with more than one mutation in a run it')
    console.error('cannot tell one caught from all of them, which is why this reads the words.')
    console.error('If the message below is about the mutation and has merely been reworded,')
    console.error('update ROUNDS in this file. If it is about anything else, this script is')
    console.error('broken and the guard it checks is unproven.\n')
    console.error('What it printed:\n')
    console.error(said.trimEnd())
    process.exit(1)
  }

  console.log(`\`check:pack\` refused the mutated tarball (exit ${ran.code}) and said why:`)
  for (const clause of expected) console.log(`  ${clause}`)
}

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
 */
function mutateTheManifest(manifest) {
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

/**
 * The release entry point taught to import the development overlay.
 *
 * Appended rather than inserted at the top, because ESM hoists imports and the
 * end of the file is the one place in it that no future edit is likely to
 * collide with. It is the line somebody would add by hand on the day they
 * decided the toolbar should be on by default, which is the mistake this is
 * pointed at rather than a contrived one.
 *
 * **It is deliberately the quiet half of that mistake.** `agentation` declares
 * `sideEffects: false`, so a bare import with no call is partly tree-shaken:
 * measured on 2026-09-07, the release bundle went from 136 kB to 1.21 MB and
 * kept React, but the overlay's own colour tokens were dropped, so only two of
 * the three markers `smoke-pack.mjs` looks for fire. Adding the call as well
 * would put all three back and make this an easier catch. The weaker mutation
 * is the better test: a guard that only notices the loud version of a mistake
 * is a guard somebody will walk past.
 *
 * The file is read first and asserted not to name the overlay already: if
 * `main.ts` has grown that import for real, this mutation is not a mutation and
 * the run below would prove nothing.
 */
function mutateTheEntryPoint(entry) {
  const source = readFileSync(entry, 'utf8')
  if (source.includes('feedback.js')) {
    throw new Error(
      `${entry} already imports the feedback overlay, so this mutation proves nothing. ` +
        'That is itself the defect ADR 0064 is about: only dev.ts may reach feedback.ts.',
    )
  }
  writeFileSync(entry, `${source}\nimport './feedback.js'\n`)
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
