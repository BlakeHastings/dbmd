---
kind: table
table: payments
columns:
  - name: id
    type: uuid
    pk: true
  - name: invoice_id
    type: uuid
    nullable: false
    ref: invoices.id
  - name: amount
    type: numeric(12,2)
    nullable: false
  - name: taken_at
    type: timestamptz
    nullable: false
group: billing
layout: { x: 820, y: 800 }
---

Money actually taken, one row per attempt that succeeded. The provider is the
source of truth and this table is a copy, so a mismatch is a bug here.
