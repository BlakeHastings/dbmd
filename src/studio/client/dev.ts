/**
 * The development entry point: the studio page, plus the feedback overlay.
 *
 * `main.ts` is the release entry and this file is the other one. The whole
 * point of the arrangement is the direction of these two imports: this file
 * imports `main.ts`, and nothing imports this file. `main.ts` therefore has no
 * path to `feedback.ts`, to React or to `agentation`, and the bundle built from
 * it cannot carry them however esbuild is configured. ADR 0064.
 *
 * It is built by `node scripts/build-client.mjs --dev`, into a directory
 * outside `dist/`, and served by `scripts/studio-dev.mjs` through the
 * `clientDir` option `startStudio` already had. `npm run studio:dev` is the one
 * command.
 *
 * The overlay is mounted after the page, not before it. `main.ts` runs its own
 * setup on import, so by the time this line executes the canvas and the
 * inspector are on the page and there is something to point at.
 */

import './main.js'
import { mountFeedbackOverlay } from './feedback.js'

mountFeedbackOverlay()
