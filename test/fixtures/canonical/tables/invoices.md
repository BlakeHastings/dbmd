---
kind: table
table: invoices
columns:
  - name: id
    type: uuid
    pk: true
  - name: order_id
    type: uuid
    nullable: false
    ref: orders.id
  - name: total
    type: numeric(12,2)
    nullable: false
  - name: status
    type: text
    nullable: false
    default: "'draft'"
indexes:
  - name: invoices_order_status_idx
    columns: [order_id, status]
group: billing
layout: { x: 820, y: 460 }
---

One invoice per order, raised when the order ships. A cancelled order never
gets one, which is why `order_id` is unique but not a primary key.
