---
kind: table
table: addresses
columns:
  - name: id
    type: uuid
    pk: true
  - name: customer_id
    type: uuid
    null: false
    ref: customers.id
  - name: recipient
    type: text
    null: false
  - name: line1
    type: text
    null: false
  - name: line2
    type: text
    null: true
  - name: town
    type: text
    null: false
  - name: postcode
    type: text
    null: false
  - name: country_code
    type: text
    null: false
    default: "'GB'"
  - name: superseded_by
    type: uuid
    null: true
    ref: addresses.id
  - name: created_at
    type: timestamptz
    null: false
    default: now()
layout: { x: 40, y: 40 }
---

**An address row is never updated.** Correcting a typo inserts a new row and
stamps `superseded_by` on the old one, so an address is a chain and the head of
the chain is the current one. `orders.shipping_address_id` points at whichever
link was current the day the order was placed, and it keeps pointing there
forever.

This looks like ceremony until you know why it exists. It used to be one mutable
row per address. A customer corrected a postcode that had been wrong for months,
and three months of shipping-cost reconciliation moved overnight, because the
courier invoices match on postcode and we were suddenly matching them against an
address that had never been used. Nobody noticed for a fortnight, and working out
what had happened took longer than writing this table did.

The columns are deliberately not a normalised address. `line1`, `line2`, `town`
and `postcode` are what the courier's label API takes, in the shape it takes
them, and the only validation we do is the country's postcode format. Splitting
out streets, or a `counties` table, buys nothing: we do not query by them, and
every scheme for decomposing an address is wrong in some country we will
eventually ship to.

`country_code` is ISO 3166-1 alpha-2, upper case. There is no lookup table
because the courier is the authority on where it will deliver and it will reject
a country we should not have offered.
