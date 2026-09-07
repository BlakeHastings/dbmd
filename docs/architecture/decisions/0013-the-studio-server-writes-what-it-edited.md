# 0013. The studio server writes what it edited, and nothing outside the model directory

Refines ADR 0004, which decided that the studio is a view onto files and that
every edit writes through, debounced. This is what building that server turned
out to require.

## Context

ADR 0004 left three things unsaid that only appear once there is a request to
answer.

**What the server holds between requests.** "The files are the state" is a claim
about where the truth lives, not a claim that the server re-reads the whole
directory on every keystroke. Something has to hold the model between a `PATCH`
and the write it is debouncing.

**What "never write a file you did not change" means.** `writeModel` already
compares each rendered file with what is on disk and skips a match, which was
taken to be the whole of it. It is not. A model directory a person wrote by hand
is rarely canonical: reading `examples/shop` and writing it straight back
rewrites four of its nine table files, none of which anybody edited. Handing the
writer the whole model after one drag therefore puts three unrelated files in the
developer's `git status`, which is precisely the noise ADR 0003 sells the format
as being free of.

**What a request is allowed to name.** The server writes files on behalf of a web
page, and a table called `../../etc/x` is a path traversal with a `PATCH` in
front of it.

## Decision

**The model in memory is a cache of the directory, and every write is followed by
a re-read.** The session adopts what the reader finds, so what the server serves
is what the files say rather than what it hoped it wrote. This is also what keeps
`referencesTo` and `groupMembers` honest, since both are computed by the reader
and an edit that changed a `ref` would otherwise leave them describing the model
as it was at startup. A read is dropped rather than adopted if an edit arrived
while it was in flight.

**The session tracks the files it edited and writes only those.** `writeModel`
takes an `only` set for this. Without it the call means "bring this directory
into canonical form", which is what an import wants and what a future `dbmd fmt`
will want; with it the call means "save this edit", which is what the studio
wants. Canonicalising a file is a thing to ask for, not a thing to be given.

**A request names an object, never a path.** The name is percent-decoded first,
then checked twice: once as a name that has to be one path segment, and again by
resolving it under the model root and refusing anything that landed outside.
The two are deliberately redundant. The first is a statement about the name and
can be argued with; the second asks the path library where the file actually is
and cannot.

**`node:http`, and three lines of it are security rather than plumbing.** It
binds to `127.0.0.1` explicitly, because `listen(port)` alone listens on every
interface. It refuses a request whose `Host` is not loopback, because binding to
loopback does not stop a name that resolves to it. It requires
`content-type: application/json` on a mutation, because that is what puts every
cross-origin mutation behind a preflight this server never answers.

## Consequences

- **A hand-written model stays hand-written** except for the files the developer
  actually edited in the studio. The cost is that the studio will not tidy a
  directory even when tidying it is obviously wanted, and that job now needs its
  own command.
- **`writeModel` has an option it did not have.** It is one filter and one
  branch, and the alternative was a second write path in the studio that would
  have had to reimplement the atomic replace and the unchanged comparison.
- **The re-read costs a directory scan per flush**, at most once every few
  hundred milliseconds during a drag. For a local model of tens of files that is
  not worth optimising, and the honesty is worth paying for.
- **The server is not the watcher.** A file edited by hand while the studio is
  running is not noticed until the next flush re-reads it, and until then a
  studio edit to the same table will write over it. dbmd-33 is that gap, and the
  re-read this record introduces is the thing it will hook into.
- **The refusals are visible.** A traversal, an unknown key, a table whose file
  did not parse, and a body that did not arrive as JSON are each a status and a
  message rather than a silently dropped field, because a patch this server half
  understood is a file it is about to overwrite with less than the caller meant.

## Revisit when

- **The studio edits `_model.md`, notes or groups.** The routes here are tables
  only, and the write-through is general, but the containment check and the patch
  parser both name tables today.
- **Two people, or two windows, edit the same model.** The in-memory cache is one
  session's, and the last write wins by construction. ADR 0004 already says that
  loopback and no authentication are wrong together the moment the studio serves
  more than one person, and this is the same trigger seen from the write side.
- **A flush becomes slow enough to feel.** Then the re-read is the thing to
  narrow first, to the files that were written, and the reason it is not narrowed
  today is that nobody has measured a model where it matters.

## Refined by 0019

The consequence above that says "the server is not the watcher", and that a
studio edit will write over a hand edit until dbmd-33 closes the gap, is no
longer true. ADR 0019 closes it, and closes it at the write rather than in the
watcher: the session re-reads immediately before writing and refuses any file
that no longer says what the edit was made against. Everything else here stands,
including that the in-memory model is a cache of the directory, that a write is
followed by a re-read, and that the session writes only the files it edited.

The one clause 0019 does amend rather than extend is "a read is dropped rather
than adopted if an edit arrived while it was in flight". That was right about the
edit and wrong about every other file: a hand edit to `customers.md` was thrown
away because a drag of `orders` was pending. A read is now adopted file by file,
keeping only the ones with unwritten edits.
