# The model format

A dbmd model is a directory of markdown files. This page is the reference for
writing one **by hand, in a text editor, with nothing installed**. Every key,
what it means, what happens when you get it wrong, and the handful of things
that are true, load-bearing and easy to guess wrong.

It is not the reasoning. [ADR 0003][adr3] argues for one file per table and
[ADR 0005][adr5] argues for a directory per kind, and both are worth reading
once. Neither is a document you can write a model against, which is why this
one exists.

**dbmd describes a schema. It does not generate or apply DDL.** Nothing here
runs against a database. A `default:` is text this format carries; it is never
executed.

If you are in a hurry, read [Five things people get wrong](#five-things-people-get-wrong)
and then come back.

<!-- Every fenced block below whose info string starts with `dbmd:` or
     `dbmd-error:` is read by `test/docs/format.test.ts` on every `npm run
     check`. The `dbmd:` blocks are assembled into one model directory and must
     produce no diagnostics at all; each `dbmd-error:` block must produce
     exactly the diagnostic codes its tag names. An example in this file cannot
     go stale without turning the build red. -->

## The directory

```
db-model/
  _model.md                       the model's own name, engine and prose
  tables/
    customers.md
    invoices.md
    invoice_lines.md
  notes/
    why-invoices-are-never-deleted.md
  groups/
    billing.md
```

`db-model/` is the default name and nothing depends on it. What does matter:

- **The directory an object is in decides what kind of object it is.** `tables/`
  holds tables, `notes/` holds sticky notes, `groups/` holds grouping boxes.
  Any other directory under the model root is ignored with an
  `unknown-kind-directory` warning.
- **The file name is the object's identity.** `tables/customers.md` is the table
  `customers`, and that is what `ref: customers.id` resolves against.
  `groups/billing.md` is the group `billing`, and that is what `group: billing`
  resolves against. Renaming a file renames the object.
- Only `*.md` files are read, and files whose name starts with `.` are skipped.
- There is one level of directories. `tables/billing/orders.md` is not read,
  and nothing warns you about it.

## A file

Every file is YAML frontmatter, then markdown:

```markdown
---
kind: table
table: customers
---

Everything from here to the end of the file is the body.
```

Three rules about the shape, and all three bite:

1. **The first line of the file must be exactly `---`.** Not a blank line first,
   not a heading first. If it is anything else the file has no frontmatter
   (`frontmatter-absent`), and a file in `tables/` with no frontmatter is not
   loaded at all.
2. **A later line of exactly `---` closes it.** Miss it and you get
   `frontmatter-unterminated`.
3. **The body is opaque.** Everything after the closing `---` is carried byte
   for byte: never parsed as markdown, never reflowed, never trimmed, carriage
   returns and all. Write whatever you like in it. This is the part of the
   format that a database cannot tell you and the reason the whole thing is
   markdown. See [Prettier will edit your prose](#prettier-will-edit-your-prose).

The frontmatter is ordinary YAML and you may write it any way YAML accepts:
block or flow, quoted or not, in any key order. dbmd normalises it the first
time it saves the file, and after that the file never moves again. What it
normalises to is [the canonical form](#the-canonical-form).

## `_model.md`

One file per model, at the root of the model directory. It holds what is true of
the whole model, and ADR 0005 asks you to keep it to facts that change rarely,
because it is the only file everybody's branch touches.

```markdown dbmd:_model.md
---
kind: model
name: kettleback-billing
engine: postgres
---

What the invoicing side of the business looks like. Three tables, and the two
sentences below are the reason all three are shaped the way they are.

Invoices are immutable once issued. Correcting one means issuing a credit note,
never editing a row, because the numbers have already been reported.
```

| key | required | value | means |
| --- | --- | --- | --- |
| `kind` | yes | `model` | Says what this file is. See below. |
| `name` | no | string | The model's name. |
| `engine` | no | string | `postgres`, `sqlserver`, whatever you target. |

**`kind: model` is required and is the first thing everybody gets wrong.** It is
not one of the three object kinds, it appears in neither ADR, and without it the
very first line of the very first file you write produces:

```markdown dbmd-error:_model.md:kind-missing
---
name: kettleback-billing
engine: postgres
---

No `kind: model`, so this file is a `kind-missing` error.
```

`_model.md` is the one file allowed to have no frontmatter at all. A `_model.md`
that is pure prose is read as prose and complained about nowhere; it simply
gives the model no name and no engine. What is not allowed is frontmatter that
forgets to say what it is.

If there is no `_model.md`, you get a `model-file-missing` **warning** and
everything else still works.

## `tables/<name>.md`

```markdown dbmd:tables/customers.md
---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: citext
    nullable: false
  - name: display_name
    type: text
    nullable: false
  - name: credit_limit_pence
    type: integer
    nullable: false
    default: "0"
  - name: created_at
    type: timestamptz
    nullable: false
    default: now()
indexes:
  - name: customers_email_key
    columns: [email]
    unique: true
group: billing
layout: { x: 40, y: 40 }
---

One row per person or company we invoice. `email` is `citext` and not `text`
because an address typed in two cases is one customer with two rows, and we had
exactly that before the type changed.

`credit_limit_pence` of `0` means no credit rather than no limit, which is the
opposite of what everybody assumes on first reading.
```

| key | required | value | means |
| --- | --- | --- | --- |
| `kind` | yes | `table` | Cross-check against the directory. |
| `table` | yes | string | Must equal the file name without `.md`. |
| `columns` | no | list | In order. See [A column](#a-column). |
| `indexes` | no | list | See [An index](#an-index). |
| `group` | no | string | The group file's name, without `.md`. |
| `layout` | no | `{ x, y }` | Where the box sits. See [Layout](#layout). |

`table:` has to agree with the file name because the file name is what a `ref`
resolves against, so a disagreement leaves the table reachable under one name
and described under another. A file called `orders.md` that says `table: order`
gets `name-mismatch`:

```markdown dbmd-error:tables/orders.md:name-mismatch
---
kind: table
table: order
---

The file is `orders.md`, so `table:` has to say `orders`.
```

An empty list is written as no key at all. A table with no columns yet has no
`columns:` line, rather than `columns: []`.

### A column

A list, in order, of mappings:

```yaml
columns:
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
```

| key | required | value | means |
| --- | --- | --- | --- |
| `name` | yes | string | The column name. |
| `type` | yes | string | The type, in the engine's own spelling. Not checked. |
| `pk` | no | `true` | Part of the primary key. See [The primary key](#the-primary-key). |
| `nullable` | no | `true` / `false` | `false` is SQL's `NOT NULL`. |
| `default` | no | string | SQL text. See [Defaults](#defaults-and-the-quoting-rule). |
| `ref` | no | `table.column` | A foreign key. See [Refs](#refs). |

`type` is carried through and never validated: dbmd does not know what types
your engine has, and a reference tool that rejected `citext` would be worse than
one that says nothing.

**`nullable` has three states and only two of them are a fact.** `nullable:
false` says NOT NULL, `nullable: true` says the column accepts nulls, and *no
`nullable` key at all* says the file did not mention it. Absent is not the same
as `true`. Say it explicitly on every column you care about.

**`nullable:` used to be spelled `null:` and the old spelling is now an error**,
not a warning and not an alias. Writing it costs you the constraint:

```markdown dbmd-error:tables/orders.md:superseded-key
---
kind: table
table: orders
columns:
  - name: status
    type: text
    null: false
---

`null: false` is a `superseded-key` error naming `nullable`.
```

**`unique:` is not a column key either.** It is an error on a column, with a
diagnostic that tells you the `indexes:` entry to write instead:

```markdown dbmd-error:tables/orders.md:superseded-key
---
kind: table
table: orders
columns:
  - name: reference
    type: text
    unique: true
---

`unique` on a column is a `superseded-key` error. It belongs on an index.
```

The reason is worth one sentence, because it is the reason you will want to
argue with: a unique constraint has a name, and that name is the string the
engine prints when the constraint fires, so
`violates unique constraint "customers_email_key"` is greppable and a column has
nowhere to put the name. [ADR 0003's amendment][adr3] has the rest.

### The primary key

`pk: true` on every column in the key. There is no separate `primaryKey:` list.

> **The order of the key is the order the columns appear in the file.**
> Reordering `columns:` for readability silently changes the primary key, and
> nothing will tell you. Put the key columns first, in key order, and leave them
> there.

```markdown dbmd:tables/invoice_lines.md
---
kind: table
table: invoice_lines
columns:
  - name: invoice_id
    type: uuid
    pk: true
    ref: invoices.id
  - name: line_no
    type: integer
    pk: true
  - name: description
    type: text
    nullable: false
  - name: amount_pence
    type: integer
    nullable: false
  - name: vat_rate
    type: numeric
    nullable: false
    default: "0.2"
indexes:
  - name: invoice_lines_invoice_idx
    columns: [invoice_id, line_no]
group: billing
layout: { x: 900, y: 40 }
---

The primary key is `(invoice_id, line_no)`, in that order, because that is the
order these two columns are written above. Swapping them would swap the key, and
the index that serves "the lines of this invoice, in order" would stop being the
leading edge of it.

`line_no` starts at 1 within an invoice and is never reused. A deleted line
leaves a gap, which is better than renumbering something a customer has printed.
```

### An index

```yaml
indexes:
  - name: customers_email_key
    columns: [email]
    unique: true
```

| key | required | value | means |
| --- | --- | --- | --- |
| `name` | yes | string | The constraint or index name the engine will print. |
| `columns` | yes | list of strings | In order. Leading column first. |
| `unique` | no | `true` | A unique index. Omit it for a plain one. |

Name it what the database calls it. That name is the payoff for uniqueness
living here rather than on the column, so an invented one throws the payoff
away.

`columns` is a list of column names as strings. dbmd does not check that they
exist yet; that is the validator's job and the validator is not built.

Omit `unique` on a plain index rather than writing `unique: false`. Both are
read the same way and dbmd keeps a `false` you wrote, so nothing will tidy it
away for you. Absent is the one canonical spelling of a plain index, and a model
where some plain indexes say `false` and others say nothing is a model with two
spellings of the same fact.

There is no way to write an expression index (`lower(email)`) or a `check`
constraint. Both are deliberately undecided; see
[What the format does not have](#what-the-format-does-not-have).

### Refs

A foreign key is declared on the column that holds it, as `table.column`:

```yaml
  - name: invoice_id
    type: uuid
    nullable: false
    ref: invoices.id
```

There is no relationship list anywhere. The arrow on the diagram is drawn from
this one line, and the reverse direction is computed when the model is read.

The value is split at the **last** dot, so the table part may itself contain
dots later. Anything without a usable dot is `ref-malformed`:

```markdown dbmd-error:tables/orders.md:ref-malformed
---
kind: table
table: orders
columns:
  - name: customer_id
    type: uuid
    ref: customers
---

`ref: customers` names no column, so it is `ref-malformed`. Write
`ref: customers.id`.
```

Whether the target exists is not checked yet. A typo in a table name is
currently a quiet dangling arrow rather than a diagnostic.

### Layout

```yaml
layout: { x: 480, y: 340 }
```

`x` and `y` are numbers and both are required once you write `layout` at all.
They are canvas coordinates and nothing checks them: any number is accepted,
negative ones included. Omit `layout` entirely and the table has no stored
position.

**A table has no `w` and no `h`.** A table's size is a consequence of its
columns. Writing them is an `unknown-key` warning and they are dropped:

```markdown dbmd-error:tables/orders.md:unknown-key
---
kind: table
table: orders
layout: { x: 40, y: 40, w: 300, h: 200 }
---

`w` and `h` belong to a note, so this is an `unknown-key` warning and the size
is ignored.
```

`layout` is the one line in the format a reviewer learns to skip. It is in the
table's own file, rather than in a shared layout file, so that moving three
boxes touches exactly three files. [ADR 0003][adr3] has the argument.

### Groups, from the table's side

```yaml
group: billing
```

One line, naming `groups/billing.md`. A table is in at most one group; there is
no list and no nesting.

If the group file does not exist you get a `group-unknown` **error**. Note that
this one is about the model rather than about the file, so the table itself
still loaded fine and dbmd will still save over it.

## `notes/<name>.md`

A sticky note is prose with a position. The body *is* the note.

```markdown dbmd:notes/why-invoices-are-never-deleted.md
---
kind: note
layout: { x: 40, y: 420, w: 380, h: 220 }
color: amber
---

An invoice row is never deleted and never edited after it is issued. A mistake
is corrected by issuing a credit note against it.

This is a review rule and not a constraint, which means the only thing enforcing
it is somebody reading a pull request. The finance export replays a date range,
so a row that changes retrospectively changes a quarter that has already been
reported to people who wrote it down.
```

| key | required | value | means |
| --- | --- | --- | --- |
| `kind` | yes | `note` | |
| `layout` | no | `{ x, y, w, h }` | `w` and `h` are optional and are a note's alone. |
| `color` | no | string | Carried through. Not validated. |

A note has no name key. Its file name is its identity, and it is the only thing
in the file that is not the note itself, so name the file something that reads
in a list: `why-invoices-are-never-deleted.md`, not `note-3.md`.

## `groups/<name>.md`

A grouping box: a labelled region drawn around the tables that joined it.

```markdown dbmd:groups/billing.md
---
kind: group
label: Billing
color: violet
---

Everything the invoicing job reads. A column change in here means checking the
nightly reconciliation before it ships, so treat this box as a warning rather
than as a label.

It is not a bounded context and it is not a module. It is the part of the model
where being wrong costs money that has already been counted.
```

| key | required | value | means |
| --- | --- | --- | --- |
| `kind` | yes | `group` | |
| `label` | no | string | What the box is called on the canvas. |
| `color` | no | string | Carried through. Not validated. |

Two things a group file deliberately cannot say:

- **It never lists its members.** Membership is declared by each table, with
  `group: billing` in that table's own file. Two branches adding a table to the
  same group therefore touch two different files and git merges them without
  asking.
- **It has no coordinates.** A group's box is the bounding box of its members
  plus padding, computed when it is drawn. A `layout:` here is an `unknown-key`
  warning and is ignored. [ADR 0005][adr5] has both arguments.

An empty group, one nothing declares itself a member of, is legal and is almost
always a rename that went wrong.

## Values, quoting and the YAML traps

Three rules cover nearly everything.

**Where the format wants a string, YAML has to hand back a string.** dbmd reads
the YAML node rather than the value, so it can tell `type: text` from
`type: true`, and it says so rather than guessing. `name`, `type`, `default`,
`ref`, `group`, `label` and `color` are all strings, and anything YAML resolves
to a number, a boolean or null is `field-wrong-type` and is dropped.

**Where it wants a boolean, write `true` or `false` bare.** `pk`, `nullable` and
`unique` are booleans. `nullable: "false"` is the *string* "false" and is an
error.

**Quote anything YAML might read as something else.** A value is safe unquoted
when it starts with a letter and contains no `:` or `#`. Everything else wants
double quotes. In particular:

| you mean | write |
| --- | --- |
| the type `text` | `type: text` |
| the type `on`, `off`, `yes`, `y`, `n` | `type: "on"` |
| a column named `null` | `name: "null"` |
| a type with a colon or a comment character | `type: "money::gbp"` |

dbmd itself reads YAML 1.2, where only `true`, `false` and `null` are keywords,
so `on` survives unquoted here. Other people's YAML tools read 1.1, where it
does not, and dbmd writes those words quoted for exactly that reason.

### Defaults and the quoting rule

This is the second thing everybody gets wrong, and it is worth its own table.

**A `default:` is SQL text.** Write exactly what would follow the word `DEFAULT`
in the DDL, then make YAML give that string back unharmed.

| the SQL you want | write |
| --- | --- |
| `DEFAULT now()` | `default: now()` |
| `DEFAULT CURRENT_TIMESTAMP` | `default: CURRENT_TIMESTAMP` |
| `DEFAULT nextval('orders_id_seq')` | `default: nextval('orders_id_seq')` |
| `DEFAULT 250` | `default: "250"` |
| `DEFAULT 0.2` | `default: "0.2"` |
| `DEFAULT false` | `default: "false"` |
| `DEFAULT 'placed'` | `default: "'placed'"` |
| `DEFAULT '{}'::jsonb` | `default: "'{}'::jsonb"` |

Two things are going on and they catch people in this order.

**A number is not a string, so `default: 250` is an error.** YAML reads `250` as
the number two hundred and fifty, dbmd wants text, and you get
`field-wrong-type` with the default dropped:

```markdown dbmd-error:tables/orders.md:field-wrong-type
---
kind: table
table: orders
columns:
  - name: quantity
    type: integer
    default: 250
---

`default: 250` is a number. Write `default: "250"`.
```

The same holds for `default: false` and `default: 0.2`. Quote all of them.

**YAML quotes are not SQL quotes.** `default: 'placed'` is YAML's way of writing
the six characters `placed`, so the model gets `placed` with no quotes on it,
and `DEFAULT placed` in SQL is a reference to a column called `placed` rather
than a string. A SQL string literal needs both sets: YAML's on the outside, SQL's
on the inside.

```yaml
default: "'placed'"     # eight characters, of which the outer two are SQL's
default: 'placed'       # six characters. Not a SQL string. Almost never right
```

Use double quotes on the outside, always. They are the pair with an escape for
everything, so there is never a second question about how a value should have
been written, and it is what dbmd writes back.

## The canonical form

dbmd emits frontmatter itself rather than through a YAML library, so that a file
that is already right produces no diff on the next save. You do not have to
write this by hand. It is here so you know what your file will look like after
its first save, and so a file you write in this shape never changes at all.

**Key order is fixed.**

| file | order |
| --- | --- |
| `_model.md` | `kind`, `name`, `engine` |
| a table | `kind`, `table`, `columns`, `indexes`, `group`, `layout` |
| a column | `name`, `type`, `pk`, `nullable`, `default`, `ref` |
| an index | `name`, `columns`, `unique` |
| a note | `kind`, `layout`, `color` |
| a group | `kind`, `label`, `color` |

**Block style everywhere, with exactly two exceptions.** ADR 0003's own example
mixes styles and this settles it: `layout` is flow (`{ x: 480, y: 340 }`) and an
index's `columns` is flow (`[customer_id, status]`). A layout only earns the
right to be a line a reviewer skips if it is one line. Everything else, columns
and indexes included, is block:

```yaml
columns:
  - name: id
    type: uuid
    pk: true
```

**Absent, not empty and not false.** No `columns: []`, no `indexes: []`. An
optional boolean you have not set is a missing key, not `false`.

**Two spaces of indentation**, list items indented under their key, and
`- name:` on the same line as the dash.

**Strings are plain when plain is unambiguous, and double-quoted otherwise.**
Never single-quoted.

**The frontmatter is written with LF line endings** and the body is written back
exactly as it arrived, carriage returns included. A CRLF file therefore
normalises its frontmatter once, keeps its body verbatim forever, and never
moves again.

You are not obliged to produce any of this. Anything YAML accepts is read; the
first save tidies it.

## Five things people get wrong

Every one of these cost somebody an afternoon while writing a model by hand.

1. **`_model.md` needs `kind: model`.** It is the first line of the first file
   and neither ADR shows it. [Above](#_modelmd).
2. **`default: 250` is an error; write `default: "250"`.** And a SQL string
   literal needs two sets of quotes: `default: "'placed'"`.
   [Above](#defaults-and-the-quoting-rule).
3. **A composite primary key's order is the order the columns appear in the
   file.** Tidying the list changes the key and nothing warns you.
   [Above](#the-primary-key).
4. **Block style everywhere except `layout` and an index's `columns`.**
   [Above](#the-canonical-form).
5. **Prettier will edit your prose.** [Below](#prettier-will-edit-your-prose).

And two that were true yesterday and are not today: a column says
`nullable: false` and never `null: false`, and uniqueness is a key on an index
and never on a column. Both old spellings are errors that name their
replacement.

## Prettier will edit your prose

If you keep `db-model/` in a repository that runs [Prettier][prettier] over
everything, Prettier will rewrite the bodies of your model files. It is not a
hypothetical: the first time it ran over this repository's own example model it
turned `*style*` into `_style_` inside a table's body. With `proseWrap` set to
anything other than `preserve` it also reflows every paragraph, which turns a
one-word edit into a whole-file diff and undoes the reviewability the format
exists for.

Add the model directory to the `.prettierignore` **at the root of your
repository**:

```
# dbmd model files. The frontmatter is safe, the prose is not: Prettier
# rewrites *emphasis* to _emphasis_ inside a body, and with proseWrap set to
# anything but preserve it reflows every paragraph.
db-model/
```

Three details, each of which has caught somebody:

- **It has to be the root `.prettierignore`.** Prettier does not read nested
  ignore files, so a `.prettierignore` inside `db-model/` does nothing at all
  while looking like protection.
- **Your frontmatter is not at risk.** Prettier leaves canonically written
  frontmatter byte for byte alone, flow `layout` and flow index `columns`
  included. It is only the markdown body it edits, which is precisely the part
  no database could have told you.
- **The same goes for any other formatter** that touches markdown, and for an
  editor set to format on save.

`dbmd init` does not write this file for you. It creates one directory and
writes model files into it, and the entry above belongs at your repository root
in a file it does not own.

## Every diagnostic

dbmd reports problems rather than throwing, and reports all of them in one pass.
A diagnostic has a stable `code`, a `severity`, the file's path and usually a
line.

**`error` means something in the file did not make it into the model.** dbmd will
refuse to save over a file that raised one, because writing the model back would
delete the line it could not understand. **`warning` means it loaded and is
probably still wrong.**

| code | severity | what happened | what to do |
| --- | --- | --- | --- |
| `model-directory-unreadable` | error | The model directory is not there or not readable. | Check the path. |
| `file-unreadable` | error | A file or a kind directory could not be read. | Check permissions. |
| `model-file-missing` | warning | No `_model.md`. | Add one, or accept a model with no name. |
| `unknown-kind-directory` | warning | A directory that is not `tables`, `notes` or `groups`. | Move the files, or delete the directory. |
| `frontmatter-absent` | error | The file does not start with a `---` line. | Add the frontmatter. Check for a blank first line. |
| `frontmatter-unterminated` | error | An opening `---` with no closing one. | Add the closing `---`. |
| `frontmatter-empty` | error | Two delimiters with nothing between them. | Say what the file is. |
| `frontmatter-invalid` | error | YAML would not parse it. | The message is YAML's. Usually indentation or a stray `:`. |
| `frontmatter-not-a-map` | error | The frontmatter parsed to a list or a scalar. | It has to be `key: value` lines. |
| `duplicate-key` | error | The same key twice in one mapping. | Delete one. The first is used. |
| `kind-missing` | error | No `kind:` key. | Add `kind: table`, `note`, `group` or `model`. |
| `kind-mismatch` | error | `kind:` disagrees with the directory. The file is not loaded. | Fix the key, or move the file. |
| `name-missing` | error | A table file with no `table:` key. | Add `table: <the file name>`. |
| `name-mismatch` | error | `table:` disagrees with the file name. | Make them agree. The file name wins. |
| `field-missing` | error | A required key is absent: a column's `name`, an index's `columns`, a layout's `x`. | Add it. |
| `field-wrong-type` | error | A key holds the wrong sort of value: a number where a string was wanted. | Usually quotes. See [the quoting rule](#defaults-and-the-quoting-rule). |
| `unknown-key` | warning | A key that means nothing here. The message lists the ones that do. | Check the spelling. Otherwise delete it: it is dropped on the next save. |
| `superseded-key` | error | A real key in the wrong place or under its old name: `null:`, or `unique:` on a column. | The message names the replacement. |
| `ref-malformed` | error | A `ref:` that is not `table.column`. | Add the column. |
| `group-unknown` | error | `group:` names a file that is not in `groups/`. | Create it, or fix the name. |

`dbmd check`, which will print these from the command line, does not exist yet.
Until it does, the honest advice is to keep this page open.

## What the format does not have

Named here so you stop looking, and because a reference that pretends to be
complete is worse than one that says where it ends.

- **No `check` constraints, and no expression indexes.** Both are engine SQL that
  dbmd could carry but could not read, render or compare, and they want one
  answer between them rather than two conventions.
- **No `on delete` behaviour on a `ref`.** `on delete cascade` says what the
  database *does*, and this is a model rather than a migration.
- **No schemas.** Table files are flat, so two schemas with a table of the same
  name collide. Subdirectories under `tables/` are the way out and nobody has
  needed it yet.
- **No nested groups, and no table in two groups.** `group:` takes one value.
- **No `w`/`h` on a table**, and no coordinates on a group. Both are computed.
- **No validation of what you wrote.** Types are not checked against an engine,
  index columns are not checked against the table, and a `ref` to a table that
  does not exist is currently silent. That is the validator's job and it is not
  built.

## Where the truth is

If this page and the code disagree, the code is right and this page is a bug.

- `src/model/read.ts` reads a directory into a model and produces every
  diagnostic above.
- `src/model/write.ts` writes one back, and is where
  [the canonical form](#the-canonical-form) is decided.
- [`examples/shop`](../examples/shop) is a whole model in this format, eight
  tables of a coffee roastery, byte-canonical and read by the test suite on
  every run.
- Every example on this page is parsed by `test/docs/format.test.ts` on every
  `npm run check`.

[adr3]: architecture/decisions/0003-markdown-on-disk-is-the-model.md
[adr5]: architecture/decisions/0005-the-canvas-holds-more-than-tables.md
[prettier]: https://prettier.io
