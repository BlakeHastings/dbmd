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
 * saying the write failed. The one exception is a refusal that says the page is
 * stale, where retrying is the defect: the patch was computed from a model that
 * is gone, so it is dropped and the page re-reads.
 *
 * **Every request names the model revision the edit was made against** (ADR
 * 0025), and it is the revision at the moment the edit was made rather than at
 * the moment it is sent. Those differ by exactly the window this whole file is
 * about: an edit can sit in `wanted` while a request is in flight, and if the
 * page adopted a change from disk in between, sending the fresher number would
 * be the page vouching for a model this patch was never computed from.
 * Coalescing therefore keeps the older of the two, because a merged patch is
 * only as fresh as its oldest half.
 */

import type { Table } from '../../model/types.js'
import {
  REVISION_HEADER,
  type TablePatch,
  type WireModel,
  type WireModelResponse,
  type WireStatus,
} from '../wire.js'
import type { Point } from './geometry.js'
import { referrersTo, withRefsRetargeted } from './model.js'

export interface WriteHandlers {
  /** The revision the page has drawn. Read per edit, not per request. */
  readonly revision: () => number
  /** Every response carries the write status; this is how the status line moves. */
  readonly onStatus: (status: WireStatus) => void
  readonly onFailure: (table: string, failure: RequestFailed) => void
}

/**
 * A refusal, with the server's code as well as its words.
 *
 * The words are for the developer and the code is for the page: `stale` and
 * `conflicted` mean the model moved and the page has to re-read, and everything
 * else means the edit is still the page's to retry. A page that could only read
 * the sentence would be matching on prose.
 */
export class RequestFailed extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RequestFailed'
  }

  /** Whether the answer is to re-read the model rather than to try again. */
  get isStale(): boolean {
    return this.code === 'stale' || this.code === 'conflicted'
  }
}

/** What the server answered a mutation with: the table, and where the writes stand. */
interface TableResponse extends WireStatus {
  readonly table: Table
}

export class TableWriter {
  private readonly wanted = new Map<string, { patch: TablePatch; revision: number; base: number }>()
  private readonly sent = new Map<string, number>()
  private readonly drains = new Map<string, Promise<void>>()
  /**
   * One counter for the whole writer rather than one per table, so a revision is
   * unique and nothing has to reason about what wrapping would mean.
   *
   * Not to be confused with `base`, which is the *model's* revision and comes
   * from the server. This one only ever orders this object's own edits.
   */
  private revisions = 0

  constructor(private readonly handlers: WriteHandlers) {}

  /**
   * Whether anything is on its way to the server or waiting to be.
   *
   * The page asks before it adopts a change from disk: redrawing from a model
   * that does not yet include an edit this object is still holding would show
   * the developer their own work disappearing and then coming back.
   */
  get busy(): boolean {
    return this.drains.size > 0
  }

  /** A box moved. The only edit the canvas makes, and it is an ordinary patch. */
  move(table: string, position: Point): void {
    this.patch(table, { layout: { x: position.x, y: position.y } })
  }

  patch(table: string, patch: TablePatch): void {
    const held = this.wanted.get(table)
    const base = this.handlers.revision()
    this.revisions += 1
    this.wanted.set(table, {
      patch: { ...held?.patch, ...patch },
      revision: this.revisions,
      // The older of the two: a merged patch carries content computed from both
      // models, so it is only as fresh as the staler half of it.
      base: held === undefined ? base : Math.min(held.base, base),
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
        // answered by the page re-reading it (ADR 0025), not by an echo, and the
        // patch that was computed from the old one is refused rather than fed
        // back.
        this.handlers.onStatus(await patchTable(table, want.patch, want.base))
        this.sent.set(table, want.revision)
      }
    } catch (error) {
      const failure =
        error instanceof RequestFailed ? error : new RequestFailed('unreachable', messageOf(error))
      // A stale patch is not a patch to retry. It was computed from a model
      // that is gone, so keeping it would mean the next edit to this table
      // sending the old column list along with the new one, which is the defect
      // this guard exists for wearing a second hat.
      if (failure.isStale) {
        this.wanted.delete(table)
        this.sent.delete(table)
      }
      this.handlers.onFailure(table, failure)
    }
  }
}

/**
 * A rename that stopped part-way, and everything a developer needs in order to
 * know where they now are.
 *
 * It carries the sentence rather than the pieces because there is exactly one
 * place that shows it and three things it has to say: what landed, what did
 * not, and that nothing is left pointing at a table that is not there.
 */
