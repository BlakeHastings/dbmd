---
kind: table
table: orders
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    null: false
    ref: customers.id
  - name: status
    type: text
    null: false
    default: "'pending'"
  - name: placed_at
    type: timestamptz
    null: false
    default: now()
indexes:
  - name: orders_customer_status_idx
    columns: [customer_id, status]
  - name: orders_placed_at_idx
    columns: [placed_at]
layout: { x: 480, y: 120 }
---

One row per customer order. Rows are never deleted: a cancelled order keeps its
row with `status = 'cancelled'` so the finance export stays reproducible.
