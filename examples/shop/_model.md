---
kind: model
name: kettleback-shop
engine: postgres
---

The order book for Kettleback, a coffee roastery that sells whole beans direct
and by subscription. Eight tables, and every one of them is here because
something went wrong once.

Two facts about the business explain most of the shape below, and neither is
visible in a schema dump.

**We roast to order, twice a week.** Nothing is in stock in the way a normal
shop means it. An order placed on Wednesday morning waits until Thursday's roast
and ships Friday, and an order placed on Thursday afternoon waits until Monday.
That gap is why `orders.status` has a value that is not a warehouse state, why
`subscriptions` has no `product_id`, and why "late" is not something you can
compute from `placed_at` alone.

**Money and stock are append-only.** Rows in `orders`, `order_items`,
`shipments` and `stock_movements` are inserted and then, apart from a small
number of status columns, left alone. There is no database constraint enforcing
that. It is a review rule, which means the only thing standing between us and a
quarter that will not reconcile is somebody reading a pull request.

What is deliberately not here:

- **Payments.** The payment service provider holds the card, the authorisation
  and the refund. We keep `orders.psp_reference` and nothing else, because a
  copy of a payment record is a copy that can be wrong about money.
- **The catalogue's words and pictures.** Tasting notes, photographs and the
  roaster's blog live in the CMS and are fetched by slug. `products` here is the
  part the warehouse and the accountant need, which is a SKU, a weight and a
  price.
- **Anything computed.** No stock level, no lifetime value, no order count on
  the customer. Those live in the read model, which is rebuilt nightly and is
  allowed to be wrong for a few hours in a way this is not.
