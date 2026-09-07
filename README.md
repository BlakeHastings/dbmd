# dbmd

Your database model, in your repository, as markdown.

One markdown file per table. YAML frontmatter holds the columns, the indexes and
where the box sits on the canvas. Everything after the frontmatter is free
markdown, and that is where the reason a table looks the way it does gets
written down, which is the part no schema dump can recover. `dbmd studio` is a
local web view onto those files: drag a box, edit a column, type a paragraph,
and the markdown is rewritten underneath you. The diff is a normal diff and the
review is a normal pull request.

## One picture and one file, and they are the same thing

![The dbmd studio: eight tables of the examples/shop model on a canvas with two amber sticky notes and a violet box labelled "Written by the depot handheld" drawn round two of the tables, the shipments table selected and outlined with its relationships highlighted, and an editing panel on the right headed "shipments / tables/shipments.md" showing its name, its group and its columns](docs/media/studio-shipments.png)

That is `dbmd studio` open on [`examples/shop`](examples/shop), a coffee
roastery's order book. `shipments` is selected, so the panel on the right is
editing `examples/shop/tables/shipments.md`, and that file is this:

```markdown
---
kind: table
table: shipments
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
  - name: carrier
    type: text
    nullable: false
  - name: tracking_reference
    type: text
    nullable: true
  - name: weight_grams
    type: integer
    nullable: true
  - name: handheld_key
    type: text
    nullable: false
  - name: packed_at
    type: timestamptz
    nullable: false
    default: now()
  - name: shipped_at
    type: timestamptz
    nullable: true
indexes:
  - name: shipments_order_idx
    columns: [order_id]
  - name: shipments_handheld_key
    columns: [handheld_key]
    unique: true
group: warehouse
layout: { x: 900, y: 640 }
---

One row per parcel. An order can have several: a 1kg bag goes on its own because
of the courier's weight bands, and an order that mixes a coffee we have with one
that is waiting for Thursday ships in two halves rather than making the customer
wait for both.

**`shipped_at` being null is the whole state machine.** A row exists from the
moment the parcel is packed, and `shipped_at` is stamped when the courier scans
it. Between those two, the parcel is in the depot: it is ours, it counts as
stock in the building, and `stock_movements` has not recorded anything for it
yet. Reading "has this shipped" as "does a shipments row exist" is the mistake
this table invites, and it has been made twice.
```

That is the frontmatter in full, and the first two paragraphs of a body that
keeps going. Every field in the panel is a line in the frontmatter, in the same
order. Scroll the panel and the indexes are there too, then a box holding the
body, which the studio carries byte for byte and never reflows.

The two halves of that file are why this exists. `unique: true` on
`shipments_handheld_key` is the difference between a parcel packed twice and a
parcel shipped twice, and the paragraph under the frontmatter is the only place
anybody will read that a `shipments` row is not a shipment. Introspection
recovers the first. Nothing recovers the second, so it lives in the same file
and goes through the same review.

## What a change looks like

Adding a column in the studio, by typing its name and its type into the panel
above and choosing `nullable: true`:

```diff
diff --git a/examples/shop/tables/shipments.md b/examples/shop/tables/shipments.md
--- a/examples/shop/tables/shipments.md
+++ b/examples/shop/tables/shipments.md
@@ -28,6 +28,9 @@ columns:
   - name: shipped_at
     type: timestamptz
     nullable: true
+  - name: signed_for_by
+    type: text
+    nullable: true
 indexes:
   - name: shipments_order_idx
     columns: [order_id]
```

No export step, no save button, and nothing else in the file moved. Commit it,
open a pull request, and the reviewer reads three added lines instead of a
picture they have to take on trust.

Dragging a box is the same idea from the other end. It rewrites the one
`layout:` line in that one table's file, so tidying a diagram touches only the
files whose boxes moved and never reads as a schema change.
[ADR 0003](docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md)
argues the format from that requirement and three others.

The canvas holds two other kinds of thing, and both are what make it a diagram
rather than a schema dump. A **sticky note** is a file under `notes/`: prose
with a position and a colour, rendered on the canvas, which is where the reason
for something that is nowhere in the schema gets written down. A **group** is a
file under `groups/` and is a box drawn round the tables that declared
themselves members of it, with `group: warehouse` in each of their own files. A
group has no coordinates at all: its box is worked out from its members every
time it is drawn, so dragging it writes one `layout` line per table that moved
and never touches the group's file, and two branches adding a table to the same
group touch two different files.
[ADR 0005](docs/architecture/decisions/0005-the-canvas-holds-more-than-tables.md)
argues that from the merge story, and
[ADR 0030](docs/architecture/decisions/0030-a-group-is-drawn-and-a-colour-is-a-name.md)
is what the studio does about it.

