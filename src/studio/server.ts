/**
 * The studio server: `node:http`, five routes and a static directory.
 *
 * No framework, on purpose. ADR 0004 already decided the client has no UI
 * library, and the same argument applies harder to the server: this is a tool
 * people run with `npx`, install time is a feature, and what a framework would
 * be doing here is the routing in `handle` below, which is a switch.
 *
 * Three things about it are security rather than plumbing, and each is marked
 * where it happens:
 *
 * 1. **It binds to 127.0.0.1 explicitly.** `listen(port)` alone listens on every
 *    interface, and this runs on a laptop on whatever network the laptop is on.
 * 2. **It checks the `Host` header.** Loopback binding is not by itself
 *    protection from a name that resolves to 127.0.0.1, which is a DNS
 *    rebinding, and the check costs two lines.
 * 3. **It requires `content-type: application/json` on a mutation.** A page on
 *    another origin cannot read our responses, but it can send a form post
 *    without a preflight. Requiring a content type that is not one of the three
 *    "simple" ones puts every mutation behind a preflight this server refuses by
 *    saying nothing about CORS at all.
 *
 * A fourth line is correctness rather than security and reads like plumbing:
 * **every mutation has to name the revision it was made against**, in
 * `x-dbmd-revision`, and this file reads it before it reads the body. ADR 0025
 * has the argument; what belongs here is that the header is read in one place
 * for all three mutating methods, so a fourth one cannot be added without it.
 *
 * Everything that decides where a file goes is in `safe-path.ts`, and everything
 * that decides what an edit means is in `edits.ts`. This file's whole job is to
 * turn a request into one of those calls and an `EditRefused` into a status.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { narrate } from '../cli/output.js'
import { Edits, EditRefused } from './edits.js'
import { resolveWithin } from './safe-path.js'
import {
  isPatchError,
  parseNewTable,
  parseRevision,
  parseTablePatch,
  REVISION_HEADER,
  toWireModel,
  type WireModelResponse,
} from './wire.js'

/** Loopback, always. Not an option, because there is no good reason to want another. */
const HOST = '127.0.0.1'

/** A model directory is markdown; a request bigger than this is not an edit to one. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface StudioOptions {
  /** The model root: the directory holding `_model.md` and `tables/`. */
  readonly dir: string
  /**
   * 0, the default, means the OS picks. Several worktrees run this at once and a
   * fixed port makes them collide silently with whichever started first, so the
   * caller learns the real port from `url` rather than from what it asked for.
   */
  readonly port?: number
  /** Open the URL in the developer's browser. `--no-open` is the CLI's way to say false. */
  readonly open?: boolean
  /** ADR 0006: stderr is narration. A caller that wants it elsewhere passes this. */
  readonly log?: (message: string) => void
  /** How long an edit waits for the next one before being written. ADR 0004. */
  readonly debounceMs?: number
  /** How long a burst of filesystem events is collected before one re-read. ADR 0019. */
  readonly watchDebounceMs?: number
  /**
   * Watch the model directory for changes made outside the studio, on by
   * default. Turning it off leaves the studio safe rather than only quiet: the
   * check that refuses to write over a file that moved runs at the write, not
   * in the watcher. ADR 0019.
   */
  readonly watch?: boolean
  /**
   * The built client. Defaults to the `client/` directory beside this module,
   * which is where `scripts/build-client.mjs` puts the bundle.
   */
  readonly clientDir?: string
}

export interface Studio {
  /** What to print and what to open. The only way a caller learns the real port. */
  readonly url: string
  readonly port: number
  /** Flush anything pending, then stop listening. Safe to call twice. */
  close(): Promise<void>
}

export async function startStudio(options: StudioOptions): Promise<Studio> {
  const log = options.log ?? narrate
  const clientDir = options.clientDir ?? fileURLToPath(new URL('client/', import.meta.url))
  const edits = await Edits.open(options.dir, {
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    ...(options.watchDebounceMs === undefined ? {} : { watchDebounceMs: options.watchDebounceMs }),
    ...(options.watch === undefined ? {} : { watch: options.watch }),
    log,
  })

  const server = createServer((request, response) => {
    void handle(request, response, edits, clientDir).catch((error: unknown) => {
      log(`request failed: ${messageOf(error)}`)
      send(response, 500, { error: messageOf(error), code: 'internal' })
    })
  })

  const port = await listen(server, options.port ?? 0)
  const url = `http://${HOST}:${port}/`
  log(`dbmd studio  ${url}`)
  log(`  model      ${edits.dir}`)

  if (options.open ?? true) openBrowser(url, log)

  let closed: Promise<void> | undefined
  return {
    url,
    port,
    close: () => (closed ??= shutdown(server, edits)),
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // The object form, with `host`, is the whole of the loopback promise: the
    // one-argument `listen(port)` binds to every interface.
    server.listen({ host: HOST, port }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('the server bound to something that is not a TCP address'))
        return
      }
      server.removeListener('error', reject)
      resolve(address.port)
    })
  })
}

