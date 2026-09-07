/**
 * Getting a moved box to the disk, exactly once and always.
 *
 * ADR 0004 puts the debounce in the server, and dbmd-30 built it there: a
 * `PATCH` applies the edit to the model in memory and schedules one write a few
 * hundred milliseconds later, so a drag is one write rather than sixty. **There
 * is deliberately no second debounce here.** A timer in the page is a timer that
 * a backgrounded tab is allowed to throttle, and "the drag that never got
 * written because the tab lost focus" is the bug that makes a developer stop
 * trusting write-through, which is the whole product.
 *
 * What is here instead is back-pressure. A drag produces a position per pointer
 * event and this sends one request at a time per table, coalescing everything
 * that arrives while a request is in flight down to the latest position. So the
 * server hears from us continuously, never more than one request deep, and the
 * last thing it hears is where the box actually ended up.
 *
 * The loop condition is the thing worth reading twice: it drains until what was
 * sent equals what is wanted, rather than sending what it was handed. That is
 * what makes the end of a drag safe without a flush of its own. A pointerup
 * that lands while a request is in flight sets `wanted` and the running drain
 * picks it up; a pointerup that lands with nothing in flight starts a drain
 * itself. There is no third case, and in particular there is no case where a
 * position is sitting in this object waiting for an event.
 *
 * A failed request leaves `wanted` ahead of `sent`, so the next move retries it.
 * The box is not moved back: the developer is looking at where they put it, and
 * snatching it away is a worse answer than the status line saying the write
 * failed.
 */

import type { WireModelResponse, WireStatus } from '../wire.js'
import type { Point } from './geometry.js'

export interface WriteHandlers {
  /** Every response carries the write status; this is how the status line moves. */
  readonly onStatus: (status: WireStatus) => void
  readonly onFailure: (table: string, message: string) => void
}

export class LayoutWriter {
  private readonly wanted = new Map<string, Point>()
  private readonly sent = new Map<string, Point>()
  private readonly draining = new Set<string>()

  constructor(private readonly handlers: WriteHandlers) {}

  move(table: string, position: Point): void {
    this.wanted.set(table, position)
    void this.drain(table)
  }

  private async drain(table: string): Promise<void> {
    if (this.draining.has(table)) return
    this.draining.add(table)
    try {
      for (;;) {
        const want = this.wanted.get(table)
        if (want === undefined) return
        const done = this.sent.get(table)
        if (done !== undefined && done.x === want.x && done.y === want.y) return
        const status = await patchLayout(table, want)
        this.sent.set(table, want)
        this.handlers.onStatus(status)
      }
    } catch (error) {
      this.handlers.onFailure(table, messageOf(error))
    } finally {
      this.draining.delete(table)
    }
  }
}

export async function fetchModel(): Promise<WireModelResponse> {
  const response = await fetch('/api/model', { headers: { accept: 'application/json' } })
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(errorIn(body) ?? `the server answered ${response.status}`)
  return body as WireModelResponse
}

async function patchLayout(table: string, position: Point): Promise<WireStatus> {
  const response = await fetch(`/api/table/${encodeURIComponent(table)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ layout: { x: position.x, y: position.y } }),
    // The last write of a drag can leave as the tab is being closed. `keepalive`
    // is what stops the browser cancelling it on the way out, and a layout patch
    // is far inside the size it is allowed.
    keepalive: true,
  })
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(errorIn(body) ?? `the server answered ${response.status}`)
  return body as WireStatus
}

/** The server's own words for a refusal, which are better than a status number. */
function errorIn(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const message = (body as { error?: unknown }).error
  return typeof message === 'string' ? message : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
