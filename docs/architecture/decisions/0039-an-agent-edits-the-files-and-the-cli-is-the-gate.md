# 0039. An agent edits the files and the CLI is the gate

## Context

dbmd-80 asked for a skill that teaches an agent to drive this tool. It could not
be written until somebody had driven the tool by hand long enough to know the
awkward parts, and on 2026-09-07 somebody had: the last command shipped, the
whole import journey ran against a real PostgreSQL container, and the studio was
driven through every edit it offers.

The item's own question was whether an agent goes through the CLI or edits the
markdown directly. That question turns out to be mis-shaped, and noticing why is
most of this record.

**The CLI has no edit command.** `dbmd init` and `dbmd import` create a model.
`dbmd check` and `dbmd export` read one. `dbmd studio` opens a server. Nothing
on the CLI changes a column. So "through the CLI" cannot mean that an edit is a
CLI invocation, and the real choice for the edit itself is between two surfaces
neither of which is a subcommand:

- **the markdown files**, with `dbmd check` afterwards, or
- **the studio's HTTP API**, which the studio's own page drives.

A refinement note on dbmd-80 argued for the second, and argued it well. The API
validates at the boundary, returns diagnostics with the response, carries a
revision so a stale edit is refused rather than lost, and `POST /api/flush` is a
real fence. The CLI offers none of that. The note's closing sentence is the one
worth answering: decide deliberately rather than defaulting to the CLI because
it is the thing with a manual page.

So the API was driven, with `curl`, against a copy of `examples/shop`, before
anything was written.

## Decision

**An agent edits the markdown files, hands each file it edited to the canonical
writer, and uses `dbmd check --json` as the gate. It does not drive the studio's
HTTP API.**

The skill is `.claude/skills/dbmd/SKILL.md`. It teaches one surface and says so
in its third paragraph, because a skill that teaches two without saying when to
use which is worse than one that picks.

### What the API measured as, rather than what it looked like

Four of the note's five claims hold. One does not, and two more turn out to be
about a problem the API creates.

**"It returns the diagnostics with the response" is not true.** A `PATCH` is
answered with the object and the session status: `lastWrite`, `pendingWrite`,
`writeError`, `conflicts`, `revision`. There is no `diagnostics` key on it.
Diagnostics are on `GET /api/model` alone, and that list is the same list
`dbmd check --json` prints. Measured, not read.

**"It validates at the boundary" holds, and is narrower than it sounds.** The
refusals are real and good. Sending `unique: true` on a column came back as a
400 saying:

```
unknown key `unique` on columns[0]; a column takes name, type, pk, nullable, default, ref
```

But that is the shape of one edit. It is not the model: no dangling ref, no
duplicate index, no missing primary key. Those need the whole-model pass, which
is `dbmd check`.

**"A revision refuses a stale edit" holds and is the API's best feature.** A
`PATCH` naming revision 99 against a studio on revision 0 came back 409 with a
sentence saying nothing was written and to read the model again. It guards
against a second writer during one server's life. An agent alone in a worktree
is guarded by git across all of them.

**"`POST /api/flush` is a real fence" holds, and it exists because the API needs
one.** A `PATCH` is answered before the file is written, on a debounce. A file
an agent writes is written when it writes it. The fence solves a problem the
other surface does not have.

**"An agent is told which refs move on a rename" is not something the server
does.** The server has create, patch and delete and no rename. The studio's
*client* does a rename as three requests in an order that never leaves a ref
dangling, with a `RenameStopped` error for the part-way case. Driving the API
means reimplementing that, and a rename is the edit most likely to be got wrong.

### And three things the API costs that the note does not price

**Its wire format says in its own source that it is still moving.** `wire.ts`,
above `COLUMN_KEYS`: "The format is still moving, so when a key is renamed or
added this is the function that changes." There is no version on it and no
reference page. The CLI's JSON carries `schema: 1` and `ok` on every response,
its codes are contracted by ADR 0014, and every one of them is documented with
its severity in `docs/format.md`. A skill is a durable artifact and outlives a
wire format.

