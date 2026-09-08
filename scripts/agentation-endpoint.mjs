// Where the feedback overlay posts its annotations, in one place.
//
// Several scripts need this and they must not disagree. `build-client.mjs --dev`
// compiles it into the bundle, because the toolbar is React and takes it as a
// prop; `studio-dev.mjs` narrates it and says whether anything answered; and
// `annotations.mjs` reads the annotations back through it. Two copies of a
// default port is two chances to move one and not the other, which is the same
// argument ADR 0026 makes about `isFileName`.
//
// This module is imported rather than run.

/**
 * The companion server's default, which is `agentation-mcp`'s own.
 *
 * `127.0.0.1` rather than `localhost`, for the reason the studio binds the same
 * literal: on Windows `localhost` can resolve to `::1` first, and a server
 * listening only on IPv4 is then unreachable under a name that looks right.
 */
const DEFAULT = 'http://127.0.0.1:4747'

/**
 * The endpoint, or `''` for "do not sync at all".
 *
 * `DBMD_AGENTATION_ENDPOINT` set to an empty string is how somebody turns the
 * sync half off and keeps the toolbar, which still copies markdown to the
 * clipboard and still keeps its annotations in `localStorage`. Unset is not the
 * same thing: unset means the owner has not thought about it and gets the
 * default, which is what the server they are running listens on.
 */
export function agentationEndpoint() {
  return process.env['DBMD_AGENTATION_ENDPOINT'] ?? DEFAULT
}
