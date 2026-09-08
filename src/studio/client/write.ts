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
 * object, coalescing everything that arrives while a request is in flight into
 * one patch. So the server hears from us continuously, never more than one
 * request deep per object, and the last thing it hears about each is what that
 * object actually says. A group drag is several objects and therefore several
 * of those queues at once, which is exactly right: they are separate files.
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

import type { CanvasObject, Group, Layout, Note, ObjectKind, Table } from '../../model/types.js'
import {
  REVISION_HEADER,
  type GroupPatch,
  type NotePatch,
  type TablePatch,
  type WireConflict,
  type WireModel,
  type WireModelResponse,
  type WireStatus,
} from '../wire.js'
import type { Point } from './geometry.js'
import { referrersTo, withRefsRetargeted } from './model.js'

/**
 * A patch for whichever kind of object is being edited.
 *
 * The three shapes are disjoint enough that a union would need a discriminator
 * on every call site, and the kind is already carried beside it everywhere this
 * appears: `patch(kind, name, patch)` names both. `wire.ts` is what refuses a
 * key the wrong kind sent, which is where that refusal belongs, because a
 * client that got it wrong should be told by the thing that knows the format.
 */
export type ObjectPatch = TablePatch | NotePatch | GroupPatch

export interface WriteHandlers {
  /** The revision the page has drawn. Read per edit, not per request. */
  readonly revision: () => number
  /** Every response carries the write status; this is how the status line moves. */
  readonly onStatus: (status: WireStatus) => void
  readonly onFailure: (kind: ObjectKind, name: string, failure: RequestFailed) => void
}

/**
 * One object, addressed the way the writer queues it.
 *
 * A key rather than two maps, because everything below treats a note and a
 * table identically: one request at a time each, coalesced, named by the same
 * revision. `:` is the separator because `safe-path.ts` refuses it in a name,
 * so two objects cannot collide here. Deliberately not a control character: a
 * NUL in a source file makes it binary to git and the diff disappears, which
 * has happened in this repository twice.
 */
function keyOf(kind: ObjectKind, name: string): string {
  return `${kind}:${name}`
}

function kindOf(key: string): ObjectKind {
  return key.slice(0, key.indexOf(':')) as ObjectKind
}

function nameOf(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

/**
 * A refusal, with the server's code as well as its words.
 *
 * The words are for the developer and the code is for the page: `stale`,
 * `conflicted` and `unreadable` mean the page has to re-read rather than retry,
 * and everything else means the edit is still the page's to retry. A page that
 * could only read the sentence would be matching on prose.
 */
export class RequestFailed extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RequestFailed'
  }

  /**
   * Whether the answer is to re-read the model rather than to try again.
   *
   * Three codes and two sentences. `unreadable` is here because retrying it is
   * as pointless as retrying the other two and the page has as little to show
   * for it, and it is a separate code because what the page should *say* about
   * it is the opposite of what it says about them: nothing on disk changed.
   */
  get isStale(): boolean {
    return this.code === 'stale' || this.code === 'conflicted' || this.code === 'unreadable'
  }

  /** Whether the file could not be read at all, which is a different sentence. */
  get wasUnreadable(): boolean {
    return this.code === 'unreadable'
  }
}

/**
 * What the page says when a refusal means the model moved.
 *
 * The rule above was only half kept. The code decided what to *do* and the
 * server's prose was concatenated to decide what to *say*, so the status bar
 * showed a sentence written for a script: it names two revision numbers and
 * tells the reader to read `/api/model` again. The person reading it cannot do
 * that, has no reason to know what `/api/model` is, and is looking at a page
 * that re-reads by itself. Then the page appended its own advice, so the same
 * instruction arrived twice, the second time correctly attributed.
 *
 * Rendering the code rather than the words is the fix, and it is the fix
 * everywhere rather than at the one call site, because there are two paths into
 * this refusal (an edit and a delete) and a person meeting the same refusal
 * twice should meet the same sentence. **The server's own message is left
 * exactly as it is**: it is the right answer to the script that got the 409,
 * and making it worse to make this one better would be trading one reader for
 * the other.
 *
 * `what` is the noun phrase for the thing that was refused, because the page
 * knows what it was doing and the server does not.
 */
