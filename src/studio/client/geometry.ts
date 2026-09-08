/**
 * Screen coordinates to model coordinates, and back, in one place.
 *
 * The canvas is a CSS transform: one element is translated and scaled, and the
 * boxes inside it are positioned in model coordinates and never think about the
 * viewport. That is what makes pan and zoom cheap, and it is also the classic
 * source of the box that jumps on pointerdown or drifts away from the cursor at
 * any zoom that is not 1. The bug is always the same one: two places converted
 * a coordinate and one of them forgot the scale, or the pan, or the position of
 * the canvas on the page.
 *
 * So there is one conversion, it is `toModel`, and every interaction goes
 * through it. `toScreen` is its exact inverse and exists so a test can say so.
 *
 * Three things go into a conversion and all three are separate arguments rather
 * than fields on one object, because they come from three different places and
 * have three different lifetimes:
 *
 * - `screen` is a pointer event's `clientX`/`clientY`, which is viewport-relative.
 * - `origin` is where the canvas element's top-left is in that same space, from
 *   `getBoundingClientRect`. It changes when the page is resized or scrolled.
 * - `viewport` is what the developer panned and zoomed to, which is the only
 *   part the canvas owns.
 *
 * Nothing in this file touches the DOM, so it is testable without a browser,
 * which is the point: this is the arithmetic that a screenshot cannot prove.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Size {
  readonly w: number
  readonly h: number
}

/** A box in model coordinates: where it is and how big it turned out to be. */
export interface Rect extends Point, Size {}

/** Where the canvas is looking. `pan` is in screen pixels, applied after `scale`. */
export interface Viewport {
  readonly pan: Point
  readonly scale: number
}

/**
 * The zoom steps the buttons walk.
 *
 * A ladder rather than a multiplier, so that "zoom out twice" lands on exactly
 * 0.5 on every machine. A drag at 0.5 and at 2 is the thing most likely to be
 * broken and least likely to be tested, and a reproducible way to get to those
 * two numbers is what makes checking it a click rather than a measurement.
 */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]

export const MIN_SCALE = 0.25
export const MAX_SCALE = 3

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** The screen point `screen` as a point on the model. */
export function toModel(screen: Point, origin: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - origin.x - viewport.pan.x) / viewport.scale,
    y: (screen.y - origin.y - viewport.pan.y) / viewport.scale,
  }
}

/** The exact inverse of `toModel`. */
export function toScreen(model: Point, origin: Point, viewport: Viewport): Point {
  return {
    x: model.x * viewport.scale + viewport.pan.x + origin.x,
    y: model.y * viewport.scale + viewport.pan.y + origin.y,
  }
}

/**
 * Zoom so that whatever is under `screen` stays under `screen`.
 *
 * Zooming to the centre of the element is easier and feels broken: the thing
 * the developer is pointing at slides away as they zoom towards it.
 */
export function zoomAbout(
  viewport: Viewport,
  origin: Point,
  screen: Point,
  scale: number,
): Viewport {
  const next = clampScale(scale)
  const anchor = toModel(screen, origin, viewport)
  return {
    scale: next,
    pan: {
      x: screen.x - origin.x - anchor.x * next,
      y: screen.y - origin.y - anchor.y * next,
    },
  }
}

/** Move the view by a screen-space delta, which is what a pan drag produces. */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { scale: viewport.scale, pan: { x: viewport.pan.x + dx, y: viewport.pan.y + dy } }
}

/** The next step up or down the zoom ladder, or the current scale at either end. */
export function stepScale(scale: number, direction: 1 | -1): number {
  const steps = direction === 1 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
  const found = steps.find((step) =>
    direction === 1 ? step > scale + 0.001 : step < scale - 0.001,
  )
  return found ?? clampScale(scale)
}

/** The smallest rectangle holding all of `rects`, or `undefined` when there are none. */
export function boundsOf(rects: Iterable<Rect>): Rect | undefined {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.w)
    bottom = Math.max(bottom, rect.y + rect.h)
  }
  if (left === Infinity) return undefined
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * The scale that would show all of `content` inside `into`, before the zoom
 * floor has its say.
 *
 * Split out of `fitTo` so that a caller can ask the one question `fitTo`'s
 * answer cannot be read for: below `MIN_SCALE` this and the scale actually used
 * are different numbers, and that difference is the whole of "**Fit** could not
 * fit". Capped at 1 for the same reason `fitTo` caps it, which is that a model
 * of two tables blown up to fill a monitor is not what anybody meant by fit.
 */
export function fitScale(content: Rect, into: Size, margin = 48): number {
  const usableWidth = Math.max(1, into.w - margin * 2)
  const usableHeight = Math.max(1, into.h - margin * 2)
  return Math.min(usableWidth / Math.max(1, content.w), usableHeight / Math.max(1, content.h), 1)
}

/** The viewport that shows all of `content` inside `into`, with a margin. */
export function fitTo(content: Rect, into: Size, margin = 48): Viewport {
  const scale = clampScale(fitScale(content, into, margin))
  return {
    scale,
    pan: {
      x: (into.w - content.w * scale) / 2 - content.x * scale,
      y: (into.h - content.h * scale) / 2 - content.y * scale,
    },
  }
}

/**
 * How many of `rects` have any of themselves inside `into` at this viewport.
 *
 * Touching counts. The question this answers is "how much of the model can the
 * person see", and a box with a corner on screen is a box they can see and
 * click; counting only the wholly visible ones would understate it by a row and
 * a column every time.
 *
 * Here rather than in `canvas.ts` because it is the same conversion `toScreen`
 * does, and because what it is for is a sentence that has to be right, which
 * means it has to be provable without a browser.
 */
