/**
 * Turning `ref`s into paths that arrive at the column they are about.
 *
 * A relationship is a column saying `ref: customers.id` (ADR 0003), so the
 * edges are derived from the tables and never stored. That much is easy. Two
 * things after it are not.
 *
 * **An edge is about a column, and it has to land on one.** Drawn between the
 * centres of two boxes, `orders.customer_id` and `orders.shipping_address_id`
 * are the same line leaving the same place, and the diagram says "orders is
 * related to customers somehow" when the file said exactly which column. So
 * each end is anchored at the row of its own column: the left or right border
 * of the box, at the row's height, because a row is a horizontal band and those
 * are the only two points on the border at the row's height. The side of each
 * box is whichever of the four combinations puts the two anchors closest
 * together, which is right-to-left for boxes side by side and the same side for
 * boxes stacked one above the other, where the alternative crosses both of them
 * to reach the far edge.
 *
 * **Two edges can still share both of their rows.** A mutual reference where
 * each side names the other's exact column has both legs running between the
 * same two points, and rows cannot tell those apart because the rows are the
 * same. So edges are grouped by the unordered pair of ends they join, and each
 * one in a group is bowed sideways by a different amount. The pair is unordered
 * for the reason ADR 0015 gives: a sideways direction taken from the way each
 * edge happens to be read flips on the return leg, the two shifts cancel, and
 * the one pair the offset exists for is the one still drawn as a single line.
 * The bow moves the control points and never the ends, because an end that slid
 * sideways to make room is an end that is no longer on its row.
 *
 * Grouping by ends rather than by tables is what stops a bow being applied where
 * the rows have already done the work: two refs from different columns of the
 * same table are two groups of one, and they separate because they leave
 * different rows rather than because they were pushed apart.
 *
 * A table that references itself gets a loop out of its right-hand side, from
 * one of its rows to another, for the same reason: it is a real relationship
 * and centre to centre it has no length at all.
 *
 * Nothing here touches the DOM. Where a row sits inside a box is a measurement
 * (`canvas.ts` takes it), and this file takes it as a number, so the arithmetic
 * can still be tested without a browser.
 */

import type { Table } from '../../model/types.js'
import type { Point, Rect } from './geometry.js'

export interface Endpoint {
  readonly table: string
  readonly column: string
}

export interface EdgeSpec {
  readonly from: Endpoint
  readonly to: Endpoint
}

/**
 * A table box on the canvas, and where its column rows ended up inside it.
 *
 * `rows` holds each column's row centre as an offset down from `y`. It is a
 * measurement rather than a calculation: a row's height is whatever the browser
 * made it out of the font it chose, and it changes when a column is added or
 * removed. Because the offsets are inside the box, an anchor is
 * `y + rows.get(column)` and moves with the box for free, which is what keeps an
 * arrow on its row through a drag rather than a frame behind it.
 */
export interface TableBox extends Rect {
  /** Each column's row centre, as an offset down from `y`. */
  readonly rows: ReadonlyMap<string, number>
  /** Where to point when a column is not one of `rows`: the header's centre. */
  readonly header: number
}

export interface RoutedEdge extends EdgeSpec {
  /** SVG path data, in model coordinates. */
  readonly d: string
  /** A point on the middle of the path, for a hit target or a label. */
  readonly at: Point
  /**
   * The ends that named a column their table does not have, as `table.column`.
   *
   * Empty for an ordinary edge. It is here rather than swallowed because an
   * edge that could not find its row is drawn at the table's header, and a
   * reader who is not told that will read it as an ordinary table-level arrow,
   * which is the thing this file exists to stop.
   */
  readonly unanchored: readonly string[]
}

/** Far enough apart to be two lines at zoom 0.5, close enough to read as a pair. */
const EDGE_SPACING = 18
/** So a line stops short of the border rather than disappearing under it. */
const BORDER_GAP = 4
/** How far a self-reference loops out of the side of its own box. */
const SELF_LOOP_REACH = 56
/** Short of this the curve leaves the box at an angle and stops naming a row. */
const MIN_REACH = 28
/** Past this the bow is a detour rather than a curve. */
const MAX_REACH = 140

/** The right-hand border of a box, or the left-hand one. */
type Side = 1 | -1

/**
 * The side combinations, in the order ties are broken.
 *
 * Right-to-left first, because that is the reading order of the diagram and the
 * answer for boxes side by side; the same-side pairs last, for boxes stacked one
 * above the other, where they beat crossing both boxes to reach the far edge.
 */
