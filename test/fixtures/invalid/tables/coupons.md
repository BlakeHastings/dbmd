---
kind: table
table: coupons
columns:
  - name: id
    type: uuid
    pk: true
  - name: code
    type: text
    nullable: false
indexes:
  - name: coupons_code_key
    columns: [code]
    unique: true
layout: { x: 920, y: 340 }
---

The control. `code` is not the primary key here either, but a single-column
unique index covers it, so a ref at it identifies one row and the validator says
nothing.

Before dbmd-14 there was no way to write the `unique: true` line above, so this
file and `promotions.md` would have been indistinguishable to the validator and
the warning would have had to be dropped.