export function staleNotice(what: string): string {
  return (
    `${what} was refused because the files changed on disk after this page read them. ` +
    `Nothing was written and the change on disk is intact. The page is re-reading the model; ` +
    `make the change again on top of what it then shows.`
  )
}

/**
 * The sentence beside that one, for the refusal that is not about a change.
 *
 * `staleNotice` is right about a file somebody else edited and wrong about a
 * file nothing could open: it says the files changed and tells the reader to
 * make the change again on top of what the page then shows, and there is
 * nothing to make it on top of. Both used to arrive here, because both leave
 * the file differing from what the edit was made against. dbmd-e6e.
 *
 * It names no cause, for the reason the server's version of it names none: a
 * file is unreadable for whatever reason the operating system gives, and
 * "another program has it open" is a guess. It points at the diagnostics
 * instead, which is where the reader has already said what it saw, and which is
 * two inches below this line on the page.
 */
export function unreadableNotice(what: string): string {
  return (
    `${what} was refused because this page could not read the file just now. ` +
    `Nothing was written and the file is exactly as it was. The diagnostics below say what the ` +
    `reader saw; make the change again once the file can be read.`
  )
}

/**
 * What the page says once a create has landed, which is the one success
 * sentence it cannot leave to the status line.
 *
 * A create is the only edit that does not go through `ObjectWriter`, and the
 * page clears its standing sentence there and nowhere else, so `Creating
 * tables/x.md.` used to stand for as long as the tab did: measured unchanged at
 * three seconds and at fifteen, over a file that was correct and complete on
 * disk the whole time.
 *
 * Letting the ordinary `Wrote ... at ...` line render instead was the other
 * answer and is the wrong one. That line ends in `Undo is git checkout`, which
 * is true of the drag it was written for and false of a file that did not exist
 * a second ago: it is untracked, and `git checkout` will not take it away. ADR
 * 0074.
 */
export function createdNotice(path: string): string {
  return `Created ${path}. Undo is deleting the file rather than git checkout, because it is new.`
}

/**
 * The line above the list of refused writes, which has to be true of all of
 * them.
 *
 * It used to say every one of them was dropped rather than written over a
 * change on disk, which for a file the studio could not read is the studio
 * contradicting the sentence in the list two lines under it. So it counts what
 * it has and says only what it can: the list itself carries the file and the
 * reason, one line each, and this is the line that stops a developer reading
 * the wrong one.
 */
export function conflictSummary(conflicts: readonly WireConflict[]): string {
  const dropped = `${conflicts.length} edit${conflicts.length === 1 ? ' was' : 's were'} dropped`
  if (conflicts.every((conflict) => conflict.reason === 'unreadable')) {
    return `${dropped} rather than written over a file the studio could not read.`
  }
  if (conflicts.every((conflict) => conflict.reason === 'changed')) {
    return `${dropped} rather than written over a change on disk.`
  }
  return `${dropped} rather than written. Each line below says why.`
}

/** What the server answered a mutation with: the object, and where the writes stand. */
interface ObjectResponse extends WireStatus {
  readonly table?: Table
  readonly note?: Note
  readonly group?: Group
}

export class ObjectWriter {
  private readonly wanted = new Map<
    string,
    { patch: ObjectPatch; revision: number; base: number }
  >()
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

  /** A box or a note moved, or a note was resized. An ordinary patch either way. */
  move(kind: 'table' | 'note', name: string, layout: Layout): void {
    this.patch(kind, name, { layout })
  }

  /**
   * A group was dragged: every member that moved, in one go.
   *
   * Several requests and one write. Each member is its own file and therefore
   * its own patch, but they all arrive inside the server's debounce window, so
   * the flush that follows writes them together and `writeModel`'s `only` set
   * holds exactly the members that moved (ADR 0015). The group's own file is
   * not in it and cannot be: nothing here has a patch for a group's position,
   * because a group has no position (ADR 0005).
   */
  moveGroup(moved: readonly { readonly name: string; readonly position: Point }[]): void {
    for (const member of moved) {
      this.patch('table', member.name, { layout: { x: member.position.x, y: member.position.y } })
    }
  }

