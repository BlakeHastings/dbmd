---
kind: table
table: products
columns:
  - name: id
    type: uuid
    pk: true
  - name: sku
    type: text
    null: false
  - name: name
    type: text
    null: false
  - name: list_price
    type: numeric(12,2)
    null: false
indexes:
  - name: products_sku_key
    columns: [sku]
group: catalogue
layout: { x: 1160, y: 120 }
---

A local copy of the catalogue, refreshed nightly. The catalogue service owns
these rows; nothing here writes them.
