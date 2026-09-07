/**
 * Getting an edit to the disk, exactly once and always.
 *
 * ADR 0004 puts the debounce in the server, and dbmd-30 built it there: a
 * `PATCH` applies the edit to the model in memory and schedules one write a few
 * hundred milliseconds later, so a drag is one write rather than sixty and a
 * typed sentence is one write rather than one per keystroke. **There is
 * deliberately no second debounce here.** A timer in the page is a timer that a
 * backgrounded tab is allowed to throttle, and "the drag that never got written
 * because the tab lost focus" is the bug that makes a developer stop trusting
 * write-through, which is the whole product.
 *
 * What is here instead is back-pressure. An interaction produces an edit per
 * pointer event or per keystroke, and this sends one request at a time per
 * table, coalescing everything that arrives while a request is in flight into
 * one patch. So the server hears from us continuously, never more than one
 * request deep, and the last thing it hears is what the table actually says.
 *
 * The loop condition is the thing worth reading twice: it drains until what was
 * sent is as new as what is wanted, rather than sending what it was handed. That
 * is what makes the end of a drag, or the end of a sentence, safe without a
 * flush of its own. A pointerup that lands while a request is in flight bumps
 * the revision and the running drain picks it up; one that lands with nothing in
 * flight starts a drain itself. There is no third case, and in particular there
 * is no case where an edit is sitting in this object waiting for an event.
 *
 * **Coalescing merges patches rather than replacing them**, and that is safe
 * because of what a `TablePatch` is: every key is the whole of that part of the
 * table rather than a delta into it (see `wire.ts`). So a body edit and a column
 * edit that overlap in flight merge into one request that carries the latest of
 * both, and re-sending a key that has not changed since the last request costs
 * the server a comparison and the disk nothing.
 *
 * A failed request leaves the revision ahead of what was sent, so the next edit
 * retries it. Nothing is rolled back in the page: the developer is looking at
 * what they typed, and snatching it away is a worse answer than the status line
 * saying the write failed.
 */

import type { Table } from '../../model/types.js'
import type { TablePatch, WireModel, WireModelResponse, WireStatus } from '../wire.js'
import type { Point } from './geometry.js'
import { referrersTo, withRefsRetargeted } from './model.js'

export interface WriteHandlers {
  /** Every response carries the write status; this is how the status line moves. */
  readonly onStatus: (status: WireStatus) => void
  readonly onFailure: (table: string, message: string) => void
}

/** What the server answered a mutation with: the table, and where the writes stand. */
interface TableResponse extends WireStatus {
  readonly table: Table
}

export class TableWriter {
  private readonly wanted = new Map<string, { patch: TablePatch; revision: number }>()
  private readonly sent = new Map<string, number>()
  private readonly drains = new Map<string, Promise<void>>()
  /**
   * One counter for the whole writer rather than one per table, so a revision is
   * unique and nothing has to reason about what wrapping would mean.
   */
  private revisions = 0

  constructor(private readonly handlers: WriteHandlers) {}

  /** A box moved. The only edit the canvas makes, and it is an ordinary patch. */
  move(table: string, position: Point): void {
    this.patch(table, { layout: { x: position.x, y: position.y } })
  }

  patch(table: string, patch: TablePatch): void {
    const held = this.wanted.get(table)
    this.revisions += 1
    this.wanted.set(table, {
      patch: { ...held?.patch, ...patch },
      revision: this.revisions,
    })
    void this.drain(table)
  }

  /**
   * Everything already handed to this writer for `table`, on disk or refused.
   *
   * A rename is three requests over two file names (see `renameTable`), and a
   * patch still in flight against the old name would land after the file it
   * names has gone. This is the one place that has to wait, and it waits on the
   * drain rather than on a timer.
   */
  async settle(table: string): Promise<void> {
    // Loop rather than await once: a patch that arrived while the drain was
    // finishing starts a second one, and the caller wants both.
    for (;;) {
      const running = this.drains.get(table)
      if (running === undefined) return
      await running
    }
  }

  private drain(table: string): Promise<void> {
    const running = this.drains.get(table)
    if (running !== undefined) return running
    const started = this.run(table).finally(() => this.drains.delete(table))
    this.drains.set(table, started)
    return started
  }

