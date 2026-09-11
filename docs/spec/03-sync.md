# Sync

Local-first. Every write is one SQLite transaction: domain rows + outbox op. The UI reads SQLite only. One endpoint, `POST /sync`, drains the outbox and pulls changes. No websockets, no tRPC.

## Flow
1. Write locally (e.g. completion + instance=done + ledger earn/bonus/streak + xp) and enqueue `{op_id, type, payload}`.
2. Drain outbox on write, on foreground, and after a push. `POST /sync {device_id, cursor, ops[]}` with retry + backoff; ops stay until acked.
3. Server applies each op idempotently (`applied_ops`), validates token scope and chore_date, writes the same deterministic rows.
4. Response: `acked[]` (each with `date_adjusted` when the server wrote a different chore_date), `rejected[]` (with reason), `changes[]` since cursor, new cursor. A rejected op leaves the outbox and is surfaced, never retried; anything else (network, 5xx) stays queued and is retried with backoff.
5. Device upserts changes into SQLite; deterministic ids make server rows identical to optimistic rows.

Parent "today" screen additionally polls every 60 s while open, and re-reads on foreground. It reads `GET /households/:id/today`, which materializes the household's instances for the chore date first, so a day is visible before any kid device has opened it. A gate refused on the free tier answers `402 {error: 'gated', gate}`.

## Ops

**Only a kid device has an outbox.** The parent app holds no local database and queues nothing: it reads and writes over plain REST and polls. So "op" means a kid-device op, and every parent action is an endpoint — `reject_completion` was the first one built that way and the rest follow it.

- **kid token (ops):** `complete`, `uncomplete` (own, same day, before parent action), `request_redemption`, `cancel_redemption`, `register_push_token`
- **parent token (REST):** upsert/delete chore, reject completion, approve photo, decide redemption, upsert reward, payout, adjust, upsert child, revoke device, set PIN, register push token
- **Plain REST, no token or a fresh one:** create household, join code issue/redeem, parent invite, parent today (`GET /households/:id/today`), entitlement, R2 presign.

A kid op the server refuses is answered with a reason and leaves the outbox. `insufficient_coins` refuses a `request_redemption` the balance no longer covers — reachable in ordinary use, because a parent's rejection can claw back coins the device has not pulled yet. **A refused op's optimistic rows must be undone locally**, not merely dropped from the outbox: a `request_redemption` that leaves its `redemptions` row and its `redeem` entry behind leaves the child's balance wrong until the next full pull.

## Conflict rules
| case | rule |
|---|---|
| chores / rewards / children edited by two parents | last-writer-wins per field by writer `updated_at`; server bumps `version` |
| completions, ledger, xp | append-only, deterministic ids, cannot conflict |
| two parents reject the same completion | both succeed, one clawback (same id) |
| reject after kid `uncomplete` | no-op, returned `already_undone` |
| two parents decide a redemption | first in server order wins; other gets `already_decided`; device replaces optimistic state on pull |
| kid completes a chore a parent deleted | accepted and paid; history shows "removed" title |
| kid completes a chore they are no longer assigned | accepted only if the instance already exists, else `unknown_chore` |
| kid completes a redo inside the Redo Window | accepted on the instance's own chore date, not today; the day bonus and streak for that date are restored |
| kid completes a redo after the Redo Window | rejected `too_late` |
| kid undoes a completion after its chore date | rejected `too_late`; only a parent can change a past day — including a redo they completed today for an earlier date |
| child cancels while a parent decides | first write to land wins; the loser is answered `already_decided` or `already_cancelled`, and both paths refund through the same clawback id, so a race cannot double-refund |
| request that the balance no longer covers | rejected `insufficient_coins`; the device undoes its optimistic rows |
| device clock wrong | chore_date ±1 day accepted, else server value + `date_adjusted` |
| revoked device | `/sync` → 401 `device_revoked`; app wipes local DB |

## Device scope
- **Kid device:** its child row, assigned chores, its instances (today ±14 days), its completions, ledger, xp, day_summaries, growth entries, the household's reward catalog, its redemptions. `change_log` is filtered by the token's `child_id` server-side; sibling isolation is structural. The household's Parent PIN hash and salt come with it: the check has to work with no network, so it is made on the device against a value it holds (ADR-0013). **Three exceptions, `children`, `growth_entries` and `rewards`, come household-wide**: the grove is one household's trees, not one child's (ADR-0011), so a kid device needs each sibling's name and the chore dates they were Day Complete to draw one tree per child. `rewards` is a per-household catalog carrying no `child_id`, and inactive rows ship too, so a built-in a parent hides disappears from the shop on the device instead of lingering. The change log carries whole rows, so a sibling's `children` row crosses entire (name, pet name, ui mode, sort, reminder time) — household-internal, and no secret: device tokens live on `child_devices`, which is not logged. Nothing else about a sibling crosses — no chores, coins, completions, xp, day summaries or instances.
- **Parent device:** whole household minus tokens/secrets. History depth gated by entitlement on pull.

## Photos
`requires_photo` chores: completion written as `pending_photo`, photo queued in the outbox, uploaded to R2 via presigned URL, then op sent with `photo_key`. R2 lifecycle rule deletes after 30 days.
