import { describe, expect, it } from 'vitest'
import type { Table } from '../../src/model/types.js'
import {
  boundsOf,
  clampScale,
  fitTo,
  stepScale,
  toModel,
  toScreen,
  zoomAbout,
  type Point,
  type Rect,
  type Viewport,
} from '../../src/studio/client/geometry.js'
import { placeTables } from '../../src/studio/client/place.js'
import {
  edgeSpecsOf,
  routeEdges,
  type EdgeSpec,
  type RoutedEdge,
  type TableBox,
} from '../../src/studio/client/edges.js'
import {
  EMPTY_GROUP,
  GROUP_PADDING,
  groupBoxes,
  type GroupBox,
} from '../../src/studio/client/groups.js'
import {
  PALETTE,
  PLAIN_TINT,
  tintClass,
  unknownColorNote,
} from '../../src/studio/client/palette.js'

/**
 * The canvas without a browser.
 *
 * Everything a screenshot cannot prove and a click can only prove once: the
 * coordinate conversion at zoom levels other than 1, the placement of a table
 * whose file has no `layout`, and the fact that an edge starts and ends on the
 * rows of the two columns it is about and stays there when a box moves. The
 * drawing, the measurement of a row and the pointer handling are in
 * `canvas.ts`, need a DOM, and are proven by driving the studio.
 */

const ORIGIN: Point = { x: 37, y: 61 }

function viewport(scale: number, pan: Point = { x: -120, y: 88 }): Viewport {
  return { scale, pan }
}

function table(name: string, columns: Table['columns'], layout?: { x: number; y: number }): Table {
  return {
    kind: 'table',
    name,
    path: `tables/${name}.md`,
    body: '\n',
    complete: true,
    columns,
    indexes: [],
    ...(layout === undefined ? {} : { layout }),
  }
}