const SIDE_PAIRS: readonly (readonly [Side, Side])[] = [
  [1, -1],
  [-1, 1],
  [1, 1],
  [-1, -1],
]

/**
 * What an end is, as one string, so a pair of ends can be ordered and compared.
 *
 * NUL as the separator, because it is the one character a table or column name
 * cannot contain, so two names cannot join into a key that some other pair also
 * produces. Written as the escape `\0` and never as the byte itself: a source
 * file holding a literal NUL is a binary file to git, and a source file that
 * produces no diff cannot be reviewed, which in this repository is the whole
 * point.
 */
function endKey(end: Endpoint): string {
  return `${end.table}\0${end.column}`
}

/**
 * The two ends an edge joins, in an order that does not depend on which way it
 * is read, so a mutual pair lands in one group and gets one sideways direction.
 */
function fanKey(spec: EdgeSpec): string {
  return leads(spec)
    ? `${endKey(spec.from)}\0${endKey(spec.to)}`
    : `${endKey(spec.to)}\0${endKey(spec.from)}`
}

/** Whether this edge is read in the pair's canonical direction. */
function leads(spec: EdgeSpec): boolean {
  return endKey(spec.from) <= endKey(spec.to)
}

/** Every `ref` on every table, in the model's order, as an edge. */
export function edgeSpecsOf(tables: readonly Table[]): EdgeSpec[] {
  const specs: EdgeSpec[] = []
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.ref === undefined) continue
      specs.push({
        from: { table: table.name, column: column.name },
        to: { table: column.ref.table, column: column.ref.column },
      })
    }
  }
  return specs
}

/**
 * Path data for every edge whose two ends are both on the canvas.
 *
 * An edge naming a table that is not there is dropped rather than drawn to
 * nowhere. Saying that the target does not exist is a diagnostic, and
 * diagnostics belong to the reader (ADR 0008) rather than to a line.
 *
 * Called again for every frame of a drag, from the boxes' current positions, so
 * it is deliberately free of anything to cache between calls.
 */
export function routeEdges(
  specs: readonly EdgeSpec[],
  boxes: ReadonlyMap<string, TableBox>,
): RoutedEdge[] {
  const fans = new Map<string, EdgeSpec[]>()
  for (const spec of specs) {
    if (!boxes.has(spec.from.table) || !boxes.has(spec.to.table)) continue
    const key = fanKey(spec)
    const fan = fans.get(key)
    if (fan === undefined) fans.set(key, [spec])
    else fan.push(spec)
  }

  const routed: RoutedEdge[] = []
  for (const fan of fans.values()) {
    fan.forEach((spec, ordinal) => {
      const from = boxes.get(spec.from.table)
      const to = boxes.get(spec.to.table)
      // Both were in `boxes` when the fan was built, and nothing removes from
      // it in between; the check is here to keep the types honest.
      if (from === undefined || to === undefined) return
      routed.push(
        spec.from.table === spec.to.table
          ? selfLoop(spec, from, ordinal)
          : between(spec, from, to, ordinal, fan.length),
      )
    })
  }
  return routed
}

function between(
  spec: EdgeSpec,
  from: TableBox,
  to: TableBox,
  ordinal: number,
  count: number,
): RoutedEdge {
  const startY = anchorY(from, spec.from.column)
  const endY = anchorY(to, spec.to.column)
  const [fromSide, toSide] = sidesFor(from, startY, to, endY)
  const start: Point = { x: borderX(from, fromSide), y: startY }
  const end: Point = { x: borderX(to, toSide), y: endY }

  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  const along: Point = { x: dx / length, y: dy / length }
  // Sideways is a property of the pair, not of the direction the edge is read
  // in. Taking it from `along` flips it on the return leg of a mutual
  // reference, the two shifts then cancel, and the pair this whole offset
  // exists for is the one pair that comes out as a single line.
  const canonical: Point = leads(spec) ? along : { x: -along.x, y: -along.y }
  const across: Point = { x: -canonical.y, y: canonical.x }

  // Symmetric about the centre line: one edge is centred, two straddle it.
  const shift = (ordinal - (count - 1) / 2) * EDGE_SPACING
  // Applied to the control points and never to the ends, because an end is on a
  // row now and moving it off the row to make room would undo the change this
  // file just made. A cubic's midpoint sits three quarters of the way to the
  // average of its two controls, so 4/3 of the gap at the controls is exactly
  // the gap wanted in the middle.
  const bow = shift * (4 / 3)

  // Out of the side it left, and into the side it arrives at, so the tangent at
  // each end is horizontal and the arrowhead points along the row rather than
  // across it.
  const reach = Math.max(MIN_REACH, Math.min(MAX_REACH, length / 2))
  const control1 = offset(offset(start, { x: fromSide, y: 0 }, reach), across, bow)
  const control2 = offset(offset(end, { x: toSide, y: 0 }, reach), across, bow)
  return {
    ...spec,
    d: `M ${pair(start)} C ${pair(control1)} ${pair(control2)} ${pair(end)}`,
    at: cubicMidpoint(start, control1, control2, end),
    unanchored: unanchoredEnds(spec, from, to),
  }
}

