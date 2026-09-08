---
name: dbmd
description: Drive dbmd, the tool that keeps a database model in a repository as markdown and edits it in a local web view. Use when reading, changing, validating or bootstrapping a dbmd model directory (a directory of markdown files holding `_model.md`, `tables/`, `notes/`, `groups/`): adding or changing a column, index, ref, sticky note or grouping box; writing the prose that says why a table is shaped the way it is; answering "what points at this table"; renaming or deleting a table; importing a model from a live PostgreSQL or SQL Server schema, or re-importing over one and reading the delta it asks you to confirm; putting `dbmd check` in CI; or reading `dbmd check --json` output. Covers which surface an agent edits through and why, the canonical form a hand edit has to match, and what to do when a check fails on your own edit.
---

# Driving dbmd

dbmd keeps an application's database model in its own repository, as markdown,
one file per table, with the prose that says why the table is shaped that way.
It describes a schema. It never generates or applies DDL, and it connects to
nothing.

## How you run it

**Run it from a checkout rather than from an install.** The model you are editing
lives in a repository and the tool that reads it should be the one in front of
you, not whichever version somebody published:

```bash
npm ci
npm run build
node dist/cli.js check path/to/db-model
```

Everything below writes `dbmd <command>`. Read that as `node dist/cli.js
<command>` from the checkout. `npx dbmd` is the other way to run it, it resolves
whatever is on the registry, and `npm view dbmd versions` is what says which
releases exist: do not take a version number from a page, including this one.

Seven commands: `dbmd init`, `dbmd query`, `dbmd import`, `dbmd check`,
`dbmd refs`, `dbmd studio`, `dbmd export`. Every one of them puts data on stdout, narration
on stderr, and its answer in the exit code. `--json` moves the report to stdout
under a versioned envelope:

```json
{ "schema": 1, "ok": true, "directory": "shop", ... }
```

`ok` and the exit code never disagree. `directory` echoes what you typed rather
than resolving it, so the same command on two machines produces the same bytes.
Nothing prompts. Nothing is timestamped. Nothing carries an absolute path.

## The surface: you edit the files, and the CLI is the gate

Three rules, and they are the whole of the decision. ADR 0039 is the argument.

1. **Read and validate through the CLI.** `dbmd check --json` is the feedback
   signal, and its `code` values are a contract.
2. **Make edits by editing the markdown files**, in the canonical form below.
3. **Hand every file you edited to the canonical writer** before you stop, so
   your edit lands in the shape the tool would have written.

**Do not drive the studio's HTTP API.** `dbmd studio` is a person's editor. Its
wire format says in its own source that it is still moving, it has no version
and no reference page, it has no rename at all, and it writes on a debounce
behind a revision counter you would have to model correctly. It gives you three
real things: a stale edit is refused, a name a file cannot hold is refused, and
`POST /api/flush` is a fence, which the API needs because a `PATCH` is answered
before the file is written. Rules 2 and 3 plus `dbmd check` give you the same
protection from a process that exits, and a file you write is written when you
write it. The reference index on `GET /api/model` is not a fourth reason:
`dbmd refs` answers that question from a command, and answers it better, because
it answers a model with errors in it. ADR 0039 weighs all of this, including the
one claim about the API that turns out not to be true.

**Do not start a studio on a directory somebody may already have open.** The
disk wins, the studio drops its own edit and says so in a page you are not
looking at.

## The loop

Read, edit, canonicalise, check, report.

```bash
# 1. what is true now
dbmd check shop --json

# 2. edit the markdown, in the canonical form below

# 3. hand what you edited to the writer (the script is below)
node canonicalise.mjs /path/to/dbmd-checkout shop tables/products.md

# 4. still true?
dbmd check shop --json

# 5. say what you did, what still has a placeholder body, and what you did not
#    touch. Do not revert on a red check: see "When the check fails" below.
```

`--json` is silent on stderr, so nothing needs redirecting. Keep
`canonicalise.mjs` in your own scratch directory rather than writing it into
somebody's repository.

## Reading a model

The files are the model and they are meant to be read. Start with `_model.md`,
then the table you care about. A table's body is where the reasons are, and the
reasons are usually the answer to whatever you were asked.

For the shape without the prose:

```bash
dbmd export shop --stdout
```

That prints a mermaid `erDiagram`: every table, its columns, `PK`, `FK`, `UK`,
and one relationship line per `ref`. It drops the notes, the groups, the layout,
every prose body, nullability and defaults, and every index that is not a
single-column unique one. It refuses a model that has an error in it.

