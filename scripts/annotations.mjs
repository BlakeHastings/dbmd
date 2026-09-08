// Read the feedback the owner left on the studio, and answer it.
//
// WHAT THIS IS FOR
// `npm run studio:dev` puts a toolbar on the page: the owner clicks an element,
// writes a sentence, and the overlay posts it to `agentation-mcp`. That is the
// writing half and it shipped on 2026-09-07. Until this script there was
// nothing in this repository that could read any of it back, so the owner was
// annotating into silence and an agent had to be handed the text by hand.
//
//   npm run annotations
//   npm run annotations -- --all
//   npm run annotations -- --url http://127.0.0.1:57818/
//   npm run annotations -- --acknowledge <id>
//   npm run annotations -- --reply <id> "which of the two boxes do you mean?"
//   npm run annotations -- --resolve <id> "made it the same height as orders"
//
// WHY IT SPEAKS MCP OVER HTTP RATHER THAN IMPORTING A CLIENT
// `agentation-mcp` serves streamable HTTP MCP at `POST /mcp`. The whole
// handshake is an `initialize` that answers with an `mcp-session-id` header, a
// `notifications/initialized` that carries it back, and then `tools/call`. That
// is three `fetch` calls. A protocol client to make three `fetch` calls would
// be a dependency, and ADR 0064 kept the writing half of this feature to
// devDependencies on purpose: `dbmd` is a tool people run with `npx` and
// install time is a feature. This script adds nothing to either list.
//
// WHY THE READ IS SESSIONS AND NOT `agentation_get_all_pending`
// Measured on 2026-09-08 against the running server: the store held eleven
// annotations across three sessions and `agentation_get_all_pending` returned
// zero. Pending means unacknowledged, so an annotation an agent has looked at
// leaves that view and never comes back, resolved or not. A reader built on it
// would have shown the owner's own history as empty, which is the failure this
// script exists to end rather than to repeat. So the read is
// `agentation_list_sessions` and `agentation_get_session`, every status is
// printed, and pending is a word on a line rather than the filter.
//
// WHY IT FILTERS, AND SAYS WHAT IT FILTERED
// The store is one per machine and is shared with everything else the owner
// annotates. On 2026-09-08 it held 177 sessions on 26 origins, of which exactly
// one was this studio's. Printing all of them would bury this repository's
// feedback in another repository's, and printing only ours without saying so
// would hide the fact that the store is shared. So the default is the studio's
// own page, the count of what was left out is on the summary line, and `--all`
// reads everything.
//
// The studio binds port `0`, so its URL is a different number every run and
// nothing on the server distinguishes its session from any other.
// `npm run studio:dev` writes down where it was listening, and
// `scripts/studio-url.mjs` is that record and the reason it exists.
//
// WHY A MISSING SERVER IS NOT AN ERROR WHEN READING, AND IS ONE WHEN ANSWERING
// `CONTRIBUTING.md` promises the toolbar works with no server at all, and it
// does: the annotations stay in the browser. A reader that threw would
// contradict a promise the page already keeps, so with nothing listening this
// says so, says how to start it, and exits zero. Answering is the other way
// round. `--reply` is a request to change something, and a request that did not
// happen is a failure however calmly it is worded, so those exit non-zero.
//
// ADR 0070.
//
//   node scripts/annotations.mjs
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { agentationEndpoint } from './agentation-endpoint.mjs'
import { lastStudioUrl } from './studio-url.mjs'

/** Long enough for a loopback server that is either there or is not. */
const TIMEOUT = 10_000

// ---------------------------------------------------------------------------
// What was asked for
// ---------------------------------------------------------------------------

/**
 * The command line, as one of the four things this does, or an explanation.
 *
 * The three answering flags are exclusive and each takes an id, so a caller who
 * writes two of them has asked for two different things at once and is told
 * rather than served the first one.
 */
