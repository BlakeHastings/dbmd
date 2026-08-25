# 0004. The studio edits files, and there is no other state

## Context

`npx dbmd studio` opens a browser and lets a developer drag tables around and
edit columns. The question this record answers is what the studio *is*: a
diagram application that happens to import and export markdown, or a view onto
files that are the only state there is.

Everything downstream depends on which. A diagram application needs a document
model, a save action, a dirty-state indicator, conflict handling against the
disk, and an undo stack. A view onto files needs none of those, because git
already is the undo stack and the disk already is the document.

## Decision

**The files are the state. The studio holds no document the disk does not.**

Concretely:

- **Every edit writes through to disk**, debounced by a few hundred milliseconds
  so a drag is one write rather than sixty. There is no Save button, no dirty
  indicator, and no unsaved state to lose. The status line says when the last
  write landed.
- **Undo is `git checkout`**, and the studio says so in the interface rather
  than implementing a second, weaker undo that disagrees with git about what
  happened.
- **The studio watches the directory** and reloads when a file changes
  underneath it. Editing `orders.md` in an editor and seeing the box update is
  the same feature as the studio writing it, seen from the other side.
- **The server is bound to loopback only**, on an OS-assigned port by default.
  It reads and writes one directory, the model directory, and nothing outside
  it. There is no authentication because there is nothing to authenticate: it is
  a developer's own files, on their own machine, for as long as the command
  runs.

**The client is vanilla TypeScript and SVG, bundled with esbuild. No UI
framework and no diagram library.**

Rejected: React with a diagram library, which is what the reference tool uses
and is a defensible choice at its size. What it buys is multi-select, a minimap,
edge routing and auto-layout, none of which are in this MVP. What it costs is a
dependency tree and a build that agents will spend review time on rather than on
the format, in a tool whose entire UI is boxes, lines and a side panel. Boxes
are absolutely positioned elements, edges are one SVG overlay, and pan and zoom
are a CSS transform.

## Consequences

- **Write-through means a mis-drag reaches the working tree.** That is intended:
  the working tree is where the developer will look, and `git diff` is the
  review. It also means the studio must never write a file it failed to parse,
  and must never write outside the model directory. Both are things to test
  rather than intend.
- **A hand edit that is invalid mid-keystroke will be seen by the watcher.**
  The studio reports the parse failure on the affected table and keeps showing
  the last good version rather than emptying the canvas.
- **No auto-layout in the MVP**, so an import places tables on a deterministic
  grid and the developer arranges them once. That is a real gap the first import
  of a fifty-table database will feel.
- Hand-rolling pan, zoom and drag is a known quantity of work and a known source
  of fiddly bugs. The trade is taken with the revisit trigger below.

## Revisit when

- **Multi-select, a minimap, or auto-layout is genuinely wanted**, and the
  hand-rolled canvas would need more than about a week to get there. Then adopt
  the library and keep this record as the reason it was not adopted first.
- **The studio needs to serve more than one person**, at which point loopback,
  no authentication and write-through are all wrong together rather than
  individually.