async function shutdown(server: Server, edits: Edits): Promise<void> {
  // The edits first: a debounced write that has not fired yet is the
  // developer's work, and closing the socket does not make it less so.
  await edits.close()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    // `close` stops listening and then waits for open connections to end. A
    // browser holds one open with keep-alive, so without this the promise waits
    // for a timeout the developer is not going to sit through.
    server.closeAllConnections()
  })
}

// --------------------------------------------------------------------------
// Routing.
// --------------------------------------------------------------------------

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  edits: Edits,
  clientDir: string,
): Promise<void> {
  if (!isLoopbackHost(request.headers.host)) {
    send(response, 403, {
      error: `this server answers on ${HOST} only, and the request asked for \`${request.headers.host ?? ''}\``,
      code: 'wrong-host',
    })
    return
  }

  const path = decodePath(request.url ?? '/')
  if (path === undefined) {
    send(response, 400, {
      error: 'the request path is not valid percent-encoding',
      code: 'bad-path',
    })
    return
  }

  if (path[0] !== 'api') {
    await serveStatic(request, response, clientDir, path)
    return
  }

  try {
    await route(request, response, edits, path)
  } catch (error) {
    if (error instanceof EditRefused) {
      send(response, error.status, { error: error.message, code: error.code })
      return
    }
    throw error
  }
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  edits: Edits,
  path: readonly string[],
): Promise<void> {
  const method = request.method ?? 'GET'

  if (path.length === 2 && path[1] === 'model') {
    if (method !== 'GET') return methodNotAllowed(response, ['GET'])
    const { model, diagnostics } = edits.snapshot()
    const payload: WireModelResponse = {
      model: toWireModel(model),
      diagnostics,
      ...edits.status(),
    }
    send(response, 200, payload)
    return
  }

  // Landing what is already accepted, and saying where that left things.
  //
  // It names no object and carries no edit, which is why it takes no revision:
  // everything it writes was accepted by a request that named one. It exists
  // because a `PATCH` is answered when the edit is accepted and the write
  // happens a few hundred milliseconds later (ADR 0004), so a client composing
  // several edits out of several requests has no other way to find out that
  // step two landed before it issues step three. ADR 0025; dbmd-39.
  if (path.length === 2 && path[1] === 'flush') {
    if (method !== 'POST') return methodNotAllowed(response, ['POST'])
    if (!requiresJson(request, response)) return
    await edits.flush()
    send(response, 200, edits.status())
    return
  }

  if (path.length === 2 && path[1] === 'table') {
    if (method !== 'POST') return methodNotAllowed(response, ['POST'])
    // Content type first, then the revision, then the body. The first is the
    // one that is security (a form post is refused before anything else is
    // asked), the second is the one that decides whether this edit is allowed
    // to exist, and only then is it worth holding somebody's table in memory.
    if (!requiresJson(request, response)) return
    const base = revisionOf(request, response)
    if (base === undefined) return
    const body = await readJsonBody(request, response)
    if (body === undefined) return
    const parsed = parseNewTable(body)
    if (isPatchError(parsed)) {
      send(response, 400, { error: parsed.error, code: 'bad-request' })
      return
    }
    const table = await edits.addTable(parsed.value.name, parsed.value.patch, base)
    send(response, 201, { table, ...edits.status() })
    return
  }

  if (path.length === 3 && path[1] === 'table') {
    const name = path[2] ?? ''
    if (method === 'PATCH') {
      if (!requiresJson(request, response)) return
      const base = revisionOf(request, response)
      if (base === undefined) return
      const body = await readJsonBody(request, response)
      if (body === undefined) return
      const parsed = parseTablePatch(body)
      if (isPatchError(parsed)) {
        send(response, 400, { error: parsed.error, code: 'bad-request' })
        return
      }
      const table = edits.patchTable(name, parsed.value, base)
      send(response, 200, { table, ...edits.status() })
      return
    }
    if (method === 'DELETE') {
      const base = revisionOf(request, response)
      if (base === undefined) return
      await edits.removeTable(name, base)
      send(response, 200, { removed: name, ...edits.status() })
      return
    }
    if (method === 'GET') {
      send(response, 200, { table: edits.table(name), ...edits.status() })
      return
    }
    return methodNotAllowed(response, ['GET', 'PATCH', 'DELETE'])
  }

  send(response, 404, { error: `no such endpoint: /${path.join('/')}`, code: 'unknown-endpoint' })
}

function methodNotAllowed(response: ServerResponse, allowed: readonly string[]): void {
  response.setHeader('Allow', allowed.join(', '))
  send(response, 405, {
    error: `that endpoint takes ${allowed.join(' or ')}`,
    code: 'method-not-allowed',
  })
}

