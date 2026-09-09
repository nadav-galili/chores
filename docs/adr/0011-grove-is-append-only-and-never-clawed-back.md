---
status: accepted
---
# The grove records effort, not earnings, and a rejection never shrinks it

The novelty cliff is the whole product bet, and nothing in the loop accrues: coins are spent, the streak resets, the pet's mood is only about today. The grove is the one quantity that only ever grows — each Day Complete plants a tree, and a child eleven trees in has something week three cannot take back. Multiple children render naturally as one household grove of separate trees.

A rejection claws back coins and breaks the streak, but never removes a tree. Coins are an account and are correctable; the grove is a history and is not. A parent who can retroactively cut down what a child grew reintroduces exactly the coercion dynamic the child-first design exists to escape, and turns the grove into the coin balance with leaves on it.

That decision rules out deriving grove stage from current state: recomputing "was this chore date day complete?" makes a later rejection shrink the grove. Deriving while ignoring rejections does not save it either, because the denominator is mutable — whether a day was complete depends on which instances were due, and a parent deleting a chore changes that retroactively.

So growth is recorded, not computed. Each Day Complete appends one `growth_entries` row with id `uuid5('grow', child_id, chore_date)` per ADR-0010, and grove stage is `COUNT(*)`. The deterministic id makes the write idempotent under outbox replay, where an incremented `grove_stage` column would double-count. Rows are never updated or deleted, and unlike the ledger the table has **no clawback counterpart** — that absence is this decision expressed in the schema.

Coins, XP and grove growth are now three separate quantities from one event. ADR-0004 explains why coins and XP are split; this splits off the third because it is the only one with no reversal.
