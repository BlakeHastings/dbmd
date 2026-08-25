# 0002. Write boundary, convention authority, and where the backlog lives

## Context

The delivery loop asks two questions before it starts, and they are independent:
may the factory write outward, and whose conventions govern. Answering them by
inference is the failure mode: a remote tells you the factory *can* write
somewhere, never that it *may*.

This repository was created empty by its owner, in their own source tree, for a
tool they intend to publish. There is no host repository and no host
conventions to defer to.

## Decision

**Write boundary: owned.** Recorded in `.git/factory/machine.md`, which is a
machine fact and is deliberately not committed: it is true for this operator on
this checkout, not for anyone who clones. Nobody who clones this repository
inherits an authority to write outward from it.

Owned does not mean unattended. Creating the GitHub repository, the first push,
and any publish to npm are each **one explicit step the owner asks for**, not
things the loop does because it may.

**Convention authority: ours.** There was nothing to conform to. The loop's own
conventions apply: `docs/architecture/decisions/` for decision records,
`docs/process/` for the two process docs, `<area>/<number>-<slug>` for branches,
and commit subjects that say why rather than what.

**The backlog is beads**, driven by `bd`. Not GitHub issues, and the reason is
that there is no remote yet: a loop whose queue cannot be created today is a
loop that cannot start today. beads supplies all eight verbs the loop needs,
including real parent/child and blocks edges, and it works offline.

**It is not in source control by default, and that was corrected rather than
assumed.** This version of beads stores issues in an embedded Dolt database
under `.beads/embeddeddolt/`, which its own `.gitignore` excludes, and its JSONL
export is off out of the box. So `export.auto` and `export.git-add` are turned
on, and `.beads/issues.jsonl` is committed. beads is explicit that this file is
an export and not the source of truth, so what the repository holds is a
readable copy of the queue rather than the queue.

For this project that copy is worth having anyway: a repository whose premise is
that the model belongs beside the code should not keep its own plan somewhere a
clone cannot see.

Ids are assigned explicitly, `dbmd-10`, not by hash. `bd` will generate
`dbmd-a3f2dd` if you let it, and branch names read better with numbers.

## Consequences

- Pull requests, when a remote exists, will carry the review record while the
  work item lives in beads. That split is the documented hybrid, not a mistake:
  the merge path stays GitHub's and the queue stays local.
- `bd init --skip-agents` was used. Bare `bd init` is an integration installer
  that writes `AGENTS.md`, `CLAUDE.md`, editor directories and a foreign skill,
  and commits all of it unasked.
- Every agent brief names its beads id, and `bd show <id>` is the first line of
  every reading order. An agent that compacts and loses its brief can recover it
  from the item; an agent briefed only in its dispatch message cannot.

## Revisit when

- **The owner asks for the GitHub repository.** The backlog does not have to
  move with it, and moving it is a decision to make deliberately rather than by
  drift. `references/backlog-port.md` has what would have to survive the port.
- **A second person works this repository.** The committed JSONL is a copy, not
  a sync. Two people writing to it produce a merge conflict in a file neither of
  them edited by hand, and that is the point at which the backlog either moves
  to GitHub issues or starts using a Dolt remote.
- **`bd init` commits on its own.** It did here, twice, sweeping an unrelated
  file into a commit called `bd init: initialize beads issue tracking`. Both
  were squashed away before anything depended on them. If beads is ever
  re-initialised in this repository, check `git log` afterwards.
