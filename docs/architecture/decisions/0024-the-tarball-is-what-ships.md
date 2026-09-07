# 0024. The tarball is what ships, so the tarball is what is tested

## Context

`dbmd-20` set `bin`, `files` and a `prepack` that builds, and proved once that a
packed tarball installs and runs. Nothing has looked at the tarball since, and
in the meantime the package grew a studio client bundle that is generated into
`dist/studio/client/` at build time rather than checked in, a second importable
module in `src/studio/index.ts`, and a library surface in `src/index.ts` that no
consumer could reach because the package had no `main` and no `exports`.

Every test in this repository imports from `src/`. The source tree has
everything, always, so all of them pass over a package that installs and does
nothing. The two failures that live in that gap are both invisible locally:

- **A `files` omission.** Drop `dist/studio/client/main.js` and `npm i dbmd`
  succeeds, `dbmd studio` starts, the port opens, the page loads, and it is
  blank. The generated bundle is exactly the kind of file a `files` entry
  forgets, because it is not in git and nobody sees it in a diff.
- **An `exports` path that points at something not shipped.** The map is a
  promise about paths that nothing checks against the tarball, and the binary
  never exercises it: the CLI reaches its own modules by relative path and never
  asks the resolver about the package name.

There is also one property that cannot exist in this repository at all. This is
developed on Windows, where `dist/cli.js` is mode 0644 and stays 0644 inside the
tarball. What makes `npx dbmd` work on Linux is npm's bin linking chmod-ing the
target on the way in. The only place to observe that is an installed package.

## Decision

**`npm run check` packs the tarball, installs it into a temporary directory
outside this repository, and drives the installed binary.**
`scripts/smoke-pack.mjs`, wired in as `check:pack`. It costs about six seconds.
`prepublishOnly` runs `npm run check`, so this runs on the day somebody
publishes, which is the day it matters most and the day nobody will remember to
run it by hand.

It asks the running studio for its page, its client bundle and its model over
HTTP rather than checking that a port accepted a connection, because a port that
accepts is not evidence: the failure this exists for serves a page. It reads the
command list out of `dbmd --help` rather than repeating it, so a command added
to the CLI is covered the day it lands. It runs the short-lived commands through
the `node_modules/.bin` link, which is what `npx` runs and what proves the
shebang and the executable bit are both there.

**The library surface is two entry points, and they are the two modules that
already exist to be one.** `.` is `src/index.ts`, the reader, the writer, the
types and the diagnostic contract. `./studio` is `src/studio/index.ts`, whose
own doc comment says `startStudio` is the whole surface, and which
`scripts/build-client.mjs` already describes as "published as a library as well
as run as a command". Nothing new was designed here; what was missing was the
`exports` map that lets anybody reach them. Deep paths are closed, so
`dbmd/dist/model/read.js` is not a thing somebody can come to depend on, and the
import provider seam is deliberately not exported because ADR 0007's registry
has no consumer-facing shape yet.

**The tarball ships no source maps.** `files` is `["dist", "!dist/**/*.js.map"]`.
`tsc`'s maps have `sources` pointing into a `src/` the tarball does not contain,
so they are worse than absent: a stack trace resolved through one is a stack
trace pointing at nothing. esbuild's client map is self-contained and does work,
and it is also 56 kB on top of a 129 kB tarball, 43% more for a first-time `npx`
user to wait through. That is the trade, and it went the way it did because the
person who wants to debug the studio client has the repository, and the person
waiting on `npx` does not. Shipping the sources instead was the other way to
make the maps resolve, and it is the same argument with a larger number: `src/`
is bigger than the maps and helps the same nobody.

**`private: true` stays.** Nothing here needs it gone: `npm pack` packs, the
tarball installs, `npx` runs it. It is the one thing standing between an
accidental `npm publish` and a name on npm that cannot be un-taken, and
publishing has never been asked for. Removing that line is the whole of the
decision, and it belongs to the owner rather than to this item.

## Consequences

- **`npm run check` now needs a network on a cold npm cache**, to install the
  tarball's one dependency. `--prefer-offline` keeps it off the network when the
  cache has `yaml`, which after `npm ci` it does, so CI pays this once.
- **The pack runs `prepack`, so `check` builds twice**, about two seconds. That
  is deliberate: packing with the scripts off would prove the tarball contains
  whatever `dist/` happened to hold, rather than that `prepack` produces it.
- **`npm pack --json` cannot be used for the real pack.** A lifecycle script's
  own stdout lands in the middle of the JSON, and `build-client.mjs` prints a
  line. The sizes come from a second, dry, `--ignore-scripts` pack over the same
  `dist/`.
- **`files` cannot drop the binary, `main`, the README or the licence.** npm
  forces those in whatever the negations say, which is worth knowing before
  writing a test that expects a negation to remove one. What it will happily
  drop is the client bundle and anything only `exports` refers to, which is why
  those are what the smoke test looks at.
- **The studio page will log a source-map warning in devtools**, because
  `main.js` still ends with a `sourceMappingURL` comment pointing at a file the
  tarball does not carry. It is a warning in a tool a user of `dbmd` has no
  reason to have open, and it is the accepted cost of the 56 kB.
- **A version that is not `0.0.0` is now the only thing between this and a
  publish**, plus the line above. Everything else this package needed to be
  installable is done and tested.

## Revisit when

- **Somebody decides to publish.** The `private` line comes out then, with a
  version, and the argument above is what it is being weighed against.
- **A consumer wants something `src/index.ts` does not export**, the import
  provider seam most likely. That is a third entry point and a decision about
  what the seam looks like from outside, rather than a line in `exports`.
- **The smoke test gets slow enough to be resented.** It is in `check` because
  six seconds is cheap. If it stops being cheap it becomes its own script and
  `prepublishOnly` keeps it, which is the placement that actually matters.
- **The client bundle stops being the largest thing in the tarball.** The
  source-map trade above is a trade about one file, and a different `dist/`
  makes it a different trade.
