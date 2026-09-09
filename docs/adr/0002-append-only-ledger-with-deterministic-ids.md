---
status: accepted
---
# Coins live in an append-only ledger whose entry ids are derived from their cause

Balance must be trustworthy across offline devices, retried syncs and two parents acting at once. Every ledger entry id is a UUIDv5 of its cause (earn from completion id, bonus from child + chore date, clawback from the entry it reverses), and balance is always a sum, never a stored column. Both device and server run the same shared code, so they produce identical rows and reconciliation is an idempotent upsert. Nothing in the ledger is ever updated or deleted; corrections are clawback entries. The same discipline applies to XP events. Money (payouts) is recorded on the same ledger so a future real-money rail consumes it without a migration.