  patch(kind: ObjectKind, name: string, patch: ObjectPatch): void {
    const key = keyOf(kind, name)
    const held = this.wanted.get(key)
    const base = this.handlers.revision()
    this.revisions += 1
    this.wanted.set(key, {
      patch: { ...held?.patch, ...patch },
      revision: this.revisions,
      // The older of the two: a merged patch carries content computed from both
      // models, so it is only as fresh as the staler half of it.
      base: held === undefined ? base : Math.min(held.base, base),
    })
    void this.drain(key)
  }

  /**
   * Everything already handed to this writer for one object, on disk or refused.
   *
   * A rename is three requests over two file names (see `renameTable`), and a
   * patch still in flight against the old name would land after the file it
   * names has gone. This is the one place that has to wait, and it waits on the
   * drain rather than on a timer.
   */
  async settle(kind: ObjectKind, name: string): Promise<void> {
    const key = keyOf(kind, name)
    // Loop rather than await once: a patch that arrived while the drain was
    // finishing starts a second one, and the caller wants both.
    for (;;) {
      const running = this.drains.get(key)
      if (running === undefined) return
      await running
    }
  }

  private drain(key: string): Promise<void> {
    const running = this.drains.get(key)
    if (running !== undefined) return running
    const started = this.run(key).finally(() => this.drains.delete(key))
    this.drains.set(key, started)
    return started
  }

  private async run(key: string): Promise<void> {
    try {
      for (;;) {
        const want = this.wanted.get(key)
        if (want === undefined) return
        if (this.sent.get(key) === want.revision) return
        // The object the server answers with is deliberately not fed back into
        // the page. A `PATCH` applies the patch this page just sent to the model
        // this page already had, so the answer is what the page computed, and
        // adopting it would rebuild a box on every keystroke of somebody's prose
        // for no change. A model that has genuinely moved underneath the page is
        // answered by the page re-reading it (ADR 0025), not by an echo, and the
        // patch that was computed from the old one is refused rather than fed
        // back.
        this.handlers.onStatus(await patchObject(kindOf(key), nameOf(key), want.patch, want.base))
        this.sent.set(key, want.revision)
      }
    } catch (error) {
      const failure =
        error instanceof RequestFailed ? error : new RequestFailed('unreachable', messageOf(error))
      // A stale patch is not a patch to retry. It was computed from a model
      // that is gone, so keeping it would mean the next edit to this object
      // sending the old column list along with the new one, which is the defect
      // this guard exists for wearing a second hat.
      if (failure.isStale) {
        this.wanted.delete(key)
        this.sent.delete(key)
      }
      this.handlers.onFailure(kindOf(key), nameOf(key), failure)
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
  writer: ObjectWriter,
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

  await writer.settle('table', from)
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
    writer.patch('table', name, { columns: withRefsRetargeted(referrer.columns, from, to) })
    await writer.settle('table', name)
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

/** A new object's file, written immediately rather than debounced (ADR 0013). */
export async function createObject(
  kind: ObjectKind,
  body: ObjectPatch & { readonly name: string },
  base: number,
): Promise<CanvasObject> {
  const response = await fetch(`/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
    body: JSON.stringify(body),
  })
  const created = (await answer(response)) as ObjectResponse
  // The server answers under the kind's own key, which is what makes the
  // response readable in a `curl` without knowing what was asked for.
  const object = created[kind]
  if (object === undefined) throw new RequestFailed('unknown', `the server created no ${kind}`)
  return object
}

export async function createTable(
  body: TablePatch & { readonly name: string },
  base: number,
): Promise<CanvasObject> {
  return createObject('table', body, base)
}

export async function deleteObject(
  kind: ObjectKind,
  name: string,
  base: number,
): Promise<WireStatus> {
  const response = await fetch(`/api/${kind}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
  })
  return (await answer(response)) as WireStatus
}

export async function deleteTable(name: string, base: number): Promise<WireStatus> {
  return deleteObject('table', name, base)
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

async function patchObject(
  kind: ObjectKind,
  name: string,
  patch: ObjectPatch,
  base: number,
): Promise<ObjectResponse> {
  const body = JSON.stringify(patch)
  const response = await fetch(`/api/${kind}/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', [REVISION_HEADER]: String(base) },
    body,
    keepalive: body.length <= KEEPALIVE_LIMIT_BYTES,
  })
  return (await answer(response)) as ObjectResponse
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
