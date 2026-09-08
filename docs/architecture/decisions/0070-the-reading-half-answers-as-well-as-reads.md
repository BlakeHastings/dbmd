# 0070. The reading half answers as well as reads, and says what it left out

## Context

[ADR 0064](0064-the-feedback-overlay-is-a-second-entry-point.md) put the
`agentation` toolbar on the studio in development. The owner clicks an element,
writes a sentence, and the overlay posts it to `agentation-mcp`, which keeps it.
That is the writing half and it has worked since 2026-09-07.

Nothing in this repository could read any of it back. The owner was annotating
into a store only their agent's own tooling could open, so the way feedback
actually travelled was that somebody copied it out of a browser by hand. That is
the loop the overlay was asked for, minus the part that closes it.

The way it was expected to arrive turned out not to be available: the server is
not registered as an MCP server for this project, and registering one is a
decision about the owner's machine that ADR 0064 deliberately left to them.

**It does not need to be registered.** Measured on 2026-09-08 against the running
server rather than read out of documentation:

| asked                                                          | answered                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /health`                                                   | `{"status":"ok","mode":"local"}`, with no session         |
| `POST /mcp` `initialize`                                        | one SSE frame, and `mcp-session-id` on a response header  |
| `POST /mcp` `notifications/initialized` with that header        | `202`                                                     |
| `POST /mcp` `tools/list` with that header                       | nine tools                                                |

So the whole of the client is three `fetch` calls and a header. That matters,
because the alternative is a protocol library: `dbmd` is a tool people run with
`npx`, [AGENTS.md](../../../AGENTS.md) says install time is a feature, and ADR
0064 kept the writing half to devDependencies for the same reason. This adds
nothing to either list.

Three measurements shaped the rest of the decision, and all three are the kind
of thing that only turns up by asking the real server.

**The store is one per machine and it is mostly somebody else's.** It held 177
sessions on 26 URLs, of which exactly one was this studio's; the rest were
another project on this machine, mostly on port 4300. By the end of the same
afternoon it was 182. Reading everything would bury this repository's feedback in
another repository's.

**Nothing on the server says which session is ours.** A session carries a url, a
status and a time. The studio binds port `0`, so its URL is a different number
every run, and there is no name, no project id and no tag to match on.
`projectId` exists on the payload and was `null` on every session read.

**`agentation_get_all_pending` returned zero while the store held eleven
annotations.** Pending means unacknowledged. Every annotation in the store had
been acknowledged, resolved or dismissed, so the tool the issue named as "the
read" answered `{"count": 0, "annotations": []}`. A reader built on it would have
shown the owner their own history as empty, which is a more convincing version of
the silence this is meant to end.

## Decision

**`npm run annotations` is the command, and `scripts/annotations.mjs` is the
whole of it.** No dependency, no registration, no daemon. It speaks streamable
HTTP MCP with `fetch`, because that is three requests.

**It speaks MCP even though a plain REST surface is sitting next to it.** The
toolbar's own client, read out of `node_modules/agentation/dist/index.mjs`, uses
`POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/annotations`,
`PATCH /annotations/:id` and `DELETE /annotations/:id`. `GET /sessions/:id`
returns a session with its annotations and needs no handshake at all, so the
read alone would be one request rather than four.

It was not taken, for two reasons and neither is the request count. The
answering half has no REST equivalent that is written down: a reply is a message
appended to a thread, and the only place that operation is named and described is
the tool list. Reading over one protocol and answering over another would be two
contracts to keep, in a script whose whole point is that the two halves are the
same conversation. And the MCP surface is the one the server advertises to
agents, with a description on every tool; the REST surface is the toolbar's own,
undocumented, and discovered here by reading a bundle. When one of the two
breaks, the documented one is the better bet, and the handshake it costs is three
requests made once.

The REST surface is also how an annotation gets written, and this script does not
write one. A write is refused three times before it is accepted, each time with a
raw `NOT NULL constraint failed` from SQLite; the sequence is in
[docs/process/verified.md](../../process/verified.md), measured by the
orchestrator on 2026-09-07 rather than here, and it is not repeated in this
record because a fact with two homes is a fact that can disagree with itself.
Creating annotations is the browser's job and the toolbar does it properly;
nothing here should be a second, worse writer.

**The read is `agentation_list_sessions` and `agentation_get_session`, not
`agentation_get_all_pending`.** The measurement above is the reason. Every status
is printed and `pending` is a word on the line rather than the filter, so an
annotation an agent has looked at does not vanish from the owner's view of their
own feedback. The narrower tool remains correct for what it says it does and is
the wrong shape for this.

An annotation carries about twenty fields and most of them are usually null:
`intent`, `severity`, `nearbyText` and `reactComponents` were empty on every one
read here, and `thread` is absent until somebody answers. So the printer prints
what is there rather than a form with blanks in it, and the three that are always
present are the ones that matter: the sentence, the element, and the path that
names it.

**It filters to the studio's page by default, and says on the summary line how
much it left out and on how many origins.** Both halves are the decision. Showing
everything makes this repository's feedback unfindable; showing only ours without
a count would hide that the store is shared, and a reader who finds nothing
should be able to tell "nobody has annotated this page" from "you are looking at
the wrong page". `--all` reads the lot and says that is what it did.

**The studio writes down where it was listening, and the reader reads that.**
`scripts/studio-url.mjs` is the one home for the value, on the argument
`scripts/agentation-endpoint.mjs` already makes for the endpoint: two scripts
need it and must not disagree. `studio-dev.mjs` is the one process that knows
the answer without being told, because `startStudio` hands it the URL.

The alternative is telling the reader the port every time, and the port is
exactly the part that changes. A number copied out of a terminal that has
scrolled away is how this loop would go unread. `--url` still takes one, so the
record is a convenience and never a dependency, and the reader prints the
recorded value with the time it was recorded rather than as a bare fact:
`docs/process/orchestrating.md` is largely a list of afternoons lost to a stale
value read as current, and a line that says when it was true cannot mislead the
same way.

It is written to `.studio-dev/`, beside the dev bundle, because it is the same
kind of thing: a development artefact, gitignored, and outside `dist/` so
`npm pack` cannot reach it. `build-client.mjs --dev` clears that directory, so a
dev build deletes the record and the studio it then starts writes it again. A
reader that finds no record says so and asks for `--url`.

**Four of the nine tools are in, and the choice is about what an owner sees.**
A version that could only read would leave the owner annotating into a thread
that never answers, and the toolbar shows them that thread, so a read-only reader
makes the feature look broken rather than unfinished. So:

- `agentation_list_sessions` and `agentation_get_session` are the read.
- `agentation_acknowledge` is "seen", which is the cheapest honest signal and
  the one worth sending before a batch of five is worked rather than after.
- `agentation_reply` is how an agent asks which of two boxes was meant. Without
  it the only way to answer a question is to close it.
- `agentation_resolve` carries a summary, and is the end of the conversation.

**`agentation_dismiss` is out, and this is the judgement rather than an
oversight.** Dismissing closes the owner's feedback against their wish, with a
reason nothing prompts anybody to read. This project escalates a disagreement
with the owner to the owner; `docs/process/orchestrating.md` is explicit that a
stopping point which has only been felt is a guess. An agent that thinks a
request should not be done has something to say, and `--reply` is where it says
it. The day the owner wants the verb it is six lines and this record is where
the argument to revisit lives.

**`agentation_get_pending`, `agentation_get_all_pending` and
`agentation_watch_annotations` are out for three different reasons.** The first
two are the narrower read the measurement above disqualified. The third blocks
for up to five minutes waiting for something to arrive, which is a different
program: this one is asked a question and answers it. Hands-free is a real thing
to want and it is not this.

**Reading with no server is not an error, and answering with no server is.**
`CONTRIBUTING.md` promises the toolbar works with no server at all, and it does:
the annotations stay in the browser. A reader that threw would contradict a
promise the page already keeps, so with nothing listening it says so, says how to
start it, and exits zero. `--reply` is a request to change something, and a
request that did not happen is a failure however calmly it is worded, so the
answering verbs exit non-zero. `GET /health` is the check, because it needs no
session and it is what `studio-dev.mjs` already asks.

Driven end to end on 2026-09-08, against the live server, with the real studio
and the real overlay:

```
dbmd annotations
  server     http://127.0.0.1:4747, which answered
  page       http://127.0.0.1:57961/, from npm run studio:dev at 2026-09-07 19:27
  sessions   1 for that page, of 182 on the server; the other 181 are 11 other origins on this machine
  found      1 annotation: 1 resolved