export class RenameStopped extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
    landed: readonly string[],
    reason: string,
  ) {
    super(
      `the rename of \`${from}\` to \`${to}\` stopped part-way: ${reason} ` +
        `${landed.length === 0 ? 'Nothing was written' : `Written so far: ${landed.join(', ')}`}, ` +
        `and tables/${from}.md was not deleted, so nothing is left pointing at a table that is not there. ` +
        `Undo what landed with git checkout, then rename again on top of what the files now say.`,
    )
    this.name = 'RenameStopped'
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
 * **Every step names the same revision, and the whole rename is abandoned the
 * moment the model stops being on it.** That one number is what makes several
 * requests one decision: it was the model the developer was shown and confirmed
 * against, so a step made against a different one is a step they did not agree
 * to. dbmd-39 was this function running to the end after one of its own patches
 * had been refused, and leaving `addresses.md` pointing at a table the last step
 * had just deleted.
 *
 * **A step is landed before the next one is issued.** The write is debounced
 * (ADR 0004), so a `PATCH` is answered when the edit is accepted and the
 * refusal, if there is one, comes into existence a few hundred milliseconds
 * later. Without the flush there is nothing yet for this loop to read, which is
 * exactly why dbmd-39 could not be closed by checking `conflicts` after each
 * step: the conflict did not exist yet.
 *
 * This is still deliberately not one endpoint. A rename touches several files
 * and is therefore several writes whichever layer composes it, and composing it
 * here means the interface can say what it is about to do in the same words it
 * then does it in. What has changed is that it now says what it did not do, in
 * the same place.
 */
export async function renameTable(
  writer: TableWriter,
  model: WireModel,
  from: string,
  to: string,
  base: number,
): Promise<void> {
  const table = model.tables.find((held) => held.name === from)
  if (table === undefined) throw new Error(`no table called \`${from}\` in this model`)
  const landed: string[] = []

  /** After a step: everything it asked for is on disk and the model has not moved. */
  const check = async (): Promise<void> => {
    const status = await flushWrites()
    if (status.revision === base) return
    const refused = status.conflicts.map((conflict) => conflict.path)
    throw new RenameStopped(
      from,
      to,
      landed,
      refused.length === 0
        ? 'the model changed on disk while it was running.'
        : `${refused.join(' and ')} changed on disk while it was running, so the studio kept the change and dropped its own edit.`,
    )
  }

  await writer.settle(from)
  await createTable(
    {
      name: to,
      // Retargeted before they are sent, so a table that references itself is
      // born pointing at itself under the new name rather than at the file
      // about to go.
      columns: withRefsRetargeted(table.columns, from, to),
      indexes: table.indexes,
      body: table.body,
      ...(table.layout === undefined ? {} : { layout: table.layout }),
      ...(table.group === undefined ? {} : { group: table.group }),
    },
    base,
  )
  landed.push(`tables/${to}.md`)
  await check()

  for (const name of new Set(referrersTo(model, from).map((referrer) => referrer.table))) {
    if (name === from) continue
    const referrer = model.tables.find((held) => held.name === name)
    if (referrer === undefined) continue
    writer.patch(name, { columns: withRefsRetargeted(referrer.columns, from, to) })
    await writer.settle(name)
    await check()
    landed.push(`tables/${name}.md`)
  }

  try {
    await deleteTable(from, base)
  } catch (error) {
    // The last step is the destructive one, and the server runs the same
    // revision check again after landing what was already queued, because that
    // landing is allowed to discover a refusal. Reaching here means it did.
    if (error instanceof RequestFailed && error.isStale) {
      throw new RenameStopped(from, to, landed, 'the model changed on disk while it was running.')
    }
    throw error
  }
}

export async function fetchModel(): Promise<WireModelResponse> {
  const response = await fetch('/api/model', { headers: { accept: 'application/json' } })
  return (await answer(response)) as WireModelResponse
}

/**
 * Land everything already accepted, and say where that left things.
 *
 * It names no revision because it carries no edit: what it writes was accepted
 * by requests that each named one. See `renameTable` for the only caller and
 * why a multi-step edit needs it.
 */
export async function flushWrites(): Promise<WireStatus> {
  const response = await fetch('/api/flush', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  return (await answer(response)) as WireStatus
}

/** A new table's file, written immediately rather than debounced (ADR 0013). */
export async function createTable(
  body: TablePatch & { readonly name: string },
  base: number,
): Promise<TableResponse> {
  const response = await fetch('/api/table', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
    body: JSON.stringify(body),
  })
  return (await answer(response)) as TableResponse
}

export async function deleteTable(name: string, base: number): Promise<WireStatus> {
  const response = await fetch(`/api/table/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
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

async function patchTable(table: string, patch: TablePatch, base: number): Promise<TableResponse> {
  const body = JSON.stringify(patch)
  const response = await fetch(`/api/table/${encodeURIComponent(table)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
    body,
    keepalive: body.length <= KEEPALIVE_LIMIT_BYTES,
  })
  return (await answer(response)) as TableResponse
}

/** The parsed body, or a throw carrying the server's own words for the refusal. */
async function answer(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new RequestFailed(
      stringIn(body, 'code') ?? 'unknown',
      stringIn(body, 'error') ?? `the server answered ${response.status}`,
    )
  }
  return body
}

/** One string field of a refusal: its words, which beat a status number, or its code. */
function stringIn(body: unknown, key: 'error' | 'code'): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
