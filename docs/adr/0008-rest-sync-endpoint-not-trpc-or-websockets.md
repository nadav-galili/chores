---
status: accepted
---
# Offline sync is a single REST `/sync` endpoint with an outbox and a change-log cursor; no tRPC, no websockets

Local-first writes go to SQLite and an outbox in one transaction; a `POST /sync` pushes ops (idempotent by op id) and pulls change-log rows since a cursor, scoped by the token to the household or the single child. Pulls happen on write, on foreground and after a push notification; the parent "today" screen polls while open. Conflict rules: chores, rewards and children are last-writer-wins per field; completions, ledger and XP are append-only and cannot conflict; the first server-ordered decision on a redemption wins. tRPC was rejected because the device-token path and batched offline ops fit plain REST better; websockets were rejected as unnecessary for a household-scale app.
