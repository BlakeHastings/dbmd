---
kind: note
layout: { x: 900, y: 380, w: 380, h: 260 }
color: amber
---

`order_items.product_name`, `order_items.unit_price_pence` and
`orders.total_pence` are copies of things that exist elsewhere. A reviewer who
normalises them away will be right about the schema and wrong about the
business, and it has been proposed twice.

An invoice is a statement about a moment. We change prices about once a quarter
and rename a coffee whenever the importer changes the lot, so if the invoice
joined to `products`, a receipt from March would quietly start showing June's
price under June's name. The first anyone hears about that is a chargeback.

The rule: **read the copy for anything a customer or an accountant sees, and
join to `products` only for facts about the coffee as it is now**, such as the
photograph on the order-history page.
