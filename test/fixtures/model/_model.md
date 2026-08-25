---
kind: model
name: shop
engine: postgres
---

The order side of the shop. Customers, orders and the lines on them; the
catalogue lives in a different repository and is reached over HTTP, which is why
there is no `products` table here and why `order_items` keeps a product id
without a `ref`.
