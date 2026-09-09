# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A kids chores and allowance app (iOS + Android) where the child is the primary user. No code exists yet; the design is complete and approved. Read in this order before doing anything:

1. `CONTEXT.md` — the glossary. Use its terms verbatim (Instance, Chore Date, Day Complete, Clawback, Kid Device, ...). Don't drift to the `_Avoid_` synonyms.
2. `docs/adr/` — nine decisions that look wrong without context. Do not "fix" them: children are not identity-provider users (0001), the ledger is append-only with deterministic ids (0002), instances are materialized not computed (0003), coins and pet XP are separate (0004), Hono + Drizzle on both server and device (0006), pnpm/Node not Bun (0007), one REST `/sync` endpoint (0008), children are anonymous in analytics (0009).
3. `docs/spec/` — product rules, data model, sync protocol, milestones, and the **approved dependency list**. Any dependency not on that list must be asked for first.
4. `BUILD-PROMPT.md` — the original brief; product constraints there are settled, not open.

## Ticket workflow

Issues live in GitHub Issues on `nadav-galili/chores` via `gh`; conventions in `docs/agents/issue-tracker.md`, labels in `docs/agents/triage-labels.md`. Issue #1 is the M1 spec; #2–#16 are its tracer-bullet tickets with native "blocked by" edges. #1 stays open and unedited until every ticket is closed.

Greenfield rule: all work lands directly on `main`. No feature branches, no PRs, until the first store release.

One ticket per session, in this order:

1. **Pick from the frontier** — a `ready-for-agent` ticket with zero open blockers (`issue_dependencies_summary.blocked_by == 0`). If the user names a ticket, use that one; otherwise take the lowest-numbered frontier ticket and say which.
2. **`/implement #N`** — it drives `/tdd` at the seams below, typechecks as it goes, runs `/code-review`, and commits to `main`. Done when every acceptance criterion on the ticket is checked off and the full test suite is green.
3. **Close out** — `git push origin main`, then `gh issue close N --comment` with the commit hash and one line per acceptance criterion that needed a judgement call. Done when the ticket shows closed and the next frontier is listed in the reply.
4. **`/clear`** before the next ticket. The ticket is self-contained, so this session's context is disposable.

When a ticket exposes a gap in the spec, resolve it in the ticket's comments and keep building; edit `docs/spec/` only if the gap changes a documented rule, and add an ADR only if the decision is hard to reverse.

## Planned layout (per ADR-0007; create it in ticket #2)

- `apps/mobile` — Expo + expo-router, one binary with `(parent)` and `(kid)` route groups, expo-sqlite + Drizzle local DB with an outbox table.
- `apps/api` — Hono on Node, Drizzle + `postgres`, Dockerfile for Railway, migrations applied on container start, minute cron in-process.
- `packages/shared` — zod schemas and all pure logic: chore date, materialization, points/ledger ids, streak, pet level, entitlement gates. Runs unchanged on device and server. This is where the correctness-critical tests live.

Tooling once scaffolded: pnpm workspaces + Turborepo, Node 22, `node-linker=hoisted` in `.npmrc`, Vitest per workspace, GitHub Actions running typecheck, lint, test on PR. Update this section with the real commands when ticket #2 lands.

## Testing seams (pre-agreed for `/tdd`; these three only)

1. `packages/shared` pure functions, input → output.
2. API over HTTP with Hono `app.request()` against a real Postgres.
3. Device sync engine over an in-memory SQLite, fed canned `/sync` responses.

No UI tests, no mocking of Postgres or SQLite, no handler-level unit tests.

## Invariants to keep in mind while coding

- Balance is always `SUM(coins)`; never store a balance column.
- Ledger, XP and completion rows are never updated or deleted; corrections are clawback entries.
- Every date-keyed row stores a household-local `chore_date`; never do date arithmetic on instants.
- A kid device token scopes every query to one child; sibling isolation is enforced server-side, not in UI.
- Child data is first name only; nothing about a child goes to analytics or third parties.
- The child's side is never gated by entitlement.

## Working style (from the brief)

Terse replies, no summaries of what was just done. Build only what the ticket asks; no speculative abstractions. Placeholders until the naming session: app name "Chores", package `net.mobilebrain.chores`, pet "Pip".