function selfLoop(spec: EdgeSpec, box: TableBox, ordinal: number): RoutedEdge {
  const start: Point = { x: borderX(box, 1), y: anchorY(box, spec.from.column) }
  const end: Point = { x: borderX(box, 1), y: anchorY(box, spec.to.column) }
  // Wider for a loop that spans more rows, so a long one is a curve rather than
  // a sliver pressed against the box, and so two loops on one table that share
  // the column they arrive at are still two arcs.
  const reach = SELF_LOOP_REACH + Math.abs(end.y - start.y) / 3 + ordinal * EDGE_SPACING
  const control1: Point = { x: box.x + box.w + reach, y: start.y }
  const control2: Point = { x: box.x + box.w + reach, y: end.y }
  return {
    ...spec,
    d: `M ${pair(start)} C ${pair(control1)} ${pair(control2)} ${pair(end)}`,
    at: cubicMidpoint(start, control1, control2, end),
    unanchored: unanchoredEnds(spec, box, box),
  }
}

/**
 * Where on the box's border an edge for `column` meets it.
 *
 * The row's own centre when the box has one, and the header's centre when it
 * does not. An edge naming a column its table does not have is still a real
 * thing to draw, because the `ref` is in the file and the reader has already
 * said so as a diagnostic (ADR 0008); what it is not is a thing to draw at a row
 * that does not exist. It goes to the header, which is the table's own name and
 * is visibly not a column row, and `unanchored` is what tells the caller to say
 * so rather than let it pass as an ordinary arrow. Falling back to the centre of
 * the box is the one answer ruled out: that is the bug this file just fixed,
 * wearing a disguise.
 *
 * Clamped into the box because `rows` can be older than `h`: between a column
 * being added to a live table and the next measurement, an offset can name a
 * row past the bottom, and the nearest border is a better answer than a point
 * hanging below the box.
 */
function anchorY(box: TableBox, column: string): number {
  const row = box.rows.get(column) ?? box.header
  return box.y + Math.min(Math.max(row, BORDER_GAP), Math.max(BORDER_GAP, box.h - BORDER_GAP))
}

/** The two ends, if any, that could not be put on a row. */
function unanchoredEnds(spec: EdgeSpec, from: TableBox, to: TableBox): readonly string[] {
  const ends: string[] = []
  if (!from.rows.has(spec.from.column)) ends.push(`${spec.from.table}.${spec.from.column}`)
  if (!to.rows.has(spec.to.column)) ends.push(`${spec.to.table}.${spec.to.column}`)
  return ends
}

/** The pair of sides whose anchors are closest together, ties broken by `SIDE_PAIRS`. */
function sidesFor(from: Rect, startY: number, to: Rect, endY: number): readonly [Side, Side] {
  let chosen: readonly [Side, Side] = [1, -1]
  let shortest = Infinity
  for (const sides of SIDE_PAIRS) {
    const distance = Math.hypot(borderX(to, sides[1]) - borderX(from, sides[0]), endY - startY)
    if (distance < shortest) {
      shortest = distance
      chosen = sides
    }
  }
  return chosen
}

function borderX(box: Rect, side: Side): number {
  return side === 1 ? box.x + box.w + BORDER_GAP : box.x - BORDER_GAP
}

function offset(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance }
}

function cubicMidpoint(p0: Point, p1: Point, p2: Point, p3: Point): Point {
  return {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8,
  }
}

/** Two decimal places is finer than a pixel at maximum zoom and keeps the DOM small. */
function pair(point: Point): string {
  return `${round(point.x)},${round(point.y)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
