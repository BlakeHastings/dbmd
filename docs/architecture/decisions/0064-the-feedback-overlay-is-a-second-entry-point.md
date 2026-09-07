# 0064. The feedback overlay is a second entry point, and the canvas says what it is

## Context

The owner is about to start a visuals phase on the studio and wants to point at
things rather than describe them. They asked for
[`agentation`](https://www.npmjs.com/package/agentation) by name: it puts a
toolbar on the page, and a click on an element plus a sentence produces
structured markdown naming the selector and the position, so an agent can find
the code being talked about.

Read out of the registry and out of the tarball rather than remembered:

| fact                 | value                                              |
| -------------------- | -------------------------------------------------- |
| version              | 3.0.2                                              |
| licence              | PolyForm-Shield-1.0.0, which is not an OSI licence |
| runtime dependencies | none                                               |
| peer dependencies    | `react >=18.0.0`, `react-dom >=18.0.0`             |
| unpacked             | 3.6 MB across 9 files                              |
| exports              | React components                                   |

`PageFeedbackToolbarCSS`, exported again as `Agentation`, returns a
`ReactPortal`. The rest of the export list is icons and four helpers. There is
no vanilla mount, no custom element and no global, so hosting the toolbar means
hosting a React root.

This repository has no React and no UI framework. `src/studio/client/` is plain
TypeScript against the DOM, its one runtime dependency anywhere is `yaml`, and
`scripts/build-client.mjs` bundles it from `main.ts` with esbuild.

Two things follow, and they pull in opposite directions.

**It must not ship.** `dist/studio/client/main.js` is 136 kB of a 237 kB
tarball, and `bundle: true` inlines everything an entry point can reach. React
plus the overlay is roughly ten times the size of the bundle it would ride in,
and it carries a licence this project does not. `dbmd` is a tool people run with
`npx`, and [AGENTS.md](../../../AGENTS.md) says install time is a feature.

**A guard on it has to be able to fail.** [ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md)
is called "a guard is not believed until it has been seen to fail", and the
failure this one is pointed at is a one-line edit that type-checks, builds,
packs, installs, starts and serves a page that works perfectly.

## Decision

**A second entry point, not a flag on the one entry.**
`src/studio/client/dev.ts` imports `main.ts` and then `feedback.ts`, and nothing
imports `dev.ts`. `main.ts` therefore has no import path to React or to
`agentation`, and the release bundle cannot carry them however the bundler is
configured.

The alternative was a build-time flag on the single entry, with an esbuild
`define` or `alias` swapping a real module for an empty stub in release builds.
It is fewer files and it was not taken, because its guarantee rests on the alias
being right: a mistyped alias, a `define` the bundler cannot fold, or a future
esbuild that keeps an unprovable branch all put the overlay back in the tarball,
and each of those is a thing to argue about rather than a thing to look at. The
direction of an import is not arguable.

**The dev bundle is written to `.studio-dev/`, outside `dist/`.** `files` in
`package.json` is `["dist"]`, so this is a directory `npm pack` cannot reach by
any spelling of that entry. It is the second of the two structural facts, and it
holds even when the dev bundle happens to be sitting on disk at pack time. It is
in `.gitignore` and `.prettierignore` beside `dist/`, for the same reasons.

The output file is `main.js` in both modes, so the one `index.html` is copied
into both directories unchanged and its `<script src="./main.js">` is true in
each. `src/studio/client/index.html` stays the single stylesheet
`npm run check:scenes` reads, and no scene gains a rule.

**The studio serves it through `clientDir`, which already existed.**
`scripts/studio-dev.mjs` calls `startStudio` with `clientDir` pointing at
`.studio-dev/`. Nothing in `src/studio/` changes. A `dbmd studio --client-dir`
flag was the other shape and was refused: it would be a shipped option whose
only purpose is development, in the help of a command strangers run.

**`npm run studio:dev` is the one command**, and it is written down in
`CONTRIBUTING.md` beside `npm run studio`, which it mirrors.

**The toolbar is given an `endpoint`, so an annotation goes somewhere rather
than only to the clipboard.** The owner already runs the other half of this
system: `agentation-mcp` was listening on port 4747 while this was written, and
`GET /health` answered `{"status":"ok","mode":"local"}` when asked rather than
inferred. That server keeps annotations and offers them to an agent over MCP,
which is what "realtime feedback" meant, and it costs a prop.

The value has one home, `scripts/agentation-endpoint.mjs`, because two scripts
need it and must not disagree: `build-client.mjs --dev` compiles it into the
bundle through an esbuild `define`, since the toolbar takes it as a React prop
and there is nowhere to read it at run time, and `studio-dev.mjs` narrates it.
`DBMD_AGENTATION_ENDPOINT` moves it, and set to an empty string turns sync off
and keeps the toolbar. The default is `http://127.0.0.1:4747`, spelled with the
address rather than `localhost` for the reason the studio binds the same
literal: on Windows `localhost` can resolve to `::1` first.

**Nothing depends on that server being up.** Read out of the package rather than
hoped for: a failed session creation is caught and logged as "using local
storage", and a failed health check sets the status to disconnected. The toolbar
goes on annotating, `copyToClipboard` still defaults to true, and the
annotations still live in `localStorage`. `studio-dev.mjs` makes one request to
`/health` at startup and prints what it found, with `agentation-mcp doctor` in
the line when it found nothing, so a server that is not running is a sentence at
the moment it can be acted on rather than a silence to be discovered later.

**Registering the MCP server is not done here.** It changes what an agent
session can do and it is a decision about the owner's machine, not a file in
this repository. `CONTRIBUTING.md` names `agentation-mcp init` as the step and
leaves it to them.

Driven end to end on 2026-09-07: a click on the `shipments` box and a sentence
produced a session on 4747 for the studio's URL, holding one annotation whose
`elementPath` was `.scene > .boxes > #table-shipments > header`. The test
annotation was deleted afterwards.

**`react`, `react-dom`, `agentation` and the two `@types` packages are
devDependencies, pinned exactly.** [docs/ci.md](../../ci.md) argues that a
version resolved at run time is a supply chain decision made by accident, and
that argument does not stop at the boundary of a CI recipe. `^` would let a
future publish of any of the five change what the owner's browser executes with
their checkout on disk, in a session where nothing looked different.

**PolyForm Shield is not an open source licence.** It is stated here rather than
left for somebody to find. The package is a devDependency, so it is not
distributed and `dbmd` stays MIT: `files` carries `dist` only, no byte of the
overlay reaches the tarball, and the check below is what keeps that true. The
owner asked for this package by name, so this is a fact to know rather than a
reason to refuse.

**`check:pack` reads the shipped bundle, and `check:guards` breaks it.**
`scripts/smoke-pack.mjs` reads `dist/studio/client/main.js` out of the installed
package and refuses three markers: esbuild's `// node_modules/` comment, which
it writes above every module it inlines and which is the broad net; React's
`Symbol.for("react.element")`; and `--agentation-color-`, the prefix of the
custom properties the overlay writes. `scripts/check-pack-guard.mjs` gained a
second round which appends `import './feedback.js'` to `main.ts` in a copy of
the tree and fails unless the pack check refuses it.

It is a second round rather than a third mutation in the existing one, and that
is the whole of why the guard file changed shape. The first round negates
`dist/studio/client/**` in `files`, which takes the bundle out of the tarball
entirely; put the overlay mutation in the same copy and the new check has no
file to read and passes trivially, which is exactly the shape of a guard that
has stopped guarding.

**The canvas names its objects on the element, so that pointing at one says
which one it is.** `nameForPointing` in `canvas.ts` sets two attributes that
nothing in this codebase reads: `id`, as `table-shipments`, `note-<name>` or
`group-<name>`, and `data-element`, as `table shipments`. The existing
`data-table`, `data-note`, `data-group` and `data-column` are untouched and
remain what the code finds an object by, so changing what a person sees cannot
change what a drag or a hit test finds.

This is here because without it the feature is most of the way to useless, and
that was measured rather than guessed. `generateSelector` in the overlay reads
the tag for a unique `nav`/`header`/`footer`/`main`, then `#id`, then the first
meaningful class, then a positional `nth-child`; `getElementPath` reads `#id`
then a class; and `identifyElement` reads `data-element` and no other data
attribute. Against `examples/shop` on 2026-09-07, before the change, a click on
the `shipments` box came back as `box` at `#canvas > .scene > .boxes > .box`,
which is the path all eight boxes share, and the word `shipments` never appeared
though it was sitting on the element in `data-table`. After it, driving the real
toolbar in a browser, the stored annotation reads:

```
element:     header
elementPath: .scene > .boxes > #table-shipments > header
fullPath:    body > main.stage > div#canvas > div.scene > div.boxes > article#table-shipments > header
```

That is the difference between "the shipments box is too tall" and "one of the
eight boxes is too tall".

An id is only set where the name is unique in the document, which is one file per
name for tables, notes and groups. A column's is not: every table has a column
called `id`, and two elements sharing one would hand the overlay a selector that
matches the wrong element. So a column gets `data-element` and no id, and its
path resolves through its table's.

## Consequences

- **React is in this repository, for one overlay, in development.** That is the
  honest description and there is no second use for it. Five devDependencies
  arrive: `agentation`, `react`, `react-dom`, `@types/react` and
  `@types/react-dom`. None is in `dependencies`, and the tarball's file list is
  unchanged at 77 files.
- **The release bundle is byte for byte what it was**, apart from the two
  attributes the canvas now writes. `node scripts/build-client.mjs` with no flag
  takes the same entry to the same place with the same options.
- **The ids are a public surface.** They exist to be pointed at. Anything that
  starts keying off them is coupled to a name that comes out of a file name, and
  the comment on `nameForPointing` says so. The data attributes remain the thing
  the code reads, and that separation is the point.
- **`data-element` couples the shipped page to a convention the overlay
  defines.** It is a string and not a dependency, and it is four attributes'
  worth of DOM, but it is a name chosen because one particular tool reads it.
  The alternative measured was `aria-label`, which `labelSection` falls back to;
  it was refused because it changes the accessibility tree of a canvas box in
  order to improve a development label.
- **A name that is awkward in a selector stays awkward.** `isFileName`
  ([ADR 0026](0026-a-name-the-writer-cannot-write-is-a-skip.md)) permits spaces
  and brackets, and `Ledger [Entry]` is a real imported table. `generateSelector`
  escapes with `CSS.escape` and `getElementPath` does not, so such a name lands
  in a path unescaped. That is left alone: a path somebody has to quote before
  pasting still names the object, and refusing the id would hand back the shared
  `.box` path, which names nothing.
- **The name reported is the deepest element under the cursor**, so a click on a
  box's header says `header` rather than `table shipments`. The path names the
  table either way, which is the load-bearing half. Decorating every child of a
  box with its own `data-element` would fix the label and was not done.
- **`check:guards` costs about nine seconds more**, because it is two copies of
  the tree and two packs rather than one.
- **The dev bundle carries a hard-coded address**, because the prop is compiled
  in. Changing `DBMD_AGENTATION_ENDPOINT` means rebuilding, which
  `npm run studio:dev` does every time anyway. A run-time lookup would mean a
  global or a fetch before mount, and neither is worth it for a value the same
  command sets and reads.
- **A session is created on the companion server for every studio URL**, and the
  port is `0` by default, so a day of restarts leaves a row of one-annotation
  sessions there. That is `agentation-mcp`'s to tidy and not this repository's.

## Revisit when

- **`agentation` ships a vanilla mount, a custom element or a global.** Then
  React is no longer the price of the toolbar and four of the five
  devDependencies go, which is most of the cost of this record.
- **Anything else in the studio wants React.** The argument above is that React
  is here for one overlay in development. A second use makes it a framework
  decision, and that is a different record with a different scope.
- **Something starts reading an id.** They are written to be pointed at. The day
  code depends on one, the name is a contract and the rule about which kinds get
  one has to be stated somewhere stronger than a comment.
- **The overlay starts reading a data attribute of its own choosing**, or stops
  reading `data-element`. The measurement above is of one version of one
  package, and the whole of `nameForPointing` exists to match it.
