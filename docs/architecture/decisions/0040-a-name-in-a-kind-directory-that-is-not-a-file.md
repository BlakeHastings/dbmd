# 0040. A name in a kind directory that is not a file

## Context

ADR 0038 stopped the reader asking a `Dirent` whether a kind directory is a
directory, and recorded under *Consequences* that it had left the same shape of
bug one level down:

> **`markdownFiles` still filters on `entry.isFile()`**, so a symlink to a
> single `.md` file inside `tables/` is still skipped in silence.

A `Dirent` answers from the `lstat` `readdir` already did, so `isFile()` is
false for a symlink whatever it points at. The filter was

```
(entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')
```

and a symlinked `tables/orders.md` therefore dropped out of the listing. The
model came back one table short, `dbmd check` said `no problems`, and the table
was on disk one link away. It is 0038's silence with a smaller blast radius.

### What could be measured on the machine this was fixed on

The item asks for the reproduction before the decision, and the reproduction
turned out to be the interesting part.

**A symlink to a file cannot be created on Windows without a privilege an
ordinary account does not have.** Measured on Windows 11 with Node 24 and no
Developer Mode: `symlink(target, link, 'file')` and `symlink(target, link)` both
fail with `EPERM`. A junction needs no privilege and is what 0038's tests use,
but **a junction links directories only**: `symlink(aFile, link, 'junction')` is
accepted and produces a link that resolves to nothing, `stat` and `readFile`
alike failing `ENOENT`. So a junction cannot stand in for a linked file.

What that leaves is three cases that *are* reproducible here, all of which the
`isFile()` filter dropped in silence, and one that is not:

| in `tables/` | `Dirent` says | before |
| --- | --- | --- |
| a plain `orders.md` | `isFile` | read |
| a junction `orders.md` → a directory | `isSymbolicLink` | skipped, silent |
| a dangling junction `orders.md` | `isSymbolicLink` | skipped, silent |
| a real directory `orders.md/` | `isDirectory` | skipped, silent |
| a symlink `orders.md` → a real `.md` file | `isSymbolicLink` | *cannot be made here* |

The last row is the one in the item's title, and on a POSIX machine it gives the
same three answers as the junction rows: `isFile()` false, `isDirectory()` false,
`isSymbolicLink()` true. That is why the fix and this record are about the
answers rather than about the platform.

### The question 0038 did not have to answer

At the kind level, "a file here is an error" was available because a directory
was the only right answer. Here both answers are wrong in different ways, and
the linked-directory case is not hypothetical: it is the *only* linked case an
ordinary Windows account can create, so anybody reproducing this bug meets it
first.

## Decision

**A name ending in `.md` inside `tables/`, `notes/` or `groups/` has to open as
a file. A directory there is an error, and a link is followed to find out.**

- **`isFile()` is a file, and it is read.** No call is made that was not made
  before, which is every entry in a model with no links in it.
- **`isDirectory()` is a directory, and it is the new error.** No call either:
  the `Dirent` settled it.
- **Anything else is a link, and `stat` follows it.** That is the one new
  filesystem call and it is made only here. A link that resolves to a directory
  is the same error; anything else is put in the listing and read.

The new code is `object-not-a-file`, severity `error`.

**A link to a directory called `orders.md` and a real directory called
`orders.md` get the same sentence.** This is the decision the item asks for and
it is the one thing here that could have gone the other way. Answering
differently depending on whether the directory was reached through a link would
be 0038's mistake in a new place: it would be a rule about what the entry *is*
rather than about what opening it *does*, and the whole point of both records is
that the first question is the one a `Dirent` cannot be trusted with. So the
reader asks what following the name arrives at, and says the same thing about
both. `test/model/read.test.ts` asserts the two messages are identical, which is
where a reader meets the decision if they meet it in the tests; the block comment
on `markdownFiles` is where they meet it if they meet it in the code.

