---
kind: table
table: products
columns:
  - name: id
    type: uuid
    pk: true
  - name: sku
    type: text
    nullable: false
  - name: name
    type: text
    nullable: false
  - name: list_price
    type: numeric(12,2)
    nullable: false
indexes:
  - name: products_sku_key
    columns: [sku]
    unique: true
group: catalogue
layout: { x: 1160, y: 120 }
---

A local copy of the catalogue, refreshed nightly. The catalogue service owns
these rows; nothing here writes them.
