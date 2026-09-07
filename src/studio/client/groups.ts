/**
 * Where a group's box is, computed, every time, and never stored.
 *
 * This is the file ADR 0005 is about. A group has no coordinates: its box is
 * the bounding box of the tables that declared themselves members of it, plus
 * padding, worked out at the moment it is drawn. There is deliberately no cache
 * here and nothing that could be written to a file, because the failure that
 * record exists to prevent is a stored box that disagrees with its members: a
 * table dragged out of a group that still looks like it is in one, in a file
 * that says something false.
 *
 * It is arithmetic over plain values and touches no DOM, which is the point:
 * the thing a screenshot cannot prove about a group is where its edges are when
 * a member moves, and that is provable here without a browser.
 *
 * **An empty group still gets a box.** A group whose last member left has
 * nothing to bound, and drawing nothing would tell the developer they had
 * deleted it, which they have not: the file is still there and `dbmd check`
 * still warns about it. So it gets a placeholder of a fixed size, in a
 * deterministic slot below everything else on the canvas, computed the same way
 * on every machine and every reload for the same reason `place.ts` puts an
 * unpositioned table on a grid.
 */

import { boundsOf, type Rect } from './geometry.js'

/** How far a group's box stands off the members it encloses, in model units. */
export const GROUP_PADDING = 28

/**
 * The height of the label bar, which sits above the padded box.
 *
 * It is above rather than inside so that the bar never covers a member's top
 * row, and so the whole of the bar is a drag handle that cannot be confused
 * with the table under it.
 */
export const GROUP_HEADER = 26

/** A group with nothing in it, drawn at this size so it is visible and obviously empty. */
export const EMPTY_GROUP: { readonly w: number; readonly h: number } = { w: 240, h: 120 }

/** The gap below the content, and between one empty group and the next. */
const EMPTY_GAP = 48

/** Where the first empty group goes when there is no content at all to sit under. */
const EMPTY_ORIGIN = { x: 40, y: 40 }

export interface GroupBox {
  readonly name: string
  /** The padded box, in model coordinates. The header bar sits just above it. */
  readonly rect: Rect
  /** The members it was computed from, in the order given. Empty is not an error. */
  readonly members: readonly string[]
}

/**
 * A box for every group: the ones with members first, in the order the groups
 * were given, then the empty ones in their own row underneath.
 *
 * `rects` holds the boxes of the tables currently on the canvas, which during a
 * drag are where the pointer has put them rather than where their files say.
 * That is what makes a group follow its members as they move: the same function
 * runs on every frame with fresher input, and there is no second copy of the
 * answer anywhere to go stale.
 *
 * A member the canvas has no box for is skipped rather than guessed at. It
 * means a table declared `group:` and the reader could not build it, and a
 * group that swelled to enclose the origin because one member was missing would
 * be a lie about where the group is.
 */
export function groupBoxes(
  groups: readonly string[],
  members: ReadonlyMap<string, readonly string[]>,
  rects: ReadonlyMap<string, Rect>,
): GroupBox[] {
  const boxes: GroupBox[] = []
  const empty: string[] = []

  for (const name of groups) {
    const held = members.get(name) ?? []
    const found = held
      .map((table) => rects.get(table))
      .filter((rect): rect is Rect => rect !== undefined)
    const bounds = boundsOf(found)
    if (bounds === undefined) {
      empty.push(name)
      continue
    }
    boxes.push({
      name,
      rect: {
        x: bounds.x - GROUP_PADDING,
        y: bounds.y - GROUP_PADDING,
        w: bounds.w + GROUP_PADDING * 2,
        h: bounds.h + GROUP_PADDING * 2,
      },
      members: held,
    })
  }

  // Below everything, left to right, in the order the groups came in, which the
  // reader sorts by name. Two reads of the same directory therefore put the
  // same placeholder in the same place, which is what stops an empty group
  // wandering across the canvas every time the page reloads.
  const content = boundsOf([...rects.values(), ...boxes.map((box) => box.rect)])
  const top = content === undefined ? EMPTY_ORIGIN.y : content.y + content.h + EMPTY_GAP
  const left = content === undefined ? EMPTY_ORIGIN.x : content.x
  empty.forEach((name, slot) => {
    boxes.push({
      name,
      rect: { x: left + slot * (EMPTY_GROUP.w + EMPTY_GAP), y: top, ...EMPTY_GROUP },
      members: [],
    })
  })

  return boxes
}
