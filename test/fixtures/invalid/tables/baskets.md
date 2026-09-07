---
kind: table
table: baskets
columns:
  - name: id
    type: uuid
    pk: true
  - name: token
    type: text
    nullable: false
  - name: token
    type: text
    nullable: true
layout: { x: 480, y: 40 }
---

`token` twice: `duplicate-column`. YAML is perfectly happy with two mappings in
one list that happen to hold the same name, so the reader takes both and nothing
about this file is wrong until somebody asks what the table is.

There is no `reference` column, which is what `orders.basket_id` refs.
