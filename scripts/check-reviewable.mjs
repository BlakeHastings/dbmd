// Fail when a tracked source file is binary to git, and therefore has no diff.
//
// WHAT THIS PREVENTS
// This repository's premise is that the model is markdown so the diff is the
// review. A file git considers binary produces no diff at all: `git diff` says
// "Binary files differ", `--numstat` says `-` `-`, and a pull request shows
// nothing to read. The file is still reviewable by opening it, which is not the
// same thing and is not what anybody does.
//
// One NUL byte anywhere is enough. Git needs no more than that.
//
// WHY IT IS A CHECK RATHER THAN A CONVENTION
// It has happened twice, from two different causes, and neither author did
// anything careless. Wave one lost a test fixture to a stray byte that arrived
// through a copied string. dbmd-31 put a deliberate NUL in a template literal
// as a map-key separator, which is a sound technique written the wrong way: the
// escape `\0` produces the identical string and stays text.
//
// Both were found by a reviewer noticing that `grep` refused the file, which is
// luck rather than process. The second one was the largest new module on its
// branch, so it had been reviewed without being seen.
//
// The fix in source is almost always to write the escape instead of the byte.
//
//   node scripts/check-reviewable.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Extensions whose contents are legitimately not text. A file with one of these
// is skipped rather than reported, because "this PNG has no diff" is true and
// uninteresting. Nothing in this repository matches today; the list exists so
// that adding a favicon does not require editing this file's logic.
const BINARY_BY_NATURE = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.zip',
  '.gz',
  '.wasm',
])

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const offenders = []
for (const file of tracked) {
  if (BINARY_BY_NATURE.has(extname(file).toLowerCase())) continue
  let bytes
  try {
    bytes = readFileSync(join(ROOT, file))
  } catch {
    // Tracked but not present: a partial checkout, or a file being deleted in
    // this very commit. Not this check's business either way.
    continue
  }
  const at = bytes.indexOf(0)
  if (at === -1) continue

  let line = 1
  for (let i = 0; i < at; i++) if (bytes[i] === 0x0a) line++
  offenders.push({ file, at, line })
}

if (offenders.length > 0) {
  console.error(
    `${offenders.length} tracked file${offenders.length === 1 ? '' : 's'} git will treat as binary:\n`,
  )
  for (const { file, at, line } of offenders) {
    console.error(`  ${file}`);
    console.error(`    NUL byte at offset ${at}, line ${line}`)
  }
  console.error(`
A file with a NUL byte in it has no diff. \`git diff\` prints "Binary files
differ" and a pull request shows nothing to read, so the change lands without
anybody having seen it. In a project whose whole argument is that the diff is
the review, that is the one defect worth failing a build over.

If you meant the byte, write the escape instead: \`\\0\` in a JavaScript or
TypeScript string is the same character and leaves the file text. If you did
not mean it, it arrived in something you pasted, and deleting it is the fix.

To see them yourself:  git diff --numstat <base>...HEAD    (a binary file is \`-\` \`-\`)
`)
  process.exit(1)
}

console.log(`${tracked.length} tracked files, none of them binary to git.`)
