# Product

## The bet
Competitors lose the child in week two. The test: do a 7-year-old and a 10-year-old still open the app in week 3 unprompted.

## Two loops
- **Kid loop, instant, no parent:** tap done → coins land → pet reacts and gains XP → streak advances. Works offline.
- **Parent loop, slow, digest:** evening digest → reject if needed → decide redemptions → optional payout. Never a per-event blast.

## Reward rules
| rule | value |
|---|---|
| per chore | 10 coins, 10 XP |
| day complete bonus | 20 coins, 20 XP (every instance due that day done) |
| streak bonus | day 3: 30 · day 7: 70 · day 14: 150 (coins and XP) |
| frozen day | zero instances due → streak neither breaks nor extends |
| rejection | clawback of exactly what the completion earned, incl. bonus/streak it triggered; instance returns to due as "redo" |
| redo window | a redo may be completed for two chore dates after its own; it counts for the date it belongs to, and restores that date's bonus and streak. The tree that date grew stands either way (ADR-0011) |
| photo proof | the only chore type where coins wait for parent approval |
| pet | one species, 5 levels from XP thresholds, mood from today's completions, never below "sleepy"; UI level is monotonic even if XP is clawed back |
| tuning | coin amounts are not parent-tunable in v1 |

## Chores
Kinds: `once` (due_date), `daily`, `weekdays` (bit mask Mon=0…Sun=6). Start/end dates. N assignees → one instance per assignee per chore date. Kid can undo own completion same day until a parent has acted on it.

## Children and devices
- Child = first name, `ui_mode` (`little` | `big`, set by parent, not derived from age), pet name, optional reminder time.
- One child per device. Parent's phone has no kid mode in v1.
- Join code: 6 chars, 15 min, single-use, bound to one child. Redeem → device token. Parent can revoke; revoked device wipes local data and shows "ask a parent to reconnect".
- One binary. First launch asks parent / kid. Kid mode exits only with the parent PIN: one per household, four digits, checked on the device itself so it works offline, and it guards that door and nothing else (ADR-0013). A parent must set one before their first join code is issued. Any signed-in parent can replace it without knowing the old one; an offline kid device keeps accepting the old one until it next syncs.
- Parents: Clerk with Google, Apple, email code. Two parents free; the first parent adds their partner by email, and the partner becomes a parent of that household on their first sign-in with it.

## Tiers
| | free | premium |
|---|---|---|
| children | 1 (+ grace: extra children added at onboarding, child row and assignment membership become parent-read-only after 14 days) | unlimited |
| parents | 2 | unlimited |
| chores | unlimited | unlimited |
| pet, streak, coins | yes | yes |
| rewards | built-in catalog (can hide) | + custom |
| history | 7 days | full + stats |
| money ledger / payouts | no | yes |
| photo proof | no | yes |

Pricing: $39.99/yr · $6.99/mo · $79.99 lifetime. No trial, no credit card for free. Paywall only when a gate is hit. RevenueCat entitlement `premium`, webhook → `households.entitlement`. Child side is never gated.

After an over-quota child's 14-day grace ends, a parent cannot edit that child's first name,
`ui_mode`, pet name or reminder time, or add or remove that child as a chore assignee. Everything
on the child's own side remains available: chores, pet, streak, coins, grove and shop. A shared
chore belongs to neither child, so its title, icon and recurrence remain editable while its
assignment membership is locked.

Built-in reward catalog, copied into each household when it is created: 50 pick a snack · 150 30 min screen time / stay up 15 min · 400 pick Friday dinner / small toy. Each row carries a `builtin_key` and the title is rendered from i18n on the device, so the catalog is not seeded in a language. Coins leave a child's ledger when they ask, not when a parent approves (ADR-0014).

## Notifications (exactly four)
1. Kid reminder at the child's reminder time (push; local fallback if no token).
2. Parent evening digest at household `digest_hour` (default 20). It summarises the chore date that is **still open** — today so far — because a parent can only act on a day that has not ended, and with a day boundary as late as 06:00 "yesterday" can mean thirty hours ago. So it reads "3/4 done" and never "did not complete", a child who finishes at 21:00 gets no credit in that evening's digest (their own screen celebrates it, which is the right place), and it carries the count of redemptions still waiting on a decision. A day with nothing due and nothing waiting sends no digest at all.
3. Parent: redemption requested (immediate).
4. Kid: reward approved (immediate).

Expo push; minute cron inside the API container; tokens re-registered on every app open; `DeviceNotRegistered` nulls the token.

## Locale
i18n with English default, Hebrew as the tested locale, RTL from day one. Store copy English first.

## Analytics (PostHog EU)
- Parent mode: `identify(clerk_user_id)`, group `household:<id>`.
- Kid mode: `distinct_id = analytics_anon_id` (random, secure store, rotated on revoke). Properties: `ui_mode`, `age_band`, `household_hash`. Never child id, name, pet name.
- `age_band` is derived from `ui_mode` — `little` → `5-7`, `big` → `8+`. No birthdate is stored anywhere and none will be (child first name only), so `8-10` and `11+` cannot be told apart without asking for an age, and are one band.
- Autocapture and session replay off. Server events via `posthog-node` with the originating distinct id.
- Flags `pet_enabled`, `grove_enabled` fetched in parent mode, cached to SQLite for kid mode. They are independent so the pet's and the grove's contributions to week-three retention can be separated (ADR-0011).

| question | events |
|---|---|
| week-2/3 kid retention | `kid_app_open` (daily dedupe), `kid_day_complete`, `grove_grew {stage}` |
| done → reward latency | `chore_completed {offline}`, `pet_reacted {ms}` |
| digest open rate | `push_sent` (server), `push_opened {kind}` |
| paywall → purchase | `paywall_shown {gate}`, `purchase_completed` (webhook) |
| activation | `household_created`, `chore_created`, `join_code_redeemed` |
| is the reward loop used | `reward_requested {builtin_key, cost_coins}` (kid device), `redemption_decided {decision}` (server) |

## Out of scope for v1
Real money movement, ADHD positioning, web app, parent-tunable coin values, shared "first to finish" chores, kid mode on the parent phone.
