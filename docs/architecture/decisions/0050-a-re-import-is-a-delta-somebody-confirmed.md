# 0050. A re-import is a delta somebody confirmed

## Context

`dbmd import` refused to write into a directory that was not empty, and the
refusal named dbmd-42 so a user could tell "not built yet" from "not allowed".
ADR 0029 called that a placeholder and named the condition that would replace
it. This is that replacement.

The item sat unbuilt for a fortnight behind three questions that were not
derivable from anything in the repository. A table that has disappeared from the
database, a column whose type has changed, and a column that has been removed
while prose still mentions it are three different decisions, and the sketch on
the item proposed a merge rule for each: report a missing table and never delete
it, take the database's type, and leave the prose alone.

**The owner's answer was not one of the three.** Verbatim:

> For the re-import, it sounds like you are asking about a delta. When we
> import, we warn the user about the changes "database table removed" in an
> itemized list for them to scroll through. Then they can confirm the change.

That supersedes the sketch rather than picking among it. The answer is not a
merge policy applied quietly; it is that a re-import computes a delta, itemises
it, and writes nothing until somebody has said yes. The recommendation on the
first question is explicitly overturned by it: a table that vanished from the
database is now **proposed for removal** rather than reported and left alone,
because the confirm step carries the risk the report-only rule existed to carry.

What that leaves undecided is a constraint the owner did not have to think about
and this repository cannot ignore. **A pipe must still work and nothing may
prompt.** ADR 0006 rule 2 is absolute about it, ADR 0011 puts every write behind
one module, and `test/cli/output-contract.test.ts` fails the build on a stray
write to the wrong stream. `dbmd import` reads standard input by default, which
means the JSON is usually *already on stdin*: there is no terminal left to ask
at, and "prompt when it is a TTY" would be a second code path that only the
minority of runs ever take.

## Decision

**A re-import computes a delta, prints it as an itemised list naming the file
each item is about, and writes nothing. `--confirm` on a later run makes exactly
the changes the list named, and nothing else is opened.**

Seven decisions inside that.

### The confirmation is a flag, and there is no prompt anywhere

Three exits, and they are the contract a script reads:

| what happened | exit | written |
| --- | --- | --- |
| the database says what the files say | `0` | nothing |
| there are changes and nobody confirmed them | `1` | nothing |
| there are changes and `--confirm` | `0` | the files the list named |

ADR 0006 rule 2 already says what to do here and this is a straight application
of it: *where a command needs a decision it does not have, it exits non-zero and
says what flag supplies it*. The delta on stderr is the list "for them to scroll
through"; the flag is "then they can confirm".

A prompt was refused rather than considered and rejected. The JSON is on standard
input in the documented path, so there is nothing to prompt *on*; a TTY-only
prompt would mean two behaviours, only one of which a test can reach without
allocating a pseudo-terminal, and the pipeline path — the one that runs every
release, unattended — would be the untested one. One behaviour, and it is the
same one in a terminal, in CI and under an agent.

The cost is real and is named in the message: a `--file` run repeats cheaply, and
a piped run has to repeat the whole pipeline, because the JSON on standard input
has been consumed. The unconfirmed report says so, and only when the source was
standard input.

**An empty delta says so and exits 0 without asking anything**, so re-importing
an unchanged database is a no-op that is safe to leave in CI. `--confirm` is
accepted on every run rather than only where there is something to confirm, so
the scheduled job that always passes it does not fail the week the delta is
empty or the directory is new.

### The list is exhaustive, and that is the whole safety argument

`Delta.write` is exactly the set of paths the items justify, and it is handed to
`writeModel`'s `only`. A file no item named is not opened, not rendered and not
compared. That option exists because ADR 0003 sells a one-line diff for a
one-column change and ADR 0015 already found that quietly canonicalising the
neighbours is how that promise gets broken by a tool that thought it was being
tidy; here it is load-bearing for a different reason. **A re-import that rewrites
every file is a re-import that loses the hand edit somebody made this morning**,
and `git diff` is the only place it would ever show.

