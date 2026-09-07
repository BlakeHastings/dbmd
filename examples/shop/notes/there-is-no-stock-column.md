---
kind: note
layout: { x: 1340, y: 320, w: 380, h: 240 }
color: amber
---

There is no `products.stock_on_hand`, and the empty space where you expect one
is the most useful thing on this diagram.

There was one. The roaster added to it, the packing app subtracted from it, and
over one Christmas it drifted eleven kilos away from what was on the shelf. The
column could not say when it went wrong, or which of the two writers was at
fault, because it only ever held the answer and never the working.

Stock is now `sum(delta_grams)` from `stock_movements`. It is slower and it can
be audited to the day. Somebody proposes caching it back onto `products` about
once a year, and the answer is the same each time: cache it in the read model,
where being an hour stale is allowed, not here, where being wrong is silent.
