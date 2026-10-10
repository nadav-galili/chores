# Ticket workflow

The `gh` commands are in `docs/agents/issue-tracker.md`. The labels are in `docs/agents/triage-labels.md`.

## Spec issues and tickets

Each milestone has one spec issue that lists its tracer-bullet tickets. The tickets have native "blocked by" edges. A spec issue stays open until all its tickets are closed. Edit a spec issue only to keep it true to its milestone's scope. Record progress on the tickets.

## Steps

One ticket per session, in this order:

1. **Pick from the frontier** — a `ready-for-agent` ticket with zero open blockers (`issue_dependencies_summary.blocked_by == 0`). If the user names a ticket, use that one; otherwise take the lowest-numbered frontier ticket and say which.
2. **`/implement #N`** — it drives `/tdd` at the seams in `CODING_STANDARDS.md` (Tests), typechecks as it goes, runs `/code-review`, and commits to `main`. Done when every acceptance criterion on the ticket is checked off and the full test suite is green.
3. **Close out** — `git push origin main`, then `gh issue close N --comment` with the commit hash and one line per acceptance criterion that needed a judgement call. Done when the ticket shows closed and the next frontier is listed in the reply.
4. **`/clear`** before the next ticket. The ticket is self-contained, so this session's context is disposable.

**`ops` tickets are the exception to step 2.** Read the ticket's labels before you explore. For an `ops` ticket, make the deliverable that `docs/agents/triage-labels.md` (`ops`) names, not an implementation.

## Spec gaps

When a ticket exposes a gap in the spec, resolve it in the ticket's comments and keep building; edit `docs/spec/` only if the gap changes a documented rule, and add an ADR only if the decision is hard to reverse.
