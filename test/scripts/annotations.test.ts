// What `npm run annotations` does, checked against a server that is there and
// against one that is not.
//
// WHY A STUB SERVER RATHER THAN THE REAL ONE
// `agentation-mcp` is the owner's, it runs on one machine, and its store is
// shared with whatever else they have annotated. A test that talked to it would
// pass or fail on what somebody clicked on a different project this afternoon,
// and CI has no server at all. So this stands up thirty lines of `node:http`
// that answer the three messages the script sends, and the parts being checked
// are the script's: the handshake it performs, the session it filters to, and
// what it says about the ones it left out.
//
// WHY THE NO-SERVER CASE IS THE ONE THAT MATTERS MOST
// `CONTRIBUTING.md` promises the toolbar works with no server at all. A reader
// that threw would contradict that promise, and ADR 0034 is the record saying a
// guard nobody has watched fail is not believed. So the closed-port case is run
// here rather than reasoned about, both ways round: reading exits zero, and
// answering, which is a request that did not happen, exits one.
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'annotations.mjs')

const PAGE = 'http://127.0.0.1:51234/'
const OTHER = 'http://127.0.0.1:4300/'

const SESSIONS = [
  { id: 'ours', url: PAGE, status: 'active', createdAt: '2026-09-08T00:00:00.000Z' },
  { id: 'theirs', url: OTHER, status: 'active', createdAt: '2026-09-04T00:00:00.000Z' },
  { id: 'theirs-too', url: `${OTHER}questions`, status: 'active', createdAt: '2026-09-04T00:00:00.000Z' },
]

const ANNOTATIONS: Record<string, unknown[]> = {
  ours: [
    {
      id: 'a1',
      comment: 'The shipments box is taller than the others.',
      element: 'header',
      elementPath: '.scene > .boxes > #table-shipments > header',
      status: 'acknowledged',
      createdAt: '2026-09-08T00:10:00.000Z',
      thread: [{ role: 'agent', content: 'Which of the two do you mean?' }],
    },
  ],
  theirs: [
    {
      id: 'b1',
      comment: 'This belongs to another project entirely.',
      status: 'pending',
      createdAt: '2026-09-04T00:10:00.000Z',
    },
  ],
  'theirs-too': [],
}

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}

/** The script, with the endpoint it reads set to whatever this test wants. */
function run(endpoint: string, args: string[] = []): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, DBMD_AGENTATION_ENDPOINT: endpoint },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (out += chunk))
    child.stderr.on('data', (chunk: string) => (err += chunk))
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 0, out, err }))
  })
}

/** What the server was asked to do, so a test can check it was asked at all. */
const answered: { name: string; args: Record<string, unknown> }[] = []

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (text += chunk))
    request.on('end', () => resolve(text))
  })
}

/** One JSON-RPC result, in the single SSE frame the real server sends. */
function frame(response: ServerResponse, id: number, payload: unknown): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const result = { content: [{ type: 'text', text: JSON.stringify(payload) }] }
  response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`)
}

let server: Server
let endpoint: string

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', mode: 'local' }))
      return
    }
    void body(request).then((text) => {
      const message = JSON.parse(text || '{}') as {
        id?: number
        method?: string
        params?: { name?: string; arguments?: Record<string, unknown> }
      }
      if (message.method === 'initialize') {
        // The session id arrives on a header and every later request carries it
        // back. That is the one thing about this transport a client has to know.
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'mcp-session-id': 'stub-session',
        })
        response.end(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: '2025-06-18', capabilities: {} },
          })}\n\n`,
        )
        return
      }
      if (message.method === 'notifications/initialized') {
        response.writeHead(202).end()
        return
      }
      if (request.headers['mcp-session-id'] !== 'stub-session') {
        response.writeHead(400).end()
        return
      }
      const name = message.params?.name ?? ''
      const args = message.params?.arguments ?? {}
      answered.push({ name, args })
      if (name === 'agentation_list_sessions') {
        frame(response, message.id ?? 0, { sessions: SESSIONS })
        return
      }
      if (name === 'agentation_get_session') {
        const id = String(args['sessionId'])
        frame(response, message.id ?? 0, { id, annotations: ANNOTATIONS[id] ?? [] })
        return
      }
      frame(response, message.id ?? 0, { ok: true })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('reading', () => {
  test('a named page is read, and the rest of the store is counted rather than hidden', async () => {
    const ran = await run(endpoint, ['--url', PAGE])
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('The shipments box is taller than the others.')
    expect(ran.out).toContain('.scene > .boxes > #table-shipments > header')
    expect(ran.out).toContain('1 annotation: 1 acknowledged')
    // The point of the line: it says how much was left out and on how many
    // origins, so nobody reads an empty page as an empty store.
    expect(ran.out).toContain('1 for that page, of 3 on the server; the other 2 are 1 other origin')
    expect(ran.out).not.toContain('This belongs to another project entirely.')
  })

  test('the thread is printed, because half a conversation is worse than none', async () => {
    const ran = await run(endpoint, ['--url', PAGE])
    expect(ran.out).toContain('agent: Which of the two do you mean?')
  })

  test('--all reads every session and says that is what it did', async () => {
    const ran = await run(endpoint, ['--all'])
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('every one of them, because you asked for --all')
    expect(ran.out).toContain('This belongs to another project entirely.')
    expect(ran.out).toContain('The shipments box is taller than the others.')
  })
})

