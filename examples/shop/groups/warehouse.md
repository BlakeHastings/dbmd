---
kind: group
label: Written by the depot handheld
color: violet
---

The two tables in this box are the only ones written by the scanner app in the
depot, and the depot's wifi is bad. The app cannot tell a timeout from a
failure, so it retries, and the same pack or the same count arrives two or three
times, sometimes minutes apart, sometimes after the operator has given up and
walked to the other end of the building.

**So every write in here is idempotent, and a new column that is not will be
wrong within a week.** Both tables carry a key the handheld generates before it
sends anything, with a unique index on it, and the second insert loses. If you
add a table to this box, or a new kind of write to one of these, that key comes
with it. This is not a nice-to-have: a duplicated `sale` row takes 250g of
coffee out of stock that never left the building, and it shows up as a stocktake
correction six weeks later with no way to work out where it came from.

Treat this box as a warning rather than a label. It is not a bounded context and
it is not a module. It is the part of the model where the network is a
participant.
