# 0042. A question answers a model a diagram refuses

## Context

ADR 0003 writes a relationship on the referring column, so that adding a foreign
key touches one file. The reverse index is therefore not on disk, and
`src/model/read.ts` computes it: `Model.referencesTo`, a map from the name
written in a `ref` to every edge that lands on it. The studio's inspector reads
it to say what a rename or a delete is about to touch. Nothing on the command
line did.

"What points at this table" is the question asked before every rename, every
delete and every column removal, and it is the one question a model of this
shape answers badly by hand: the fact lives in the referring file, so the table
being asked about is the one place the answer is not written down.

Two people reached for it on 2026-09-07 and neither had it. The orchestrator
answered it with `grep` four times in one day and got it wrong once, because
`ref: orders.id` and the word "orders" in a paragraph are the same string to
`grep`, and the models where this matters are the ones full of prose.

ADR 0039 records the meanwhile answer, which the dbmd skill teaches and which is
exact rather than a heuristic:

```
dbmd export <dir> --stdout | grep -E '^  "<table>" .* : '
```

Every relationship line in the mermaid output is generated from a `ref:` and
from nothing else, one per ref, referenced table on the left. So it cannot match
prose and it cannot miss a ref. Its two weaknesses are the argument for this
record. It is a `grep` over a rendering, so the answer is only as stable as
mermaid's line shape. And ADR 0023 makes `dbmd export` refuse a model with an
error in it, which is exactly the state a rename is in half way through, which
is exactly when somebody wants to ask.

## Decision

**`dbmd refs <table> [directory]`, a seventh command, which reads and prints and
touches nothing.**

Four things follow, and each was a choice rather than a default.

### It answers a model that does not validate

`dbmd export` refuses one and is right to: a diagram missing a table that failed
to load is wrong in a way its reader cannot see (ADR 0023). A list of refs is
not a picture, and a short list that says it is short is still useful. So this
command reads the model, runs the reader's diagnostics and the validator's
exactly as `dbmd check` does, counts the errors, says so above the answer, and
answers anyway. The exit code is unmoved by them: the question was answered.

The sentence it prints is the honest one rather than the reassuring one. A file
that did not parse is missing from the model along with every ref written in it,
so an answer over a model with errors may be short, and the run says that
instead of implying completeness. Measured: with `tables/shipments.md` broken on
purpose, `shipments.order_id -> orders.id` is not in the answer for `orders`,
and the run says why.

### "Nothing points at it" and "there is no such table" are different exit codes

They are the same shape of sentence and opposite instructions to whoever asked.
An empty answer about a table that exists is a success and exits 0. A name that
no file carries and no `ref` mentions is a failure and exits 1, with an
`error.code` of `no-such-table`.

The asymmetry is deliberate and it is about consequence. The question is asked
immediately before a delete, and a typo that answered "nothing points at it"
would be a true sentence read as permission. There is no reading of exit 1 that
gets somebody hurt.

### A table that is gone and still pointed at is an answer

`referencesTo` is keyed by the name written in the `ref`, not by a table that
exists, so a table nobody wrote still has an entry when something points at it.
That is not an error case, it is the middle of a rename, and it is the state
this command exists for. The run says the file is not there, then lists what
still points at the name, and exits 0.

### The referring column and its file, not just the referring table

"Three tables point here" does not say what to edit. The column does. Beside it
goes the path of the file the `ref` is written in, because the whole reason the
question is hard is that the fact lives somewhere else, and a caller should not
have to know how a model directory is laid out to go and fix it.

Two marks go on a row when they apply. `key` means the referring column is part
of its own table's primary key, so that row cannot outlive this one. `required`
means the file says `nullable: false`, so the ref cannot be emptied. Both are
the difference between "retarget this" and "delete this row", which is what
somebody actually wants to know, and the mermaid diagram encodes only the first
of them and encodes it as a dashed line, which is a thing to decode rather than
read.

