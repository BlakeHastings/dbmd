---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: citext
    null: false
  - name: created_at
    type: timestamptz
    null: false
    default: now()
  - name: "null"
    type: boolean
    null: false
    default: "false"
indexes:
  - name: customers_email_key
    columns: [email]
layout: { x: 120, y: 120 }
---

Imported from the old billing system in 2019, which is where the column named
`null` came from. The reporting views spell it out, so nobody has dared rename
it.
