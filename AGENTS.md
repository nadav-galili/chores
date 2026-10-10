# Mibo

ASD-STE100: write all prose in this repo in Simplified Technical English (docs, code comments, commit messages, issue and PR text).

Mibo is a chores and allowance app for iOS and Android. Its primary user is the child.

Keep replies short. Give the result, with no summary of the work that you did.

Read the file for your task before you start the task:

- **Domain:** `docs/agents/domain.md` routes to the glossary, the ADRs and the spec. Read it before you name a domain concept or change what the app does.
- **Dependencies:** `docs/spec/04-milestones.md` (Dependencies) is the approved list. Ask the user before you add a package that is not on it.
- **Issues:** `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`, before you create, read or label an issue.
- **Tickets:** `docs/agents/ticket-workflow.md`, before you work on a ticket or a spec issue.
- **Environments:** `docs/agents/environments.md`, before you set up Postgres, edit a `src/db/schema.ts`, deploy the API, or use the live API.
- **Invariants:** `CODING_STANDARDS.md`, before you write code for one of these:
  - the database
  - a date
  - a Kid Device route, or an entitlement check
  - a `catch` or a `throw`
  - analytics, push, or other data for a third party
  - a shell script
  - a test
  - the brand name, or an identifier that says `chores` (`NAMESPACE_CHORES`)
