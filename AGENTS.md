# AGENTS.md

ASD-STE100: write all prose for this repo in Simplified Technical English (docs, code comments, commit messages, issue and PR text).

## What this is

A kids chores and allowance app (iOS + Android) where the child is the primary user. Read in this order before doing anything:

1. `CONTEXT.md` — the glossary. Use its terms verbatim (Instance, Chore Date, Day Complete, Clawback, Kid Device, ...). Don't drift to the `_Avoid_` synonyms.
2. `docs/adr/` — decisions that look wrong without context. Do not "fix" them.
3. `docs/spec/` — product rules, data model, sync protocol, milestones, and the **approved dependency list**. Any dependency not on that list must be asked for first.
4. `BUILD-PROMPT.md` — the original brief; product constraints there are settled, not open.

Three workspaces — `apps/mobile`, `apps/api`, `packages/shared` — laid out and justified in `docs/adr/0007-*`.

## Branches

Greenfield rule: all work lands directly on `main`. No feature branches, no PRs, until the first store release.

Exception — `/implement-spec`: when the user explicitly runs that skill, the greenfield rule is suspended for that run. Only that skill gets this exception, and only when invoked by name.

## Task docs

- **Tickets**: read `docs/agents/ticket-workflow.md` before you work on a ticket or a spec issue.
- **Environments**: read `docs/agents/environments.md` before you set up Postgres, edit a `src/db/schema.ts`, deploy the API, or use the live API.

## Invariants

`CODING_STANDARDS.md` holds the invariants in reviewable form. `/code-review` reads it. Read the file before you write code for one of these:

- a schema or migration
- a ledger, XP, completion or growth write
- a Chore Date
- a kid-device query
- an analytics call, an error message, or anything else sent to a third party
- anything entitlement-gated
- a `catch`
- a shell script in `scripts/`
- a test (the `/tdd` seams), or the database a test uses
- text that names the app
- `NAMESPACE_CHORES`, or another identifier that still says `chores`

## Working style (from the brief)

Terse replies, no summaries of what was just done. Build only what the ticket asks; no speculative abstractions. Pet name is per-child: a parent sets a starting name, the child may rename it.
