---
kind: table
table: deliveries
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
indexes:
  - name: deliveries_order_idx
    columns: [order_id]
  - name: deliveries_order_idx
    columns: [id]
layout: { x: 480, y: 340 }
---

Two indexes under one name: `duplicate-index`. The engine would refuse the
second one and the model carries both, so the diff that introduced this looks
fine and the migration does not.

`orders.id` is the sole primary key of `orders`, so the ref on `order_id` is the
ref that is right.