export function visibleCount(rects: Iterable<Rect>, into: Size, viewport: Viewport): number {
  let shown = 0
  for (const rect of rects) {
    const left = rect.x * viewport.scale + viewport.pan.x
    const top = rect.y * viewport.scale + viewport.pan.y
    const right = left + rect.w * viewport.scale
    const bottom = top + rect.h * viewport.scale
    if (right > 0 && left < into.w && bottom > 0 && top < into.h) shown += 1
  }
  return shown
}

/**
 * What a fit managed, which is not always what it was asked for.
 *
 * Counted after the viewport moved rather than predicted from the bounds: the
 * rectangles are the ones the browser measured, so this is what is on screen
 * and not what ought to be. `Canvas.fit` is what fills it in and re-exports
 * this type; it lives here because `didNotFitNotice` is the only thing that
 * reads it, and the question of whether there is a sentence to say has to be
 * answerable without a browser.
 */
export interface FitReport {
  /** Objects with any part of themselves inside the canvas afterwards. */
  readonly shown: number
  /** Objects on the canvas at all: tables, notes and group boxes. */
  readonly total: number
  /** The fit wanted a scale below `MIN_SCALE` and was refused it. */
  readonly clamped: boolean
}

/**
 * What the page says when **Fit** ran out of zoom before it ran out of model,
 * and `undefined` when it did not.
 *
 * `fitTo` clamps at `MIN_SCALE`, and until now that was the end of it: on a
 * six-hundred-table import the button moved the view, left 530 boxes off the
 * bottom of the window and said nothing at all, so the only reading available
 * was that Fit had worked and there was nothing else there. A create that said
 * `Creating tables/x.md.` fifteen seconds after the file existed was treated as
 * a defect for the same reason and ADR 0074 came out of it; this is that shape
 * of problem with the sentence missing rather than stale. ADR 0075.
 *
 * It says the count rather than "some objects are off screen" because the count
 * is what tells a person which of the two situations they are in: two boxes
 * over the edge is a scroll, and five hundred is a model nobody is going to
 * read at this size. And it says what to do, because the answer is not the one
 * the toolbar suggests: zooming out further is refused on purpose, so the way
 * to the rest is the keyboard walk the canvas already describes.
 *
 * **Both halves of "it was not far enough" are asked here, and the second one
 * is what this used to leave to the caller.** `clamped` says the zoom floor had
 * its say; it does not say the floor cost anything, and on a small model in a
 * small window it costs nothing at all. `examples/shop` is eleven objects that
 * need a scale below 25% to sit inside the fit's margin and fit inside the
 * canvas anyway once the margin is spent, so the first draw at 420 by 300 said
 * *11 of the 11 objects on the canvas are on screen and the rest are past the
 * edges*, with no rest. Measured at three window sizes, and on the first draw,
 * where nobody pressed anything and so nobody is owed an explanation at all.
 * ADR 0075's amendment.
 *
 * So the sentence and the condition for saying it are one function. They were
 * two, the caller held the condition, and the condition it held was not the one
 * the sentence claims: that is the shape of defect worth not repeating, rather
 * than the missing comparison itself.
 */
export function didNotFitNotice(report: FitReport): string | undefined {
  if (!report.clamped || report.shown >= report.total) return undefined
  const floor = `${Math.round(MIN_SCALE * 100)}%`
  return (
    `Fit is as far out as this page goes, and it was not far enough: ${report.shown} of the ` +
    `${report.total} objects on the canvas are on screen and the rest are past the edges. The ` +
    `zoom stops at ${floor} so that a box still says what it is, so the way to the others is ` +
    `the arrow keys, which walk to one object at a time and bring it into view.`
  )
}

/**
 * The smallest change to the pan that brings `rect` inside `into`.
 *
 * The scale is not touched. This is for a keyboard walking from one object to
 * the next, where the answer to "I cannot see it" is to move the paper, and
 * never to change how big everything is under somebody who did not ask.
 *
 * It is needed because the canvas deliberately cannot scroll. `#canvas` is
 * `overflow: clip` precisely so nothing can move the content behind the one
 * transform that owns pan, and the browser's own "scroll the focused element
 * into view" is one of the things that would. So focusing an object that is
 * off-screen would put a focus ring where nobody can see it, and this is what
 * puts it on screen instead. dbmd-y6k.
 *
 * A rectangle already inside the margin gives the viewport back unchanged, so a
 * step between two objects that are both on screen moves nothing at all. A
 * rectangle too large for the room it has is aligned to its top-left corner,
 * which is where a table's name and a group's label are: showing the corner
 * that says what the thing is beats centring a box whose middle says nothing.
 */
export function panToReveal(viewport: Viewport, into: Size, rect: Rect, margin = 32): Viewport {
  return {
    scale: viewport.scale,
    pan: {
      x: reveal(viewport.pan.x, viewport.scale, into.w, rect.x, rect.w, margin),
      y: reveal(viewport.pan.y, viewport.scale, into.h, rect.y, rect.h, margin),
    },
  }
}

function reveal(
  pan: number,
  scale: number,
  extent: number,
  at: number,
  size: number,
  margin: number,
): number {
  // Two bounds on the pan, from the two edges of the rectangle. Any pan at or
  // above `least` keeps the near edge inside the margin; any pan at or below
  // `most` keeps the far edge inside it.
  const least = margin - at * scale
  const most = extent - margin - (at + size) * scale
  // `least` above `most` is the arithmetic saying the rectangle is larger than
  // the room it has. Both edges cannot be shown, and the near one wins.
  if (least > most) return least
  return Math.min(most, Math.max(least, pan))
}
