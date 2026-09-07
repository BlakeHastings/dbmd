---
kind: table
table: order_items
columns:
  - name: order_id
    type: uuid
    pk: true
    ref: orders.id
    on delete: cascade
  - name: line_no
    type: integer
    pk: true
  - name: product_id
    type: uuid
    nullable: false
    ref: products.id
    on delete: restrict
  - name: product_name
    type: text
    nullable: false
  - name: unit_price_pence
    type: integer
    nullable: false
  - name: quantity
    type: integer
    nullable: false
    default: "1"
  - name: grind
    type: text
    nullable: false
    default: "'whole'"
indexes:
  - name: order_items_product_idx
    columns: [product_id]
layout: { x: 900, y: 40 }
---

The lines on an order. **The primary key is `(order_id, line_no)`**, and the
composite key is the point of this table rather than an accident of it.

A line's identity is its position on the order the customer was shown. The
packing slip prints "line 3 of 5", the PDF invoice numbers the same way, and the
depot reads line numbers down a phone when something is wrong with an order.
There was a surrogate `id` here once, with the line number derived from the sort
order at render time; a query somewhere lost its `order by` and a packing slip
came out with the lines in a different order from the invoice the customer was
holding. A natural key that the paperwork already agrees on is cheaper than
remembering to sort.

**`order_id` is the one `ref` in this model that says `on delete: cascade`**,
and it is not a change of heart about deleting orders. A line number is a line
number *of* something: `line_no` means nothing away from the order it counts
within, so a line that outlived its order would be a row nobody could read. As
nothing deletes an order, the clause never fires, and writing it down is
describing the constraint rather than asking for it.

`line_no` starts at 1 and is never reused within an order. Removing a line
before payment leaves a gap, which is fine and is better than renumbering rows
that somebody may already have printed.

**`product_name` and `unit_price_pence` are copies, on purpose.** See the note
next to this table. In short: `products` is edited, an invoice is a statement
about a moment, and anything a customer or an accountant reads comes from these
columns and not from a join.

`grind` is `whole`, `filter`, `espresso` or `cafetiere`, and it is on the line
rather than on the order because a household orders two bags ground two ways.
It is not on `products` because it is not a different product: it is what the
grinder is set to on the way into the bag.

`order_items_product_idx` answers "how much of this coffee did we sell", which
is asked on every roast-planning Monday. There is no index on `order_id` because
the primary key already leads with it.
