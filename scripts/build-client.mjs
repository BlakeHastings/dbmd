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
// THE TWO ENTRY POINTS
// `main.ts` is the release entry and its bundle ships. `dev.ts` is the
// development entry: it imports `main.ts` and then the feedback overlay, which
// brings React and `agentation` with it. Run with `--dev`, this builds that one
// instead, into `.studio-dev/`, which is outside `dist/` and so outside `files`.
//
// The two facts that make "it cannot ship" structural rather than argued are
// both here. `main.ts` has no import path to the overlay, and `bundle: true`
// inlines only what an entry can reach, so the release bundle cannot carry it
// whatever this script is configured to do. And the dev bundle is written to a
// directory `npm pack` never looks in, so it cannot ship even if it is sitting
// on disk when somebody packs. ADR 0064.
//
// The output file is `main.js` in both modes, so the one `index.html` is copied
// to both directories unchanged and the page's `<script src="./main.js">` is
// true in each. That keeps `src/studio/client/index.html` the single stylesheet
// `npm run check:scenes` reads.
//
// This is not a watcher. Rebuild by running it again; the studio serves whatever
// is in the directory at the time of the request.
//
//   node scripts/build-client.mjs
//   node scripts/build-client.mjs --dev
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { agentationEndpoint } from './agentation-endpoint.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src', 'studio', 'client')

// Not `parseArgs`: one flag, and an unrecognised argument here should be a
// refusal rather than a quiet release build somebody thought was a dev one.
const [flag, ...rest] = process.argv.slice(2)
if (rest.length > 0 || (flag !== undefined && flag !== '--dev')) {
  console.error(
    `build-client takes nothing or --dev, and got: ${process.argv.slice(2).join(' ')}.\n` +
      'Nothing else, because the difference between the two is what ships.',
  )
  process.exit(1)
}

const dev = flag === '--dev'

/**
 * Which entry, and where its bundle goes.
 *
 * The dev directory is at the root rather than under `dist/` on purpose.
 * `files` in package.json is `["dist"]`, so a sibling directory is one npm
 * cannot pack by any spelling of that entry, and `.gitignore` keeps it out of
 * the repository as well.
 */
const { entry, out, where } = dev
  ? { entry: 'dev.ts', out: join(root, '.studio-dev'), where: '.studio-dev' }
  : { entry: 'main.ts', out: join(root, 'dist', 'studio', 'client'), where: 'dist/studio/client' }

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const result = await build({
  entryPoints: [join(source, entry)],
  outfile: join(out, 'main.js'),
  bundle: true,
  format: 'esm',
  // The studio runs on the developer's own machine, on loopback, for as long as
  // the command runs. Every browser that can run this is younger than es2022.
  target: 'es2022',
  sourcemap: true,
  logLevel: 'warning',
  ...(dev
    ? {
        define: {
          // React reads this and ships its development build when it is not
          // set, which is 400 kB of warnings and a slower render for an overlay
          // nobody debugs. Only the dev bundle has React in it, so only the dev
          // bundle needs it.
          'process.env.NODE_ENV': '"production"',
          // Where the toolbar posts annotations. It is a React prop, so it is
          // compiled in rather than read at run time; `studio-dev.mjs` narrates
          // the same value from the same module.
          __AGENTATION_ENDPOINT__: JSON.stringify(agentationEndpoint()),
        },
      }
    : {}),
})

await copyFile(join(source, 'index.html'), join(out, 'index.html'))

if (result.errors.length > 0) process.exit(1)
console.log(`Built the studio client${dev ? ' with the feedback overlay' : ''} into ${where}.`)