## Your editor and the canvas, at the same time

The studio watches the directory while it runs, so editing the markdown by hand
and editing it in the page are the same feature seen from two ends. Add a column
to a table file in your editor and the open page picks it up, without a reload
and without losing what you had selected. Edit that table in the panel
afterwards and the column you typed by hand is still there.

`git checkout` is the undo, and it is safe with a page open. The studio notices
that the files moved and says so on its status line:

```
The model changed on disk. This page is still showing what you were working on,
and will catch up when you are between edits.
```

An edit you had already composed against the model as it used to be is then
refused rather than written over the top of what `git` just restored:

```
this patch names revision 0 and this studio is on revision 1, so it was made
against a model that is no longer what the files say. Nothing was written. Read
/api/model again and make the edit on top of what it says now.
```

Nothing is written and nothing is lost. The page re-reads the model, and the
same edit made again lands normally.

## Running it

Two ways, and the second one is also how you work on it.

**From npm, when there is a release on the registry.** No clone and no install:
`npx --yes dbmd@0.1.0 studio db-model` fetches the package, runs it and leaves
nothing behind. `npm view dbmd versions` says what has been published, which is
the one answer to that question a file in this repository cannot get wrong;
`0.1.0` is the number chosen for the first release, and releases are cut by
pushing a tag.

**From a checkout**, which always works:

```bash
git clone https://github.com/BlakeHastings/dbmd.git
cd dbmd
npm ci
npm run build
```

After that, `node dist/cli.js` is the command written as `dbmd` everywhere
below, and it runs against a model directory anywhere. `npm run studio` is the
shortcut that builds and then opens this repository's own `examples/shop`, which
is the fastest way to get the picture above onto your own screen.
[`CONTRIBUTING.md`](CONTRIBUTING.md) takes that from a clean clone.

## The commands

In the order you meet them. Every block below is real output, and all of it is
on stderr: **stdout is data and stderr is narration**, in every command, so
`dbmd check 2>/dev/null` is the quiet flag this CLI does not have.

**`dbmd init`** writes a model to start from, in a directory called `db-model`.

```
$ dbmd init
Created db-model, 4 files:
  _model.md
  notes/there-are-no-passwords-here.md
  tables/accounts.md
  tables/api_keys.md

Read _model.md first. It says what the rest of them are for.

The format is written down at https://github.com/BlakeHastings/dbmd/blob/main/docs/format.md
If this repository runs Prettier, add db-model/ to its .prettierignore.
Prettier rewrites the prose in these files, and the prose is the point.
```

**`dbmd query --engine <id>`** prints one engine's introspection SQL on stdout
and nothing else. It is the first step of the journey `dbmd import` finishes,
and the step in the middle is yours: dbmd never connects to a database and never
asks for a credential, so you run that SQL with the client you already trust.

```
$ dbmd query --engine postgres > introspect.sql
The PostgreSQL introspection query, 9827 characters, on stdout.
Read the comments at the top before you run it: they say what it touches,
and how to save its result without cutting it short.
Run it, save the one value it returns, then "dbmd import --file <that file>".
```

**`dbmd import`** turns the JSON printed by an introspection query into a model
directory, the other way in besides `dbmd init`. `--file <path>` says which file
to read, defaulting to standard input so a pipe works; `--dir <path>` says where
to write, defaulting to `db-model` like every other command; `--engine <id>`
overrides the engine the file says it is; `--confirm` makes the changes a run
over a directory that already holds a model lists.

```
$ dbmd import --file test/import/fixtures/postgres-raw.json --dir shop-model
Imported 2 tables from postgres into shop-model, 3 files:
  _model.md
  tables/order_line.md
  tables/orders.md

Run "dbmd check shop-model" to read it, and "dbmd studio shop-model" to arrange it.
Every table body says nobody has documented it yet. That line is the prompt.
```

`shop-model/tables/orders.md` is then this, in full, and it is the first diff
anybody reviews:

```markdown
---
kind: table
table: orders
columns:
  - name: id
    type: bigint
    pk: true
    nullable: false
  - name: tenant_id
    type: integer
    nullable: false
  - name: code
    type: character varying(32)
    nullable: false
  - name: placed_at
    type: timestamp with time zone
    nullable: false
    default: now()
  - name: total
    type: numeric(12,2)
    nullable: false
    default: '0'
  - name: notes
    type: text
    nullable: true
indexes:
  - name: orders_tenant_id_code_key
    columns: [tenant_id, code]
    unique: true
layout: { x: 340, y: 40 }
---

One row per placed order.

Imported from `public.orders`.
```

