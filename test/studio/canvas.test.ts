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
import { edgeSpecsOf, routeEdges } from '../../src/studio/client/edges.js'

/**
 * The canvas without a browser.
 *
 * Everything a screenshot cannot prove and a click can only prove once: the
 * coordinate conversion at zoom levels other than 1, the placement of a table
 * whose file has no `layout`, and the fact that two relationships between the
 * same pair of tables are two lines. The drawing and the pointer handling are
 * in `canvas.ts`, need a DOM, and are proven by driving the studio.
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
  const boxes = new Map<string, Rect>([
    ['orders', { x: 0, y: 0, w: 220, h: 160 }],
    ['customers', { x: 600, y: 0, w: 220, h: 160 }],
  ])

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

  it('draws two relationships between one pair of tables as two lines', () => {
    const routed = routeEdges(
      [
        {
          from: { table: 'orders', column: 'customer_id' },
          to: { table: 'customers', column: 'id' },
        },
        {
          from: { table: 'orders', column: 'billed_to' },
          to: { table: 'customers', column: 'id' },
        },
      ],
      boxes,
    )
    expect(routed).toHaveLength(2)
    const [first, second] = routed
    if (first === undefined || second === undefined) throw new Error('two edges were expected')
    expect(first.d).not.toBe(second.d)
    // Far enough apart to be two lines rather than a thick one, at the ends as
    // well as in the middle: two arrowheads on one pixel read as one edge.
    expect(Math.abs(starts(first.d).y - starts(second.d).y)).toBeGreaterThanOrEqual(16)
  })

  it('separates a mutual reference, which is the pair most often drawn as one', () => {
    const routed = routeEdges(
      [
        {
          from: { table: 'orders', column: 'customer_id' },
          to: { table: 'customers', column: 'id' },
        },
        {
          from: { table: 'customers', column: 'last_order' },
          to: { table: 'orders', column: 'id' },
        },
      ],
      boxes,
    )
    expect(routed).toHaveLength(2)
    const [first, second] = routed
    if (first === undefined || second === undefined) throw new Error('two edges were expected')
    // Not `d`, which differs the moment the ends are swapped even when the two
    // lines lie on top of each other. This pair is the one that reads as a
    // single double-headed arrow if the sideways offset is taken from the
    // direction each edge is read in, because the two offsets then cancel.
    expect(Math.abs(first.at.y - second.at.y)).toBeGreaterThanOrEqual(16)
  })

  it('loops a self reference out of the side of its own box', () => {
    const routed = routeEdges(
      [{ from: { table: 'orders', column: 'parent_id' }, to: { table: 'orders', column: 'id' } }],
      boxes,
    )
    expect(routed).toHaveLength(1)
    expect(starts(routed[0]?.d ?? '').x).toBeGreaterThanOrEqual(220)
  })

  it('drops an edge to a table that is not on the canvas rather than drawing to nowhere', () => {
    const routed = routeEdges(
      [{ from: { table: 'orders', column: 'x' }, to: { table: 'gone', column: 'id' } }],
      boxes,
    )
    expect(routed).toEqual([])
  })

  it('starts and ends outside the boxes it joins', () => {
    const routed = routeEdges(
      [
        {
          from: { table: 'orders', column: 'customer_id' },
          to: { table: 'customers', column: 'id' },
        },
      ],
      boxes,
    )
    expect(starts(routed[0]?.d ?? '').x).toBeGreaterThan(220)
  })
})
