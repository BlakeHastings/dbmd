---
kind: table
table: invoice_lines
columns:
  - name: invoice_id
    type: uuid
    pk: true
    null: false
    ref: invoices.id
  - name: line_no
    type: integer
    pk: true
    null: false
  - name: description
    type: text
    null: false
  - name: amount
    type: numeric(12,2)
    null: false
group: billing
layout: { x: 1160, y: 460 }
---

The lines on an invoice, frozen at the moment the invoice was raised. They do
not follow later changes to the order.
