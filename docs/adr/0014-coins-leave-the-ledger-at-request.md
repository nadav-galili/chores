---
status: accepted
---
# Coins leave the ledger when a child asks, not when a parent approves

A Redemption sits open between the child's request and the parent's decision, and those coins have to be somewhere. The obvious answer — leave them in the balance and hold them aside — puts two numbers on screen where there was one. `CODING_STANDARDS.md` says balance is always `SUM(coins)`; `docs/spec/02-data-model.md` said balance is `SUM(coins)` minus reserved open redemptions. Both cannot be true, and the second is the one that spreads: every display, every gate and every test has to pick which balance it means, and "Reservation" becomes a concept the glossary has to carry and the sync protocol has to move.

So the `redeem` entry is written at request time, `uuid5('redeem', redemption_id)`, `−cost`. Approval writes nothing further — it is permission, not an accounting event. A decline or a cancel refunds with a clawback of that entry.

Balance stays exactly `SUM(coins)`, and a child cannot ask for two four-hundred-coin rewards on four hundred coins, because after the first the coins are genuinely gone. Overspending becomes structurally impossible rather than something a check has to catch on every path that could reach it. "Reservation" earns no glossary entry, because it is not a thing: it is a `redeem` entry whose Redemption is still `requested`.

The concurrency falls out of the deterministic ids (ADR-0010) rather than being designed. Decline and cancel both refund through `uuid5('clawback', redeem_entry_id)`, so a parent approving at the same moment a child cancels can only ever produce one refund entry however the two writes interleave; the status column records which story it was, and the ledger cannot double-refund. `reconcileLedger` is untouched — its grant kinds are `earn`, `bonus` and `streak`, and it never reverses a `redeem`.

What this costs: a declined request reads as a spend followed by a refund, where a reserved balance would have shown nothing happening at all. That is the honest record — the child did spend, and the parent did say no — but it is surprising enough to be the reason this file exists.

One thing this forces. The Kid Device writes the request optimistically, the way it writes every other kid action, and the server can legitimately refuse it: a parent's Rejection may have clawed back coins the device has not pulled yet, so `insufficient_coins` is reachable in ordinary use. A refused op must undo its optimistic rows locally, not merely leave the outbox — a `redeem` entry left behind on the device is a balance that lies until the next full pull. That is the first kid op for which dropping a refusal on the floor is not harmless.
