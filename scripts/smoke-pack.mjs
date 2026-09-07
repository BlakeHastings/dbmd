// Pack the tarball, install it somewhere else, and run the real binary.
//
// WHAT THIS PREVENTS
// The source tree has everything. The tarball is what ships, and the difference
// between the two is one line in `files` that nobody can see the effect of
// locally. Every test in this repository imports from `src/`, so every one of
// them passes over a package that installs and does nothing.
//
// The specific failure this is pointed at is the studio client bundle. It is
// generated into `dist/studio/client/` at build time rather than checked in, so
// it is exactly the kind of file a `files` entry forgets. If it does not ship,
// `npm i dbmd` succeeds, `dbmd studio` starts, the port opens, and the page is
// blank. Nothing short of asking the running server for the page catches that,
// which is why this fetches `/main.js` and looks at what comes back rather than
// checking that the socket accepted a connection.
//
// It also pins the two things about a binary that only exist outside this
// repository: the shebang has to survive `tsc`, and the entry has to be
// executable on a POSIX install even though it was produced on Windows. npm's
// bin linking is what sets that bit, so the only place to observe it is an
// installed package, and the assertion below is skipped on Windows because the
// bit does not exist there.
//
// WHY IT IS PART OF `npm run check`
// It costs about six seconds and it is the only thing in the repository that
// looks at the artefact users get. `prepublishOnly` runs `npm run check`, so on
// the day somebody publishes, this runs first.
//
//   node scripts/smoke-pack.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WINDOWS = process.platform === 'win32'

/** Long enough for `npm install` on a cold cache, short enough that CI fails rather than hangs. */
const INSTALL_TIMEOUT_MS = 180_000
/** A command that has printed its answer and not exited is a bug worth failing on. */
const COMMAND_TIMEOUT_MS = 60_000
/** How long to wait for the studio to narrate the URL it bound. */
const STUDIO_TIMEOUT_MS = 30_000

const failures = []
/** Everything to delete on the way out, whether or not the run succeeded. */
const cleanup = []

try {
  await smoke()
} finally {
  for (const path of cleanup.reverse()) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 5 })
    } catch (error) {
      // A leftover temp directory is worth a line and not worth a red build.
      console.error(`could not remove ${path}: ${error.message}`)
    }
  }
}

if (failures.length > 0) {
  console.error('\nThe packed tarball is not what ships:\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error(
    '\nThe source tree still has all of this. Check `files` and `bin` in\n' +
      'package.json, and that `prepack` built what the tarball needs.',
  )
  process.exit(1)
}

async function smoke() {
  const workspace = mkdtempSync(join(tmpdir(), 'dbmd-pack-'))
  cleanup.push(workspace)

  const tarball = await pack(workspace)
  const manifest = await inventory()
  report(manifest)

  const install = join(workspace, 'install')
  await mkdir(install, { recursive: true })
  // A package.json with no dependencies, so `npm install <tarball>` writes the
  // whole tree rather than reconciling one, and so npm does not walk up out of
  // the temp directory looking for a project to be part of.
  writeFileSync(
    join(install, 'package.json'),
    `${JSON.stringify({ name: 'dbmd-smoke', version: '0.0.0', private: true }, null, 2)}\n`,
  )

  const installed = await run(
    'npm',
    ['install', tarball, '--no-audit', '--no-fund', '--prefer-offline', '--loglevel=error'],
    { cwd: install, timeout: INSTALL_TIMEOUT_MS, shell: WINDOWS },
  )
  if (installed.code !== 0) {
    failures.push(`npm install of the tarball exited ${installed.code}: ${installed.stderr.trim()}`)
    return
  }

  console.log(`Installed it into ${install}.`)
  checkTheEntryPoint(install)
  const commands = await checkTheCommands(install, manifest.version)
  console.log(`Ran the installed binary: ${commands.join(', ')}.`)
  await checkTheStudio(install)
  console.log('Asked the running studio for its page, its client bundle and its model.')
  await checkTheLibrary(install)
  console.log('Imported both entry points a consumer is offered.')
}

// --------------------------------------------------------------------------
// Building the artefact, and saying how big it is.
// --------------------------------------------------------------------------

/** The real pack, lifecycle scripts and all, because `prepack` building is the thing under test. */
async function pack(workspace) {
  const packed = await run('npm', ['pack', '--pack-destination', workspace], {
    cwd: ROOT,
    timeout: INSTALL_TIMEOUT_MS,
    shell: WINDOWS,
  })
  if (packed.code !== 0) throw new Error(`npm pack exited ${packed.code}\n${packed.stderr}`)
  // The filename is the last thing `npm pack` writes to stdout. Everything
  // before it belongs to `prepack`, whose build prints a line of its own.
  const name = packed.stdout.trim().split(/\r?\n/).at(-1)
  if (!name?.endsWith('.tgz')) {
    throw new Error(`npm pack said it succeeded but named no tarball:\n${packed.stdout}`)
  }
  return join(workspace, name)
}

