# 0054. A file one folder too deep

## Context

ADR 0038 stopped the reader believing a `Dirent` about a kind directory, and ADR
0040 did the same one level down for a name ending in `.md`. Both were written
about the same failure: not a malformed model, a correct one the tool refused to
read and then declared healthy. This is the third instance of it, and the one
where nothing pointed at the missing thing.

Take `examples/shop`, move its two notes into `notes/archive/`, change nothing
else:

```
$ dbmd check shop
shop: 8 tables, 0 notes, 1 group, no problems.
$ echo $?
0
```

Two paragraphs of hand-written prose are on disk and not in the model. The only
signal is `0 notes`, which is a number nobody checks against a memory of what
the model used to hold.

The other two kinds are less bad and worth seeing as a set, because the
difference between them is the argument:

| moved into a subdirectory | what a person was told |
| --- | --- |
| `tables/billing/orders.md` | two `ref-table-unknown` errors, at the two tables that referenced `orders` |
| `groups/old/warehouse.md` | `group-unknown` at each table that joined it |
| `notes/archive/*.md` | nothing at all |

The first two are true and they name the consequence rather than the cause:
there is indeed no `tables/orders.md`, and nothing says there is a file at
`tables/billing/orders.md` that was not read. Notes get nothing because a note
is the one object nothing in a model references. The prose simply is not there.

### The reader already had this vocabulary one level up

A stray directory beside `tables/` has been a warning since ADR 0005:

```
scratch
    warning  `scratch/` is not a kind of object dbmd knows; its files are ignored (unknown-kind-directory)
```

So the asymmetry is the whole argument. The reader warns about an unread
directory beside a kind directory and is silent about one inside it.

### What this is not

**It is not a proposal to read subdirectories.** Flat files under `tables/` are
what ADR 0003 argues for and what `docs/format.md` states, and neither is being
overturned here. ADR 0003 names subdirectories as the way out of a hundred-table
model and observes that nobody has needed one yet, which is an invitation
somebody will eventually accept. What they must not get is silence.

## Decision

**A directory inside `tables/`, `notes/` or `groups/` with markdown under it is
an `object-in-subdirectory` error.** It is raised in `markdownFiles`, beside the
two diagnostics 0038 and 0040 put there, and it names the directory:

```
notes/archive
    error  `archive/` is a directory inside `notes/`, and dbmd reads only the files directly in `notes/`, so `notes/archive/the-copies-are-deliberate.md` is not a note; move the markdown up into `notes/` (object-in-subdirectory)
```

Three things were decided to get there, and each of them could have gone the
other way.

### The claim belongs to the `.md` name, not to the directory

ADR 0040 wrote the sentence this narrows:

> **A name that is not `*.md` is still nobody's business.** A junctioned
> `tables/archive/`, a real `tables/drafts/`, a `README.txt`: all silent, link
> or not. […] what changed is that `billing/` claims to be nothing while
> `orders.md` claims to be a table.

That is still right about `billing/` and it is the reason the diagnostic fires
on what is *under* the directory rather than on the directory itself. `billing/`
claims nothing. `billing/orders.md` claims to be the table `orders`, by 0040's
own rule that a name ending in `.md` in a kind directory is a claim to be an
object, and the claim does not stop being one because there is a folder in front
of it.

So the reader looks for the first markdown name under the directory and says
nothing at all when there is none. An empty `tables/drafts/`, a
`tables/screenshots/` of images, a `tables/schema.sql`, a `tables/README`: all
silent, exactly as before. **This is what makes an error affordable.** A rule
that fired on any subdirectory would fire on models where nothing was lost, and
a diagnostic that fires when nothing is wrong is the one people learn to ignore.

**A non-`.md` file directly in a kind directory stays nobody's business**, which
is the same boundary 0038 drew at the model root, where a `README` beside
`tables/` raises nothing. A `tables/notes.txt` is a different kind of mistake
from `tables/billing/orders.md`, and it is not one dbmd can tell from a person
keeping a file where they want it.

**A directory whose name begins with `.` is skipped**, as a dot-file in a kind
directory has always been. That is not an afterthought: it is the opt-out that
lets somebody keep an archive beside their model with dbmd having no opinion
about it, and it is why the error needs no flag to turn it off. A `.git` that
has somehow ended up in `tables/` costs nothing.

### The severity is `error`

`unknown-kind-directory` is a warning because nothing was lost: a `scratch/` at
the model root never claimed to be model objects. Here they did, and the
consequence is 0040's:

> A warning would leave CI green on a model whose `orders` is gone, which is the
> sentence 0038 already refused to write.

The notes case is that sentence at its worst, because a warning leaves `dbmd
check` exiting 0 and a team's prose can go missing from every export and every
diagram with the build still green. The failure this record exists to fix is the
exit code as much as the silence.

### One error per directory, naming the first file as evidence

The alternative was one per unread file, which is more useful to a person right
up until somebody puts a `node_modules` in `tables/`, and then it is a page of
errors saying the same thing. The directory is also the thing they will act on:
the fix is a `mv`, once.

Naming *no* file would have been cheaper still and worse. `notes/archive/` is
unread is a claim a reader has to go and verify; `notes/archive/why.md` is not a
note is a path they can open. So the message cites the first markdown name found
under the directory, which the search has in hand anyway.

The search stops at that first name, which is why it is affordable: the usual
cost is one `readdir`, and the misplaced `node_modules` costs the two or three
it takes to reach the first `README.md` rather than a walk of the tree. It also
decides the wording, because a count would mean finishing the walk. Entries are
sorted and files are looked at before subdirectories at each level, so the file
the message names is the same on every platform and in every run.

Links are followed, both to the subdirectory and inside it, because a junctioned
`tables/billing/` is 0038's case exactly and refusing to follow it would be this
silence again. The loop protection is a depth cap of eight rather than a cycle
check: a subdirectory is already the mistake, eight of them is the same mistake
said eight times, and a link pointing back at its own parent would otherwise
never return.

## Consequences

- **A repository keeping markdown in a subdirectory of a kind directory now
  fails `dbmd check` where it passed.** That is the cost and it is the point.
  The fix is a `mv`, or a leading dot on the directory name.
- **The tables and groups cases now say the cause beside the consequence.** The
  `ref-table-unknown` and `group-unknown` errors still fire, because both facts
  are true and the one that says a file was skipped is the one nothing else can
  say.
- **The studio's diagnostics panel shows it** with no change, because it renders
  whatever the reader hands back and the location is an ordinary file path. It
  reads as `notes/archive` followed by the message, in the same red as any other
  error.
- **The reader makes no filesystem call it did not make before on a model with
  no subdirectories.** Every entry in a kind directory takes the `isFile()`
  branch and is skipped or read as it always was. A stray directory costs one
  `readdir`, and only a *linked* one costs a `stat`, which is the bargain 0040
  already struck for `.md` names.
- **`docs/format.md` gained a row, a paragraph and a `dbmd-error:` block**, and
  lost the sentence saying `tables/billing/orders.md` is not read and nothing
  warns you about it. That sentence was true when 0040 wrote it and is now the
  behaviour this record changes.

## Revisit when

- **Somebody has a legitimate reason to keep model markdown in a subdirectory**
  and the leading dot is not it. The evidence would be people renaming
  directories to shut dbmd up rather than moving files. The answer then is
  reading subdirectories, which is a format change and ADR 0003's question, not
  a softer diagnostic.
- **The depth cap of eight is reached by a real model.** It would mean somebody
  is organising a hundred tables into a tree, which is the case ADR 0003 names
  as the reason to revisit flat files.