### The shape of the surface

- **A subcommand rather than a flag on `dbmd check`.** `check`'s contract is a
  list of diagnostics and an exit code that means "this model is not good".
  Three referrers is neither a diagnostic nor a problem, and putting a question
  behind a command whose non-zero exit means something else would make the
  answer's exit code unreadable.
- **A subcommand rather than a flag on `dbmd export`.** That is the command that
  refuses the model this one has to answer, so building on it means inheriting
  the refusal or arguing with it inside one command.
- **The table first and the directory second.** Every other command takes the
  directory as its first bare word, so this is the one place a reader has to
  stop. It is this way because the table is the question and the directory is
  only where it is asked, and `dbmd refs customers shop` reads as the sentence a
  person means. The invited mistake is naming the directory first, and the
  "no such table" message says the order out loud whenever a second word was
  given.
- **`--incoming` and `--outgoing`, defaulting to incoming, both flags for
  both.** The reverse question is the same command with a direction rather than
  a second command, because it is the same edge read from the other end. It is
  not the default, because a table's own refs are written in its own file and
  are the half of this that a person can already see. Neither flag means the
  question the command is named after; both means the whole picture of one
  table's edges, so there is no third flag name for that.
- **`--json` carries both directions whichever flags were given.** ADR 0006 and
  ADR 0011: the report goes on stdout under `schema: 1`, the prose on stderr,
  the flags choose what a person reads, and a caller that asked for the report
  gets the whole answer and never runs this twice. This has the shape
  `dbmd check --strict` already has, where the flag moves the exit code and not
  the payload.

## Consequences

- **The skill's recipe becomes a paragraph about history.** `.claude/skills/dbmd/SKILL.md`
  teaches this command instead, and the rename and delete recipes ask with it,
  which is the change that matters: those recipes told an agent to ask *before*
  starting, because the `grep` over the diagram stops working once the model is
  broken. That caveat goes.
- **A seventh command.** `AGENTS.md`'s count and `README.md`'s list both move,
  and `scripts/check-commands.mjs` now resolves `dbmd refs` for anybody who
  writes it in backticks.
- **`no-such-table` is a new contracted string.** It is a CLI error code on the
  `--json` envelope rather than a `Diagnostic` code, so it is not in
  `docs/format.md`'s table and does not want to be: nothing about it is a
  property of a file. It is documented in the command's own `--help`.
- **`inPrimaryKey` and `nullable` are omitted rather than written false.** That
  mirrors the format on disk and ADR 0008's three states, and it means a
  consumer reading `nullable === false` is reading something the file said
  rather than something this command decided.
- **Nothing in `src/model/` changed.** `referencesTo` was already the answer,
  already sorted, and already keyed by the written name. The forward direction
  is a walk of one table's columns, done in the command, because a second index
  in the model would be a thing to keep honest for one caller.
- **The path is the referring table's own file, so a table whose file name and
  `table:` key disagree cannot be reached this way.** That disagreement is
  `name-mismatch`, an error, and the file is not in the model at all, so it is
  already covered by the "this answer may be short" sentence rather than by a
  second rule.

## Revisit when

- **A rename becomes a command.** This is the query half of one. If `dbmd` ever
  moves a table for you, this is what it would have to run first, and the two
  should agree about what a self-reference is before then.
- **Somebody asks it about a column rather than a table.** "What points at
  `customers.id`" is a narrower question than this answers, and the payload
  already carries `to.column` on every edge, so the shape would be a filter
  rather than a new command.
- **A model gets big enough that the answer wants grouping.** Today it is a flat
  list because eleven refs across eight tables is a flat list. A model with
  forty referrers would want them grouped by file, and that is a rendering
  change with no contract in it.
- **`dbmd check` grows a "what would this break" mode.** That is this question
  asked about a change rather than about a table, and if it lands, this command
  is the thing it should be built out of rather than beside.