**Prose over JSON is prose written badly.** ADR 0003 says the body is the point:
it is carried byte for byte and it is the half of the model a schema dump cannot
give you. On the API a body is a string with escaped newlines, replaced whole,
with no way to add a paragraph without resending the others. Making the most
valuable thing in the format the hardest thing to write is the wrong trade for
this tool.

**A server is stateful and an agent has to model it.** A debounce, a watcher, an
adopt-and-conflict machine, a revision counter, a port learned by parsing
stderr, and a process to kill. Every one is a thing that can surprise a caller.
A CLI invocation is a process that exits.

### The churning-diff objection, and why it does not land

The argument against editing markdown is ADR 0012's: anything that produces
model files goes through `writeModel`, or the canonical form stops being a
promise and the diffs churn.

**It is a real hazard and it is invisible to every check we have.** Measured: a
column added to `examples/shop` in flow style, in the wrong key order, passed
`dbmd check` with zero diagnostics. It stays passing until somebody drags that
table's box in the studio, at which point the whole frontmatter is rewritten and
the diff is attributed to moving a box.

**It does not force the API, because the canonical writer is not behind the
server.** `src/index.ts` exports `readModel`, `validate` and `writeModel`, and
`writeModel`'s `only` narrows a write to named files. Nine lines of Node read
the model and write back exactly the file the agent edited. Measured on the same
edit: `written: ["tables/products.md"]`, the file canonical, one file changed in
the directory, and a second run reported `skipped: [{ path, reason: "unchanged"
}]` and wrote nothing.

So the agent's edit does go through the canonical writer. It just does not go
through a socket to get there. That is the whole of the disagreement with the
note, and it is why the decision reads "edit the files" rather than "edit the
files and accept the churn".

### What the agent asks for that this does not give it

**"What points at this table."** The model holds `referencesTo` and no command
exposes it. `grep` is wrong for it, because `ref: orders.id` and the word
"orders" in a paragraph are the same string.

The skill's answer meanwhile is exact rather than a heuristic: every relationship
line `dbmd export` emits is generated from a `ref:` and from nothing else, one
line per ref, referenced table on the left.

```
dbmd export shop --stdout | grep -E '^  "customers" .* : '
```

It cannot match prose and it cannot miss a ref. It is still a grep over a
rendering, and `dbmd export` refuses a model with an error in it, which is
exactly the state you are in half way through a rename. dbmd-81 is the item for
a command, filed rather than built, because the skill's branch was not the place
for one.

## Consequences

- **The skill teaches a surface with no version negotiation in it.** `schema: 1`
  is the only thing it has to notice, and `ok` and the exit code cannot
  disagree.
- **An agent following this needs a checkout, not an install.** `npx dbmd` does
  not work, because `package.json` says `"private": true` on purpose, and the
  canonicalise step imports `dist/index.js` from that checkout. Both facts are
  in the skill. If the package is ever published, the second line changes and
  the first stops being a caveat.
- **Rule 3 is a step an agent can skip and nothing will catch it.** The check
  passes on a non-canonical file, by design: `docs/format.md` promises that a
  half-canonical model is a normal model. The skill says the step is not
  optional and says what skipping it costs, which is the most that can be done
  without a command.
- **The studio API is left as what it is**, the local editor's own wire, free to
  keep moving. Nothing outside `src/studio/` is now written against it, which is
  the property that made "it is still moving" an acceptable comment to leave in
  `wire.ts`.
- **The skill lives in this repository.** Where it lives when the package is
  published is downstream of a question nobody has answered, and nothing about
  writing it depended on that. `.claude/skills/dbmd/SKILL.md` is scanned by
  `scripts/check-commands.mjs` like every other tracked markdown file, so a
  command it names has to exist.
