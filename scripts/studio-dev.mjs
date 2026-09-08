// Start the studio with the feedback overlay on the page.
//
// WHAT THIS IS FOR
// The owner clicks an element, writes a note, and gets structured markdown
// naming the selector and the position, so an agent can find the code being
// talked about. That is `agentation`, and this is the only way to get it on
// screen. `npm run studio:dev` is the command; this file is what it ends with.
//
// WHY IT IS A SCRIPT AND NOT A CLI FLAG
// `dbmd studio --client-dir` would be a shipped option whose only purpose is
// development, documented in the help of a command strangers run, and one more
// path into the file server. `startStudio` already takes `clientDir` (it is in
// `StudioOptions`, and the server has read it since it was written), so the
// seam is there and the CLI does not have to grow anything. Nothing in
// `src/studio/` changes for this.
//
// WHY IT IMPORTS FROM dist/
// `startStudio` is TypeScript and this is a plain `.mjs` script, the same as
// every other file in this directory. `npm run studio:dev` builds first, so
// `dist/studio/index.js` is there and is the same code `dbmd studio` runs.
//
// It stops on Ctrl-C, and it flushes before it stops, for the reason
// `src/cli/studio.ts` gives: there may be a debounced write that has not fired
// yet, and that is somebody's work.
//
//   node scripts/studio-dev.mjs
//   node scripts/studio-dev.mjs examples/shop --no-open
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStudio } from '../dist/studio/index.js'
import { agentationEndpoint } from './agentation-endpoint.mjs'
import { recordStudioUrl } from './studio-url.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The same model `npm run studio` opens, so the two commands differ in one thing only. */
const DEFAULT_DIRECTORY = join(root, 'examples', 'shop')

/** Where `node scripts/build-client.mjs --dev` put the bundle with the overlay in it. */
const CLIENT = join(root, '.studio-dev')

const argv = process.argv.slice(2)
const open = !argv.includes('--no-open')
const directory = argv.find((argument) => !argument.startsWith('-')) ?? DEFAULT_DIRECTORY

const studio = await startStudio({ dir: directory, port: 0, open, clientDir: CLIENT })
// The port is `0`, so this URL is a different number every run, and the feedback
// server has no other way to tell this studio's annotation session from every
// other page annotated on this machine. Written down here because this is the
// one process that knows it without being told. `scripts/studio-url.mjs` says
// the rest.
await recordStudioUrl(studio.url)
console.error('  overlay    agentation 3.0.2, from .studio-dev, which never ships')
console.error(`  annotate   ${await syncLine()}`)
console.error('  read back  npm run annotations')

const signal = await untilStopped()
await studio.close()
console.error(`\nStopped ${studio.url} on ${signal}.`)

/**
 * Whether the annotations will go anywhere, said at the moment it can be acted
 * on rather than left to be discovered.
 *
 * The toolbar works either way: with nothing listening it keeps annotations in
 * the browser and copies markdown to the clipboard. What it cannot do is tell
 * you at a glance that the server you meant to be running is not, and this line
 * costs one request to say so. It is narration on stderr, beside the two lines
 * `startStudio` already writes there. ADR 0006.
 *
 * The check is not repeated: this says what was true when the studio started,
 * and the toolbar's own settings panel carries the live connection state.
 */
async function syncLine() {
  const endpoint = agentationEndpoint()
  if (endpoint === '') {
    return 'clipboard only, because DBMD_AGENTATION_ENDPOINT is empty'
  }
  try {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) return `${endpoint}, which answered`
    return `${endpoint}, which answered ${response.status}; try "agentation-mcp doctor"`
  } catch {
    return (
      `${endpoint}, which is not answering, so annotations stay in the browser. ` +
      'Start it with "agentation-mcp server", or check it with "agentation-mcp doctor"'
    )
  }
}

/** Resolves with the signal that asked this to stop. `once`, so a second Ctrl-C exits. */
function untilStopped() {
  return new Promise((resolve) => {
    const listeners = new Map()
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const listener = () => {
        for (const [other, registered] of listeners) process.off(other, registered)
        resolve(signal)
      }
      listeners.set(signal, listener)
      process.once(signal, listener)
    }
  })
}