describe('answering', () => {
  test('a reply is one tool call with the id and the message on it', async () => {
    answered.length = 0
    const ran = await run(endpoint, ['--reply', 'a1', 'which', 'box'])
    expect(ran.code).toBe(0)
    expect(answered).toEqual([
      { name: 'agentation_reply', args: { annotationId: 'a1', message: 'which box' } },
    ])
  })

  test('a resolve carries the summary, and carries none when there is none', async () => {
    answered.length = 0
    await run(endpoint, ['--resolve', 'a1', 'made it shorter'])
    await run(endpoint, ['--resolve', 'a1'])
    expect(answered).toEqual([
      { name: 'agentation_resolve', args: { annotationId: 'a1', summary: 'made it shorter' } },
      { name: 'agentation_resolve', args: { annotationId: 'a1' } },
    ])
  })

  test('acknowledging carries nothing else, so a message is a refusal', async () => {
    const ran = await run(endpoint, ['--acknowledge', 'a1', 'a message'])
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('Use --reply to say something')
  })

  test('two answers at once are refused rather than half done', async () => {
    const ran = await run(endpoint, ['--reply', 'a1', '--resolve', 'a1'])
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('two different answers')
  })
})

describe('with nothing listening', () => {
  // A port nothing is on. `listen(0)` then `close()` is the only way to name one
  // that was free a moment ago rather than one that looks unlikely.
  let closed: string

  beforeAll(async () => {
    const shut = createServer()
    await new Promise<void>((resolve) => shut.listen(0, '127.0.0.1', resolve))
    closed = `http://127.0.0.1:${(shut.address() as AddressInfo).port}`
    await new Promise<void>((resolve) => shut.close(() => resolve()))
  })

  test('reading says so and exits zero, because the toolbar still works', async () => {
    const ran = await run(closed, ['--url', PAGE])
    expect(ran.code).toBe(0)
    expect(ran.out).toContain('which is not answering')
    expect(ran.out).toContain('still in the browser')
    expect(ran.out).toContain('agentation-mcp server')
  })

  test('answering exits one, because a request that did not happen is a failure', async () => {
    const ran = await run(closed, ['--reply', 'a1', 'hello'])
    expect(ran.code).toBe(1)
    expect(ran.err).toContain('this did not happen')
  })

  test('an empty endpoint is sync turned off, not a server that is down', async () => {
    const reading = await run('', ['--url', PAGE])
    expect(reading.code).toBe(0)
    expect(reading.out).toContain('DBMD_AGENTATION_ENDPOINT is empty')
    expect(reading.out).toContain('copies markdown to the clipboard')

    const answering = await run('', ['--reply', 'a1', 'hello'])
    expect(answering.code).toBe(1)
    expect(answering.err).toContain('no server to answer on')
  })
})
