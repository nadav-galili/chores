# Coding standards

A break of a rule in this file is a hard violation, not a judgement call. Each rule gives the **rule**, then the violation as it shows in a diff, then the ADR, spec, issue or commit behind it. Where a rule cites an ADR, the ADR is the authority, and this file restates it for review. "Not a violation" names a false positive.

## Derived values

- **Balance is always `SUM(coins)` over the ledger.** Violation: a `balance` column in a schema or migration, a balance field on an API response computed once and persisted, any write that "updates" a balance. (ADR-0002, ADR-0014)
- **Grove stage is always `COUNT(*)` over growth entries.** Violation: a `stage` or `grove_stage` column, or a stage cached on `children`. (ADR-0011)

Not a violation: a `SELECT` that computes either value.

## Append-only rows

- **Ledger and XP rows are append-only. A correction is a new Clawback entry.** Violation: `UPDATE` or `DELETE` against those tables, a Drizzle `.update()` / `.delete()` on them, or a migration that rewrites their rows. (ADR-0002)
- **Code writes a completion row once. After that, only its `status` changes.** A Rejection also sets `rejected_by` and `rejected_at`, and a `pending_photo` row gets its `photo_key` one time, when the upload lands. Violation: a `DELETE` of a completion, an update to any other completion column, or a migration that rewrites completion rows. (`docs/spec/02-data-model.md`, ADR-0017)
- **Growth entries are append-only *and* have no clawback.** A rejection costs coins and the streak, never a tree. Violation: any clawback path that also removes or negates a growth entry. (ADR-0011)

These rules cover the rows that the server accepted for a living household. Not a violation:

- A device deletes its own optimistic rows for an op that the server refused. A refused `request_redemption` that keeps its `redemptions` row and its `redeem` entry leaves the balance wrong. (ADR-0014, `docs/spec/03-sync.md`)
- A Household Deletion deletes all the rows of the household. (ADR-0019)

## Dates

**Every date-keyed row stores a household-local `chore_date`. Code computes the Chore Date once, from the household timezone and Day Boundary, and then carries it.** Violation: a Chore Date derived from an instant. Examples are adding days to a timestamp or `Date`, `toISOString().slice(0,10)`, and a comparison of instants that decides the Chore Date of a row. (ADR-0003)

## Sibling isolation

**A Kid Device token scopes every query to one child, in the query itself.** Violation: a kid-device route that takes a `childId` from the request body or params instead of from the token. Also a violation: a query without the child scope that filters after the fetch or in a component. (`docs/spec/03-sync.md`)

Not a violation: the three tables in `HOUSEHOLD_WIDE` (`apps/api/src/sync.ts`) reach a Kid Device household-wide. `children` and `growth_entries` do because the grove belongs to the household (ADR-0011). `rewards` does because it is a per-household catalog with no `child_id`. `redemptions` stays child-scoped.

## Child privacy

**Child data is first name only, and nothing about a child reaches analytics or a third party.** Violation: a child's name, age, birthday, photo or id in an analytics call, a crash-report payload, a log line that ships off-device, or any third-party SDK argument. Children are anonymous per-device in analytics. (ADR-0009)

**One carve-out, and only this one: a child's first name may appear in push copy addressed to a registered device of a parent of that child's own household** — the parent digest (`digestCopy` in `packages/shared/src/notification.ts`). Nothing else widens: not analytics, not crash reports, not logs, not the child's own pushes, and never a pet name, chore title, reward title or Join Code. (ADR-0009)

**An error message names the operation that failed, not the row it failed on.** A crash report carries the message. Violation: a `throw new Error(...)`, a rejected promise or a `captureException` context that interpolates a child's first name, a pet name, a chore title or a Join Code. (ADR-0015)

**Anything a third-party SDK sends is an allowlist, not a scrub list.** Violation: a `beforeSend`, `beforeBreadcrumb` or similar hook that deletes known-bad fields from the object it gets, instead of a new object built from known-good fields. The allowlists are in `packages/shared/src/error-reporting.ts`. (ADR-0015)

## Entitlement

**Entitlement gates the parent's side only. The child's side is always available.** Violation: an entitlement, paywall, subscription or free-tier check anywhere under a `(kid)` route, in a kid-device handler, or in shared logic that one of them reaches. (ADR-0005)

## A catch never discards its cause

**Every `catch` either surfaces the cause, logs it, or says in a comment why the silence is safe.** The screen can hide a failure, but the cause always goes to one of these places:

- A parent's screen shows the cause (`chore-form.tsx` appends the status and code to a failed save).
- A child's screen stays calm, and the cause goes to the log.
- An inert failure gets the comment (`haptics.ts`: a buzz that does not fire is not an error).

Violation: `catch {}` or `.catch(() => {})` with no comment, or a `catch (e)` that binds the cause and then drops it. This applies on a path where the failure is real: a write that does not land, a request that does not return, a session that does not activate. ESLint (`no-empty`, `no-empty-function`) rejects the two empty shapes and accepts them with a comment inside. Only review finds a `catch (e)` that drops its cause. (#36)

Child privacy outranks this rule: a log line carries no first name, pet name, chore title or Join Code. (ADR-0009)

## Shell scripts

Every `scripts/*.sh` runs `set -euo pipefail`.

**Capture the output of a long-running or chatty command first, then slice it.** Violation: a pipe from such a command into a filter that stops reading early (`head`, `sed -n '1,5p'`, `grep -q`, `jq -e` on a stream). The filter exits, the writer gets SIGPIPE, `pipefail` reports the pipeline as failed, and the `|| warn` fires on a healthy command. Write `out=$(cmd)`, then `printf '%s\n' "$out" | head -5`. Shellcheck does not catch this. (#75)

**An interactive checklist offers three answers: yes, no, and not yet run.** A bare Enter records *not yet run*, which goes in neither column. Violation: a `[y/n]` prompt over work that the person possibly could not try yet. It records untried work as FAILED, or it forces the person to abandon the run. (#75)

## Tests

**Every test runs at one of three seams.** These are the pre-agreed seams for `/tdd`:

1. `packages/shared` pure functions, input → output.
2. API over HTTP with Hono `app.request()` against a real Postgres.
3. Device sync engine over an in-memory SQLite, fed canned `/sync` responses.

Violation: a UI test, a mock of Postgres or SQLite, a handler-level unit test, or another test outside the three seams. (#1, Testing Decisions)

**Tests use `TEST_DATABASE_URL` (default `chores_test`), never `DATABASE_URL`.** `DATABASE_URL` names the dev server's database, and every test file drops the whole `public` schema of its database. Violation: a test file or a test helper that reads `DATABASE_URL`, or a fallback from `TEST_DATABASE_URL` to it. Not a violation: the server, `drizzle.config.ts` or a script in `scripts/` that reads `DATABASE_URL` for its own database. (`apps/api/src/test/db.ts`)

## Names

**`NAMESPACE_CHORES` is frozen.** Every deterministic id derives from it, so a change breaks every existing id. Violation: any edit to its value. (ADR-0010)

**The npm scope `@chores/shared`, the repo name and the Railway project keep the name `chores`.** Violation: a diff that renames one of them to "Mibo", for a cleanup or for any other reason. (commit 04127e6)

**The brand is "Mibo" alone.** "Kids" is in the identifier `com.mibokids.app` only. Violation: text a person reads that names the app anything other than "Mibo", for example "Mibo Kids". This includes `app.json`, a catalog string, push copy and a page that the API serves. Not a violation: the keyword tail of a store title after "Mibo", which the store listing controls. (`docs/spec/05-store-listing.md`)
