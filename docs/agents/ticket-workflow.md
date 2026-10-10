# Ticket workflow

## Spec issues and tickets

Each milestone has one spec issue that lists its tracer-bullet tickets. The tickets have native "blocked by" edges. A spec issue stays open until all its tickets are closed. Edit a spec issue only to keep it true to the scope of its milestone. Record progress on the tickets.

## Steps

Do one ticket per session. Do these steps in this order:

1. **Pick from the frontier.** The frontier is the set of `ready-for-agent` tickets that have zero open blockers (`issue_dependencies_summary.blocked_by == 0`). Use the ticket that the user names. If the user names no ticket, take the frontier ticket with the lowest number, and tell the user which one.
2. **`/implement #N`.** Build only what the ticket asks (YAGNI). Write the tests at the pre-agreed `/tdd` seams in `CODING_STANDARDS.md` (Tests). Done when every acceptance criterion on the ticket is checked off and the full test suite is green.
3. **Close out.** Push the commit. Then run `gh issue close N --comment`. In the comment, give the commit hash and one line for each acceptance criterion that needed a judgement call. Done when the ticket shows as closed and your reply lists the next frontier.
4. **`/clear`.** Clear the session before the next ticket. The ticket holds all its context, so the context of this session has no more use.

**An `ops` ticket replaces step 2.** Read the labels of the ticket before you explore. For an `ops` ticket, make the deliverable that `docs/agents/triage-labels.md` (`ops`) names.

## Spec gaps

When a ticket shows a gap in the spec, resolve the gap in the comments of the ticket and continue the work. Edit `docs/spec/` only when the gap changes a documented rule. Add an ADR only when the decision is hard to reverse.
