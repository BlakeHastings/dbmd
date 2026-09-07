# 0062. The bundler gets no warning and the studio keeps its map

## Context

[ADR 0024](0024-the-tarball-is-what-ships.md) decided that the tarball ships no
source maps, and both of its reasons still hold. `tsc`'s maps have `sources`
pointing into a `src/` the tarball does not contain, so a stack trace resolved
through one is a stack trace pointing at nothing. esbuild's client map does
work and is large enough that a first-time `npx` user pays for it in wait. None
of that is reopened here.

What is reopened is the sentence that record wrote about the cost. Its
Consequences say the studio page will log a source-map warning in devtools,
"because `main.js` still ends with a `sourceMappingURL` comment pointing at a
file the tarball does not carry". That is one file. Measured on 2026-09-07 from
`npm pack --dry-run --json --ignore-scripts`, it was every file:

| what                                   | count |
| -------------------------------------- | ----- |
| `.js` files in the tarball             | 37    |
| carrying a `sourceMappingURL` comment  | 37    |
| `.map` files in the tarball            | 0     |
| `.d.ts` files carrying a declaration map | 0   |

`tsconfig.build.json` set `"sourceMap": true`, `package.json` negates
`dist/**/*.js.map` in `files`, and nothing between the two ever removed the
comment `tsc` writes at the foot of what it emits. The negation takes the map
and leaves the pointer.

The 37 have two producers, and more usefully two readers.

**Thirty-six are `tsc`'s, and they are the library.** `main`, `exports` and
everything those reach are these files. 0024 is the record that added that
surface, and `scripts/smoke-pack.mjs` says so in its own summary line: it
imports both entry points a consumer is offered, on every check. So the reader
of those 36 dangling comments is not somebody with devtools open on a tool they
had no reason to open. It is somebody who wrote `import { readModel } from
'dbmd'` and whose bundler now reports a missing source map once per file it
pulls in. 0024 did not weigh that reader, and could not have counted them:
the entry points it was adding had no consumers on the day it was written.

**The thirty-seventh is `dist/studio/client/main.js`,** esbuild's, and it is
the file 0024's sentence actually named. It is served to a browser over HTTP
and imported by nothing, so no bundler ever resolves it, and its only reader is
the one 0024 weighed and accepted.

## Decision

**`tsconfig.build.json` sets `"sourceMap": false`.** The 36 comments and the 36
maps beside them both stop being produced. `files` keeps its
`!dist/**/*.js.map` negation, which now costs nothing and is what would catch a
map arriving from somewhere else.

**Nothing local pays for this**, and that was checked rather than assumed. No
test in this repository imports from `dist/`: vitest runs the suite over
`src/`, where the TypeScript is what is being stepped through and no map is
involved. Three things reach `dist/`, and none of them is a debugger. `npm run
check` builds it and packs it. `smoke-pack.mjs` installs it elsewhere and
drives the binary, asserting on what commands print. `npm run studio` builds it
and runs `dist/cli.js` against `examples/shop`, and every place this repository
writes down what that script is for says the same thing: `CONTRIBUTING.md`
calls it the fastest way to get a picture on screen, and `docs/process/review.md`
and `docs/process/working-an-issue.md` both say to bring it up and drive it the
way the real user would. There is no launch configuration in this repository,
no `--inspect` in any script or document, and no line anywhere suggesting that
somebody steps through the compiled server. It is a way to run the app rather
than a way to read it.

**`scripts/build-client.mjs` keeps `sourcemap: true`, and the client bundle
keeps its comment.** This is the map with local value and it is the only one:
the client is the one part of this codebase that cannot be run from `src/` at
all, because a browser will not load TypeScript and ADR 0004's bundler is what
turns it into something a page can execute. Somebody debugging the canvas opens
the studio from a checkout, opens devtools, and reads their own source, because
the map is beside the bundle on disk. Turning it off to remove one dangling
reference from the tarball would spend the affordance 0024 protected in order
to buy silence in a tool a `dbmd` user has no reason to have open.

So the tarball ends with one dangling reference instead of 37, and it is the
one 0024 wrote down.

**`check:pack` reads the reference rather than the setting.**
`scripts/smoke-pack.mjs` walks every `.js` in the installed package, resolves
each `sourceMappingURL` against the file beside it, and fails on any that does
not resolve, with `dist/studio/client/main.js` as the single named allowance. A
`tsconfig` flag flipped back is a one-word edit that packs, installs, runs and
serves exactly like the real thing, and puts all 36 back without moving a test.
The only check that can see that is one that looks at the artefact, which is
what that script is already for.

## Consequences

- **Nobody can step through the compiled server in a debugger any more**, and
  would get JavaScript with no way back to the TypeScript if they tried. The
  evidence above says nobody does. Anybody who wants to is one line away: set
  `"sourceMap": true` locally and do not commit it. `dist/` is not in git and
  the maps never were, so nothing else has to change to get them back.
- **The build writes 36 fewer files, all of them maps.** They were 314 kB on
  disk that no tarball ever carried, so this is smaller only in a working
  directory. The packed tarball does not change size at all.
- **The allowance in `check:pack` is a path, and a path can go stale.** If the
  client bundle is renamed or moved, the check fails on a file it should be
  allowing rather than passing on one it should not, and its message names the
  file. That is the direction to fail in.
- **0024's last consequence becomes exactly true rather than approximately
  true.** It said the studio page logs a source-map warning because `main.js`
  carries a dangling comment. It now does, and it is the only file that does.
- **The tarball's file list is unchanged.** What changed is the inside of 37
  files already listed in it. `check:pack` and `check:guards` both read that
  list, and both were run and read rather than assumed: the guard still fires
  on both its mutations and still prints both clauses it asserts.

## Revisit when

- **The client bundle stops being served to a browser and starts being
  imported.** The only thing that makes its dangling comment different in kind
  from the other 36 is that no bundler resolves it. A client that becomes an
  entry point is the same problem again with a larger map.
- **Somebody wants to debug the compiled server.** "Nobody does" is an
  observation rather than a rule, and the person who wants to is the evidence
  that it changed. The fix is one line in the file this record just edited.
- **The maps become shippable.** `tsc`'s are unusable inside a tarball because
  `sources` points outside it, and `sourceRoot` or inlined sources would change
  that. Then 0024's trade is about size rather than about correctness, and it
  is 0024 that gets revisited rather than this.
