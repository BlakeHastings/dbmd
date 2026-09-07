/**
 * Noticing that the model directory changed underneath the studio.
 *
 * ADR 0004 wants editing `orders.md` in an editor and seeing the box move to be
 * the same feature as the studio writing it, seen from the other side. This is
 * the other side. ADR 0019 is the record for what the studio then does about it,
 * and the division of labour it settles is the reason this file is as small as
 * it is: **the watcher never decides anything.** It says "something under here
 * moved", once per burst, and `edits.ts` re-reads and works out what that means.
 *
 * That matters because `fs.watch` is the least dependable thing in Node. It is
 * a different mechanism on every platform, it reports a rename as a delete and
 * a create, it reports one save as anywhere from one to four events, it
 * sometimes hands over a `null` filename, and on Windows it can report a
 * directory it can no longer open. A watcher that had to be right about *what*
 * changed would inherit all of that. A watcher whose only output is "look
 * again" inherits none of it: a spurious wake-up costs a directory read, and a
 * missed one is covered by the check `edits.ts` runs immediately before every
 * write, which does not involve this file at all.
 *
 * Three things it does own:
 *
 * **It watches the root and each kind directory, rather than recursively.** A
 * model directory is two levels deep by ADR 0005 and no deeper, so four
 * non-recursive watchers cover it exactly. `{ recursive: true }` would be one
 * call, and it is the one call whose support differs by platform and by Node
 * version, which is the trade this project has already refused elsewhere.
 *
 * **It debounces.** An editor that writes a temporary file and renames it over
 * the target produces a delete and a create; several editors produce more. One
 * burst has to become one wake-up or the studio re-reads the directory four
 * times for one Ctrl-S. That is `Burst` below, which is separate from the
 * watching so that a test can hold it to the promise without going through
 * `fs.watch` to do it.
 *
 * **It ignores the writer's own temporary files, at the kind directory.**
 * `write.ts` writes `.<name>.<uuid>.tmp` beside the target and renames it over.
 * Those names start with a dot and do not end in `.md`, which is the rule
 * `readModel` already skips them by, and applying the same rule here is what
 * keeps that file out of the kind directory's watcher. It is not a promise that
 * no such name ever reaches `onChange`, and `isRootEntry` below is where that
 * distinction is measured and why it does not matter.
 */

import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { KIND_DIRECTORIES, MODEL_FILE } from '../model/paths.js'

/**
 * Long enough that a rename lands inside the same burst as the delete that
 * preceded it, short enough that a save feels immediate. It is not the write
 * debounce and should not be tied to it: that one is about how long to wait for
 * a person to stop dragging, this one is about how long an editor takes to
 * finish a single save.
 */
const DEFAULT_WATCH_DEBOUNCE_MS = 120

export interface WatchOptions {
  /** How long a burst of filesystem events is collected before one wake-up. */
  readonly debounceMs?: number
  /** Narration, one line at a time, without the newline. */
  readonly log?: (message: string) => void
}

/** What a directory watcher reports about one name, ignoring the event type. */
type Interesting = (filename: string) => boolean

/**
 * One call per burst, where a burst is bumps no further apart than `withinMs`.
 *
 * The whole of this file's timing, and it is a class of its own rather than two
 * fields on `ModelWatcher` so that "once per burst" can be held to account
 * without `fs.watch` in the way. **A burst driven by `fs.watch` is not a burst
 * the test made; it is one the test hoped for.** Two files saved together are two
 * events whose delivery times belong to the operating system, and a machine
 * under load that spaces them by more than the window has produced two bursts,
 * which is two wake-ups and is correct. dbmd-056 is the CI runs where a case
 * that saved two files and expected one wake-up met exactly that and reported
 * it as `expected 2 to be 1`.
 *
 * A `bump` is a function call, so the cases in `watch.test.ts` that count
 * wake-ups make their bursts rather than waiting to be given one, and nothing
 * about them depends on how busy the machine is. What the filesystem is still
 * asked in that file is whether the events reach here at all, which is a
 * question it can answer.
 *
 * Trailing rather than leading: the wake-up belongs to the end of a burst,
 * because the point of it is to look at a directory once everything that was
 * going to move has moved.
 */
export class Burst {
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly withinMs: number,
    private readonly wake: () => void,
  ) {}

  /** Another event. Push the wake-up out to `withinMs` from now. */
  bump(): void {
    this.cancel()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.wake()
    }, this.withinMs)
    // A pending wake-up must never be the thing keeping `dbmd studio` alive
    // after the listening socket has gone. Same reason the write timer is
    // unref'd.
    this.timer.unref()
  }

  /** Drop a wake-up the last burst had queued, if there is one. */
  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}

