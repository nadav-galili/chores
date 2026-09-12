# Coding standards

Read during review, not implementation. Each rule reads *what it is* → *what a violation looks like in a diff*. Terms are `CONTEXT.md`'s; use them verbatim.

These are hard violations, not judgement calls — every one of them is a settled decision with an ADR or a spec behind it. Where a rule cites an ADR, the ADR is the authority; this file is the reviewable restatement.

## Derived values are never stored

- **Balance is always `SUM(coins)` over the ledger.** Violation: a `balance` column in a schema or migration, a balance field on an API response computed once and persisted, any write that "updates" a balance.
- **Grove stage is always `COUNT(*)` over growth entries.** Violation: a `stage` or `grove_stage` column, or a stage cached on `children`. (ADR-0011)

A derived value in a `SELECT` is fine. A derived value in a `CREATE TABLE`, an `INSERT`, or an `UPDATE` is the violation.

## Append-only rows

- **Ledger, XP and completion rows are never updated or deleted.** Corrections are new Clawback entries. Violation: `UPDATE` or `DELETE` against those tables, a Drizzle `.update()` / `.delete()` on them, or a migration that rewrites their rows.
- **Growth entries are append-only *and* have no clawback.** A rejection costs coins and the streak, never a tree. Violation: any clawback path that also removes or negates a growth entry. (ADR-0011)

The asymmetry is the point: the ledger corrects by appending a negative entry; the grove does not correct at all.

**The rule governs rows the server accepted.** A device's optimistic rows for an op the server *refused* were never accepted, are the device's own, and that op deletes them — a refused `request_redemption` that leaves its `redemptions` row and its `redeem` entry behind leaves the balance wrong. Flagging that delete is a false positive. (ADR-0014, `docs/spec/03-sync.md`)

## Dates are household-local, never instants

**Every date-keyed row stores a household-local `chore_date`.** Violation: date arithmetic on a timestamp or `Date` to derive a Chore Date — adding days to an instant, `toISOString().slice(0,10)`, comparing instants to decide which Chore Date a row belongs to. The Chore Date is computed once at the household boundary (ADR-0003) and carried; downstream code reads it, never recomputes it.

## Sibling isolation is server-side

**A Kid Device token scopes every query to one child**, enforced in the query, not in the UI. Violation: a handler that takes a `childId` from the request body or params on a kid-device route rather than deriving it from the token; a query missing the child scope with the filtering done after the fetch, or in a component.

**There are two exceptions, the grove and the reward catalog.** `children` and `growth_entries` reach a Kid Device household-wide because the grove belongs to the household (ADR-0011); `rewards` does too, because it is a per-household catalog carrying no `child_id` at all. `redemptions` stays child-scoped. The three are named in `HOUSEHOLD_WIDE` in `apps/api/src/sync.ts`; flagging one of them as a leak is a false positive. (`docs/spec/03-sync.md`)

## Child privacy

**Child data is first name only, and nothing about a child reaches analytics or a third party.** Violation: a child's name, age, birthday, photo or id in an analytics call, a crash-report payload, a log line that ships off-device, or any third-party SDK argument. Children are anonymous per-device in analytics. (ADR-0009)

**One carve-out, and only this one: a child's first name may appear in push copy addressed to a registered device of a parent of that child's own household** — the parent digest, which is unreadable without saying which child (`digestCopy` in `packages/shared/src/notification.ts`). Nothing else widens: not analytics, not crash reports, not logs, not the child's own pushes, and never a pet name, chore title, reward title or Join Code. (ADR-0009)

**An error's own message is part of that payload.** A crash report carries the string a `throw`
was given, and no scrubber downstream can tell a chore title inside it from a real error. Violation:
a `throw new Error(...)`, a rejected promise or a `captureException` context that interpolates a
child's first name, pet name, a chore title or a Join Code. Name the operation that failed, not the
row it failed on. (ADR-0015)

**Anything a third-party SDK sends is an allowlist, not a scrub list.** Violation: a `beforeSend`,
`beforeBreadcrumb` or equivalent that deletes known-bad fields from an object it was handed instead
of building a new one out of known-good fields — the next SDK release adds a field the deny list has
never heard of. The allowlists live in `packages/shared/src/error-reporting.ts`. (ADR-0015)

## Entitlement never gates the child

**The child's side is never gated by entitlement.** Violation: an entitlement, paywall, subscription or free-tier check anywhere under a `(kid)` route, in a kid-device handler, or in shared logic reached from one. Entitlement gates the parent's side only. (ADR-0005)

## A catch never discards its cause

**Every `catch` either surfaces the cause, logs it, or says in a comment why the silence is safe.** Violation: `catch {}` or `.catch(() => {})` with no comment, on a path where the failure is real — a write that does not land, a request that does not return, a session that does not activate.

Swallowing the *failure* is often right; swallowing the *cause* never is. Where the person who sees the screen can act on it, the cause reaches them (`chore-form.tsx` appends the status and code to a failed save). Where they cannot — anything a child sees — it is logged instead and the child's screen stays calm. Failure that is genuinely inert may be ignored, with a comment saying so; `haptics.ts` is the honest case, because a buzz that does not fire is not an error.

Nothing logged may carry a child's first name, pet name, chore title or join code — the privacy rule above outranks this one (ADR-0009).

The two banned shapes are the two a linter can see, so `no-empty` and `no-empty-function` reject them; both accept a body holding a comment, which is the third shape written down inside the braces. A `catch (e)` that binds the cause and then drops it is beyond either rule and stays a review call.

This rule is evidence rather than an ADR: four bugs in one session — a discarded OAuth error, two discarded `uuid7()` failures and one with no `catch` at all — each cost a ten-minute instrumented device build to learn something the device already knew. (#36)

## Frozen identifiers

**`NAMESPACE_CHORES` must never change** — deterministic ids are derived from it, so changing it silently breaks every existing id. Violation: any edit to its value. (ADR-0010)

The npm scope `@chores/shared`, the repo name and the Railway project also keep the original name; the app itself is "Mibo" (`docs/spec/05-store-listing.md`). A diff that renames the former to match the latter is a violation, not a cleanup.
