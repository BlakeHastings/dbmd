---
kind: table
table: stock_movements
columns:
  - name: id
    type: bigint
    pk: true
  - name: product_id
    type: uuid
    nullable: false
    ref: products.id
  - name: shipment_id
    type: uuid
    nullable: true
    ref: shipments.id
  - name: delta_grams
    type: integer
    nullable: false
  - name: reason
    type: text
    nullable: false
  - name: handheld_key
    type: text
    nullable: true
  - name: occurred_at
    type: timestamptz
    nullable: false
    default: now()
indexes:
  - name: stock_movements_product_idx
    columns: [product_id, occurred_at]
  - name: stock_movements_handheld_key
    columns: [handheld_key]
    unique: true
group: warehouse
layout: { x: 1340, y: 640 }
---

An append-only ledger of everything that has changed how much coffee is in the
building. **Nothing in this table is ever updated or deleted**, and current
stock is a sum over it rather than a column anywhere. The note beside this table
says what happened the last time it was a column.

`delta_grams` is signed, and the sign is the only thing that says which way the
coffee went. `reason` is one of:

- `roast` : positive, entered when a batch comes off the roaster and is weighed.
  This is the only row a human types a number into, and the number is the weight
  after roasting, which is about 15% less than what went in.
- `sale` : negative, written when a parcel is handed to the courier, with
  `shipment_id` set. Not when the order is placed and not when it is packed: a
  packed parcel sitting in the depot is still coffee we have.
- `waste` : negative. Spilled, stale, or given to the café next door.
- `count` : either sign, and it is a stocktake correcting the ledger to what is
  actually on the shelf. A count is written as the difference rather than as an
  absolute, so that the running sum stays a running sum and the correction is
  visible as its own row. A large `count` is a signal that something upstream is
  wrong, and it is worth chasing rather than absorbing.

**Grams, not bags.** A 1kg bag and four 250g bags come off the same roast and
the warehouse splits them at packing time, so counting in bags means the same
coffee has a different amount of stock depending on which bag someone reaches
for. `products` has a `bag_grams` and the arithmetic happens at the edges.

`handheld_key` is nullable here and not on `shipments`, because a `roast` or a
`count` row is typed on a laptop in the roastery and does not come from the
scanner. Postgres lets a unique index hold as many nulls as it likes, so
`stock_movements_handheld_key` collapses the retries described in the group note
to one row while having nothing to say about the rows that never had a key.

`id` is a `bigint` rather than a uuid because this is the one table that grows
without limit and is read in `occurred_at` order. A few million rows a year is
nothing, but it is enough that a random-ordered key would stop being free.
