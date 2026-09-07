# 0038. A kind name that is not a directory

## Context

ADR 0005 put a directory per kind under the model root, and `readModel` walked
the root's entries with one guard:

```
for (const entryName of names) {
  if (isDirectory.get(entryName) !== true) continue
```

That guard treats "not a directory" and "not there" as the same thing, and for
most entries they are: `_model.md`, a `README`, a `.gitignore` are all files at
the model root that dbmd has no opinion about, and a model with no `tables/` at
all is a legal empty model that `dbmd init` writes on purpose.

Two cases it also swallows are not that, and they were measured rather than
argued about.

**A `tables` that is a plain file.** `dbmd check` printed `0 tables, 0 notes, 0
groups, no problems.` and exited `0`. That is a true sentence and the least
useful one available: the user is looking at `tables` in their own directory
listing while being told the model is fine.

**A `tables` that is a link to a real directory of tables.** A `Dirent` answers
from the `lstat` that `readdir` already did, so it describes the entry and not
what the entry points at. Measured on Windows 11 with Node 24, a junction
answers `isDirectory=false isFile=false isSymbolicLink=true`, and a POSIX
symlink to a directory answers the same way. The guard skipped it. The tables
were on disk, one link away, and the report was `0 tables, no problems`.

The second is the one that settles it. It is not a malformed model at all. It is
a correct model that dbmd refused to read and then declared healthy, and no
argument about whose business a stray file is reaches it.

There is a third case worth naming because it is how the first one usually
happens. Git writes a symlink as an ordinary file whose contents are the link's
target when the checkout cannot create symlinks, which is the default on
Windows. A repository that symlinks a shared `tables/` directory becomes case
one on the next colleague's machine, silently, with every table still in the
repository.

## Decision

**The reader stops asking a `Dirent` whether a kind directory is a directory.**
`isDirectory()` cannot answer that question: it answers a narrower one, about
the entry rather than about what opening it would do. ADR 0008 says the reader
diagnoses rather than guesses, and the guard was a guess about what would work.

For the three reserved names, `tables`, `notes` and `groups`:

- **`isFile()` is a file and nothing else, so it is a diagnostic.** A plain file
  is the one answer that settles the question without another call: it is not a
  directory, it does not point at one, and it never will. The new code is
  `kind-not-a-directory`, severity `error`.
- **Everything else is handed to `readdir`.** A real directory, a symlink, a
  Windows junction, anything: `readdir` follows a link and is the only thing
  that can tell a link to a directory from a link to nothing. This costs no
  extra filesystem call, because it is the `readdir` the loop was going to make
  anyway. A link that resolves is read like any other directory. A link that
  does not raises `file-unreadable` with the errno, which is what that code has
  always meant: a call was made and it failed.

**For every other name, the `isDirectory()` guard stays.** The complaint is
about the three reserved names and nothing else. Warning about a file only
because it is not a directory would warn about `_model.md`, about a `README`,
about everything anybody keeps beside their model, and that is the warning
people stop reading. A junctioned `sketches/` therefore still raises no
`unknown-kind-directory`, which is a smaller silence and left alone.

**`file-unreadable` is not widened to cover the file case**, and that is
deliberate rather than incidental. It could have been: attempting the `readdir`
unconditionally would fail with `ENOTDIR` and produce a diagnostic with no new
code. Two things are wrong with it. The errno collides: a dangling link and an
absent `tables` are both `ENOENT`, and one of them is legal and silent, so a
`file-unreadable` reading `no such file or directory` beside a path the user can
see in a directory listing is a riddle rather than a message. And `ENOTDIR`'s
words in `errnoText` are "a directory in the path is not a directory", written
for a path component, which in this case points the reader at the wrong part of
the path. A code exists so the message can be about the thing that happened.

**The severity is `error` and not a warning.** `unknown-kind-directory` is a
warning because nothing was lost: those files never claimed to be model objects.
Here the name is reserved and the thing under it claims to be the model's
tables. In the checked-out-symlink case the tables genuinely go missing from
every export, every diagram and every `dbmd check` run, so the run should fail.
A warning would leave CI green on a repository whose model is not being read.

## Consequences

- **A repository that keeps an unrelated file called `notes` beside its model
  now fails `dbmd check` where it passed.** That is the cost, it is real, and it
  is accepted: `notes` is a name this format reserves, and the fix is to rename
  the file. There is no way to have the diagnostic without it.
- **Symlinked kind directories now work.** They did not before, on any platform,
  and nothing said so. Anybody sharing one model directory between checkouts, or
  vendoring one, gets a reader that reads it.
- **`markdownFiles` still filters on `entry.isFile()`**, so a symlink to a
  single `.md` file inside `tables/` is still skipped in silence. That is the
  same shape of bug one level down and it is not fixed here, because the case
  that motivated this one is a linked directory rather than a linked file.
- The reader still makes exactly one `readdir` of the model root and one per
  kind directory. Nothing stats an entry, and nothing resolves a link itself.

## Revisit when

- **A linked `.md` file inside a kind directory costs somebody a day.** The fix
  is `entry.isFile() || entry.isSymbolicLink()` in `markdownFiles` and letting
  `readFile` be the judge, exactly as this record does one level up, and the
  question it raises is what a link to a directory named `orders.md` should say.
- **The `error` severity turns out to fire on models nobody thinks are broken.**
  The evidence would be people renaming a legitimate `notes` file rather than
  thanking the tool. The answer then is a warning, not silence.
