---
kind: table
table: customers
columns:
  - name: id
    type: uuid
    pk: true
  - name: email
    type: citext
    nullable: false
  - name: created_at
    type: timestamptz
    nullable: false
    default: now()
  - name: "null"
    type: boolean
    nullable: false
    default: "false"
indexes:
  - name: customers_email_key
    columns: [email]
    unique: true
  - name: customers_email_domain_idx
    columns: [{ expression: "split_part(email, '@', 2)" }]
layout: { x: 120, y: 120 }
---

Imported from the old billing system in 2019, which is where the column named
`null` came from. The reporting views spell it out, so nobody has dared rename
it.

The domain index is an expression rather than a column, and its expression needs
quoting because of the comma and the apostrophes in it.