- **`dbmd import`'s placeholder body is taught as a prompt.** The skill's
  strongest instruction is to not generate a paragraph per table, because a body
  restating the frontmatter looks like documentation while telling a reader
  nothing, and it is the one failure mode an agent will reach for unprompted.

## Revisit when

- **A `dbmd fmt` exists.** Rule 3 becomes one command instead of nine lines of
  Node, the `pathToFileURL` caveat goes away, and the skill gets shorter. That
  is the single change that would most improve it. This record is not scanned by
  `scripts/check-commands.mjs`, which is why the name is written here without a
  marker and with one in the skill.
- **dbmd-81 lands.** The reference query stops being a grep over a diagram, and
  it stops being unavailable in the middle of a rename, which is the moment it
  is most wanted.
- **The studio API grows a version and a reference page.** The objection in this
  record is that a skill outlives a moving wire format, not that HTTP is the
  wrong shape. A versioned API with a rename and diagnostics on a mutation would
  be worth re-reading this over.
- **Somebody publishes the package.** The skill's opening section is written
  around `npx dbmd` not working. It should stop being written that way on the
  day it starts.
- **An agent is measured churning a diff anyway.** That would mean rule 3 is
  being skipped in practice, and the answer is a command rather than a firmer
  sentence.

## Two revisit entries have fired, and the skill has already moved

Appended rather than edited, because the decision holds unchanged: an agent
still edits the files, still hands each one to the canonical writer, and still
uses `dbmd check --json` as the gate. Nothing measured above has been
re-measured and found different. What has moved is two of the conditions under
**Revisit when**, both of which now describe work that has happened.

**"Somebody publishes the package" has half fired, and the half that matters to
this record is done.** The owner decided to publish on 2026-09-07
([ADR 0051](0051-the-first-release-is-a-tag-a-person-pushes.md)) and #118
rewrote the skill's opening the same day. It no longer says `npx dbmd` does not
work. It says to run from a checkout because the tool should be the one in front
of you rather than whichever version somebody published, then says `npx dbmd`
resolves whatever is on the registry and that `npm view dbmd versions` is what
says which releases exist. That is written to be true on both sides of a first
release rather than around one not having happened, which is what this entry
was asking for.

The consequence above, "an agent following this needs a checkout, not an
install", keeps its conclusion and loses one of its two reasons. `private: true`
is out of `package.json`, so that is no longer why. The canonicalise step still
imports `dist/index.js` from a checkout, which is still why, and it stops being
why on the day a `dbmd fmt` exists.

**The condition itself has still not fired.** Nothing is on the registry and
nobody has pushed a `v*` tag. So the entry stays where it is, and what is left
for that day is the version question the skill now answers by refusing to name a
version at all.

**"dbmd-81 lands" has fired outright.** It landed in #88 as `dbmd refs`, and
[ADR 0042](0042-a-question-answers-a-model-a-diagram-refuses.md) is the record,
with [ADR 0049](0049-the-answer-before-a-delete-says-what-the-delete-does.md)
adding the answer a delete gives first. So the section above headed "What the
agent asks for that this does not give it" is history rather than a description.
The skill teaches `dbmd refs <table>` and not the `dbmd export | grep` recipe
written here, and the caveat attached to that recipe, that `dbmd export` refuses
a model with an error in it and that is exactly the state a rename leaves you
in, is the first thing ADR 0042 fixed: `dbmd refs` counts the errors, says them
out loud, and answers anyway.

**Why this correction is later than the one on 0024.** The publishing entry
fired on the same decision as ADR 0024's, which was appended to that day. This
record and 0028 were left alone because the brief for that work said they "are
not edited", which was right about editing and wrong about appending.

**The rest of the list was read at the same time and none of it has fired.**
There is no `dbmd fmt`, so rule 3 is still nine lines of Node and still the
step this record says nothing will catch you skipping. The studio API has not
grown a version or a reference page; `wire.ts` still carries the comment saying
the format is moving, and nothing outside `src/studio/` is written against it.
No agent has been measured churning a diff.
