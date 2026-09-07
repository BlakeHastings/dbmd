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
and all. `npx dbmd studio` works too: it serves that directory on loopback and
opens it, and `--port N` and `--no-open` are the two flags it takes.
`npx dbmd check` is the one to put in CI: it reads the model, prints every
problem grouped by the file it is in, and exits non-zero on an error, or on any
diagnostic at all with `--strict`. `--json` gives the same answer and the same
exit code in a shape a script can read. `npx dbmd export` writes the model as a
mermaid diagram into `db-model/README.md`, between two markers, so a pull
request that changes a table shows a changed picture that GitHub renders for
anybody who opens it; `--stdout` prints it instead of writing.
[`docs/ci.md`](docs/ci.md) is those last two as a GitHub Actions workflow, with
the version-pinning decision argued, a reason for every line that is not
obvious, and a note saying which of its lines do not work today and what to run
instead.
What is decided is in
[`docs/architecture/decisions/`](docs/architecture/decisions/), and why the
format is shaped this way is
[ADR 0003](docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md).

[`examples/shop`](examples/shop) is a whole model written in that format: eight
tables of a coffee roastery's order book, one grouping box and two sticky notes.
It is the best answer to "what is the prose actually for", and the test suite
reads it on every run so that it cannot quietly go stale.
