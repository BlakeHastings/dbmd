---
kind: table
table: refunds
columns:
  - name: id
    type: uuid
    pk: true
  - name: payment_id
    type: uuid
    null: false
    ref: payments.id
  - name: amount
    type: numeric(12,2)
    null: false
  - name: reason
    type: text
    null: true
group: billing
layout: { x: 1160, y: 800 }
---

A refund is against a payment rather than against an invoice, because a part
refund of one of three payments has to say which one.
