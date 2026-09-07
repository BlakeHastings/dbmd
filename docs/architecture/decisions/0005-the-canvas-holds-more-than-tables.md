# 0005. The canvas holds more than tables

Extends ADR 0003, which assumed the only thing on the diagram was a table.

## Context

A data model diagram that only shows tables is a schema dump. What makes a
diagram worth keeping is the things a database cannot tell you: a sticky note
saying why a denormalisation exists, and a box drawn around six tables that says
"this is billing, and it is the part you should not touch casually".

So the canvas holds at least three kinds of object, and probably more later.
The constraint that decides the format is the one that decided ADR 0003, and the
owner restated it: **merge conflicts have to be easy, or preferably impossible.**

That constraint is what rules out the obvious design. A `_canvas.md` holding
every note and every group is one file that every branch touches, which is the
single worst shape for a repository where several people, or several agents, are
editing the model at once.

## Decision

**One file per object, and the directory says what kind of object it is.**

```
db-model/
  _model.md              name, engine, and prose about the model as a whole
  tables/
    orders.md
    customers.md
  notes/
    why-orders-are-never-deleted.md
  groups/
    billing.md
```

Each file carries `kind:` in its frontmatter as well. The directory decides and
the key is a cross-check: a file whose `kind` disagrees with its directory is a
diagnostic, never a silent reinterpretation. The redundancy is deliberate,
because a file pasted into a pull request comment or a chat window has lost its
path, and it should still say what it is.

### A note is prose with a position

```markdown
---
kind: note
layout: { x: 120, y: 640, w: 320, h: 200 }
color: amber
---

Orders are never hard deleted. Finance replays the export by date range, so a
missing row silently changes last quarter's numbers.
```

The body is the note. Nothing else is needed, and markdown is already the right
format for a paragraph a human wrote, which is the whole reason this project
exists.

`w` and `h` are on a note and not on a table, because a note's size is a design
choice and a table's is a consequence of its columns.

### Membership is declared by the member, not by the group

This is the decision that the merge-conflict requirement actually forces, and it
is the same shape as `ref` in ADR 0003.

A group file holds what the group *is*, and never who is in it:

```markdown
---
kind: group
label: Billing
color: violet
---

Everything the invoicing job reads. Changing a column here means checking the
nightly reconciliation, so treat this box as a warning rather than a label.
```

A table joins a group with one line in its own frontmatter:

```yaml
group: billing
```

The alternative, a `members: [orders, invoices, ...]` list on the group, is what
most tools do and it conflicts constantly: two branches each adding one table to
the same group are two edits to the same line region of the same file. Declared
by the member, those two branches touch two different files and git merges them
without noticing there was a question.

The cost is that a group's membership is computed rather than written down. That
is the same cost ADR 0003 already accepted for relationships, and it is paid in
one index built at load time.

### A group has no coordinates

A group's box is the bounding box of its members plus padding. It is never
stored.

Two reasons, and the second is the real one. Stored geometry can disagree with
its members, so a table dragged out of the box stays visually inside it, and the
file says something false. And a stored box means moving one member rewrites the
group file as well as the table file, which puts a shared file back in the path
of every layout change, which is the thing this record is avoiding.

Dragging a group moves its members, and the diff is one `layout` line per member
moved. That is exactly the diff a reviewer wants: the boxes that moved.

An empty group has nothing to bound. It renders as a small placeholder and is a
warning from `dbmd check`, because an empty group is almost always a rename that
went wrong.

## Consequences

Here is the whole merge story, which is the thing that was being optimised:

| Operation | Files touched |
| --- | --- |
| Add a table, a note or a group | One new file. Cannot conflict |
| Add or change a column | One line, one file |
| Move a box | One line, one file |
| Put a table in a group | One line, in that table's file |
| Rename a group's label | One line, in the group file |
| Edit a note | One file, and it is prose, where git's merge is as good as it gets |
| Rename a table | Its own file, plus one line in each file that `ref`s it |

Only the last one touches more than one file, and the studio has to say so
before doing it rather than after.

- **`_model.md` is the only shared file**, and it holds facts that change rarely.
  Keep it that way. Anything that would be edited during normal modelling work
  does not belong in it.
- **One level of grouping.** Nested groups are not in the MVP, and `group:` takes
  one value rather than a list. Both are extensions the format leaves room for
  and neither is worth the layout arithmetic yet.
- **Kinds will be added.** The next plausible ones are a legend and a note that
  anchors to a table with a leader line. Both are new directories and neither
  changes anything above, which is the property the directory-per-kind design was
  chosen for.
- The reader, the writer and the validator all now dispatch on kind. That is
  three small switches rather than one, and it is worth writing the dispatch once
  in the reader rather than three times.

## Revisit when

- **Someone wants a table in two groups**, or a group inside a group. Membership
  by the member handles the first with a list and the second not at all.
- **Computed group bounds get in the way**, most likely because somebody wants a
  group with a fixed size or a deliberate margin. The way out is an optional
  `layout` on the group that overrides the computation, and it should be added
  only when asked for, because the moment it exists it can disagree with reality.
- **The number of kinds passes about six.** Then a directory per kind is a lot of
  directories and the flat-with-`kind` design deserves another look.

## Appended 2026-09-07: a consequence this record did not list

Added by ADR 0035 rather than edited into the text above, so that what was
argued in August is still readable as it was argued.

**A computed bounding box costs the author of a member the work of reasoning
about a non-member's enclosure**, and that cost falls on whoever is arranging
the canvas rather than on whoever wrote the format. It is not in the
consequences table above and it should have been. The bill has been paid once
already: the agent that laid out `examples/shop` wanted a group over `orders`,
`order_items` and `shipments`, worked the box out on paper, saw it would reach
over `products`, and shipped a smaller group instead.

Neither argument for no-coordinates is weakened by this. A stored box can still
disagree with its members and still puts a shared file in the path of every
layout change, and this cost is if anything a second reason not to store one:
it lands on the same person, who would then have two things to keep true rather
than one. **The `layout`-on-a-group revisit path above is still the way out and
still costs what it says it costs.** ADR 0035 answers the enclosure problem
without taking it, by drawing the box so that what it covers and does not hold
is visible.