// --------------------------------------------------------------------------
// Static files.
// --------------------------------------------------------------------------

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
])

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  clientDir: string,
  path: readonly string[],
): Promise<void> {
  if ((request.method ?? 'GET') !== 'GET') return methodNotAllowed(response, ['GET'])

  const segments = path.length === 1 && path[0] === '' ? ['index.html'] : path
  // The same containment check the edits use. A browser normalises `..` out of
  // a URL before sending it; `curl --path-as-is` does not, and neither does
  // anything else that is not a browser.
  const target = resolveWithin(clientDir, ...segments)
  if (target === undefined) {
    send(response, 400, {
      error: `refusing \`/${path.join('/')}\`: it resolves outside the client directory`,
      code: 'unsafe-name',
    })
    return
  }

  let content: Buffer
  try {
    if ((await stat(target)).isDirectory()) throw new Error('is a directory')
    content = await readFile(target)
  } catch {
    send(response, 404, { error: `no such file: /${path.join('/')}`, code: 'not-found' })
    return
  }

  response.writeHead(200, {
    'content-type': CONTENT_TYPES.get(extname(target)) ?? 'application/octet-stream',
    'content-length': content.byteLength,
    // The bundle is rebuilt while the studio is running and the model is the
    // point of the page. Nothing here is worth caching for a developer.
    'cache-control': 'no-store',
  })
  response.end(content)
}

// --------------------------------------------------------------------------
// Requests and responses.
// --------------------------------------------------------------------------

/**
 * The path, split and percent-decoded, or `undefined` if it does not decode.
 *
 * Decoding happens here and nowhere later, which is the order that matters: a
 * check run before decoding would pass `..%2F..%2Fetc` and hand a traversal to
 * whatever decoded it next.
 */
function decodePath(url: string): string[] | undefined {
  const raw = url.split('?')[0] ?? '/'
  try {
    return raw.replace(/^\//, '').split('/').map(decodeURIComponent)
  } catch {
    return undefined
  }
}

/** 127.0.0.1 or localhost, with or without a port. Anything else is a rebinding. */
function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return name === HOST || name === 'localhost' || name === '::1'
}

/**
 * The revision the request was made against, or `undefined` when this function
 * has already answered.
 *
 * Read before the body on purpose: a request that cannot say what model it was
 * made against is refused without this server having to hold its edit in memory
 * first. ADR 0025 has why absent is a refusal rather than a default.
 */
function revisionOf(request: IncomingMessage, response: ServerResponse): number | undefined {
  const header = request.headers[REVISION_HEADER]
  const parsed = parseRevision(Array.isArray(header) ? header[0] : header)
  if (isPatchError(parsed)) {
    send(response, 400, { error: parsed.error, code: 'no-revision' })
    return undefined
  }
  return parsed.value
}

/**
 * Whether the request said it was JSON, answering it itself when it did not.
 *
 * The content type is required rather than sniffed. It is what makes a mutation
 * a preflighted cross-origin request, which is what a page on another origin
 * cannot get past a server that never sends an `access-control-allow-origin`.
 * So it is asked even of a mutation with nothing in its body to parse.
 */
function requiresJson(request: IncomingMessage, response: ServerResponse): boolean {
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
  if (type === 'application/json') return true
  send(response, 415, {
    error: 'this endpoint takes `content-type: application/json`',
    code: 'unsupported-media-type',
  })
  return false
}

/**
 * The parsed JSON body, or `undefined` when this function has already answered.
 *
 * The caller has already asked `requiresJson`, which is why that is a separate
 * function: the two questions are asked in a deliberate order and one route has
 * the first and no body to read at all.
 */
async function readJsonBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<unknown | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      send(response, 413, { error: 'the request body is too large', code: 'too-large' })
      request.destroy()
      return undefined
    }
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    send(response, 400, {
      error: `the request body is not JSON: ${messageOf(error)}`,
      code: 'bad-request',
    })
    return undefined
  }
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  if (response.writableEnded) return
  // Two spaces, so that a `curl` of any of this is readable without a formatter,
  // and a trailing newline for the same reason. ADR 0006 wants a human, an
  // Actions step and an agent to all get on with the same output.
  const text = `${JSON.stringify(payload, null, 2)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  response.end(text)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Open the developer's browser, and shrug if it does not work.
 *
 * A studio that failed to launch a browser is a studio with a URL on stderr,
 * which is what `--no-open` asks for anyway, so this never fails the command.
 */
function openBrowser(url: string, log: (message: string) => void): void {
  // `start` on Windows takes a window title first and would otherwise read the
  // URL as one, which is why the empty string is there.
  const launcher: { command: string; args: string[] } =
    process.platform === 'win32'
      ? { command: 'cmd', args: ['/c', 'start', '', url] }
      : process.platform === 'darwin'
        ? { command: 'open', args: [url] }
        : { command: 'xdg-open', args: [url] }
  try {
    const child = spawn(launcher.command, launcher.args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', (error) => log(`could not open a browser: ${error.message}`))
    child.unref()
  } catch (error) {
    log(`could not open a browser: ${messageOf(error)}`)
  }
}