**It is an error rather than a warning**, on 0038's reasoning and against the
obvious objection. The objection is that nothing was lost: unlike a junctioned
`tables/`, where every table was on disk and none loaded, a directory called
`orders.md` holds no table that dbmd failed to read. What decides it the other
way is that the file name *is* the object's identity in this format. `orders.md`
in `tables/` is a claim to be the table `orders` and nothing else makes a table,
so a name in that position that can never be an object leaves a table missing
from every export and every diagram. A warning would leave CI green on a model
whose `orders` is gone, which is the sentence 0038 already refused to write.

**A name that is not `*.md` is still nobody's business.** A junctioned
`tables/archive/`, a real `tables/drafts/`, a `README.txt`: all silent, link or
not. This is the same boundary 0038 drew at the model root, where a junctioned
`sketches/` still raises nothing. `docs/format.md` says one level of directories
is not read and nothing warns about it, and that stays true; what changed is
that `billing/` claims to be nothing while `orders.md` claims to be a table.

**A link that points at nothing stays `file-unreadable`.** `stat` failing is
answered `false` rather than diagnosed, so the name goes into the listing and
the `readFile` that follows fails with the same errno and raises the code that
has always meant a call was made and it failed. That keeps one sentence per
broken link, worded for a call the user can see the point of, and it keeps
`file-unreadable` meaning what 0038 said it means. The errno collision 0038
worried about does not arise here: at the model root, `ENOENT` on `tables` could
mean the legal, silent case of a model with no tables, but a name inside
`markdownFiles` came out of a `readdir` a moment earlier, so `ENOENT` on it can
only mean it will not open.

### What it costs, measured

The kind-directory fix was free because it reused a `readdir` the loop was going
to make. This one is not free, so it was measured rather than asserted, on
Windows 11 with Node 24 and a 2,000-table model, eleven interleaved runs each:

| | median | `stat` calls |
| --- | --- | --- |
| before | 721 ms | — |
| after | 718 ms | 0 |

Zero, and a delta inside the run-to-run spread, because every entry in that
model takes the `isFile()` branch. The cost is per *link*, not per file, and a
model with no links pays nothing however large it is.

The bound if that were not true: a `stat` on this machine costs 47 µs measured
over 2,000 sequential calls, so a pathological model in which all 2,000 files
were links would add 94 ms to a 720 ms read. That is the worst case, it is
survivable, and nobody has that model.

## Consequences

- **A directory called `orders.md` inside `tables/` now fails `dbmd check`
  where it passed.** Real, accepted, and the same trade 0038 made: the fix is to
  rename it to something that does not end in `.md`.
- **Symlinked object files now work**, which is what the item was for. They did
  not before, on any platform, and nothing said so.
- **The reader now makes a filesystem call of its own for the first time.**
  `readModel` used to be exactly `readdir` and `readFile`; it now also `stat`s,
  and only entries that are neither a plain file nor a plain directory.
- **The linked-*file* assertion does not run on Windows without Developer
  Mode.** `test/model/read.test.ts` probes for the privilege and skips one test,
  which would leave the case in the item's title proven only on the Linux
  runner. `test/model/linked-file.test.ts` covers it everywhere instead by
  supplying the `Dirent` a POSIX symlink gives and letting the real file behind
  it be read, which is the technique `test/model/unreadable.test.ts` already
  uses for a filesystem failure a test may not cause.
- **`src/studio/watch.ts` is untouched** and still decides what to reload from
  file names. A linked object file that changes may not wake the studio. That is
  a different loop with a different question and it was left alone.

## Revisit when

- **Somebody's model directory is mostly links.** The 47 µs is a measurement on
  one machine's NTFS, and a network filesystem is not that. The answer then is to
  do the `stat` only for entries `readdir` reported as symlinks rather than for
  everything that is not plainly a file or a directory, which is a smaller set on
  paper and the same set in practice today.
- **`object-not-a-file` fires on models nobody thinks are broken.** The evidence
  would be people renaming directories they meant to keep. The answer then is a
  warning, not silence, exactly as 0038 says for its own code.
