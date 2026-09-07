# 0063. A terminal is refused, a pipe is waited on, and the difference is proved outside this repository

## Context

`dbmd import` with no `--file` reads standard input. That is the documented
default and the middle step of the journey `README.md` describes: print the
query, run it against your own database, hand back what it printed.

dbmd-i2u reported that the command prints nothing and waits forever, against a
list of five other error paths that each answered in under a second with a
sentence and a non-zero exit. The report is worth taking seriously for the
reason it gives: [ADR 0006](0006-one-cli-three-callers.md) names an agent as one
of this tool's three callers, and an agent that runs a command to see what it
does has no Ctrl-D and no cursor to look at.

**The terminal case was already fixed**, by dbmd-f3p, at 05:08 on the day the
report was written. `runImport` refuses when there is no `--file` and
`process.stdin.isTTY`, and the sentence names both ways out. Driven against the
built binary on 2026-09-07:

| standard input | exit | what it said |
| --- | --- | --- |
| `< /dev/null` | 1 | `there was nothing in standard input` |
| a terminal | 2 | `standard input is a terminal, so there is nothing there to read` |
| a pipe nobody writes to | none | nothing, for as long as it was left |

The third row is the one that has never been fixed, and it is the row a report
written from a harness measures. A process spawned with Node's default `stdio`
gets a pipe on file descriptor 0 that the parent holds open and never writes to.
`isTTY` is undefined there, which is correctly not a terminal, and the read
blocks. Measured the same day: eight seconds, no output, killed. It would have
been three hundred.

### Why the report could be written at all

The refusal has had a test since the day it landed, and the test hands
`runImport` an `Input` whose `isTty` is `true`. That seam is what makes the
interesting combination reachable from a suite, and it is also why every test in
`test/cli/import.test.ts` passes over a `processStdin` that reads the wrong
property, or none. The tarball smoke drove `import --help` and nothing else, for
the reason dbmd-58d recorded: the JSON this command wants comes from a live
database, and there is not one in `npm run check`.

So the behaviour was correct, and nothing anywhere demonstrated it. A probe from
outside is the only thing that could, and when one ran it measured the third row
and reported the first two as broken. That is the defect this record is really
about.

## Decision

**The terminal refuses and that does not change.** No `--file`, `isTTY`, exit 2,
a sentence naming `--file` and naming the pipe. It is ADR 0006 rule 2 applied
exactly: a command that needs a decision it does not have exits non-zero and
says what supplies it.

**A pipe is waited on, however long it takes.** `dbmd import` is a filter and
the wait is the feature. The two things that could shorten it are both worse
than the wait:

- **A timer.** "Nothing has arrived in two seconds, so say something" is a
  sentence whose presence depends on how fast the database was, which is ADR
  0006 rule 4 broken on stderr, and it is a race in CI on a machine under load.
- **Refusing a standard input that is not a terminal.** That is the documented
  default and every scripted use of this command, including the journey in the
  README.

There is no third signal. A pipe nobody will ever write to and a pipe somebody
is about to write to slowly are the same file descriptor in the same state. The
caller knows which one it made and the command cannot, so the caller is the one
told what to do, in `dbmd import --help`, in the paragraph under the options:
close the pipe or pass `--file`. Every other filter on the system behaves this
way and the fix for all of them is the same.

**Saying something before blocking was considered and rejected**, and not only
for the timer. `Output` has `data` and `report`, and [ADR
0011](0011-the-cli-writes-through-one-module.md) is why: stdout carries exactly
one thing per run and narration is the report's own text at the end of it. A
line printed before the read needs a third writer on that interface, for every
command, so that one command can describe a mistake its caller has already made.
That is a large change to the CLI's shape bought with a small one to this
command's manners.

**What changes is the proof.** Two additions, and neither of them is to the
behaviour:

1. `scripts/smoke-pack.mjs` drives `dbmd import` against the installed tarball
   with the pipe closed and nothing in it. An empty standard input needs no
   database, so the one command that could not be driven there can now be driven
   for its refusal, and a build that waits fails on the command timeout instead
   of passing. `run` grows an optional `stdin`, and leaving it out still means
   "a pipe nobody closes", because that is what every other case there wants.
2. `test/cli/import.test.ts` tests `processStdin` itself, against a
   `process.stdin.isTTY` set to `true` and then to `undefined`. It is three
   lines and it is the join between the seam every other case uses and the
   process the command actually runs in.

## Consequences

- **`dbmd import` can still hang, and that is now written down in two places
  rather than none**: in `--help`, where the caller who did it is looking, and
  here, where the next person to file it is sent. The next report of this should
  be a report about the third row, and it should arrive knowing the first two
  are answered.
- **The smoke's `run` has a stdin that is opt-in**, which is an asymmetry worth
  keeping. Closing every child's standard input would be tidier and would make
  the one case that matters indistinguishable from the six that do not.
- **An unwritten pipe does not mean the same thing on every path into the
  binary**, which is measured rather than assumed and is in
  `docs/process/verified.md`. Node's own `spawn` waits, and so does the same
  command through `cmd /c`; the npm `.cmd` shim on Windows reads it as end of
  input and answers straight away. So the smoke closes the pipe rather than
  leaving it open and trusting the platform, because left open the case would
  pass on Windows for a reason that is not about this command at all.
- **A real terminal is still not driven anywhere.** The smoke spawns processes
  and a spawned process in CI has no terminal on its standard input; producing
  one needs a pseudo-terminal, which is a dependency and a platform difference
  for a single branch. The terminal half stays with the seam, and what is new is
  that the seam is now known to be attached to the right property.
- **The exit codes of the two refusals differ, on purpose.** An empty standard
  input is 1, because something was read and it was not usable. A terminal is 2,
  because the command line asked for something that cannot be answered. Both are
  in the `Exit codes:` block of the help.

## Revisit when

- **A pseudo-terminal is already a dependency for something else.** Then driving
  the terminal branch end to end costs a line rather than a decision, and this
  record's third consequence is what to delete.
- **A second command reads standard input.** The guard, the sentence and the
  help paragraph are all written for the one that does. A second one makes this
  a rule about the CLI rather than a fact about `import`, and the place for it is
  `Command` rather than three copies.
- **`Output` grows a writer for progress.** ADR 0006's own "Revisit when" already
  names line-delimited JSON on stderr for a long-running command. If that
  arrives, the argument above against announcing the read is spent, and
  announcing it becomes cheap and worth re-arguing.