export class ModelWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly burst: Burst
  private closed = false

  private constructor(
    private readonly dir: string,
    debounceMs: number,
    private readonly onChange: () => void,
    private readonly log: (message: string) => void,
  ) {
    this.burst = new Burst(debounceMs, () => {
      // A kind directory created while the studio was running is reported by
      // the root watcher, and the files put into it afterwards are not reported
      // by anything until it has a watcher of its own. Attaching here is what
      // makes the second save into a brand new `notes/` visible.
      this.attachKinds()
      this.onChange()
    })
  }

  /**
   * Start watching. `onChange` is called at most once per burst and takes no
   * arguments on purpose: what changed is a question for a re-read, not for an
   * event whose filename may be `null`.
   *
   * This never throws. A directory that cannot be watched is narrated and the
   * studio carries on without a live update for it, because the alternative is
   * a studio that refuses to start on a filesystem that does not support
   * `fs.watch` and every write already re-checks the disk anyway.
   */
  static open(dir: string, onChange: () => void, options: WatchOptions = {}): ModelWatcher {
    const watcher = new ModelWatcher(
      dir,
      options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
      onChange,
      options.log ?? (() => {}),
    )
    // The root watcher reports `_model.md` and the appearance of a kind
    // directory. It does not report the files inside one, which is why each
    // kind directory gets its own.
    watcher.attach('.', dir, isRootEntry)
    watcher.attachKinds()
    return watcher
  }

  /** Stop watching and cancel anything the last burst had queued. */
  close(): void {
    this.closed = true
    this.burst.cancel()
    for (const handle of this.watchers.values()) handle.close()
    this.watchers.clear()
  }

  /** How many directories are actually being watched. For the test, and for narration. */
  get watching(): number {
    return this.watchers.size
  }

  // ------------------------------------------------------------------------

  private attachKinds(): void {
    for (const directory of KIND_DIRECTORIES.keys()) {
      this.attach(directory, join(this.dir, directory), isModelFileName)
    }
  }

  private attach(key: string, target: string, interesting: Interesting): void {
    if (this.closed || this.watchers.has(key)) return
    let handle: FSWatcher
    try {
      // `persistent: false` for the same reason the write timer is unref'd: a
      // watcher must never be the thing keeping `dbmd studio` alive after the
      // listening socket has gone.
      handle = watch(target, { persistent: false }, (_event, filename) => {
        // A `null` filename means the platform knows something changed and not
        // what, and an event that cannot say what changed has to be taken as
        // one that did.
        if (filename !== null && !interesting(String(filename))) return
        this.bump()
      })
    } catch (error) {
      // A model directory with no `notes/` yet is the ordinary case rather than
      // a fault, and the root watcher will bring one into view if it appears.
      if (!isMissing(error)) this.log(`not watching ${target}: ${messageOf(error)}`)
      return
    }
    handle.on('error', (error: Error) => {
      // Windows raises here when a watched directory is renamed or removed.
      // Dropping the watcher rather than throwing keeps the studio serving; the
      // check before each write is what keeps it safe without one.
      this.log(`stopped watching ${target}: ${error.message}`)
      handle.close()
      this.watchers.delete(key)
    })
    this.watchers.set(key, handle)
  }

  private bump(): void {
    if (this.closed) return
    this.burst.bump()
  }
}

/**
 * At the model root: the model file itself, or a directory that holds objects.
 *
 * **This is a hole in the filename filter, and it is meant to stay open.** The
 * name it lets through is a *directory*, so on a platform that reports a change
 * inside `tables/` as a change to `tables` itself, every file put into that
 * directory reaches `onChange` with no filename of its own, and
 * `isModelFileName` never sees it. Widening the root watcher is not the fix:
 * it exists to notice a kind directory appearing or disappearing, which is a
 * real event and the only thing that brings a `notes/` created mid-session
 * under a watcher of its own.
 *
 * Measured on Windows 11, NTFS, Node 24 (dbmd-c8p), with a raw `fs.watch` on
 * the root beside this one:
 *
 * - Writing `.orders.md.<uuid>.tmp` into `tables/` and deleting it, which is
 *   exactly what every save does, delivers `change` / `tables` to the root
 *   watcher and wakes the studio. Eleven times in twelve, the miss being the
 *   first such file written into a directory the watcher had only just
 *   attached to.
 * - Against a *freshly copied* directory the same operation woke it zero times
 *   in twelve. Same name, same syscalls, opposite answer, so **the filename is
 *   not what decides this** and no rule about names can close the hole. It is
 *   NTFS reporting a parent directory's own metadata, and holding a test to it
 *   would be holding a test to the operating system.
 * - Linux was not measured. `inotify` on a directory does not report its
 *   children's contents at all, so the leak is expected to be absent there and
 *   a green run on CI proves nothing either way.
 *
 * **It costs nothing today, for two reasons that are worth keeping separate.**
 * In the writer's own path the temporary file and the rename over the target
 * land inside the same debounce, and the target is a real change the watcher
 * owes a wake-up to regardless, so the leak adds no wake-up at all. For a
 * genuinely uninteresting file, `notes.txt` dropped into `tables/`, it costs one
 * directory read: `Edits.reload` re-reads, compares a fingerprint and returns
 * silently when nothing moved. That second half is the load-bearing one. If that
 * comparison ever stops being how the echo is answered (ADR 0019), this stops
 * being harmless, and this comment is the first place to look.
 */
function isRootEntry(filename: string): boolean {
  return filename === MODEL_FILE || KIND_DIRECTORIES.has(filename)
}

/**
 * Inside a kind directory: what `readModel` would read.
 *
 * The dot rule is the important half. Every write in this project is a
 * `.<name>.<uuid>.tmp` renamed over its target, so without this the studio's
 * own saves would wake it up twice for every file it wrote.
 */
function isModelFileName(filename: string): boolean {
  return filename.endsWith('.md') && !filename.startsWith('.')
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