/**
 * What is in the tarball, as numbers.
 *
 * A second `npm pack`, dry and with the scripts off, because `--json` and a
 * lifecycle script cannot both have stdout: the build's own line lands in the
 * middle of the JSON. This one reads the `dist/` the real pack just built, so
 * it describes the same bytes.
 */
async function inventory() {
  const listed = await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    timeout: COMMAND_TIMEOUT_MS,
    shell: WINDOWS,
  })
  if (listed.code !== 0) throw new Error(`npm pack --json exited ${listed.code}\n${listed.stderr}`)
  const [entry] = JSON.parse(listed.stdout)
  return entry
}

function report(manifest) {
  const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`
  console.log(
    `Packed ${manifest.filename}: ${kb(manifest.size)} packed, ` +
      `${kb(manifest.unpackedSize)} unpacked, ${manifest.entryCount} files.`,
  )
}

// --------------------------------------------------------------------------
// What only an installed package can be asked.
// --------------------------------------------------------------------------

/**
 * The shebang, and the bit that makes it matter.
 *
 * `tsc` emits the shebang because it is the first comment in the file, which is
 * behaviour rather than a promise, so it is asserted rather than assumed. The
 * executable bit is npm's doing: `dist/cli.js` is mode 0644 inside a tarball
 * built on Windows, and npm's bin linking chmods the target on the way in. That
 * is the whole reason `npx dbmd` works at all on Linux and the reason this
 * cannot be checked from the repository.
 */
function checkTheEntryPoint(install) {
  const entry = join(install, 'node_modules', 'dbmd', 'dist', 'cli.js')
  let source
  try {
    source = readFileSync(entry, 'utf8')
  } catch {
    // npm forces whatever `bin` names into the tarball regardless of `files`,
    // so getting here means `bin` points at a path the build does not produce.
    failures.push(`there is no ${entry}, so "bin" names a file the build does not write`)
    return
  }
  if (!source.startsWith('#!/usr/bin/env node')) {
    failures.push('dist/cli.js has no shebang, so a POSIX install cannot exec it')
  }
  if (!WINDOWS && (statSync(entry).mode & 0o111) === 0) {
    failures.push('dist/cli.js is not executable after install, so the bin link is a dead file')
  }
}

/**
 * Every command the binary says it has, driven through the installed shim.
 *
 * The command list is read from `--help` rather than written here, so a command
 * added to the CLI is covered by this the day it lands, and a command that is
 * advertised but not dispatchable fails here rather than in front of somebody.
 * That is the cheap half. The other half is driving `init`, `check` and `export`
 * for real, which cannot be generated from a help listing because each one needs
 * arguments only somebody who knows the command can supply, and which is the
 * half that proves more than "the module loaded".
 *
 * Every one of them is asserted on what it said and not only on what it
 * returned. An exit code is a coarse instrument here: `dbmd check` exits 0 for
 * a model with warnings on purpose, `--help` exits 0 having printed nothing,
 * and a command that narrates onto stdout exits 0 too. Each of those is a
 * regression a user meets on their first command, and none of them moves a
 * code.
 */
async function checkTheCommands(install, version) {
  const printed = await dbmd(install, ['--version'])
  if (printed.code !== 0 || printed.stdout.trim() !== version) {
    failures.push(
      `dbmd --version said "${printed.stdout.trim()}" (exit ${printed.code}), expected "${version}"`,
    )
    // Nothing else will work either, and one line is more useful than ten.
    return ['--version']
  }

  const help = await dbmd(install, ['--help'])
  const commands = namedCommands(help.stdout)
  if (commands.length === 0) {
    failures.push('dbmd --help listed no commands, so there is nothing to smoke')
    return ['--version', '--help']
  }
  for (const command of commands) {
    const answered = await dbmd(install, [command, '--help'])
    // The usage line and the stream it arrived on, rather than the exit code. A
    // command whose help is empty exits 0, and `--help` is a document the caller
    // asked for, so ADR 0006 puts it on stdout and not in the narration.
    if (answered.code !== 0 || !answered.stdout.includes(`Usage: dbmd ${command}`)) {
      failures.push(
        `dbmd ${command} --help exited ${answered.code} and put no usage on stdout: ` +
          `${firstLine(answered.stderr)}`,
      )
    }
  }

  const ran = ['--version', '--help', ...commands.map((command) => `${command} --help`)]

  const model = join(install, 'model')
  const created = await dbmd(install, ['init', model])
  // `init` has no data to emit, so all of what it says is narration, and an
  // empty stdout beside a stderr naming the directory is ADR 0006's split seen
  // on a real pair of descriptors rather than on a captured `Environment`.
  // `test/cli/cli.test.ts` says in its own header that this is the half it
  // cannot prove.
  if (created.code !== 0 || created.stdout !== '' || !created.stderr.includes(model)) {
    failures.push(
      `dbmd init exited ${created.code}, put ${created.stdout.length} bytes on stdout and did ` +
        `not narrate ${model} on stderr: ${firstLine(created.stderr)}`,
    )
    return ran
  }
  // The words, not the code. `dbmd check` exits 0 for a model with warnings by
  // design (ADR 0020), so an exit code cannot tell a clean scaffold from one
  // that warns at every new user on their first command. `no problems` is the
  // clause that carries the claim; the rest of the sentence counts tables and is
  // prose ADR 0006 leaves free to be reworded, so the clause is all that is
  // asserted.
  const checked = await dbmd(install, ['check', model])
  if (checked.code !== 0 || !checked.stderr.includes('no problems')) {
    failures.push(
      `dbmd check over what init wrote exited ${checked.code} and did not say "no problems": ` +
        `${lastLine(checked.stderr)}`,
    )
  }
  // Again under `--strict`, which is the boundary ADR 0020 moves and so the only
  // place a warning in the scaffold would ever reach an exit code. The pair says
  // "nothing at all to report", which is more than either line says alone.
  const strict = await dbmd(install, ['check', model, '--strict'])
  if (strict.code !== 0 || !strict.stderr.includes('no problems')) {
    failures.push(
      `dbmd check --strict over what init wrote exited ${strict.code} and did not say ` +
        `"no problems", so the scaffold a new user starts from is not clean: ` +
        `${lastLine(strict.stderr)}`,
    )
  }
  // `--stdout` rather than the write, for two reasons: it leaves the model
  // exactly as `init` wrote it for the studio to read next, and it is the one
  // command here whose answer is data on stdout, so it is the one that can show
  // ADR 0006's stream split surviving into an installed binary.
  const exported = await dbmd(install, ['export', model, '--stdout'])
  if (exported.code !== 0 || !exported.stdout.includes('erDiagram')) {
    failures.push(
      `dbmd export --stdout exited ${exported.code} and put no diagram on stdout: ` +
        `${firstLine(exported.stderr)}`,
    )
  }
  return [...ran, 'init', 'check', 'check --strict', 'export --stdout']
}

/** The command names out of the root help, which lists them one per indented line. */
function namedCommands(help) {
  const body = help.split('Commands:')[1]?.split('\nOptions:')[0] ?? ''
  return body
    .split(/\r?\n/)
    .map((line) => /^ {2}(\S+)\s{2,}\S/.exec(line)?.[1])
    .filter((name) => name !== undefined)
}

/**
 * The studio, asked for its page rather than for a connection.
 *
 * A port that accepts is not evidence: the failure this exists for is a client
 * bundle that did not ship, and that failure serves a page. So both files the
 * page is made of are fetched and looked at, and the model the server was
 * pointed at is read back through the API.
 *
 * This one is started as `node <entry>` rather than through the bin shim, on
 * both platforms, because it is the only long-running child here and it has to
 * be stoppable by its own pid. On Windows the shim is a `.cmd` that needs a
 * shell, and killing the shell leaves the node process behind. The shim is
 * covered by every other command above.
 */
async function checkTheStudio(install) {
  const entry = join(install, 'node_modules', 'dbmd', 'dist', 'cli.js')
  const model = join(install, 'model')
  const studio = spawn(process.execPath, [entry, 'studio', model, '--no-open', '--port', '0'], {
    cwd: install,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const url = await boundUrl(studio)
    if (url === undefined) {
      failures.push('dbmd studio never printed the URL it bound, so it did not start')
      return
    }

    const page = await get(`${url}`)
    if (page.status !== 200 || !page.body.includes('<title>dbmd studio</title>')) {
      failures.push(`GET ${url} returned ${page.status} and did not look like the studio page`)
    }
    // `index.html` loads this with a module script tag. If `files` dropped it,
    // everything above still passes and the page renders nothing at all.
    const bundle = await get(`${url}main.js`)
    if (bundle.status !== 200 || bundle.body.length < 1000) {
      failures.push(
        `GET ${url}main.js returned ${bundle.status} and ${bundle.body.length} bytes: ` +
          'the studio client bundle is not in the tarball, so the page would be blank',
      )
    }
    const api = await get(`${url}api/model`)
    if (api.status !== 200 || !api.body.includes('"tables"')) {
      failures.push(`GET ${url}api/model returned ${api.status}, so the server read no model`)
    }
  } finally {
    studio.kill('SIGINT')
    await new Promise((resolve) => studio.once('exit', resolve))
  }
}

/**
 * The two entry points `exports` promises, imported by name from outside.
 *
 * `exports` is a promise about paths made in a file that nothing type-checks
 * against the tarball: a name in the map pointing at something `files` did not
 * ship is a package that installs cleanly and throws ERR_MODULE_NOT_FOUND on
 * the consumer's first import. It is also the half of the surface that no
 * amount of running the binary exercises, since the binary reaches its own
 * modules by relative path and never asks the resolver about the package name.
 */
async function checkTheLibrary(install) {
  const probe = join(install, 'probe.mjs')
  writeFileSync(
    probe,
    "import { readModel, writeModel } from 'dbmd'\n" +
      "import { startStudio } from 'dbmd/studio'\n" +
      'const missing = [\n' +
      "  ['dbmd readModel', readModel],\n" +
      "  ['dbmd writeModel', writeModel],\n" +
      "  ['dbmd/studio startStudio', startStudio],\n" +
      "].filter(([, value]) => typeof value !== 'function').map(([name]) => name)\n" +
      "if (missing.length > 0) throw new Error(`not a function: ${missing.join(', ')}`)\n" +
      "console.log('ok')\n",
  )
  const imported = await run(process.execPath, [probe], {
    cwd: install,
    timeout: COMMAND_TIMEOUT_MS,
    shell: false,
  })
  if (imported.code !== 0) {
    failures.push(
      `importing "dbmd" and "dbmd/studio" from an installed copy failed: ` +
        `${firstLine(imported.stderr)}`,
    )
  }
}

function firstLine(text) {
  return text.trim().split(/\r?\n/).find(Boolean) ?? '(no output)'
}

/**
 * The last thing a report said.
 *
 * `dbmd check` groups its diagnostics under file headings and puts the tally
 * last, so the first line of a failing run is a path and the last one is the
 * count. The count is what says whether a scaffold that stopped being clean
 * grew an error or a warning, which is the whole distinction these assertions
 * exist for.
 */
function lastLine(text) {
  return text.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '(no output)'
}

/** The URL from the server's narration, which is on stderr and is the only place it appears. */
function boundUrl(studio) {
  return new Promise((resolve) => {
    let seen = ''
    const timer = setTimeout(() => resolve(undefined), STUDIO_TIMEOUT_MS)
    studio.stderr.setEncoding('utf8')
    studio.stderr.on('data', (chunk) => {
      seen += chunk
      const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(seen)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    })
    studio.once('exit', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
  })
}

async function get(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return { status: response.status, body: await response.text() }
  } catch (error) {
    return { status: 0, body: `request failed: ${error.message}` }
  }
}

// --------------------------------------------------------------------------
// Running things.
// --------------------------------------------------------------------------

/**
 * The installed binary, through the link npm made in `node_modules/.bin`.
 *
 * Not `node <entry>`: the link is the thing `npx dbmd` runs, and on POSIX
 * running it is what proves the shebang and the executable bit are both there.
 */
function dbmd(install, args) {
  const shim = join(install, 'node_modules', '.bin', WINDOWS ? 'dbmd.cmd' : 'dbmd')
  return run(shim, args, { cwd: install, timeout: COMMAND_TIMEOUT_MS, shell: WINDOWS })
}

function run(command, args, { cwd, timeout, shell }) {
  return new Promise((resolve, reject) => {
    // `shell` on Windows only, where npm and the bin shim are both `.cmd` files
    // that Node refuses to spawn directly. The whole line is built here and
    // handed over as one string with no argument array, because passing both is
    // deprecated and because cmd.exe would concatenate them itself anyway.
    const child = shell
      ? spawn([command, ...args].map(forCmd).join(' '), [], {
          cwd,
          shell: true,
          timeout,
          windowsHide: true,
        })
      : spawn(command, args, { cwd, timeout, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/**
 * One token of a `cmd.exe` command line.
 *
 * A path is quoted because it is a temp path and nothing promises it has no
 * spaces in it. A bare command name is **not**, and that is not tidiness:
 * `"npm"` in quotes makes cmd skip its `PATHEXT` search and run the
 * extensionless `npm` shell script that ships beside `npm.cmd`, which is a bash
 * script and fails with a missing-module error that says nothing about quoting.
 */
function forCmd(token) {
  return /[\s\\/]/.test(token) ? `"${token}"` : token
}
