---
kind: table
table: shipments
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
group: shipping
layout: { x: 480, y: 460 }
---

Declares itself a member of `shipping`, and there is no `groups/shipping.md`.
The group is not invented; the table loads and says so.