  private async run(table: string): Promise<void> {
    try {
      for (;;) {
        const want = this.wanted.get(table)
        if (want === undefined) return
        if (this.sent.get(table) === want.revision) return
        // The table the server answers with is deliberately not fed back into
        // the page. A `PATCH` applies the patch this page just sent to the model
        // this page already had, so the answer is what the page computed, and
        // adopting it would rebuild a box on every keystroke of somebody's prose
        // for no change. A model that has genuinely moved underneath the page is
        // the watcher's problem (dbmd-33) and is fixed by re-reading, not by an
        // echo.
        this.handlers.onStatus(await patchTable(table, want.patch))
        this.sent.set(table, want.revision)
      }
    } catch (error) {
      this.handlers.onFailure(table, messageOf(error))
    }
  }
}

/**
 * Rename a table, and move every `ref` that pointed at it, out of the routes
 * that already exist.
 *
 * The server has no rename: it has create, patch and delete (ADR 0013), and a
 * rename is those three in an order that never leaves a ref dangling. Create the
 * new file first, then move the refs onto it, then delete the old one. Doing it
 * the other way round would put the model through a state where three files
 * point at nothing, which is a state a watcher or a second window would see.
 *
 * A self-reference is handled by the first step rather than by the second: the
 * columns are retargeted before they are sent, so the new file is born pointing
 * at itself under its new name.
 *
 * This is deliberately not one endpoint. A rename touches several files and is
 * therefore several writes whichever layer composes it, and composing it here
 * means the interface can say what it is about to do in the same words it then
 * does it in. Where it is not atomic is real and is worth knowing: a failure
 * between the steps leaves both files on disk, which is a state `git status`
 * shows and `git checkout` undoes.
 */
export async function renameTable(
  writer: TableWriter,
  model: WireModel,
  from: string,
  to: string,
): Promise<void> {
  const table = model.tables.find((held) => held.name === from)
  if (table === undefined) throw new Error(`no table called \`${from}\` in this model`)

  await writer.settle(from)
  await createTable({
    name: to,
    // Retargeted before they are sent, so a table that references itself is born
    // pointing at itself under the new name rather than at the file about to go.
    columns: withRefsRetargeted(table.columns, from, to),
    indexes: table.indexes,
    body: table.body,
    ...(table.layout === undefined ? {} : { layout: table.layout }),
    ...(table.group === undefined ? {} : { group: table.group }),
  })

  for (const name of new Set(referrersTo(model, from).map((referrer) => referrer.table))) {
    if (name === from) continue
    const referrer = model.tables.find((held) => held.name === name)
    if (referrer === undefined) continue
    writer.patch(name, { columns: withRefsRetargeted(referrer.columns, from, to) })
    await writer.settle(name)
  }

  await deleteTable(from)
}

export async function fetchModel(): Promise<WireModelResponse> {
  const response = await fetch('/api/model', { headers: { accept: 'application/json' } })
  return (await answer(response)) as WireModelResponse
}

/** A new table's file, written immediately rather than debounced (ADR 0013). */
export async function createTable(
  body: TablePatch & { readonly name: string },
): Promise<TableResponse> {
  const response = await fetch('/api/table', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await answer(response)) as TableResponse
}

export async function deleteTable(name: string): Promise<WireStatus> {
  const response = await fetch(`/api/table/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  })
  return (await answer(response)) as WireStatus
}

/**
 * The largest body this will send with `keepalive`.
 *
 * `keepalive` is what stops the browser cancelling the last write of a drag as
 * the tab is being closed, and it is worth having on every small patch for the
 * same reason. It also has a hard limit of 64 KiB across all in-flight keepalive
 * requests, above which the fetch rejects, and a prose body is the one patch
 * that can pass it. So the flag is asked for by size rather than always: a
 * paragraph keeps the guarantee, and a chapter is a request that would have
 * failed with it and succeeds without.
 */
const KEEPALIVE_LIMIT_BYTES = 48 * 1024

async function patchTable(table: string, patch: TablePatch): Promise<TableResponse> {
  const body = JSON.stringify(patch)
  const response = await fetch(`/api/table/${encodeURIComponent(table)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: body.length <= KEEPALIVE_LIMIT_BYTES,
  })
  return (await answer(response)) as TableResponse
}

/** The parsed body, or a throw carrying the server's own words for the refusal. */
async function answer(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(errorIn(body) ?? `the server answered ${response.status}`)
  return body
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
