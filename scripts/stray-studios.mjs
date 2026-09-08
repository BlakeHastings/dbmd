// Which studios are still listening, on which port, and which one is the owner's.
//
// `working-an-issue.md` tells an agent to stop the server it started, by its own
// process, before its worktree is removed. That rule is broken constantly and it
// is broken most often by the orchestrator: `handoff.md` records twenty two left
// running in one session, and four more were found hours after the fact in the
// session that wrote this. Nobody notices, because a studio that is still
// listening looks exactly like nothing at all.
//
// So this is the fourth constraint applied to a rule that is otherwise only ever
// repeated: whatever prevention you have, add detection, because detection runs
// on the result and a bound port is the one thing a forgotten stop cannot avoid
// producing.
//
// **It stops nothing.** Killing a studio is a decision about somebody else's
// window and it stays with a person, which is why the owner's is singled out
// below rather than filtered out.
//
// **It asks the ports, not the process table.** The first version matched any
// command line containing the word "studio" and reported eight processes: five
// `npm run studio:dev` shell wrappers around one server, that server twice
// because a `cmd.exe` carrying it as an argument matched too, and the PowerShell
// query doing the asking. A studio is a thing listening on a port, so the
// listeners are the right question and every wrapper falls away for free.
//
//   node scripts/stray-studios.mjs
import { execFileSync } from 'node:child_process'

const powershell = (command) =>
  execFileSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }).trim()

/** Every loopback listener as `{ port, pid }`. */
function listeners() {
  if (process.platform === 'win32') {
    const json = powershell(
      "Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue |" +
        ' Select-Object LocalPort, OwningProcess | ConvertTo-Json -Compress',
    )
    if (json === '') return []
    const rows = JSON.parse(json)
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      port: r.LocalPort,
      pid: r.OwningProcess,
    }))
  }
  // `lsof` is the portable-enough answer and its absence is not a failure worth
  // a stack trace: on a machine without it this reports nothing and says so.
  try {
    return execFileSync('lsof', ['-nP', '-iTCP@127.0.0.1', '-sTCP:LISTEN', '-Fpn'], {
      encoding: 'utf8',
    })
      .split('\n')
      .reduce((out, line) => {
        if (line.startsWith('p')) out.push({ pid: Number(line.slice(1)), port: undefined })
        else if (line.startsWith('n') && out.length > 0) {
          out[out.length - 1].port = Number(line.split(':').pop())
        }
        return out
      }, [])
  } catch {
    return []
  }
}

/** The command line of one process, or '' where it cannot be read. */
function commandOf(pid) {
  try {
    if (process.platform === 'win32') {
      return powershell(
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      )
    }
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// The owner's is started through `npm run studio`, which is `studio-dev.mjs`
// pointed at the tracked `examples/shop`. An agent's is always `dist/cli.js
// studio` pointed somewhere else, because `working-an-issue.md` forbids the
// other shape. That is the discriminator, and it is a claim about this
// repository's own rules rather than about processes in general.
const OWNERS = /scripts[/\\]studio-dev\.mjs/
const AGENTS = /dist[/\\]cli\.js["']?\s+studio\b/

const seen = new Set()
const studios = []

for (const { port, pid } of listeners()) {
  if (pid === process.pid || seen.has(pid)) continue
  const command = commandOf(pid)
  if (!OWNERS.test(command) && !AGENTS.test(command)) continue
  seen.add(pid)
  studios.push({ port, pid, command, owners: OWNERS.test(command) })
}

if (studios.length === 0) {
  console.log('No studio is listening.')
  process.exit(0)
}

/** The model directory, which is what tells two of these apart at a glance. */
const modelOf = (command) => {
  if (OWNERS.test(command)) return 'examples/shop, the tracked one'
  const after = command.split(/\bstudio\b/)[1] ?? ''
  const first = after.trim().split(/\s+/)[0] ?? ''
  return first.startsWith('-') || first === '' ? '(the default)' : first
}

console.log(`${studios.length} studio(s) listening.\n`)

for (const s of studios.sort((a, b) => a.port - b.port)) {
  console.log(
    `${s.owners ? "OWNER'S" : '  stray'}  http://127.0.0.1:${s.port}/  pid ${s.pid}`,
  )
  console.log(`          ${modelOf(s.command)}`)
}

const strays = studios.filter((s) => !s.owners).length
console.log(
  strays === 0
    ? "\nOnly the owner's. Nothing to stop."
    : `\n${strays} ${strays === 1 ? 'was' : 'were'} started by an agent or by the orchestrator` +
        '\nand should have been stopped by whoever started them. Stop them by pid, never with' +
        '\na global node kill: other agents are working in other worktrees on this machine.' +
        "\n\nThe owner's is not yours to stop. Its address was given to them.",
)
