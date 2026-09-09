# Sync

Local-first. Every write is one SQLite transaction: domain rows + outbox op. The UI reads SQLite only. One endpoint, `POST /sync`, drains the outbox and pulls changes. No websockets, no tRPC.

## Flow
1. Write locally (e.g. completion + instance=done + ledger earn/bonus/streak + xp) and enqueue `{op_id, type, payload}`.
2. Drain outbox on write, on foreground, and after a push. `POST /sync {device_id, cursor, ops[]}` with retry + backoff; ops stay until acked.
3. Server applies each op idempotently (`applied_ops`), validates token scope and chore_date, writes the same deterministic rows.
4. Response: `acked[]`, `rejected[]` (with reason), `changes[]` since cursor, new cursor.
5. Device upserts changes into SQLite; deterministic ids make server rows identical to optimistic rows.

Parent "today" screen additionally polls every 60 s while open.

## Ops
- **kid token:** `complete`, `uncomplete` (own, same day, before parent action), `request_redemption`, `cancel_redemption`, `register_push_token`
- **parent token:** `upsert_chore`, `delete_chore`, `reject_completion`, `approve_photo`, `decide_redemption`, `upsert_reward`, `payout`, `adjust`, `upsert_child`, `revoke_device`
- Plain REST (needs server): create household, join code issue/redeem, parent invite, entitlement, R2 presign.

## Conflict rules
| case | rule |
|---|---|
| chores / rewards / children edited by two parents | last-writer-wins per field by writer `updated_at`; server bumps `version` |
| completions, ledger, xp | append-only, deterministic ids, cannot conflict |
| two parents reject the same completion | both succeed, one clawback (same id) |
| reject after kid `uncomplete` | no-op, returned `already_undone` |
| two parents decide a redemption | first in server order wins; other gets `already_decided`; device replaces optimistic state on pull |
| kid completes a chore a parent deleted | accepted and paid; history shows "removed" title |
| device clock wrong | chore_date ±1 day accepted, else server value + `date_adjusted` |
| revoked device | `/sync` → 401 `device_revoked`; app wipes local DB |

## Device scope
- **Kid device:** its child row, assigned chores, its instances (today ±14 days), its completions, ledger, xp, day_summaries, growth entries, active rewards, its redemptions. `change_log` is filtered by the token's `child_id` server-side; sibling isolation is structural.
- **Parent device:** whole household minus tokens/secrets. History depth gated by entitlement on pull.

## Photos
`requires_photo` chores: completion written as `pending_photo`, photo queued in the outbox, uploaded to R2 via presigned URL, then op sent with `photo_key`. R2 lifecycle rule deletes after 30 days.