The consequence runs the other way too: a change that is not itemised is a change
that does not happen. That is what decides the column-order question below.

### The three cases, each with a proposed action

Each is a default inside a change somebody reviews, not a silent policy.

- **A table in the model that is not in the database** is proposed for removal,
  itemised in the owner's own words: `database table removed`. The item says
  that the prose in that file goes with it and that the last commit is where it
  survives, names the other bodies that mention the table in backticks, and says
  the likeliest innocent cause, which is an import over fewer schemas than the
  last one.
- **A column whose type changed** takes the database's answer. The item states
  both sides — `` `numeric(12,2)` in the file and `numeric(14,4)` in the
  database `` — and nothing else about the column is touched. In the write, the
  whole column is replaced rather than the one key, and that is the same act: a
  column carries no prose and nothing about one is hand-written that the
  catalogue does not also report. The itemised list is where the distinction the
  owner drew is honoured, because that is what the reader is checking.
- **A column removed from the database while prose still mentions it** is
  removed from `columns:`, the paragraph is left byte for byte, and the list
  says that the prose will then name a column that is not there.

### A machine never edits prose, and the only thing read out of a body is a backtick

ADR 0044 is the precedent and this is that rule one level down. A backticked span
is a claim about the schema and a bare word is English, so a bare `` `note` ``
counts inside the file about `note`'s own table and `` `orders.note` `` counts in
any body at all, `_model.md` and notes and groups included. A span never crosses
a line, which is what a span is and what keeps a fenced block from being read as
one enormous one.

**This is not a check over the model and must not become one.** ADR 0003 makes a
body opaque, and dbmd-x82 leaves whether the tool reads prose at all as the
owner's question. What this answers is narrower and is about one moment:
something is about to be deleted, and these are the paragraphs that say it is
there. The count is spans rather than files, because a paragraph naming the thing
three times is three sentences to reread. Nothing is said when there is nothing,
rather than "0 mentions": a line that fires on every item is a line people stop
reading.

The regular expression is a second copy of the one in
`src/studio/client/model.ts`. That file is browser code built by
`tsconfig.client.json` and four lines across that seam is a smaller wrong than a
Node module importing the bundle, which is the same trade ADR 0029 took for the
grid constants. Unlike those, the grid is now shared as `GRID` rather than
copied, because `src/import/model.ts` and `src/import/delta.ts` are both Node.

### Matching is by table name and then by column name, and a rename is refused

A rename in the database is a drop and an add from here, and **this deliberately
does not guess otherwise**. There is nothing in an introspection document that
could make the guess right: a catalogue reports the name it has now, dbmd never
saw the old one, and matching `subscriptions` to `plans` because their columns
agree would delete a body the day the guess was wrong. Two items, and the person
reading the list is the one who knows.

### Column order is not a change, and a reorder is never written

**A column in both keeps the position the file has it in; a new column is
appended.** The catalogue's order is not taken.

`docs/format.md` says the keys are listed in the order dbmd writes them and that
you may write them in any order, so a file's column order is not a fact this
format claims to hold. A column dropped and re-added in the database comes back
last however long it has been there, and taking the catalogue's order would
rewrite a whole `columns:` block for a schema that had not moved. **A re-import
that looks enormous is one nobody reads**, and a file rewritten for a reason that
is not on the list breaks the exhaustiveness the safety argument rests on.

Indexes follow the same rule, matched by name, because an index has one and it is
what the engine prints when a unique index refuses a row.

The cost: after a drop and an add the file lists columns in an order the database
does not use. Nothing downstream reads the order for meaning and `dbmd export`
sorts its own output, so the cost is aesthetic and it is paid in the file rather
than in the diff.

### The type compared is the one that gets written