export function parseArguments(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        all: { type: 'boolean' },
        url: { type: 'string' },
        acknowledge: { type: 'string' },
        reply: { type: 'string' },
        resolve: { type: 'string' },
      },
    })
  } catch (error) {
    return { error: error.message }
  }

  const { values, positionals } = parsed
  const answers = ['acknowledge', 'reply', 'resolve'].filter((name) => values[name] !== undefined)
  if (answers.length > 1) {
    return { error: `--${answers[0]} and --${answers[1]} are two different answers. Send one.` }
  }

  if (answers.length === 1) {
    const [action] = answers
    if (values.all || values.url !== undefined) {
      return { error: `--${action} answers one annotation by id, so --all and --url mean nothing.` }
    }
    const text = positionals.join(' ').trim()
    if (action === 'reply' && text === '') {
      return { error: 'A reply with no message says nothing. Put it in quotes after the id.' }
    }
    if (action === 'acknowledge' && text !== '') {
      return { error: 'Acknowledging carries no message. Use --reply to say something.' }
    }
    return { action, id: values[action], text }
  }

  if (values.all && values.url !== undefined) {
    return { error: '--all reads every page and --url reads one. Pick one.' }
  }
  if (positionals.length > 0) {
    return { error: `Nothing to do with: ${positionals.join(' ')}` }
  }
  return { action: 'read', all: Boolean(values.all), url: values.url }
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

/**
 * The one frame of an SSE body that answers a given request.
 *
 * The server replies to a `POST /mcp` with `text/event-stream` even when there
 * is exactly one message in it, and it may carry others. Matching on the id
 * rather than taking the first `data:` line is what keeps this true if it ever
 * sends a notification alongside the answer.
 */
export function readEvent(body, id) {
  const frames = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      try {
        return JSON.parse(line.slice('data:'.length))
      } catch {
        return null
      }
    })
    .filter(Boolean)
  return frames.find((frame) => frame.id === id) ?? null
}

/**
 * A connected client, or a throw.
 *
 * The session id comes back on a header rather than in the body, and every
 * later request has to carry it, which is the one thing about this transport
 * that is not obvious from the JSON-RPC.
 */