1. mtrxne7b-46v9n0  resolved  2026-09-07 19:30
   The shipments box is taller than the others and it pulls the eye.
   header at .scene > .boxes > #table-shipments > header
   agent: Do you mean the header or the whole box?
   agent: Resolved: Nothing changed: this annotation was written to prove the read path in dbmd-v6c.
```

The session in that run was created by the overlay when a browser loaded the
studio, and its URL is the one `npm run studio:dev` had written down, unaided.
The annotation itself was posted through the same HTTP call the toolbar makes
rather than typed into the toolbar, and was deleted afterwards; ADR 0064 already
records a hand-driven one, and what was open here was the reading.

**The test stands up its own server rather than talking to that one.**
`test/scripts/annotations.test.ts` answers the three messages the script sends
from thirty lines of `node:http`. The real server is the owner's, its store
changes when somebody clicks something on another project, and CI has no server
at all, so a test against it would be a test of this afternoon. The closed-port
promise is run there both ways round rather than reasoned about, and it was
watched to fail: inverting the one condition that distinguishes reading from
answering turned the reading test red at `expected 1 to be +0`.
[ADR 0034](0034-a-guard-is-not-believed-until-it-has-been-seen-to-fail.md).

## Consequences

- **The loop closes with nothing asked of the owner.** No MCP registration, no
  new dependency, no configuration. `DBMD_AGENTATION_ENDPOINT` is the one knob
  and it already existed.
- **An agent can now answer in the owner's thread**, which means an agent can
  now be wrong in it. A resolve with a summary is a claim in a place the owner
  reads, and the only thing checking it is whoever wrote it.
- **`--all` makes one request per session**, and there were 182. It took about
  twenty seconds and it is the escape hatch rather than the daily command. If
  the store keeps growing this becomes the reason to want a filter on the
  server.
- **The record in `.studio-dev/` is a second place the studio's URL exists.** It
  is written by the process that owns the value and read by one other, which is
  the same arrangement as the endpoint, and it carries a time so that a reader
  can see it is old.
- **This repository now names a tool surface it does not own.** Nine tool names,
  a payload shape and a transport, all read off one version of `agentation-mcp`
  on one machine on one day. None of it is versioned or promised.

## Revisit when

- **`agentation-mcp` grows a way to say which project a session belongs to.**
  `projectId` is on the payload and was null everywhere. If the toolbar can set
  it, the recorded URL and the whole of `scripts/studio-url.mjs` go, and the
  filter becomes a field instead of an inference.
- **`agentation_get_all_pending` stops meaning unacknowledged**, or the store
  gains a filter of its own. Either would move work off this script and into the
  server, which is where it belongs.
- **Somebody wants the hands-free loop.** `agentation_watch_annotations` blocks
  until annotations arrive and is built for exactly that. It is a second command
  with a different shape, not a flag on this one.
- **The owner asks to dismiss something from here.** The argument above is that
  declining their feedback is a conversation rather than a command. If it turns
  out they want it recorded in the thread instead, that is a decision they get to
  make and this is the record it corrects.
- **The handshake changes.** `protocolVersion` is pinned at `2025-06-18` in one
  place in the script. A server that stops accepting it will fail loudly on the
  first request, which is the behaviour to want, and the fix is one string.