`character varying(32)` is Postgres's own name for the column with its modifier
put back on, not a normalised `string` and not a shortened `varchar(32)`; a SQL
Server import spells its own columns the same way, down to `nvarchar(max)`.
[ADR 0029](docs/architecture/decisions/0029-what-an-import-writes-and-what-it-drops.md)
is why. "One row per placed order." is the one line of prose the source
database already had on this table; a table with none gets a line saying so,
because a paragraph invented out of the frontmatter above it would say nothing
a reader could not already see two lines up.

Run it again over that directory next release and it is a **re-import**. It
compares what the database says against what the files say, prints every
difference as an itemised list naming the file it is about, and writes nothing:

```
$ dbmd import --file next-release.json --dir shop-model
Re-importing shop-model from postgres would make 3 changes:

tables/event.md
  database table removed
      `event` is in the model and not in this import, so tables/event.md is
      deleted.
      Its prose goes with it, and the last commit is where that survives.
      A table nobody dropped on this list usually means an import over fewer
      schemas than the last one.

tables/order_line.md
  database column removed
      `order_line.note` is in the file and not in the database, so the entry is
      removed from `columns:`.
      1 mention of it in backticks stays exactly as written, in
      tables/order_line.md, so the prose will name a column that is not there.
      No check reads a body, so nothing else will tell you.
  database column changed
      `order_line.unit_price`: type `numeric(12,2)` in the file and
      `numeric(14,4)` in the database.
      The database's answer is taken, and nothing else about the column is
      touched.

dbmd: nothing has been written, because nothing above has been confirmed.
Read the list, then run the same command again with --confirm
to make exactly those changes.
Prose bodies, layout and group membership are not touched either way.
```

That exits 1, so a first run in a script tells its author what to add. `--confirm`
on the next run makes exactly the changes the list named and opens no other file:
a table nothing was said about is not rewritten, every prose body and every
`layout:` survives, and a table new to the database lands below everything
already placed. **Prose is never edited by a machine.** A column that goes leaves
the paragraph about it exactly as written, and the list is what tells you the
sentence has gone stale.

An unchanged database prints one line and exits 0, so a re-import is safe to
leave in CI:

```
$ dbmd import --file next-release.json --dir shop-model
shop-model already says what this postgres import says: 4 tables, nothing to change.
```

Nothing prompts, in either half.
[ADR 0050](docs/architecture/decisions/0050-a-re-import-is-a-delta-somebody-confirmed.md)
is why the confirmation is a flag rather than a question: the JSON is usually
already on standard input, so there is no terminal left to ask at.

**`dbmd studio [directory]`** serves that directory on loopback and opens it in
a browser. The URL it bound to is printed on stderr, and with the default port,
which is `0`, that line is the only way to learn the port. `--port N` picks one
yourself and `--no-open` binds without opening a browser. It listens on
127.0.0.1 only.

```
$ dbmd studio examples/shop --no-open
dbmd studio  http://127.0.0.1:53429/
  model      examples/shop
```

**`dbmd check [directory]`** is the one to put in CI. It reads the model, checks
every file against the format and the files against each other, and groups what
it finds by the file it is in.

```
$ dbmd check examples/shop
examples/shop: 8 tables, 2 notes, 1 group, no problems.
```

A `ref:` at a table nobody wrote is the thing this catches and a reviewer does
not, and the exit code is the answer a script reads:

```
$ dbmd check
tables/api_keys.md
    error  `ref: acccounts.id` on column `account_id` names no table; there is no tables/acccounts.md (ref-table-unknown)

db-model: 1 error across 1 file.
$ echo $?
1
```

`--strict` fails on a warning too, and `--json` puts the same report on stdout
with the same exit code:

```json
{
  "schema": 1,
  "ok": false,
  "directory": "db-model",
  "strict": false,
  "counts": { "errors": 1, "warnings": 0 },
  "diagnostics": [
    {
      "code": "ref-table-unknown",
      "severity": "error",
      "at": { "in": "file", "path": "tables/api_keys.md" },
      "message": "`ref: acccounts.id` on column `account_id` names no table; there is no tables/acccounts.md"
    }
  ]
}
```

**`dbmd refs <table> [directory]`** answers "what points at this table". A
relationship is written on the referring column, so that adding one touches one
file, and the table being asked about pays for it: the fact lives somewhere
else, and its own file is the one place the answer is not written down. `grep`
cannot stand in, because `ref: orders.id` and the word "orders" in a paragraph
are the same string.

```
$ dbmd refs orders examples/shop
2 refs point at orders in examples/shop:

  order_items.order_id -> orders.id  tables/order_items.md  key  on delete: cascade
  shipments.order_id   -> orders.id  tables/shipments.md    required  on delete: restrict

"key": the referring column is part of its own table's primary key, so that row cannot outlive this one.
"required": the file says nullable: false, so the ref cannot be emptied.
"on delete", "on update": the clause the file writes beside that ref, saying what the engine does to the row on the left
when the row on the right is deleted or its key changes. A row without one is a ref the file said nothing about.
```

