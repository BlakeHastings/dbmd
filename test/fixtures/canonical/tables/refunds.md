---
kind: table
table: refunds
columns:
  - name: id
    type: uuid
    pk: true
  - name: payment_id
    type: uuid
    nullable: false
    ref: payments.id
  - name: amount
    type: numeric(12,2)
    nullable: false
  - name: reason
    type: text
    nullable: true
group: billing
layout: { x: 1160, y: 800 }
---

A refund is against a payment rather than against an invoice, because a part
refund of one of three payments has to say which one.