async function connect(endpoint) {
  let session = null
  let nextId = 0

  async function post(message) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    if (session) headers['mcp-session-id'] = session
    const response = await fetch(`${endpoint}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) {
      throw new Error(`${endpoint} answered ${response.status} to ${message.method}`)
    }
    session ??= response.headers.get('mcp-session-id')
    return response
  }

  const opened = await post({
    jsonrpc: '2.0',
    id: ++nextId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dbmd', version: '0.1.0' },
    },
  })
  await opened.text()
  if (!session) throw new Error(`${endpoint} opened no MCP session, so there is nothing to ask`)
  // Read and discard: the notification answers 202 with an empty body, and an
  // unread body holds the socket open past the point this has anything to do.
  await (await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).text()

  return {
    /** One tool call, with its JSON payload already parsed out of the text block. */
    async call(name, args) {
      const id = ++nextId
      const response = await post({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      const frame = readEvent(await response.text(), id)
      if (!frame) throw new Error(`${name} answered nothing this client could read`)
      if (frame.error) throw new Error(`${name} refused: ${frame.error.message}`)
      const text = frame.result?.content?.[0]?.text
      if (typeof text !== 'string') throw new Error(`${name} answered with no text to read`)
      if (frame.result.isError) throw new Error(`${name} refused: ${text}`)
      try {
        return JSON.parse(text)
      } catch {
        return { text }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Which sessions are ours
// ---------------------------------------------------------------------------

/**
 * The origin of a URL, or the URL itself when it will not parse.
 *
 * Sessions are keyed by page URL and the studio serves one page, so the origin
 * is the thing that identifies it: a query string or a fragment on the page
 * would otherwise read as somebody else's session.
 */
export function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/**
 * Split the store into this studio's sessions and everything else.
 *
 * `origin` of `null` means "no page was named", which is not the same as "no
 * session matched": the caller has to say something different in each case, and
 * conflating them is how a reader tells somebody their feedback is gone when
 * really it never asked for it.
 */
export function sessionsFor(sessions, origin) {
  if (origin === null) return { mine: [], others: sessions, origins: originCount(sessions) }
  const mine = sessions.filter((session) => originOf(session.url) === origin)
  const others = sessions.filter((session) => originOf(session.url) !== origin)
  return { mine, others, origins: originCount(others) }
}

function originCount(sessions) {
  return new Set(sessions.map((session) => originOf(session.url))).size
}

// ---------------------------------------------------------------------------
// What it looks like
// ---------------------------------------------------------------------------

/** The narration column `studio-dev.mjs` uses, so the two commands read alike. */
function line(label, text) {
  return `  ${label.padEnd(10)} ${text}`
}

/** Local, to the minute, because that is the resolution anybody thinks in. */
export function when(iso) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return String(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

/**
 * One annotation, as the lines a person reads.
 *
 * The comment is the owner's sentence and is never shortened. The path is what
 * an agent needs in order to find the code, and ADR 0064 is the reason it names
 * a table rather than one of eight identical boxes. The thread is printed whole:
 * it is a conversation, and half a conversation is worse than none.
 */
export function annotationLines(annotation, number) {
  const at = when(annotation.createdAt ?? annotation.timestamp)
  const lines = [`${number}. ${annotation.id}  ${annotation.status ?? 'pending'}  ${at}`]
  for (const paragraph of String(annotation.comment ?? '').split(/\r?\n/)) {
    lines.push(`   ${paragraph}`)
  }
  if (annotation.selectedText) lines.push(`   selected: ${annotation.selectedText}`)
  const where = [annotation.element, annotation.elementPath].filter(Boolean).join(' at ')
  if (where) lines.push(`   ${where}`)
  for (const reply of annotation.thread ?? []) {
    lines.push(`   ${reply.role ?? 'agent'}: ${reply.content ?? ''}`)
  }
  return lines
}

/** "3 annotations: 1 pending, 2 resolved", in the order a status is reached. */
export function tally(annotations) {
  const order = ['pending', 'acknowledged', 'resolved', 'dismissed']
  const counts = new Map()
  for (const annotation of annotations) {
    const status = annotation.status ?? 'pending'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const known = order.filter((status) => counts.has(status))
  const rest = [...counts.keys()].filter((status) => !order.includes(status)).sort()
  const parts = [...known, ...rest].map((status) => `${counts.get(status)} ${status}`)
  const total = `${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`
  return parts.length > 0 ? `${total}: ${parts.join(', ')}` : total
}

const HOW_TO_ANSWER = `
Answering is what tells the owner somebody read it:
  npm run annotations -- --acknowledge <id>
  npm run annotations -- --reply <id> "which of the two boxes do you mean?"
  npm run annotations -- --resolve <id> "made it the same height as orders"`

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

/** Whether anything is listening, asked the cheap way. `/health` needs no session. */
async function answering(endpoint) {
  try {
    const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

const HOW_TO_START =
  'Start it with "agentation-mcp server", or check it with "agentation-mcp doctor".'

async function read(endpoint, request) {
  const out = ['dbmd annotations', line('server', `${endpoint}, which answered`)]

  let origin = null
  if (request.url !== undefined) {
    origin = originOf(request.url)
    out.push(line('page', `${request.url}, which you named`))
  } else if (!request.all) {
    const recorded = await lastStudioUrl()
    if (recorded === null) {
      out.push(line('page', 'not known, because no studio in this checkout has written one down'))
    } else {
      origin = originOf(recorded.url)
      const at = recorded.startedAt ? `, from npm run studio:dev at ${when(recorded.startedAt)}` : ''
      out.push(line('page', `${recorded.url}${at}`))
    }
  }

  const client = await connect(endpoint)
  const all = (await client.call('agentation_list_sessions', {})).sessions ?? []

  const wanted = request.all ? { mine: all, others: [], origins: 0 } : sessionsFor(all, origin)
  out.push(line('sessions', describeSessions(wanted, all.length, request.all, origin)))

  const annotations = []
  for (const session of wanted.mine) {
    const full = await client.call('agentation_get_session', { sessionId: session.id })
    for (const annotation of full.annotations ?? []) {
      annotations.push({ ...annotation, sessionUrl: session.url })
    }
  }
  annotations.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  out.push(line('found', tally(annotations)))

  console.log(out.join('\n'))

  if (annotations.length === 0) {
    console.log(
      origin === null && !request.all
        ? '\nName a page with --url, or read every one of them with --all.'
        : '\nNothing has been annotated there yet. Run npm run studio:dev and click something.',
    )
    return 0
  }

  annotations.forEach((annotation, index) => {
    console.log(`\n${annotationLines(annotation, index + 1).join('\n')}`)
    if (request.all) console.log(`   on ${annotation.sessionUrl}`)
  })
  console.log(HOW_TO_ANSWER)
  return 0
}

function describeSessions(wanted, total, all, origin) {
  if (all) return `${total} on the server, every one of them, because you asked for --all`
  if (origin === null) return `${total} on the server, and no page named to choose between them`
  const left = wanted.others.length
  const mine = `${wanted.mine.length} for that page, of ${total} on the server`
  if (left === 0) return mine
  const origins = `${wanted.origins} other origin${wanted.origins === 1 ? '' : 's'}`
  return `${mine}; the other ${left} are ${origins} on this machine`
}

const ANSWERS = {
  acknowledge: {
    tool: 'agentation_acknowledge',
    args: (id) => ({ annotationId: id }),
    said: () => 'acknowledged, so the toolbar shows it has been seen',
  },
  reply: {
    tool: 'agentation_reply',
    args: (id, text) => ({ annotationId: id, message: text }),
    said: (text) => `replied: ${text}`,
  },
  resolve: {
    tool: 'agentation_resolve',
    args: (id, text) => ({ annotationId: id, ...(text ? { summary: text } : {}) }),
    said: (text) => (text ? `resolved: ${text}` : 'resolved, with no summary'),
  },
}

async function answer(endpoint, request) {
  const { tool, args, said } = ANSWERS[request.action]
  const client = await connect(endpoint)
  await client.call(tool, args(request.id, request.text))
  console.log(`${request.id} ${said(request.text)}`)
  return 0
}

async function main() {
  const request = parseArguments(process.argv.slice(2))
  if (request.error) {
    console.error(request.error)
    console.error(HOW_TO_ANSWER)
    return 1
  }

  const endpoint = agentationEndpoint()
  if (endpoint === '') {
    if (request.action !== 'read') {
      console.error('DBMD_AGENTATION_ENDPOINT is empty, so there is no server to answer on.')
      return 1
    }
    console.log(
      'dbmd annotations\n' +
        line('server', 'none, because DBMD_AGENTATION_ENDPOINT is empty\n') +
        'Nothing is being synced, so there is nothing here to read. The toolbar still\n' +
        'annotates and still copies markdown to the clipboard.',
    )
    return 0
  }

  if (!(await answering(endpoint))) {
    if (request.action !== 'read') {
      console.error(`${endpoint} is not answering, so this did not happen.\n${HOW_TO_START}`)
      return 1
    }
    console.log(
      'dbmd annotations\n' +
        line('server', `${endpoint}, which is not answering\n`) +
        'Anything annotated is still in the browser, which is what the toolbar promises,\n' +
        `and nothing here can read it until the server is up.\n${HOW_TO_START}`,
    )
    return 0
  }

  return request.action === 'read' ? read(endpoint, request) : answer(endpoint, request)
}

// Imported by its tests, run by `npm run annotations`. The pure halves above are
// the parts worth checking without a server, and importing a module must not
// start making requests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