The column, not just the table, because "two tables point here" does not say
what to edit, and the file beside it because that is where the edit goes. The
marks are the difference between retargeting a ref and deleting a row, and the
question is asked immediately before a delete, so the `on delete:` and
`on update:` clauses are on the row too, quoted from the file. A ref the file
wrote nothing about gets nothing: absent is not `no action`, and printing one
for the other would invent a fact about somebody's database.
[ADR 0049](docs/architecture/decisions/0049-the-answer-before-a-delete-says-what-the-delete-does.md).
`--outgoing` asks the other direction, and `--json` carries both directions
whichever flag was given, with each action as a value on the ref rather than a
flag beside it.

**It answers a model that `dbmd export` refuses.** That is the point of it.
Half way through a rename the model has a dangling ref, which is an error, and
an error is where the diagram stops:

```
$ dbmd export shop --stdout
dbmd: shop has 2 errors in it, so there is nothing safe to draw.
Run "dbmd check shop" to see them.
$ dbmd refs addresses shop
shop has 2 errors in it. A file that did not load is missing from the model along with every ref
written in it, so what follows may be short. Run "dbmd check shop".

There is no tables/addresses.md in shop, and something still points at that name.

2 refs point at addresses in shop:

  orders.shipping_address_id     -> addresses.id  tables/orders.md            required  on delete: restrict
  postal_addresses.superseded_by -> addresses.id  tables/postal_addresses.md  on delete: restrict

"required": the file says nullable: false, so the ref cannot be emptied.
"on delete", "on update": the clause the file writes beside that ref, saying what the engine does to the row on the left
when the row on the right is deleted or its key changes. A row without one is a ref the file said nothing about.
```

"There is no such table" and "nothing points at it" read alike and mean opposite
things, so they are not the same exit code: an empty answer about a table that
exists is a success, and a name no file carries and no `ref` mentions exits 1.
The question gets asked immediately before a delete, and a typo must not answer
it with permission.
[ADR 0042](docs/architecture/decisions/0042-a-question-answers-a-model-a-diagram-refuses.md)
is the whole argument.

**`dbmd export [directory]`** draws the model as a mermaid `erDiagram` and
writes it into the model directory's own `README.md`, between two markers,
leaving the rest of that file alone. GitHub renders it, so a pull request that
changes a table shows a changed picture to anybody who opens the directory.

```
$ dbmd export
Wrote db-model/README.md: 2 tables, 1 relationship.
$ dbmd export
db-model/README.md is already up to date: 2 tables, 1 relationship.
```

`--stdout` prints the document instead of writing it, which is what a CI job
wants. [`docs/ci.md`](docs/ci.md) is `check` and `export` as a GitHub Actions
workflow, with a reason for every line that is not obvious, including the pinned
version and why pinning it is a decision rather than a formality.

## What it does not do

Two things, and both are decisions rather than gaps. Meeting them in review is
expensive, so they are here rather than three clicks away.

**It does not generate or apply DDL.** It describes a schema. A `default:` in a
model file is text the format carries and nothing ever executes it, and there is
no migration anywhere in this tool.

**It does not connect to a database.** Not to read one and not to write one.
`dbmd import` reads a JSON file that a person produced by running a query
themselves, with whatever client they already trust, and hands back what it
printed. The query itself lives with the provider that emits it, one file per
engine under `src/import/providers/`, written as a comment block meant to be
read and pasted whole, and `dbmd query --engine <id>` prints it for you.

[ADR 0003](docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md)
and [ADR 0007](docs/architecture/decisions/0007-engines-are-providers.md) are
the arguments, and
[`CONTRIBUTING.md`](CONTRIBUTING.md#before-you-write-anything) says what happens
to a pull request that adds either.

## Where to read more

- **[`docs/format.md`](docs/format.md) is the format.** Every key, every
  diagnostic, and the handful of things that are load-bearing and easy to guess
  wrong. It is written for somebody typing a model into a text editor with
  nothing installed, which is a thing you can do: a hand-written file and a
  studio-written file are the same file.
- **[`examples/shop`](examples/shop)** is a whole model in that format. Eight
  tables, one grouping box and two sticky notes, and it is the best answer to
  "what is the prose actually for". The test suite reads it on every run, so it
  cannot quietly go stale.
- **[`docs/ci.md`](docs/ci.md)** for running `check` and `export` on every pull
  request.
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for working on `dbmd` itself, and
  **[`docs/architecture/decisions/`](docs/architecture/decisions/)** for what has
  been decided and why.

MIT licensed. Developed at
[`github.com/BlakeHastings/dbmd`](https://github.com/BlakeHastings/dbmd).