function starts(d: string): Point {
  const match = /^M (-?[\d.]+),(-?[\d.]+)/.exec(d)
  if (match === null) throw new Error(`not a path: ${d}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** The last point of the curve, which is the end the arrowhead is on. */
function ends(d: string): Point {
  const match = /(-?[\d.]+),(-?[\d.]+)$/.exec(d)
  if (match === null) throw new Error(`not a path: ${d}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

describe('coordinates', () => {
  for (const scale of [0.5, 1, 2]) {
    it(`converts back and forth without drift at zoom ${scale}`, () => {
      const view = viewport(scale)
      const model = { x: 412.5, y: -87.25 }
      const round = toModel(toScreen(model, ORIGIN, view), ORIGIN, view)
      expect(round.x).toBeCloseTo(model.x, 9)
      expect(round.y).toBeCloseTo(model.y, 9)
    })

    it(`keeps the grabbed point of a box under the pointer at zoom ${scale}`, () => {
      // The drag, exactly as `canvas.ts` does it: the offset from the box's
      // corner to the pointer is taken once, in model units, and every move is
      // the model point under the pointer minus that offset. A conversion that
      // forgot the scale would move the box by the screen delta instead.
      const view = viewport(scale)
      const start = { x: 300, y: 200 }
      const down = toScreen({ x: start.x + 40, y: start.y + 12 }, ORIGIN, view)
      const grab = {
        x: toModel(down, ORIGIN, view).x - start.x,
        y: toModel(down, ORIGIN, view).y - start.y,
      }

      const moved = { x: down.x + 90, y: down.y - 30 }
      const at = toModel(moved, ORIGIN, view)
      const next = { x: at.x - grab.x, y: at.y - grab.y }

      expect(next.x).toBeCloseTo(start.x + 90 / scale, 9)
      expect(next.y).toBeCloseTo(start.y - 30 / scale, 9)
      // And the pointer is still over the same point of the box.
      expect(toScreen({ x: next.x + 40, y: next.y + 12 }, ORIGIN, view).x).toBeCloseTo(moved.x, 9)
      expect(toScreen({ x: next.x + 40, y: next.y + 12 }, ORIGIN, view).y).toBeCloseTo(moved.y, 9)
    })
  }

  it('zooms about the pointer, so what is under it stays under it', () => {
    const before = viewport(1)
    const pointer = { x: 640, y: 400 }
    const anchor = toModel(pointer, ORIGIN, before)
    for (const scale of [0.5, 2, 3]) {
      const after = zoomAbout(before, ORIGIN, pointer, scale)
      const still = toModel(pointer, ORIGIN, after)
      expect(still.x).toBeCloseTo(anchor.x, 9)
      expect(still.y).toBeCloseTo(anchor.y, 9)
      expect(after.scale).toBe(scale)
    }
  })

  it('clamps a zoom that would turn the model into a dot or a wall', () => {
    expect(clampScale(0.001)).toBe(0.25)
    expect(clampScale(50)).toBe(3)
    expect(clampScale(Number.NaN)).toBe(1)
  })

  it('steps to exactly a half and exactly a double, which is what gets checked', () => {
    expect(stepScale(stepScale(1, -1), -1)).toBe(0.5)
    expect(stepScale(stepScale(1, 1), 1)).toBe(2)
    expect(stepScale(3, 1)).toBe(3)
    expect(stepScale(0.25, -1)).toBe(0.25)
  })

  it('fits the content into the viewport it was given', () => {
    const content: Rect = { x: 100, y: 100, w: 2000, h: 1000 }
    const view = fitTo(content, { w: 1200, h: 800 })
    const topLeft = toScreen({ x: content.x, y: content.y }, { x: 0, y: 0 }, view)
    const bottomRight = toScreen(
      { x: content.x + content.w, y: content.y + content.h },
      { x: 0, y: 0 },
      view,
    )
    expect(topLeft.x).toBeGreaterThanOrEqual(0)
    expect(topLeft.y).toBeGreaterThanOrEqual(0)
    expect(bottomRight.x).toBeLessThanOrEqual(1200)
    expect(bottomRight.y).toBeLessThanOrEqual(800)
  })

  it('has no bounds for nothing, rather than a rectangle at infinity', () => {
    expect(boundsOf([])).toBeUndefined()
  })
})

describe('placement', () => {
  const laidOut = table('orders', [], { x: 480, y: 340 })
  const loose = ['a', 'b', 'c'].map((name) => table(name, []))

  it('leaves a table where its file put it', () => {
    expect(placeTables([laidOut]).get('orders')).toEqual({ x: 480, y: 340 })
  })

  it('places a table with no layout on a grid, and in the same place twice', () => {
    const first = placeTables(loose)
    const second = placeTables(loose)
    expect([...first.values()]).toEqual([...second.values()])
    expect(new Set([...first.values()].map((p) => `${p.x},${p.y}`)).size).toBe(3)
  })

  it('puts the unplaced tables clear of the ones somebody arranged', () => {
    const placed = placeTables([laidOut, ...loose])
    for (const name of ['a', 'b', 'c']) {
      expect(placed.get(name)?.y).toBeGreaterThan(340)
    }
  })
})

describe('edges', () => {
  /**
   * A box, with a row per column, standing in for a measurement of the page.
   *
   * `canvas.ts` reads these offsets out of the DOM, because how tall a row is
   * depends on the font the browser picked. What the arithmetic here needs is
   * only that each column has a distinct offset inside its box, so the numbers
   * are made up and evenly spaced. ADR 0018.
   */
  const HEADER = 14
  const FIRST_ROW = 30
  const ROW_PITCH = 20

  function boxOf(x: number, y: number, columns: readonly string[]): TableBox {
    return {
      x,
      y,
      w: 220,
      h: FIRST_ROW + columns.length * ROW_PITCH + 8,
      header: HEADER,
      rows: new Map(columns.map((name, index) => [name, FIRST_ROW + index * ROW_PITCH])),
    }
  }

  function rowY(box: TableBox, column: string): number {
    const row = box.rows.get(column)
    if (row === undefined) throw new Error(`the fixture has no row for ${column}`)
    return box.y + row
  }

  function only(routed: readonly RoutedEdge[]): RoutedEdge {
    const edge = routed[0]
    if (edge === undefined || routed.length !== 1) {
      throw new Error(`one edge was expected, got ${routed.length}`)
    }
    return edge
  }

  function both(routed: readonly RoutedEdge[]): readonly [RoutedEdge, RoutedEdge] {
    const [first, second] = routed
    if (first === undefined || second === undefined || routed.length !== 2) {
      throw new Error(`two edges were expected, got ${routed.length}`)
    }
    return [first, second]
  }

  const orders = boxOf(0, 0, ['id', 'customer_id', 'billed_to', 'parent_id'])
  const customers = boxOf(600, 0, ['id', 'email', 'last_order'])
  const canvas = new Map<string, TableBox>([
    ['orders', orders],
    ['customers', customers],
  ])

  const ordersToCustomers: EdgeSpec = {
    from: { table: 'orders', column: 'customer_id' },
    to: { table: 'customers', column: 'id' },
  }

  it('reads every ref, in the order the model holds them', () => {
    const specs = edgeSpecsOf([
      table('orders', [
        { name: 'id', type: 'uuid', pk: true },
        { name: 'customer_id', type: 'uuid', ref: { table: 'customers', column: 'id' } },
      ]),
    ])
    expect(specs).toEqual([
      {
        from: { table: 'orders', column: 'customer_id' },
        to: { table: 'customers', column: 'id' },
      },
    ])
  })

  it('leaves and arrives at the rows of the two columns, not the middles of the boxes', () => {
    const edge = only(routeEdges([ordersToCustomers], canvas))
    expect(starts(edge.d).y).toBe(rowY(orders, 'customer_id'))
    expect(ends(edge.d).y).toBe(rowY(customers, 'id'))
    // The bug this replaced, named so that reintroducing it fails here rather
    // than in a screenshot: both ends were the centre of their box.
    expect(starts(edge.d).y).not.toBe(orders.y + orders.h / 2)
    expect(ends(edge.d).y).not.toBe(customers.y + customers.h / 2)
    expect(edge.unanchored).toEqual([])
  })

  it('keeps both ends on their rows when a box moves, which is the half that is hard', () => {
    const moved = new Map(canvas)
    moved.set('orders', { ...orders, x: orders.x + 137, y: orders.y + 240 })
    const before = only(routeEdges([ordersToCustomers], canvas))
    const after = only(routeEdges([ordersToCustomers], moved))
    expect(starts(after.d).y).toBe(starts(before.d).y + 240)
    expect(starts(after.d).x).toBe(starts(before.d).x + 137)
    // And the end did not move, because the box it is on did not.
    expect(ends(after.d)).toEqual(ends(before.d))
  })

  it('draws two refs on different columns from the two rows they are about', () => {
    const routed = routeEdges(
      [
        ordersToCustomers,
        { from: { table: 'orders', column: 'billed_to' }, to: ordersToCustomers.to },
      ],
      canvas,
    )
    const [first, second] = both(routed)
    expect(starts(first.d).y).toBe(rowY(orders, 'customer_id'))
    expect(starts(second.d).y).toBe(rowY(orders, 'billed_to'))
    expect(first.d).not.toBe(second.d)
  })

  it('separates a mutual reference, which is the pair most often drawn as one', () => {
    const routed = routeEdges(
      [
        ordersToCustomers,
        {
          from: { table: 'customers', column: 'last_order' },
          to: { table: 'orders', column: 'id' },
        },
      ],
      canvas,
    )
    const [first, second] = both(routed)
    // Four rows, so four anchors, so two lines. The sideways offset is not what
    // separates these any more and is deliberately not applied: the row each leg
    // leaves is already somewhere the other leg is not.
    expect(starts(first.d).y).toBe(rowY(orders, 'customer_id'))
    expect(ends(first.d).y).toBe(rowY(customers, 'id'))
    expect(starts(second.d).y).toBe(rowY(customers, 'last_order'))
    expect(ends(second.d).y).toBe(rowY(orders, 'id'))
    expect(first.at).not.toEqual(second.at)
  })

  it('fans the one pair the rows cannot separate: two edges on the same two columns', () => {
    // Each side names the other's exact column, so both legs run between the
    // same two points and only the sideways offset tells them apart. The offset
    // is taken from the two table names in a fixed order rather than from the
    // direction each edge is read in (ADR 0015); derived from the edge it flips
    // on the return leg, the two shifts cancel, and this is drawn as one line.
    const routed = routeEdges(
      [ordersToCustomers, { from: ordersToCustomers.to, to: ordersToCustomers.from }],
      canvas,
    )
    const [first, second] = both(routed)
    expect(Math.abs(first.at.y - second.at.y)).toBeGreaterThanOrEqual(16)
    // And the fan did it by bowing the curve, so both ends are still on their
    // rows. Moving an end sideways to make room is the change this undoes.
    expect(starts(first.d).y).toBe(rowY(orders, 'customer_id'))
    expect(ends(second.d).y).toBe(rowY(orders, 'customer_id'))
    expect(ends(first.d).y).toBe(rowY(customers, 'id'))
    expect(starts(second.d).y).toBe(rowY(customers, 'id'))
  })

  it('loops a self reference from one of its rows to another', () => {
    const edge = only(
      routeEdges(
        [{ from: { table: 'orders', column: 'parent_id' }, to: { table: 'orders', column: 'id' } }],
        canvas,
      ),
    )
    expect(starts(edge.d).x).toBeGreaterThanOrEqual(orders.w)
    expect(starts(edge.d).y).toBe(rowY(orders, 'parent_id'))
    expect(ends(edge.d).y).toBe(rowY(orders, 'id'))
  })

  it('takes the same side of both boxes when one is stacked above the other', () => {
    const below = new Map<string, TableBox>([
      ['orders', orders],
      ['customers', boxOf(orders.x, orders.y + 400, ['id', 'email', 'last_order'])],
    ])
    const edge = only(routeEdges([ordersToCustomers], below))
    // Crossing both boxes to reach the far edge is longer and reads as a line
    // that missed, so the two anchors are on the same border.
    expect(starts(edge.d).x).toBe(ends(edge.d).x)
    expect(starts(edge.d).x).toBeGreaterThan(orders.x + orders.w)
  })

  it('points at the table name, and says which column is missing, when there is no row', () => {
    const edge = only(
      routeEdges(
        [
          {
            from: { table: 'orders', column: 'customer_id' },
            to: { table: 'customers', column: 'nope' },
          },
        ],
        canvas,
      ),
    )
    // The header, which is visibly the table rather than a column. The centre of
    // the box is the one answer ruled out: that is the old bug in a disguise.
    expect(ends(edge.d).y).toBe(customers.y + HEADER)
    expect(ends(edge.d).y).not.toBe(customers.y + customers.h / 2)
    expect(edge.unanchored).toEqual(['customers.nope'])
  })

  it('keeps an anchor on the box when a row offset is older than the box it is in', () => {
    // A column removed from a live table shrinks the box before the next
    // measurement lands, so an offset can name a row past the bottom.
    const stale = new Map<string, TableBox>([
      ['orders', orders],
      ['customers', { ...customers, h: 40 }],
    ])
    const edge = only(routeEdges([ordersToCustomers], stale))
    expect(ends(edge.d).y).toBeLessThanOrEqual(customers.y + 40)
    expect(ends(edge.d).y).toBeGreaterThanOrEqual(customers.y)
  })

  it('drops an edge to a table that is not on the canvas rather than drawing to nowhere', () => {
    const routed = routeEdges(
      [{ from: { table: 'orders', column: 'x' }, to: { table: 'gone', column: 'id' } }],
      canvas,
    )
    expect(routed).toEqual([])
  })

  it('starts and ends outside the boxes it joins', () => {
    const edge = only(routeEdges([ordersToCustomers], canvas))
    expect(starts(edge.d).x).toBeGreaterThan(orders.x + orders.w)
    expect(ends(edge.d).x).toBeLessThan(customers.x)
  })
})

/**
 * A group's box, which is the one thing on this canvas that is computed and
 * never stored.
 *
 * This is the half of dbmd-34 a screenshot cannot prove. A picture shows a box
 * around three tables; what it cannot show is that the box came out of the
 * three tables rather than out of a file, which is the difference between ADR
 * 0005 being implemented and ADR 0005 being drawn.
 */
describe('a group has no coordinates', () => {
  const at = (x: number, y: number): Rect => ({ x, y, w: 200, h: 100 })

  function oneBox(boxes: readonly GroupBox[]): GroupBox {
    const box = boxes[0]
    if (box === undefined || boxes.length !== 1) {
      throw new Error(`one group box was expected, got ${boxes.length}`)
    }
    return box
  }

  const three = new Map<string, Rect>([
    ['orders', at(100, 100)],
    ['invoices', at(400, 100)],
    ['payments', at(100, 300)],
  ])
  const members = new Map<string, readonly string[]>([
    ['billing', ['orders', 'invoices', 'payments']],
  ])

  it('is the bounding box of its members plus padding', () => {
    const box = oneBox(groupBoxes(['billing'], members, three))
    expect(box.rect).toEqual({
      x: 100 - GROUP_PADDING,
      y: 100 - GROUP_PADDING,
      w: 500 + GROUP_PADDING * 2,
      h: 300 + GROUP_PADDING * 2,
    })
  })

  it('follows a member that moved, because it is recomputed rather than kept', () => {
    // The whole of the drag: the same function, fresher rectangles, and nothing
    // anywhere holding on to the previous answer.
    const dragged = new Map(three).set('payments', at(100, 900))
    const box = oneBox(groupBoxes(['billing'], members, dragged))
    expect(box.rect.h).toBe(900 + 100 - 100 + GROUP_PADDING * 2)
  })

  it('is the same box for the same members, on every call and every machine', () => {
    expect(groupBoxes(['billing'], members, three)).toEqual(groupBoxes(['billing'], members, three))
  })

  it('skips a member the canvas has no box for rather than bounding the origin', () => {
    // A table that declared `group:` and did not parse has no box. Treating a
    // missing rectangle as (0, 0) would swell the group all the way to the
    // origin, which is a lie about where the group is rather than a gap in it.
    const missing = new Map(three)
    missing.delete('payments')
    const box = oneBox(groupBoxes(['billing'], members, missing))
    expect(box.rect.x).toBe(100 - GROUP_PADDING)
    expect(box.rect.y).toBe(100 - GROUP_PADDING)
  })

  it('gives an empty group a placeholder box below the content, not nothing', () => {
    // A group whose last member left has not been deleted, and a canvas that
    // drew nothing would say it had.
    const box = oneBox(groupBoxes(['billing'], new Map([['billing', []]]), three))
    expect(box.members).toEqual([])
    expect(box.rect.w).toBe(EMPTY_GROUP.w)
    expect(box.rect.h).toBe(EMPTY_GROUP.h)
    expect(box.rect.y).toBeGreaterThan(300 + 100)
  })

  it('puts two empty groups in different places, in the order it was given them', () => {
    const boxes = groupBoxes(
      ['a', 'b'],
      new Map([
        ['a', []],
        ['b', []],
      ]),
      three,
    )
    expect(boxes.map((box) => box.name)).toEqual(['a', 'b'])
    expect(boxes[0]?.rect.y).toBe(boxes[1]?.rect.y)
    expect(boxes[0]?.rect.x).toBeLessThan(boxes[1]?.rect.x ?? 0)
  })

  it('places an empty group somewhere even when there is no content at all', () => {
    const box = oneBox(groupBoxes(['billing'], new Map([['billing', []]]), new Map()))
    expect(Number.isFinite(box.rect.x)).toBe(true)
    expect(Number.isFinite(box.rect.y)).toBe(true)
  })
})

describe('the colour palette', () => {
  it('paints a name from the list, and nothing else', () => {
    expect(tintClass('amber')).toBe('tint-amber')
    expect(tintClass(undefined)).toBe(PLAIN_TINT)
  })

  it('draws a colour it does not know plainly, and says so rather than rewriting it', () => {
    // `docs/format.md` carries `color` through without validating it, so a model
    // that says `color: seafoam` has to open. Refusing it here would make the
    // studio a narrower reader than `dbmd check`.
    expect(tintClass('seafoam')).toBe(PLAIN_TINT)
    expect(unknownColorNote('seafoam')).toContain('seafoam')
    expect(unknownColorNote('amber')).toBeUndefined()
  })

  it('offers names rather than hex values, because the diff is the point', () => {
    for (const color of PALETTE) expect(color).toMatch(/^[a-z]+$/)
  })
})
