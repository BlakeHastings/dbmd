---
kind: model
name: db-model
engine: postgres
---

The model `README.md` and `docs/ci.md` are looking at when they show a run that
failed. It is copied to `db-model/` in a sandbox, because both pages show a
command given no directory at all and `db-model` is the default one
(`src/cli/check.ts`), so the report's `directory` is only that word if the
directory really is called that.

It holds one mistake, on purpose: `tables/api_keys.md` points at a table nobody
wrote. That is one error and no warnings, which is the count both pages print.
Adding a second table, a note or a group to this directory changes those counts
and turns `test/docs/payloads.test.ts` red, which is the intent: the pages are
quoting this model.