### What points at this table

Ask the command. Do not `grep` for the table name: `ref: orders.id` and the word
"orders" in a paragraph look the same to `grep`, and the models where this
matters are the ones full of prose. (Grep is the right tool for the prose
itself, which is a different question and is under
[Rename a table](#rename-a-table).)

```bash
dbmd refs customers shop
```

```
3 refs point at customers in shop:

  addresses.customer_id     -> customers.id  tables/addresses.md      required  on delete: restrict
  orders.customer_id        -> customers.id  tables/orders.md         required  on delete: restrict
  subscriptions.customer_id -> customers.id  tables/subscriptions.md  required  on delete: restrict

"required": the file says nullable: false, so the ref cannot be emptied.
"on delete", "on update": the clause the file writes beside that ref, saying what the engine does to the row on the left
when the row on the right is deleted or its key changes. A row without one is a ref the file said nothing about.
```

The table comes first and the directory second, which is the opposite of every
other command and is the one thing to remember about it.

- **The column and the file, not just the table.** "Three tables point here"
  does not say what to edit; the column does, and the file is where the edit
  goes. `key` means the column is part of the referring table's own primary key,
  so that row cannot outlive this one. `required` means `nullable: false`.
  Together they are the difference between retargeting a ref and deleting a row.
- **And what a delete does to those rows.** `on delete: cascade` beside a row
  means deleting the row on the right takes the row on the left with it;
  `restrict` and `no action` mean the delete is refused instead. The clause is
  quoted from the file, so a row without one is a ref that wrote none, which is
  not the same fact as `no action` and is not printed as one. ADR 0049.
- **It answers a model with errors in it**, which `dbmd export` refuses. That is
  the state you are in half way through a rename, so you can ask during rather
  than only before. It says the model has errors first, because a file that did
  not load is missing from the model along with every ref written in it, and the
  answer may therefore be short.
- **A table that is gone and still pointed at is an answer, not an error.** The
  run says there is no `tables/<name>.md` and then lists what still points at
  the name. That is exactly the middle of a rename.
- **A name nothing has heard of exits 1**, with `no-such-table` on the `--json`
  envelope. That is deliberately not the same as "nothing points at it", which
  exits 0, because you ask this immediately before a delete.
- **`--outgoing`** asks what this table points at. Both flags prints both.
  `--json` carries both directions whichever flag you gave, so an agent never
  runs it twice. `from`, `to` and `path` are on every edge. `inPrimaryKey`,
  `nullable`, `onDelete` and `onUpdate` are there only when the file said so,
  omitted rather than written false, for the reason the format omits them on
  disk. **Test whether the key is there rather than reading its value**: a
  missing `onDelete` is a ref that wrote no clause, which is not `no action`.

## Editing: the canonical form

Anything YAML accepts is read. What you want is the shape the writer emits, so
that your file never moves again and the next person's save produces no diff.
`docs/format.md` is the full reference; this is the part you need at the keyboard.

**Key order is fixed.**

| file        | order                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| `_model.md` | `kind`, `name`, `engine`                                                     |
| a table     | `kind`, `table`, `columns`, `indexes`, `group`, `layout`                     |
| a column    | `name`, `type`, `pk`, `nullable`, `default`, `ref`, `on delete`, `on update` |
| an index    | `name`, `columns`, `unique`                                                  |
| a note      | `kind`, `layout`, `color`                                                    |
| a group     | `kind`, `label`, `color`                                                     |

**`on delete` and `on update` go under the `ref:` they are about, and never
without one**, indented with the rest of the column's keys. Each takes one of
five words, and anything else is `not-in-vocabulary`. A clause on a column with
no `ref:` is `field-missing`, so the model could not be read back.

**Block style everywhere, with exactly two exceptions:** `layout` is flow
(`{ x: 480, y: 340 }`) and an index's `columns` is flow (`[customer_id, status]`).
Two spaces of indent, `- name:` on the same line as the dash.

**Absent, not empty and not false.** No `columns: []`, no `indexes: []`, no
`pk: false`. A key you have not set is a key that is not there.

**Strings are plain when plain is unambiguous and double-quoted otherwise.**
Never single-quoted. Frontmatter is LF; the body is left exactly as it is.

Seven things that bite, in the order they bite:

1. **The first line of the file is exactly `---`.** Not a blank line. Not a
   heading. A close of exactly `---` after it.
2. **`_model.md` needs `kind: model`.** It is the first line of the first file
   and it is the thing everyone forgets.
3. **`table:` must equal the file name without `.md`.** The file name is the
   identity; `table:` is the cross-check.
4. **`default: 250` is an error. Write `default: "250"`.** A SQL string literal
   needs two sets of quotes: `default: "'placed'"`.
5. **A composite primary key's order is the order the columns appear in the
   file.** Tidying the list changes the key and nothing warns you. Key columns
   first, in key order, and leave them there.
6. **`nullable:` has three states and only two are facts.** Absent is not
   `true`. Say it explicitly on every column you care about.
7. **Uniqueness is an index, never a column key.** `unique: true` on a column is
   an error that names the `indexes:` entry to write instead, because the
   constraint's name is the string the engine prints when it fires.

Lowercase names, with digits, hyphens and underscores. A model with `Orders` and
`orders` is two tables on Linux and one file on Windows.

## The prose is the point

This is the instruction that matters most and it is the easiest one to get
backwards.

A table's body is carried byte for byte: never parsed, never reflowed, never
trimmed. It is the half of the model a schema dump cannot give you, and it is
the reason the format is markdown at all. `dbmd import` writes one line per
table saying nobody has documented it yet, and that line is a prompt rather than
filler.

- **Do not generate a paragraph per table.** A body that restates the columns is
  worse than the placeholder, because the placeholder is honest about being
  empty and a summary of the frontmatter looks like documentation while telling
  the reader nothing. If you do not know why the table is shaped that way, leave
  the prompt and say in your report which tables still have it.
- **Do not rewrite or reflow a body somebody else wrote.** Add to it. A
  whole-file prose diff hides the one-column change it came with.
- What belongs there: why this column is an integer of the smallest unit, why
  rows are never deleted, which of two plausible readings of a status is the
  real one, what somebody lost an afternoon to. Facts a person paid for.

If a repository runs Prettier over everything, the model directory needs to be
in the root `.prettierignore`. Prettier rewrites `*emphasis*` inside a body, and
with `proseWrap` set to anything but preserve it reflows every paragraph. A
nested ignore file does nothing and looks like protection.

## Canonicalise what you edited

Nine lines, so that rule 3 costs nothing. This is the canonical writer, the same
one the studio and `dbmd import` write through, pointed at exactly the files you
touched.

```javascript
// canonicalise.mjs <dbmd checkout> <model dir> <path> [path...]
// Paths are relative to the model dir, slash-separated: tables/orders.md
import { pathToFileURL } from 'node:url'

const [checkout, dir, ...paths] = process.argv.slice(2)
const dbmd = await import(new URL('dist/index.js', pathToFileURL(`${checkout}/`)).href)

const { model } = await dbmd.readModel(dir)
const result = await dbmd.writeModel(dir, model, { only: new Set(paths) })
console.log(JSON.stringify(result, null, 2))
```

```
{ "written": ["tables/products.md"], "skipped": [] }
```

- **`only` is what makes it safe.** Without it the whole directory is
  canonicalised, and three files nobody touched land in somebody's `git status`
  next to the one you meant.
- **A file already in the shape is reported `skipped` as `unchanged`** and not
  rewritten. Running it twice is a no-op, so run it.
- **`skipped` as `incomplete`** means the reader raised an error building that
  object, so it was left alone rather than written over: saving it back would
  delete the line dbmd could not understand. Run `dbmd check` and fix that first.
- **A path in neither list is worse than a skip.** A file whose frontmatter never
  parsed, or whose `kind:` disagrees with its directory, produces no object at
  all, so `only` matches nothing and the answer is
  `{ "written": [], "skipped": [] }`. That reads like a clean no-op and it is
  your edit not being seen. Check the list against the paths you passed.
- **A disk that refuses the write throws, and takes the result with it.**
  `writeModel` rejects with a `WriteFailed`, exported beside it, carrying `path`,
  the model file spelled the way `written` spells one; `temporary`, the writer's
  own scratch file; and the system's words as `message`, with the original on
  `cause`. **Report `error.path` rather than `error.message`**: the message opens
  with the temporary file, which is absolute and which the writer has already
  deleted, and reaches the file you care about only after an arrow. Files sorted
  before the one that failed were written, and the throw took the `written` array
  with them, so `git status` is the only record of what landed. The script above
  prints nothing at all in that case. ADR 0083.
- **`pathToFileURL` is not decoration.** A bare Windows path in an `import`
  fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `C:` reads as a protocol.
- This step is not optional and `dbmd check` will not do it for you. A
  non-canonical file passes every check there is, right up until somebody saves
  that table in the studio and gets a whole-frontmatter diff attributed to
  moving a box. Verified: a column added in flow style passed `dbmd check` with
  zero diagnostics.

There is no `dbmd fmt`. <!-- hypothetical: dbmd fmt -->

## Three edits worth a recipe

### Add or change a column

Edit `tables/<name>.md`, in the key order above, in the right place in the list
if it is part of the primary key. Canonicalise, then check. If it is a foreign
key, `ref: <table>.<column>` and the target has to identify one row, or you get
`ref-target-not-unique`.

### Rename a table

The one that goes wrong. It moves one file and edits every file that refs the
table, and getting it half right passes nothing.

Five steps, and none of them is optional.

```bash
# 1. ask what points at it. You can ask again at any step: this command
#    answers a model with a dangling ref in it.
dbmd refs addresses shop
#   addresses.superseded_by     -> addresses.id  tables/addresses.md   <- a self-ref counts
#   orders.shipping_address_id  -> addresses.id  tables/orders.md

# 2. move the file
git mv shop/tables/addresses.md shop/tables/postal_addresses.md

# 3. edit `table:` inside the moved file to match its new name, or the next
#    check is `name-mismatch`. The file name is the identity; `table:` agrees
#    with it.

# 4. retarget every ref found in step 1, the self-ref included. It is the
#    `ref:` value that moves: `ref: addresses.id` becomes
#    `ref: postal_addresses.id`, in the referring file.

# 5. canonicalise every file you touched, then check
node canonicalise.mjs /path/to/dbmd-checkout shop tables/postal_addresses.md tables/orders.md
dbmd check shop --json
```

A ref you missed is `ref-table-unknown`, an error, naming the file, the column
and the table that is not there. That is the safety net, and it is why step 1 is
a query rather than a guess: the check tells you afterwards, and you would
rather know before. `dbmd refs addresses shop` after step 2 lists exactly what
is still pointing at the old name, and it keeps working while that is an error.

**Then sweep the prose, by hand, and this is the one place `grep` is right.**
A body is opaque to every check there is, so a paragraph in `_model.md` or in a
neighbouring table that names the old table is left saying something false and
nothing will ever tell you. Measured on `examples/shop`: after a clean rename
with a green check, `_model.md` still had a sentence about the old name.

```bash
grep -rn 'addresses' shop --include=*.md | grep -v postal_addresses
```

Read every hit and decide. Some are the rename and some are a person writing
about a thing that is genuinely still called that.

**A note or a group is renamed the same way**, and a group has the extra step
that every member declares `group: <name>` in its own file, so those move too. A
group nobody declares is `group-empty`, a warning, and it is nearly always a
rename that missed a file.

### Delete a table

`dbmd refs <table>` first, and read the marks. A `key` referrer cannot be
retargeted to nothing: that row exists because this one does, and letting it go
is a decision rather than a tidy-up. **An `on delete: cascade` referrer is the
one to say out loud**, because dropping that constraint changes what a delete
does to real rows and nothing in the diff will look like it. Delete the file,
remove or retarget every ref that pointed at it, canonicalise the files you
changed, and check.
Then sweep the prose, as above.

`dbmd check` will not miss a dangling ref, but it will happily let you delete a
table and then delete the refs that pointed at it, which is a green check over a
decision nobody made. **Say what you removed, and say which columns you removed
to make the deletion legal**, because that second list is the one somebody will
want to argue with.

## When the check fails on your own edit

**Report. Do not revert.**

The writer's `only` makes a partial write a meaningful state rather than a
corrupt one: the files it did not name are exactly as they were, and a revert
throws away the part of your work that was already right. This is the same
answer the studio gives, in the same words: undo is `git checkout`, and the
model is files in a repository, so git is the undo that was always there.

So: leave the tree as it is, and report the `code`, the file, and the line if
the diagnostic carries one. Say which part landed and which did not. **When the
canonicalise step threw rather than reporting, `git status` is where that second
answer is**: a `WriteFailed` names the one file that did not land and says
nothing about the ones that did. Let whoever asked decide whether to fix forward
or throw it away. The one thing to do yourself is fix the diagnostic you caused,
when you know what it is.

`error` means something did not make it into the model. **Not every error blocks
the canonicalise step, and the line number is what tells the two halves apart.**
An error raised while reading one file carries the line it is on, leaves that
object incomplete, and dbmd refuses to save over it, because writing the model
back would delete the line it could not understand. An error about the whole
model carries a path and no line, and does not block anything: a dangling
`ref-table-unknown` is a disagreement between two files and both of them still
write. That is why the rename recipe canonicalises in the middle of a rename and
it works.

`warning` means it loaded and is probably still wrong: an unnamed column, a
keyless table, an empty group. Half-written models are full of warnings on
purpose. `--strict` is how a team says warnings do not reach `main`.

`docs/format.md` has every code, its severity, and what to do about it.

## Bootstrapping from a real database

dbmd never connects to a database and never asks for a credential. The journey
is three commands and you run the middle one yourself:

```bash
dbmd query --engine postgres > introspect.sql   # postgres or sqlserver
# run introspect.sql with the client you already trust, save the one value
# it returns, whole, to introspection.json
dbmd import --file introspection.json --dir db-model
dbmd check db-model
```

Read the query before you run it. Its comment block says what it touches, that
it cannot write, and how to save the result without cutting it short, which is
the mistake the importer sees most.

Tables land on a grid in name order; the layout is a person's job in the studio.
Every table gets the one-line placeholder body. **Replacing those is the work**,
and it is the part of this that is worth doing carefully rather than quickly.

`dbmd init` writes a small example model with its prose, meant to be read once
and replaced. That one does refuse a directory that exists and is not empty,
because it writes files named after common tables.

### Running import again is a re-import, and it is a delta somebody confirms

`dbmd import` over a directory that already holds a model does not refuse it and
does not overwrite it. It compares what the database says against what the files
say, prints every difference as an itemised list naming the file it is about,
and writes nothing. Run the same command again with `--confirm` to make exactly
the changes on that list and nothing else. ADR 0050 is the argument, the owner's
own sentence is in it, and `dbmd import --help` is the four paragraphs.

Three exits, and they are what a script reads:

| what happened                               | exit              | written                  |
| ------------------------------------------- | ----------------- | ------------------------ |
| the database says what the files say        | `0`, and one line | nothing                  |
| there are changes and nobody confirmed them | `1`, and the list | nothing                  |
| there are changes and `--confirm`           | `0`               | the files the list named |

- **Nothing prompts, here as everywhere.** The confirmation is a flag, because
  the JSON is usually already on standard input and there is nothing left to ask
  at. An unchanged re-import is a no-op that is safe to leave in CI, and
  `--confirm` is accepted on a run with nothing to confirm.
- **The unconfirmed run costs the whole pipeline again**, because the JSON on
  standard input has been read. Use `--file` where you can, so the second run is
  a second read of a file rather than a second query.
- **On `--json` the unconfirmed run is `ok: false` with `error.code`
  `changes-not-confirmed`**, and it carries a `changes` array whose entries have
  a `kind`, a `path`, a `headline` and a `detail`. Branch on `kind`
  (`table-removed`, `table-added`, `column-added`, `column-removed`,
  `column-changed`, `index-added`, `index-removed`, `index-changed`,
  `model-changed`) rather than on the prose.
- **A file the filesystem refuses is exit `1` with `error.code` `write-failed`**,
  and it is the one exit that can leave the directory part written: the run stops
  at the file that refused, and every file written before it stays written.
  `error.file` names the one that refused and `files` is what did land, both
  relative to the model directory. Read `files` before deciding what to do next;
  a first import that landed some of a model turns the next run into a
  re-import. ADR 0087.
- **Prose bodies, layout and group membership are untouched either way**, and a
  file no item on the list names is never opened. A column or a table that goes
  takes no paragraph with it: the list says which paragraphs will then name
  something that is not there, and deciding what those should say is yours.
- **A rename in the database arrives as a removal and an addition**, because a
  catalogue cannot say otherwise. That is the item to read twice, because
  confirming it deletes a body. A table new to a re-import lands below
  everything already placed, so nothing arranged moves.

## What you can rely on

- **Deterministic output.** Sorted, no timestamps, no absolute paths, the
  directory echoed rather than resolved. Two runs of the same command over the
  same model produce the same bytes on any machine, so diffing two runs is a
  fair test and committing the output of `dbmd export` is safe.
- **Stable diagnostic codes**, with the severity, documented in
  `docs/format.md`.
- **`dbmd export` writes nothing when the diagram has not changed**, so running
  it in a loop leaves `git status` empty. It replaces only what is between its
  two markers, so the rest of that README is a place to write.
- **A file that does not parse does not stop a check.** It is reported and
  skipped and every other file is still checked, so one broken file never hides
  the other nine.
