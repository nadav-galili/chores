---
status: accepted
---
# Deterministic ids use one fixed UUIDv5 namespace and a unit-separator join

ADR-0002 and ADR-0003 say ids are "UUIDv5 of their cause" but not how the cause is encoded. Both halves are frozen here because every instance, ledger and XP id on every device and the server depends on them; changing either later is a data migration.

- Namespace: `NAMESPACE_CHORES = 1f3e4d5c-7a8b-4c9d-8e0f-2a1b3c4d5e6f`, a constant in `@chores/shared`.
- Name: the cause's parts in the order the data model lists them (e.g. `chore_id, child_id, chore_date`; `'earn', completion_id`), joined with the ASCII unit separator (U+001F), so `('ab','c')` and `('a','bc')` never collide.
- SHA-1 is implemented in the shared package rather than taken from `node:crypto` or `uuid`, so Hermes and Node produce identical bytes with no dependency and no async.

`uuid5(...parts)` in `packages/shared/src/uuid5.ts` is the only way ids are derived.
