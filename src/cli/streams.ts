/**
 * The two streams, and which line belongs on which.
 *
 * ADR 0006 rule 1: stdout is data, stderr is narration. `console.log` writes to
 * stdout and `console.error` writes to stderr, and on a terminal both look
 * identical, so narrating to stdout by habit is a mistake nobody sees until it
 * breaks somebody's pipe.
 *
 * This is deliberately two one-line functions and nothing else. dbmd-70 builds
 * the output module proper, with colour, `--json` and a test that forbids a
 * bare `console.log`; while there is one command, anything more would be a
 * framework designed for callers that do not exist yet. What these two buy in
 * the meantime is a grep: two names find every place in the CLI that writes.
 */

/** Data. Something another program might read. */
export function writeOut(text: string): void {
  process.stdout.write(text)
}

/** Narration. Progress, warnings, and what went wrong. */
export function writeErr(text: string): void {
  process.stderr.write(text)
}
