---
kind: model
name: broken-shop
engine: postgres
---

Every file in this directory parses. `readModel` reads it start to finish and
says nothing at all, and that is the point of it: everything wrong here is wrong
between the files rather than inside one of them, which is exactly the half
`src/model/validate.ts` owns.

One violation of each rule the validator implements, except `duplicate-table`,
which a directory cannot produce because a directory holds one `orders.md`. That
one is built in memory in `test/model/validate.test.ts` instead.
