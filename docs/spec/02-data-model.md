# Data model

Postgres is the source of truth. Devices hold a scoped subset in expo-sqlite with the same Drizzle schema shapes. Ids are client-generated UUIDv7 unless marked **deterministic** (UUIDv5 of the listed inputs). Balances are never stored.

## Household and people
- **households**: id · name · tz (IANA) · day_boundary_hour (0–6, default 0) · digest_hour (default 20) · currency (ILS|USD) · coins_per_unit · entitlement (free|premium) · entitlement_source · created_at
- **parents**: id · household_id · clerk_user_id (unique) · display_name · pin_hash · created_at
- **parent_devices**: id · parent_id · expo_push_token · platform · last_seen_at
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
| redeem | uuid5('redeem', redemption_id) | −cost |
| payout | client uuid | −coins, +money_amount |
| adjust | client uuid | ± with note |

Balance = `SUM(coins)` minus reserved open redemptions. Owed money = `SUM(money_amount)`.

- **xp_events**: id = uuid5('xp', ledger_entry_id) · child_id · xp (signed) · ref_entry_id · created_at. Mirrors earn/bonus/streak/clawback 1:1. Pet level = threshold table over `SUM(xp)`.
- **day_summaries**: child_id · chore_date (PK) · due_count · done_count · complete · streak_after. Recomputed on every completion/rejection. Streak = walk back while `complete` or `due_count = 0`.
- **growth_entries**: **id = uuid5('grow', child_id, chore_date)** · household_id · child_id · chore_date · created_at. Appended once when a day summary first becomes `complete`. Grove stage = `COUNT(*)` per child; never a stored column. Unlike `xp_events`, this table has **no** clawback counterpart — a rejection claws back coins and XP and breaks the streak, but never deletes or reverses a growth entry. Append-only, `ON CONFLICT DO NOTHING`. (ADR-0011)

## Rewards
- **rewards**: id · household_id (null = built-in) · title · icon · cost_coins · is_builtin · active · sort · updated_at · deleted_at
- **redemptions**: id · reward_id · child_id · household_id · cost_coins (snapshot) · status (requested|approved|declined|cancelled) · requested_at · decided_at · decided_by

## Sync and ops plumbing
- **change_log**: seq (bigserial) · household_id · child_id (nullable) · table · row_id · op · row (jsonb) · at. Written by trigger on every table above.
- **applied_ops**: op_id (PK) · device_id · result · at
- **notifications**: id · target (parent_device|child_device) · kind · payload · scheduled_for · sent_at · ticket
- **revenuecat_events**: raw webhook log, idempotent by event id

## Timezone rules
- `chore_date(now, tz, day_boundary_hour)` = calendar date in `tz` of `now − day_boundary_hour hours`.
- Computed on device at tap time and sent with the completion. Server recomputes from `completed_at`; accepts if equal or ±1 day, else uses its own and flags `date_adjusted`.
- Recurrence evaluated on local dates only. Weekday of `chore_date` decides weekday chores. No arithmetic on instants → DST cannot shift a day.
- Changing household `tz` never rewrites materialized instances.

## Tests required before any UI (`packages/shared`)
- chore_date across midnight and DST (Asia/Jerusalem, America/New_York), boundary 0 and 3
- weekday mask materialization with start/end dates and once chores
- day complete / freeze / break, streak walk-back, each streak bonus fires exactly once
- ledger: earn → reject → clawback nets 0; reject that breaks day-complete claws back bonus and streak; re-applying any op is a no-op
- entitlement gate matrix: free × premium × each gated action; 14-day read-only child
