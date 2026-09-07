/**
 * The feedback overlay, which is development only and never ships.
 *
 * This is the only file in this repository that names `react`, `react-dom` or
 * `agentation`, and nothing the release bundle can reach imports it. The one
 * importer is `dev.ts`, which is a second entry point built by
 * `node scripts/build-client.mjs --dev` into a directory outside `dist/`.
 * `main.ts` has no path to this file, and `bundle: true` inlines what an entry
 * can reach, so the shipped bundle cannot carry any of it. ADR 0064 has the
 * argument and the guard that proves it.
 *
 * WHY REACT IS IN THIS REPOSITORY AT ALL
 * `agentation` exports React components and nothing else. There is no vanilla
 * mount, no custom element and no global on `window`, so hosting the toolbar
 * means hosting a React root. That is the whole of React's job here: one
 * overlay, in development, on one page.
 *
 * WHY THERE IS NO JSX
 * `createElement` rather than `<Agentation />`, so `tsconfig.client.json` needs
 * no `jsx` setting and `scripts/build-client.mjs` needs no loader for a `.tsx`
 * extension it has never had. One call is not worth either.
 *
 * WHAT IT PUTS ON THE PAGE
 * A host `<div>` at the end of `<body>`, and that is all it puts anywhere the
 * studio's own stylesheet can see. The component itself renders through a
 * portal, and its styles are CSS-module class names carrying a build hash
 * (`.styles-module__popup___IhzrD` and the like) plus custom properties under
 * `--agentation-*`. Read on 2026-09-07 out of `dist/index.mjs`: 34 selectors,
 * every one of them hashed, and the only unhashed rules are two `:root` blocks
 * that declare `--agentation-color-*` and nothing else. So nothing it injects
 * can match an element of either studio scene, which is the collision ADR 0037
 * and `npm run check:scenes` exist for.
 */

import { createElement, type FunctionComponent } from 'react'
import { createRoot } from 'react-dom/client'
import { Agentation, type AgentationProps } from 'agentation'

/**
 * The toolbar, retyped so `createElement` will take props for it.
 *
 * The package declares its props parameter as optional
 * (`PageFeedbackToolbarCSS(props?: AgentationProps)`), and a function whose
 * props are optional is not a `FunctionComponent<P>`, so React's overloads fall
 * through to the one that accepts only `Attributes`. The cast asserts the thing
 * the declaration already says, that this component's props are
 * `AgentationProps`, and it is here with a name rather than inline so that it is
 * one assertion in one place.
 */
const Toolbar = Agentation as FunctionComponent<AgentationProps>

/** The host element's id, so a second call finds the first one's root. */
const HOST_ID = 'agentation-host'

/**
 * Where annotations are posted, compiled in by `build-client.mjs --dev` from
 * `scripts/agentation-endpoint.mjs`, and `''` when sync is turned off.
 *
 * The toolbar takes it as a React prop, so there is nowhere to read it from at
 * run time; the define is the only seam. It is declared rather than imported
 * because it does not exist as a module: esbuild substitutes the literal, and
 * `main.ts` never sees this file, so the release bundle has no such identifier
 * to substitute.
 */
declare const __AGENTATION_ENDPOINT__: string

/**
 * Put the toolbar on the page.
 *
 * Idempotent, because the dev entry is a module and a page that somehow
 * evaluated it twice should get one toolbar rather than two stacked on each
 * other. It returns rather than throwing when the host is already there: this
 * is a development affordance and a thrown error here would take the studio
 * down with it.
 */
export function mountFeedbackOverlay(): void {
  if (document.getElementById(HOST_ID) !== null) return

  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.append(host)

  // `endpoint` is what makes an annotation arrive somewhere rather than only on
  // the clipboard: `agentation-mcp` listens on it, keeps the annotations, and
  // offers them to an agent over MCP. It is omitted rather than passed empty
  // when sync is off, because the toolbar reads the prop's presence to decide
  // whether to show a connection state at all.
  //
  // Nothing here depends on the server being up. Read out of the package on
  // 2026-09-07: a failed session creation is caught and logged as "using local
  // storage", and a failed health check sets the status to disconnected. The
  // toolbar goes on annotating, `copyToClipboard` still defaults to true, and
  // the annotations still live in `localStorage`.
  const props: AgentationProps =
    __AGENTATION_ENDPOINT__ === '' ? {} : { endpoint: __AGENTATION_ENDPOINT__ }
  createRoot(host).render(createElement(Toolbar, props))
}
