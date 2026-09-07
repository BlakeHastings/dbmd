---
kind: table
table: api_keys
columns:
  - name: id
    type: uuid
    pk: true
  - name: account_id
    type: uuid
    nullable: false
    ref: acccounts.id
---

One row per API key.

`acccounts` is a typo for `accounts` and it is the point of this file. There is
no `tables/acccounts.md`, so the validator raises `ref-table-unknown` and names
the column the `ref:` was written on, which is the diagnostic `README.md` shows
in both its text form and its `--json` form.
