# dbmd

Your database model, in your repository, as markdown.

```bash
npx dbmd studio
```

Opens a local web view of the model in `db-model/`. Drag tables, edit columns,
write down why a table exists. Every change writes straight back to the markdown
files, so the diff is a normal diff and the review is a normal pull request.

**[`docs/format.md`](docs/format.md) is the format**: every key, every
diagnostic, and the handful of things that are load-bearing and easy to guess
wrong. It is written for somebody typing a model into a text editor with nothing
installed, which is a thing you can do today.

**Status: in development.** `npx dbmd init` works: it writes a `db-model/`
directory with a small example model in it, two tables and a sticky note, prose
and all. The studio above does not exist yet. What is decided is in
[`docs/architecture/decisions/`](docs/architecture/decisions/), and why the
format is shaped this way is
[ADR 0003](docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md).

[`examples/shop`](examples/shop) is a whole model written in that format: eight
tables of a coffee roastery's order book, one grouping box and two sticky notes.
It is the best answer to "what is the prose actually for", and the test suite
reads it on every run so that it cannot quietly go stale.
