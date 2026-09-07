---
kind: table
table: addresses
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    nullable: false
    ref: customers.id
  - name: line1
    type: text
    nullable: false
  - name: postcode
    type: varchar(16)
    nullable: false
  - name: country
    type: char(2)
    nullable: false
    default: "'GB'"
indexes:
  - name: addresses_customer_idx
    columns: [customer_id]
layout: { x: 120, y: 460 }
---

Postal addresses, one row per address a customer has ever used. Rows are
never edited in place: an order shipped to an address must still show that
address a year later.
