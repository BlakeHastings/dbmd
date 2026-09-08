// Where the last `npm run studio:dev` was listening, in one place.
//
// WHY THIS EXISTS
// The feedback server keeps one annotation session per page URL, and the studio
// binds port `0`, so the studio's URL is a different number every run. Nothing
// on the server says which of its sessions is this repository's: they carry a
// url, a status and a time, and the store on this machine is shared with
// whatever else the owner has annotated. Measured on 2026-09-08: 177 sessions,
// of which exactly one was the studio's.
//
// So the studio writes down where it was, and `annotations.mjs` reads it. That
// is the whole of the coupling, and it is the only fact either script needs
// from the other. `studio-dev.mjs` is the one process that knows the answer
// without being told, because `startStudio` hands it the URL.
//
// WHY IT IS A FILE AND NOT A FLAG
// The alternative is telling the reader the port every time, and the port is
// the part that changes. A number copied out of a terminal that has scrolled
// away is the reason this loop would go unread.
//
// WHY THE RECORD CARRIES A TIME, AND THE READER PRINTS IT
// A recorded value goes stale, and a stale value read as current is how this
// project has lost afternoons. The time is written beside the URL so the reader
// can say "recorded at 21:17" rather than "the studio", and a reader who is
// looking at yesterday's session can see that they are.
//
// WHERE IT LIVES, AND WHAT DELETES IT
// `.studio-dev/`, beside the dev bundle, because it is the same kind of thing:
// a development artefact, gitignored, and outside `dist/` so `npm pack` cannot
// reach it. `build-client.mjs --dev` clears that directory, so a dev build
// removes the record; the same command then starts the studio, which writes it
// again. A reader that finds nothing says so and asks for `--url`.
//
// This module is imported rather than run.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '.studio-dev')
const FILE = join(DIRECTORY, 'studio.json')

/**
 * Write down where the studio is listening, for whoever reads the annotations.
 *
 * Failure is swallowed. This is a convenience for a later command and the
 * studio is already on screen; refusing to start one because a note could not
 * be written would trade the feature for the hint about it.
 */
export async function recordStudioUrl(url) {
  try {
    await mkdir(DIRECTORY, { recursive: true })
    await writeFile(FILE, `${JSON.stringify({ url, startedAt: new Date().toISOString() })}\n`)
  } catch {
    // Nothing to say. The studio is running either way, and `annotations.mjs`
    // asks for `--url` when it finds no record.
  }
}

/**
 * The last recorded studio, or `null` if there is none to read.
 *
 * `null` covers every way this can go wrong at once, and they are the same
 * thing to a caller: no studio has run in this checkout, or a dev build cleared
 * the directory, or the file is half written. Each of those means "you will
 * have to say which page you mean", which is what the reader then says.
 */
export async function lastStudioUrl() {
  let text
  try {
    text = await readFile(FILE, 'utf8')
  } catch {
    return null
  }
  try {
    const record = JSON.parse(text)
    if (typeof record.url !== 'string' || record.url === '') return null
    return { url: record.url, startedAt: record.startedAt ?? null }
  } catch {
    return null
  }
}
