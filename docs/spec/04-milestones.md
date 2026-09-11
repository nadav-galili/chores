# Milestones

All four ship in v1. Order exists so the kids get the loop first and later work builds on a tested ledger and sync.

## M1 · Core loop → APK on both kids' devices
Exit: two kids, two devices, real chores, offline works, per-day opens visible in PostHog.
- Monorepo scaffold (`apps/mobile`, `apps/api`, `packages/shared`), CI (typecheck, lint, vitest), Railway deploy, Postgres, Drizzle migrations
- `packages/shared`: schemas, chore_date, recurrence, points, ledger ids, streak; test list in 02 green
- API: Clerk JWT verify, household/children/chores CRUD, join code issue/redeem, device token, `/sync`, change_log triggers, day materialization cron
- Mobile parent mode (minimal, en+he): sign in (Google/email), create household, add children with ui_mode, add chores, show join code, read-only today view
- Mobile kid mode: redeem code, today list, done/undo, coins, streak, pet (5 levels, mood, placeholder art), little/big layouts, offline outbox, local reminder
- PostHog with identity rule, `pet_enabled` flag
- EAS dev build, Android internal distribution

## M2 · Parent shell
- Reject + clawback; "redo" on kid side
- Built-in reward catalog, request → approve/decline, reservation
- Expo push: tokens, four kinds, digest content, minute cron, push-triggered pull
- Parent PIN
- Devices per child, revoke, reconnect
- Stats (7-day window), Hebrew RTL pass

## M3 · Premium
- RevenueCat products + entitlement + webhook, paywall at gates only
- Server gates: child quota with `read_only_after`, 3+ parents, custom rewards, money ledger, full history, photo proof
- Custom rewards CRUD; money ledger with `coins_per_unit`, payout, adjust, owed view
- Photo proof via R2 presigned upload in outbox; 30-day bucket lifecycle
- Entitlement gate tests

## M4 · Store
- Apple sign-in, iOS build, App Store listing (en), privacy labels, COPPA-facing privacy policy
- expo-updates channels, production EAS profiles
- Play listing after iOS; Hebrew store copy later
- Name "Mibo", bundle id `com.mibokids.app`; store listing in `docs/spec/05-store-listing.md`. Icons still outstanding.

## Risks
- **Second-child paywall at day 14** — highest-risk decision; kid side stays fully usable; watch `paywall_shown{gate=child_quota}` → churn.
- **Pet art** — placeholder art in M1 tells you nothing about the mechanic; budget real art before the week-3 verdict.
- **Drizzle migrations on expo-sqlite** — bundled generated SQL with a runner from M1.
- **Materialization races** — deterministic id + `ON CONFLICT DO NOTHING`.
- **Push token rot** — re-register on open; null on `DeviceNotRegistered`.

## Dependencies (approved once, here)
- mobile: expo-router, expo-sqlite, drizzle-orm, @clerk/clerk-expo, expo-secure-store, expo-notifications, posthog-react-native, react-native-purchases, i18n-js, expo-localization, expo-image-picker, uuid, react-native-reanimated, expo-haptics, expo-font, expo-crypto
- api: hono, @hono/node-server, drizzle-orm, postgres, zod, @clerk/backend, posthog-node, expo-server-sdk, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
- tooling: turbo, vitest, tsx, drizzle-kit, eslint, prettier, typescript

Anything not on this list is asked for separately.

`expo-crypto` supplies the one WebCrypto call the app makes. `uuid7()` in `packages/shared` uses
`crypto.getRandomValues`; Node has it and Hermes does not, so `apps/mobile/src/lib/crypto.ts` assigns
the global from `expo-crypto` before any screen loads. It is load-bearing for every write the device
makes — a chore, a completion, an outbox op — and without it the app reads normally and silently
writes nothing at all.

`react-native-reanimated`, `expo-haptics` and `expo-font` are approved for the design milestone
(issue #19), which lands between M1 and M2. Motion and haptics are spent on the done moment only;
`expo-font` carries the one bundled face — Rubik 600, for display and title — because Rubik covers
Hebrew and Latin in one family. Only `expo-font` is installed so far; the other two arrive with the
tickets that use them.

`react-dom` is pinned in `apps/mobile` and in `pnpm.overrides` at the same version as `react`. Nothing
imports it — pnpm auto-installs it as a peer of expo-router's runtime and hoists it, and a hoisted copy
newer than `react` red-boxes the app on launch with "Incompatible React versions". It is a version pin
on a package that was already in the tree, not a new dependency; keep the two versions equal when
either moves.
