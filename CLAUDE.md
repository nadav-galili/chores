# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A kids chores and allowance app (iOS + Android) where the child is the primary user. No code exists yet; the design is complete and approved. Read in this order before doing anything:

1. `CONTEXT.md` — the glossary. Use its terms verbatim (Instance, Chore Date, Day Complete, Clawback, Kid Device, ...). Don't drift to the `_Avoid_` synonyms.
2. `docs/adr/` — fourteen decisions that look wrong without context. Do not "fix" them: children are not identity-provider users (0001), the ledger is append-only with deterministic ids (0002), instances are materialized not computed (0003), coins and pet XP are separate (0004), Hono + Drizzle on both server and device (0006), pnpm/Node not Bun (0007), one REST `/sync` endpoint (0008), children are anonymous in analytics (0009), deterministic ids use one fixed namespace (0010), the grove is append-only and never clawed back (0011), the Parent PIN is checked on the kid device against a synced hash (0013), and a redemption's coins leave the ledger when the child asks rather than when the parent approves (0014).
3. `docs/spec/` — product rules, data model, sync protocol, milestones, and the **approved dependency list**. Any dependency not on that list must be asked for first.
4. `BUILD-PROMPT.md` — the original brief; product constraints there are settled, not open.

## Ticket workflow

Issues live in GitHub Issues on `nadav-galili/chores` via `gh`; conventions in `docs/agents/issue-tracker.md`, labels in `docs/agents/triage-labels.md`. Issue #1 is the M1 spec; #2–#18 are its tracer-bullet tickets with native "blocked by" edges. #1 stays open until every ticket is closed, and is edited only to keep it true to the milestone's scope — never to record progress.

Greenfield rule: all work lands directly on `main`. No feature branches, no PRs, until the first store release.

Exception — `/implement-spec`: when the user explicitly runs that skill, the greenfield rule is suspended for that run. It is expected to create a feature branch and a draft PR, fan implementer subagents out into their own worktrees and branches, merge them back into the PR branch, and mark the PR ready for review. Only that skill gets this exception, and only when invoked by name.

One ticket per session, in this order:

1. **Pick from the frontier** — a `ready-for-agent` ticket with zero open blockers (`issue_dependencies_summary.blocked_by == 0`). If the user names a ticket, use that one; otherwise take the lowest-numbered frontier ticket and say which.
2. **`/implement #N`** — it drives `/tdd` at the seams below, typechecks as it goes, runs `/code-review`, and commits to `main`. Done when every acceptance criterion on the ticket is checked off and the full test suite is green.
3. **Close out** — `git push origin main`, then `gh issue close N --comment` with the commit hash and one line per acceptance criterion that needed a judgement call. Done when the ticket shows closed and the next frontier is listed in the reply.
4. **`/clear`** before the next ticket. The ticket is self-contained, so this session's context is disposable.

When a ticket exposes a gap in the spec, resolve it in the ticket's comments and keep building; edit `docs/spec/` only if the gap changes a documented rule, and add an ADR only if the decision is hard to reverse.

## Layout and commands (per ADR-0007)

Three workspaces — `apps/mobile`, `apps/api`, `packages/shared` — laid out and justified in `docs/adr/0007-*`. Everything else is in `package.json` scripts; these three are not:

```
pnpm dev                                               # concurrently: api (tsx watch) + expo start --dev-client
pnpm --filter api db:generate                          # drizzle-kit generate after editing src/db/schema.ts
railway up --service api --ci                          # from the repo root; service `api` in Railway project `chores`
```

Tooling: pnpm workspaces + Turborepo, Node 22, `node-linker=hoisted`, TypeScript 6 strict, ESLint flat config at the root, Prettier, Vitest per workspace, GitHub Actions (`.github/workflows/ci.yml`) running typecheck, lint, test on PR and on main.

Live API: https://api-production-c5c7.up.railway.app/health

Local Postgres for API tests: `docker run -d --name chores-pg -p 5499:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=chores postgres:17-alpine`, then `DATABASE_URL=postgres://postgres:postgres@localhost:5499/chores`.

## Testing seams (pre-agreed for `/tdd`; these three only)

1. `packages/shared` pure functions, input → output.
2. API over HTTP with Hono `app.request()` against a real Postgres.
3. Device sync engine over an in-memory SQLite, fed canned `/sync` responses.

No UI tests, no mocking of Postgres or SQLite, no handler-level unit tests.

## Invariants

`CODING_STANDARDS.md` holds the seven, in reviewable form; `/code-review` reads it. Read it before touching a schema or migration, a ledger, XP, completion or growth write, a Chore Date, a kid-device query, an analytics call, or anything entitlement-gated.

Never stored, always derived: balance is `SUM(coins)`, grove stage is `COUNT(*)`.

## Working style (from the brief)

Terse replies, no summaries of what was just done. Build only what the ticket asks; no speculative abstractions. App name "Mibo", bundle id and Android package `com.mibokids.app` (see `docs/spec/05-store-listing.md`). Pet name is per-child: a parent sets a starting name, the child may rename it. The npm scope `@chores/shared`, the repo, the Railway project and `NAMESPACE_CHORES` keep the original name — `NAMESPACE_CHORES` is frozen by ADR-0010 and must never change.
