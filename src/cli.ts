#!/usr/bin/env node
/**
 * The `dbmd` binary.
 *
 * Everything except the shebang and the exit code lives in `cli/main.ts`, so
 * that the CLI can be run by a test without spawning a process and without a
 * module that exits out from under it. The shebang is what makes the file
 * executable on a Unix `npx`, and the `bin` mapping in `package.json` is what
 * makes it run on Windows; both are needed and neither is visible when the
 * thing is run as `node src/cli.ts`, which is why this is tested from a
 * packed tarball.
 *
 * `process.exitCode` rather than `process.exit`, so that stdout is flushed
 * before the process goes away. `dbmd export --stdout | head` losing its last
 * chunk would be a bug in this line and would look like a bug anywhere else.
 */
import { main } from './cli/main.js'

process.exitCode = await main(process.argv.slice(2))
