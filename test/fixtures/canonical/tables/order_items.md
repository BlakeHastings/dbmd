---
kind: table
table: order_items
columns:
  - name: order_id
    type: uuid
    pk: true
    nullable: false
    ref: orders.id
  - name: product_id
    type: uuid
    pk: true
    nullable: false
    ref: products.id
  - name: quantity
    type: integer
    nullable: false
    default: "1"
layout: { x: 820, y: 120 }
---

The line items on an order. The primary key is `(order_id, product_id)` rather
than a surrogate id, because the same product twice on one order is a quantity
and not a second line.
