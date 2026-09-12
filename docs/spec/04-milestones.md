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
Exit: a parent can see a day, reject what did not happen, decide what a child asked for, and be told once each evening — and a child can redo, spend and stay out of parent mode.

What M1 already landed, so M2 does not rebuild it: the rejection endpoint and its clawback; the Expo transport, receipts and the minute cron, for `kid_reminder` only; the revoke endpoint; the Hebrew and RTL pass. What M1 left as a shape with no middle: `redeem` in the ledger kinds, three notification kinds, `custom_reward` in the gate list, `redo` as an instance status, `pin_hash` as an unread column, and both reward tables on the kid device but in no migration.

- **Reject, reachable.** A `completion_id` on the parent's surfaces — today and the 7-day grid — because the endpoint exists and nothing can name what to reject.
- **Redo.** The server writes a completion on an existing instance's own chore date however far back it is; the kid side shows redos in their own section for two days; the ledger restores the day bonus and streak; the grove may grow for a past chore date.
- **Rewards.** Both tables in Postgres, the catalog copied into each household at creation with a `builtin_key`, `request_redemption` / `cancel_redemption` as optimistic kid ops, a parent decision over REST, and the kid shop. Coins leave at request (ADR-0014); a refused op undoes its own rows.
- **Push, the other three kinds.** Parent device registration with a locale, `digestsDue()`, digest content and suppression, and the two immediate kinds.
- **Parent PIN.** On `households`, set before the first join code, verified on the kid device (ADR-0013).
- **Devices per child.** A `GET` to go with the revoke that already exists; "reconnect" is issuing another join code, not un-revoking one.
- **Stats.** The 7-day grid, per child, ungated — it is the free tier's history promise, and its `done` cells are how a parent reaches a past completion at all.
- **Analytics.** `reward_requested` and `redemption_decided`, and nothing about a child.

Not in M2: custom rewards, the money ledger and photo proof stay behind their M3 gates; crash reporting (#35) is its own issue, sequenced **before** the rejected-op rollback and the PIN check, because both fail silently on a device and both fail by making the balance look like a lie.

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
- mobile: expo-router, expo-sqlite, drizzle-orm, @clerk/clerk-expo, expo-secure-store, expo-notifications, posthog-react-native, react-native-purchases, i18n-js, expo-localization, expo-image-picker, uuid, react-native-reanimated, expo-haptics, expo-font, expo-crypto, @sentry/react-native
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

`@sentry/react-native` is approved for the mobile app only, for crash and handled-error reporting
(#35, ADR-0015). It is the one third party that receives anything from a kid device, so what it
receives is an allowlist built in `packages/shared/src/error-reporting.ts` and nothing else: no
child identity, no first name, pet name, chore title or join code. The API keeps `posthog-node` and
Railway logs.

Its build-time config is *not* committed. The PostHog key sits in `eas.json` because it is a
write-only ingest key; the Sentry values include an auth token that can read the project, so all
four are EAS environment variables instead — set once, from the repo root:

```
eas env:create --environment preview --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility plaintext
eas env:create --environment preview --name SENTRY_ORG     --value <org-slug>     --visibility plaintext
eas env:create --environment preview --name SENTRY_PROJECT --value <project-slug> --visibility plaintext
eas env:create --environment preview --name SENTRY_AUTH_TOKEN --value <token> --visibility secret
```

- `EXPO_PUBLIC_SENTRY_DSN` is read at runtime by `src/lib/error-reporting.ts`. With no DSN the
  reporter is a no-op and the app behaves exactly as before — which is also why nothing breaks
  before these are set.
- `SENTRY_ORG` and `SENTRY_PROJECT` are read at build time by `app.config.ts`, and
  `SENTRY_AUTH_TOKEN` by the config plugin, to upload source maps. Without the first two the
  plugin still links the native SDK; only symbolication is lost.

`app.config.ts` exists for those two variables alone, and adds the config plugin; `app.json` is
still the whole of the app's configuration. `metro.config.js` wraps Expo's default config with
Sentry's, which is what stamps the debug id that matches an uploaded source map to a released
build.

`react-dom` is pinned in `apps/mobile` and in `pnpm.overrides` at the same version as `react`. Nothing
imports it — pnpm auto-installs it as a peer of expo-router's runtime and hoists it, and a hoisted copy
newer than `react` red-boxes the app on launch with "Incompatible React versions". It is a version pin
on a package that was already in the tree, not a new dependency; keep the two versions equal when
either moves.