ADR 0009 gives a column type two spellings and ADR 0029 decided which one a file
carries: the engine's own name with its modifier put back on, `character
varying(32)` and not `varchar(32)` and not `string`. `typeText` is that function
and the delta compares the string it produces against the string in the file.
Comparing the normalised vocabulary instead would report a change on every
re-import of a model whose file says what ADR 0029 told it to say.

### A model this cannot read is refused before a delta is computed

If `readModel` raises any error, the re-import stops and prints them. A file that
does not parse is missing from the model (ADR 0008), and missing from the model
reads from a delta's point of view as missing from the database, which would put
`database table removed` on the list about a file sitting on disk with a
paragraph in it. Warnings do not stop it: a model worth saying something about is
still one a delta over it is true of.

`writeModel` still refuses a name it cannot write and still reports a `WriteSkip`
naming the object, and the re-import turns that into the same `import/unsafe-name`
diagnostic dbmd-41 built, over the same document.

## Consequences

- **`dbmd import` has two behaviours and the second is destructive.** It deletes
  files, which nothing else in this tool does, and it does it only against a list
  the user has read. `writeModel` deliberately does not delete — a file it cannot
  read is missing from the model, and deleting on that basis throws away the file
  whose problem somebody is trying to see — so the removal is the command's own
  act rather than a new option on the writer.
- **`directory-not-empty` is gone from the `--json` contract.** ADR 0006 makes
  those shapes public API and this retires one, which is a breaking change made
  deliberately: the condition it reported no longer exists. The `ENOTDIR` case
  that used to be folded into it is now `not-a-directory`, and the two new codes
  are `changes-not-confirmed` and `model-unreadable`. A `changes` array is added
  to the re-import's payload with a `kind`, a `path`, a `headline` and the
  sentences, so an agent branches on `kind` rather than parsing the prose.
- **The three sentences in `src/cli/import.ts` that named dbmd-42 are gone**, and
  so is the one in `README.md`. ADR 0029's paragraph about the refusal stays as
  written, because this repository never edits a record; this one supersedes it.
- **A re-import cannot add a note or a group and cannot move a box.** An import
  has no opinion about either, so notes and groups are carried untouched and are
  never in the write set. A table new to the database lands on the grid below
  everything already placed, tables and notes both, so nothing already arranged
  moves and the same input gives the same coordinates.
- **A `ref:` somebody added by hand is proposed for removal.** The format lets an
  author write a relationship the database does not enforce, and a re-import
  reports it as the column changing and takes the catalogue's answer. It is on
  the list, so it can be declined, but a model that documents un-enforced
  relationships will produce an item for each one on every re-import. That is the
  most likely source of a list that fires when nothing has changed.
- **The unconfirmed run costs a full pipeline re-run.** Everything about the
  import is done twice: the query is not, because a person runs that, but the
  paste or the pipe is. For `--file` that is a cheap second read; for a pipeline
  it is the pipeline again.

## Revisit when

- **Somebody wants to confirm part of a list.** Nothing here can: `--confirm` is
  all of it or none of it. The shape that would answer it is a per-item selector,
  and the right time to design one is when there is a real list somebody wanted
  to split rather than now.
- **A reorder in the database turns out to matter to somebody.** That is the
  decision above with the cost on the other side, and the evidence would be a
  user comparing a model file against a `\d` and being confused. The fix would be
  an item for it rather than a silent rewrite.
- **A rename becomes something dbmd can be told about.** A catalogue cannot say
  it, but a person could: a flag naming an old and a new name would turn two
  items into one and carry the body across. It is worth building the first time
  somebody loses a paragraph to a rename they did tell us about.
- **The prose scan is observed firing where there is nothing to fix.** ADR 0044's
  own revisit condition, and the answer is the same: a narrower rule rather than
  a louder one.
- **The owner answers whether dbmd reads prose at all.** A yes makes a general
  check possible and this becomes a special case of it. A no makes the sentence
  on the list the furthest the tool ever goes.
