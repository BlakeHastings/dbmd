# 0011. The CLI writes through one module, and a test keeps it that way

## Context

ADR 0006 says stdout is data, stderr is narration, `--json` on everything that
reports, and deterministic output. It calls those rules checkable rather than
aspirational, and until now nothing checked them.

Nothing had to. There was one command. But the rules are the kind that are easy
to state and easy to break by accident, and two of them break invisibly:

- `console.log` writes to stdout and `console.error` writes to stderr. At a
  terminal they are the same white text on the same screen. A progress line
  written with `console.log` looks perfect to whoever wrote it and corrupts
  every pipe, every GitHub Actions step that reads the output, and every agent.
- The `--json` exit code. ADR 0006 already names this one: the command prints
  valid JSON describing three errors and exits 0, because printing worked.

Neither is caught by review. A reviewer reads a diff, sees a line printed, and
has no way to see which file descriptor it went to. A reviewer who does catch it
catches it once, on that pull request, and the next one is written by somebody
else six months later.

The moment to build this is while there is one command rather than four. The
shape a second command copies is whatever the first one did.

## Decision

`src/cli/output.ts` is the only module in `src/` that writes, and
`test/cli/output-contract.test.ts` fails the build when something else does.
The gate is the part of this decision that matters; the rest is what makes the
gate a reasonable thing to obey.

**One writer, enforced.** The test scans every `.ts` file under `src/` and
refuses a `console.*` call, a `process.stdout.write` or `process.stderr.write`
call, and `process.exit`, everywhere except `src/cli/output.ts`. It matches
calls rather than mentions, so prose in a comment about `console.log` is fine,
which matters because that prose is where the reason lives. It is a test rather
than a lint rule because `npm run check` is this repository's only mechanical
gate and vitest already runs inside it: a lint rule would mean a linter, a
config file and a dependency to enforce three regular expressions. `process.exit`
is in the list for a different reason from the other two: it truncates a pipe
that has not flushed, which is why `src/cli.ts` sets `process.exitCode` instead.

**A command returns a report, and the exit code travels inside it.** A command
gets an `Output` as its second argument and its last line is
`return out.report(...)`. A report is one value with three fields: the exit
code, the text form, and the JSON payload. The two renderings therefore cannot
disagree about whether the run failed, because there is only one code and both
forms are made from it. The `--json` envelope derives `ok` from that same code,
so a caller may branch on `ok` or on `$?` and get the same answer, and a command
has no way to set `ok` itself: the payload type refuses the key.

**stdout carries exactly one thing per run.** Either a command's data, or its
`--json` report. Nothing else, ever. In particular the *text* form of a report
is narration and goes to stderr, which is the one place this record goes further
than ADR 0006 spelled out. It follows from ADR 0006's own reasoning: a text
format is free to change wording in a patch release precisely because the JSON
did not, so text is not something another program may consume, so it does not
belong on the stream reserved for things another program consumes. In text mode
the machine-readable answer is the exit code. A script that wants the prose asks
for it with `2>&1`, and a script that wants structure asks for `--json`.

**Colour is one decision from three inputs, in this order.** Highest first:

1. `--no-color`. Somebody typed it, and detection is the thing they are
   overriding.
2. `NO_COLOR` set to anything but the empty string. Per no-color.org the value
   is not read, only its presence, so `NO_COLOR=0` still means no colour.
3. `TERM=dumb`. A dumb terminal is a TTY and cannot render an escape code.
4. Otherwise on when stdout is a terminal **and** stderr is one too.

The second half of rule 4 is not in ADR 0006 and is deliberate. ADR 0006 says
"on when stdout is a TTY", which was written before rule 1 had a consequence:
narration is written to stderr, so `dbmd init 2> log.txt` under the literal rule
would write escape codes into somebody's log file. Both streams have to be
terminals before either gets styled. Colour is applied to narration only. Data
on stdout is never styled, in any mode, because it is bytes for another program.

**One sort, and it is not `localeCompare`.** `sortedBy` compares strings with
`<`, which is UTF-16 code-unit order: identical on every machine and in every
locale, which is exactly what `localeCompare` is not. ADR 0006 rule 4 is about a
generated file that only changes when the model does, and a sort that depends on
the machine's locale is a diff that depends on whose machine ran it.

**No `--quiet`, now or later.** Narration is on stderr, so quiet is
`2>/dev/null`. A request for the flag is evidence that something is narrating to
stdout, and the fix is that thing.

## Consequences

- **The JSON shapes are public API from this commit**, per ADR 0006. The
  envelope is `{"schema": 1, "ok": bool, ...}` and `schema` is here before it is
  needed because a consumer cannot start checking a version later than we start
  emitting one. `error.code` is the stable half of a failure and `error.message`
  is prose that may be reworded.
- **`dbmd check | grep` will find nothing** when `check` lands, and that is the
  intent rather than an oversight. The two supported ways to consume a run are
  the exit code and `--json`.
- **The gate applies to all of `src/`, not just `src/cli/`.** A `console.log`
  in the model reader breaks a pipe exactly as badly as one in a command, and
  the studio is a command in the same process. It caught one on its first run
  against a merge commit: the studio server defaulted its injectable `log` to a
  direct `process.stderr.write`, which is the right stream by luck rather than
  by construction. That default is now `narrate` from this module. There is no
  exemption list and adding one would be the end of the rule.
- **`narrate` is the seam for a caller that is not a command.** The studio
  server is a library that takes a `log`; it does not have an `Output` and
  should not have to invent one to print a URL. Narration on stderr is always
  allowed. Choosing the stream yourself is what is not.
- **`Output` is threaded through `Command.run`** rather than imported, so the
  flags and the terminal detection are resolved once by the entry point. It also
  means a test hands in the combination of `NO_COLOR` and TTY it wants to pin
  down, on any platform, including combinations the machine running the test
  cannot produce.
- **`--help` and `--version` stay text on stdout even under `--json`.** They are
  documents the caller asked for rather than reports about a run, and there is
  nothing in them to structure. It is the one place the "stdout carries one
  thing" sentence needs a footnote, and it is worth less than the machinery to
  remove it.

## Revisit when

- **Something needs to parse a command's text output.** That is the signal that
  the prose has become a contract, and the answer is a JSON field rather than a
  promise about wording.
- **A caller needs streaming progress.** ADR 0006 already names the shape:
  line-delimited JSON on stderr. The report is a single value today because
  every command finishes and then speaks.
- **The `schema` number has to change.** Adding a field does not require it.
  Renaming or removing one does, and by then consumers exist.
- **A Windows terminal turns up that renders the escape codes as text.** Node
  enables virtual terminal processing on a Windows console it owns, which is why
  the detection above does not ask what kind of terminal it is. A report of
  literal `[31m` in a transcript is the evidence that this needs more than
  `isTTY`.
