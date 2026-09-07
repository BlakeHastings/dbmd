---
kind: table
table: products
columns:
  - name: id
    type: uuid
    pk: true
  - name: sku
    type: text
    nullable: false
  - name: name
    type: text
    nullable: false
  - name: cms_slug
    type: text
    nullable: false
  - name: origin
    type: text
    nullable: false
  - name: roast_level
    type: text
    nullable: false
  - name: bag_grams
    type: integer
    nullable: false
  - name: price_pence
    type: integer
    nullable: false
  - name: retired_at
    type: timestamptz
    nullable: true
indexes:
  - name: products_sku_key
    columns: [sku]
    unique: true
  - name: products_live_idx
    columns: [retired_at, origin]
layout: { x: 1340, y: 40 }
---

**A product is a coffee at a bag size**, so the same bean at 250g and at 1kg is
two rows with two SKUs. This surprises people who expect a `products` and
`product_variants` pair, and the reason is that nothing about the two rows is
actually shared at the point it matters: price is not linear in weight, the 1kg
bag ships in its own parcel, and the warehouse picks by SKU off a printed sheet.
A variants table would exist to hold the tasting notes, and the tasting notes
are not here at all.

`cms_slug` is how you get the words and the photograph. The catalogue copy lives
in the CMS because the roaster edits it several times a week and should not need
a migration to do so. Everything in this table is what the warehouse or the
accountant needs, and the split is a good rule of thumb for what belongs here:
if getting it wrong sends the wrong bag or the wrong invoice, it is a column; if
getting it wrong is embarrassing, it is CMS copy.

**`price_pence` is an integer, in pence.** Not a float, not `numeric`. There was
a float here for about a month and it produced order totals that were a penny
off in one direction and a penny off in the other, and the day spent finding out
why is the reason this line is so emphatic. Anything that reaches a customer as
money is an integer of the smallest unit, everywhere in this model.

A product is retired, never deleted: `retired_at` hides it from the shop and
leaves it joinable from `order_items` and `stock_movements`. We retire a coffee
every few weeks, when the lot runs out, and a deleted row would break every
historical order that contained it.
