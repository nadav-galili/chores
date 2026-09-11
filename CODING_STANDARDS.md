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

## Dates are household-local, never instants

**Every date-keyed row stores a household-local `chore_date`.** Violation: date arithmetic on a timestamp or `Date` to derive a Chore Date — adding days to an instant, `toISOString().slice(0,10)`, comparing instants to decide which Chore Date a row belongs to. The Chore Date is computed once at the household boundary (ADR-0003) and carried; downstream code reads it, never recomputes it.

## Sibling isolation is server-side

**A Kid Device token scopes every query to one child**, enforced in the query, not in the UI. Violation: a handler that takes a `childId` from the request body or params on a kid-device route rather than deriving it from the token; a query missing the child scope with the filtering done after the fetch, or in a component.

**The one exception is the grove.** `children` and `growth_entries` reach a Kid Device household-wide, because the grove belongs to the household. Flagging that as a leak is a false positive. (ADR-0011, `docs/spec/03-sync.md`)

## Child privacy

**Child data is first name only, and nothing about a child reaches analytics or a third party.** Violation: a child's name, age, birthday, photo or id in an analytics call, a crash-report payload, a log line that ships off-device, or any third-party SDK argument. Children are anonymous per-device in analytics. (ADR-0009)

## Entitlement never gates the child

**The child's side is never gated by entitlement.** Violation: an entitlement, paywall, subscription or free-tier check anywhere under a `(kid)` route, in a kid-device handler, or in shared logic reached from one. Entitlement gates the parent's side only. (ADR-0005)

## Frozen identifiers

**`NAMESPACE_CHORES` must never change** — deterministic ids are derived from it, so changing it silently breaks every existing id. Violation: any edit to its value. (ADR-0010)

The npm scope `@chores/shared`, the repo name and the Railway project also keep the original name; the app itself is "Mibo" (`docs/spec/05-store-listing.md`). A diff that renames the former to match the latter is a violation, not a cleanup.
