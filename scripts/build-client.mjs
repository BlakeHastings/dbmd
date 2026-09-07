// Bundle the studio client into dist/studio/client/, beside the compiled server.
//
// WHY A BUNDLER AT ALL
// The client is TypeScript, and a browser will not run TypeScript. `tsc` could
// emit it, but then the page would load a module graph over HTTP one file at a
// time and every import would need a `.js` extension a bundler does not care
// about. ADR 0004 names esbuild for this and nothing in the standard library
// does the job.
//
// WHY THE SERVER IS NOT BUNDLED
// It is published as a library as well as run as a command, so `tsc` emits it
// with declarations. Only the client, which nothing imports, is bundled.
//
// This is not a watcher. Rebuild by running it again; the studio serves whatever
// is in the directory at the time of the request.
//
//   node scripts/build-client.mjs
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src', 'studio', 'client')
const out = join(root, 'dist', 'studio', 'client')

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const result = await build({
  entryPoints: [join(source, 'main.ts')],
  outfile: join(out, 'main.js'),
  bundle: true,
  format: 'esm',
  // The studio runs on the developer's own machine, on loopback, for as long as
  // the command runs. Every browser that can run this is younger than es2022.
  target: 'es2022',
  sourcemap: true,
  logLevel: 'warning',
})

await copyFile(join(source, 'index.html'), join(out, 'index.html'))

if (result.errors.length > 0) process.exit(1)
console.log('Built the studio client into dist/studio/client.')
