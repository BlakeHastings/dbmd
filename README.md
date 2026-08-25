# dbmd

Your database model, in your repository, as markdown.

```bash
npx dbmd studio
```

Opens a local web view of the model in `db-model/`. Drag tables, edit columns,
write down why a table exists. Every change writes straight back to the markdown
files, so the diff is a normal diff and the review is a normal pull request.

**Status: in development.** Nothing above works yet. What is decided is in
[`docs/architecture/decisions/`](docs/architecture/decisions/), and the shape of
the model file is [ADR 0003](docs/architecture/decisions/0003-markdown-on-disk-is-the-model.md).
