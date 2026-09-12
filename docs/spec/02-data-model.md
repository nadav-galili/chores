# Data model

Postgres is the source of truth. Devices hold a scoped subset in expo-sqlite with the same Drizzle schema shapes. Ids are client-generated UUIDv7 unless marked **deterministic** (UUIDv5 of the listed inputs). Balances are never stored.

## Household and people
- **households**: id · name · tz (IANA) · day_boundary_hour (0–6, default 0) · digest_hour (default 20) · currency (ILS|USD) · coins_per_unit · entitlement (free|premium) · entitlement_source · pin_hash · pin_salt · created_at. The Parent PIN is one per household and lives here, not on a parent: it is a door out of kid mode, not a credential identifying who opened it (ADR-0013).
- **parents**: id · household_id · clerk_user_id (unique) · email (lower-cased, from the Clerk token, nullable) · display_name · created_at
- **parent_invites**: email (PK, lower-cased) · household_id · invited_by · created_at · accepted_at · accepted_parent_id. A partner is invited by address alone: there is no link and no mail. Their first Clerk sign-in with that email creates their parent row in the household and marks the invite accepted. A pending invite holds a seat, so it counts against the free tier's two parents.
- **parent_devices**: id · parent_id · expo_push_token · locale · platform · last_seen_at. The locale is registered with the token, the way a kid device's is, so a digest arrives in the language that device reads.
- **children**: id · household_id · first_name · ui_mode (little|big) · pet_name · reminder_time (local HH:MM, nullable) · read_only_after (nullable) · sort · created_at
- **child_devices**: id · child_id · household_id · token_hash · analytics_anon_id · expo_push_token · platform · last_seen_at · revoked_at
- **join_codes**: code (6 chars, unique while live) · household_id · child_id · created_by · expires_at · redeemed_at · redeemed_device_id

## Chores
- **chores**: id · household_id · title · icon · kind (once|daily|weekdays) · weekday_mask · start_date · end_date · due_date · requires_photo · version · updated_at · updated_by · deleted_at · field_clocks (jsonb: field → writer `updated_at` of its last landed write; what makes last-writer-wins *per field* possible when ops arrive out of order)
- **chore_assignees**: chore_id · child_id (PK)
- **chore_instances**: **id = uuid5(chore_id, child_id, chore_date)** · chore_id · child_id · household_id · chore_date (DATE) · status (due|done|pending_photo|redo) · unique(chore_id, child_id, chore_date). Materialized by the device on day open and by server cron at the household boundary, `ON CONFLICT DO NOTHING`.
- **completions**: id · instance_id · chore_id · child_id · household_id · chore_date · completed_at (UTC) · device_id · photo_key · status (accepted|pending_photo|rejected|undone) · rejected_by · rejected_at · created_at. Append-only: the row is written once and afterwards only its status moves. `undone` is the child's own same-day undo — the row stays and stops counting, so a later parent rejection can see it was already undone. Re-completing after an undo writes a **new** completion. Completion of a deleted chore is accepted and paid.

## Coins, XP, money
- **ledger_entries**: **id deterministic per kind** · household_id · child_id · kind · coins (signed) · money_amount (minor units, nullable) · ref_type · ref_id · created_at · created_by

| kind | id | coins |
|---|---|---|
| earn | uuid5('earn', completion_id) | +10 |
| bonus | uuid5('bonus', child_id, chore_date) | +20 |
| streak | uuid5('streak', child_id, chore_date, n) | +30/+70/+150 |
| clawback | uuid5('clawback', target_entry_id) | −target |
| redeem | uuid5('redeem', redemption_id) | −cost, written when the redemption is **requested** (ADR-0014) |
| payout | client uuid | −coins, +money_amount |
| adjust | client uuid | ± with note |

Balance = `SUM(coins)`, with nothing subtracted from it and nothing held aside: a requested redemption has already spent its coins, so there is nothing left to reserve. `ref_type` is one of `completion | chore_date | ledger_entry | redemption`. Owed money = `SUM(money_amount)`.

