/**
 * The order the keyboard walks the canvas in, without a browser.
 *
 * The canvas is a plane and a keyboard is a line, so reaching every object with
 * arrow keys means choosing a line through the plane. This file is that choice
 * and nothing else: it takes rectangles in model coordinates and returns them
 * in an order, and it never touches the DOM. `canvas.ts` builds the list from
 * what it has drawn and asks this file which object is next.
 *
 * **Top edge first, then left edge.** A person scanning a diagram starts at the
 * top-left and works across and down, and this is that, taken from the corner
 * each object is placed by rather than from its middle. Both are read exactly,
 * with no tolerance band: two boxes twenty pixels apart vertically are two rows
 * here even when they look like one row on screen. That costs something real
 * and it buys something worth more. In `examples/shop` the two notes sit at
 * `y: 320` and two tables at `y: 340`, so the notes are walked before those
 * tables rather than after them, which is a surprise of twenty pixels. A
 * tolerance that fixed it would need a number nobody can derive, would make the
 * order depend on which object the sweep happened to start from, and would
 * change what "next" means as a box is dragged. An exact order is the same on
 * every machine, after every reload, and is a sort rather than a heuristic.
 *
 * **The name is the last tie-break, so the order is total.** Two objects at the
 * same corner would otherwise be ordered by whatever the map iterated first,
 * and a ring whose order changes between two presses of the same key is worse
 * than one that is merely surprising. Kind is compared before name so that a
 * table and a note of the same name at the same point still have one answer.
 *
 * **The ring wraps.** These are peers on a plane with no first and no last, and
 * the alternative is a person pressing Down at the bottom and being told
 * nothing at all. `Home` and `End` are what reach the ends deliberately.
 */

import type { ObjectKind } from '../../model/types.js'
import type { Rect } from './geometry.js'

/** One object the keyboard can reach, and the rectangle it occupies. */
export interface Reachable {
  readonly kind: ObjectKind
  readonly name: string
  readonly rect: Rect
}

/** The order above, as a new array. The argument is not modified. */
export function readingOrder(objects: readonly Reachable[]): Reachable[] {
  return [...objects].sort(
    (a, b) =>
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x ||
      compare(a.kind, b.kind) ||
      compare(a.name, b.name),
  )
}

/** Where `kind` and `name` sit in `order`, or -1 when they are not in it. */
export function positionOf(
  order: readonly Reachable[],
  kind: ObjectKind,
  name: string,
): number {
  return order.findIndex((object) => object.kind === kind && object.name === name)
}

/**
 * The object `steps` along the ring from `from`, wrapping at both ends.
 *
 * `from` of -1 means nothing is on the ring yet, and then a step forwards is
 * the first object and a step backwards is the last. That is what makes the
 * first arrow press after a reload land somewhere rather than nowhere.
 */
export function stepFrom(
  order: readonly Reachable[],
  from: number,
  steps: 1 | -1,
): Reachable | undefined {
  if (order.length === 0) return undefined
  if (from < 0) return steps === 1 ? order[0] : order[order.length - 1]
  return order[(from + steps + order.length) % order.length]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