- **xp_events**: id = uuid5('xp', ledger_entry_id) · child_id · xp (signed) · ref_entry_id · created_at. Mirrors earn/bonus/streak/clawback 1:1. Pet level = threshold table over `SUM(xp)`.
- **day_summaries**: child_id · chore_date (PK) · due_count · done_count · complete · streak_after. Recomputed on every completion/rejection. Streak = walk back while `complete` or `due_count = 0`.
- **growth_entries**: **id = uuid5('grow', child_id, chore_date)** · household_id · child_id · chore_date · created_at. Appended once when a day summary first becomes `complete`. Grove stage = `COUNT(*)` per child; never a stored column. Unlike `xp_events`, this table has **no** clawback counterpart — a rejection claws back coins and XP and breaks the streak, but never deletes or reverses a growth entry. Append-only, `ON CONFLICT DO NOTHING`. A redo completed inside the Redo Window can make a **past** chore date day complete for the first time, so a growth entry may be appended for a date that is not today — every other path appends for today, and that is not an invariant. (ADR-0011)

## Rewards
- **rewards**: id · household_id · builtin_key (nullable) · title · icon · cost_coins · is_builtin · active · sort · updated_at · deleted_at. Every reward belongs to a household, built-ins included: the catalog is **copied into a household when it is created**, so a global row with no household never has to reach a `change_log` that is scoped by one. A built-in carries a `builtin_key` (`snack`, `screen_time`, ...) and the device renders its title from i18n, so nothing is seeded in a language and a Hebrew parent and an English kid device each read their own. Hiding a built-in is `active = false` on the household's own row. A catalog entry added in a later app version reaches existing households only by backfill migration.
- **redemptions**: id · reward_id · child_id · household_id · cost_coins (snapshot) · status (requested|approved|declined|cancelled) · requested_at · decided_at · decided_by

## Sync and ops plumbing
- **change_log**: seq (bigserial) · household_id · child_id (nullable) · table · row_id · op · row (jsonb) · at. Written by trigger on every table above.
- **applied_ops**: op_id (PK) · device_id · result · at
- **notifications**: **id = uuid5('notif', kind, subject_id, key)** · target (parent_device|child_device) · target_id (the device pushed to, nullable) · kind · payload · scheduled_for · sent_at · ticket. The id is what makes the minute cron send exactly once — it inserts `ON CONFLICT DO NOTHING` and only a claimed row is pushed — with the subject being who the notification is about (a child, a parent) and the key what makes it one of a series (a chore date for the daily kinds). A row with `sent_at` null was never pushed: no token, so the device's own local notification is the delivery. `payload.receipt` holds what Expo answered for the ticket; a `DeviceNotRegistered` receipt nulls `child_devices.expo_push_token`.
- **revenuecat_events**: raw webhook log, idempotent by event id

## Timezone rules
- `chore_date(now, tz, day_boundary_hour)` = calendar date in `tz` of `now − day_boundary_hour hours`.
- Computed on device at tap time and sent with the completion. Server recomputes from `completed_at`; accepts if equal or ±1 day, else uses its own and flags `date_adjusted`. **The ±1 rule applies only when the instance would have to be created**: it exists so a device with a wrong clock cannot invent a day, and an instance the server already materialized was not invented by a device. A completion naming an existing instance is written on that instance's chore date however far back it is, which is what makes the Redo Window work.
- Recurrence evaluated on local dates only. Weekday of `chore_date` decides weekday chores. No arithmetic on instants → DST cannot shift a day.
- Changing household `tz` never rewrites materialized instances.

## Tests required before any UI (`packages/shared`)
- chore_date across midnight and DST (Asia/Jerusalem, America/New_York), boundary 0 and 3
- weekday mask materialization with start/end dates and once chores
- day complete / freeze / break, streak walk-back, each streak bonus fires exactly once
- ledger: earn → reject → clawback nets 0; reject that breaks day-complete claws back bonus and streak; re-applying any op is a no-op
- entitlement gate matrix: free × premium × each gated action; 14-day read-only child
- redemption: request writes `redeem` at request; decline and cancel produce the same clawback id; approve writes nothing; a request that would take the balance below zero is refused
- redo inside the Redo Window restores the day bonus and the streak; outside it, nothing; re-running reconciliation on the same facts is a no-op
- `verifyPin` accepts the right code and refuses every other, with the salt taken from the household
