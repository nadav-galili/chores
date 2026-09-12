---
status: accepted
---
# PostHog (EU) with parents identified and children anonymous per device

Analytics is needed to measure the week-3 retention bet, but COPPA-minimal data forbids analytics tied to a child profile. Parent mode identifies the Clerk user and groups by household. Kid mode uses a random per-device analytics id generated at join-code redemption, rotated on revoke, with only ui mode, an age band and a hashed household id as properties; never child id, name or pet name. Autocapture and session replay are off everywhere. Feature flags are fetched in parent mode and cached to the device so kid devices never call PostHog for flags. Notifications are limited to exactly four kinds (kid reminder, parent evening digest, redemption requested, reward approved) as a product rule, not a technical one.

## Carve-out: children's first names in the parent digest

The parent evening digest names the children it is about — "Noa 3/4 done" — and that copy is handed to Expo's push service. This is a deliberate carve-out, taken because the digest is useless without it: its whole job is to tell a parent per child what is done, what is still due and who is Day Complete, and a household with three children cannot read a lock-screen summary that names nobody. The alternative — a nameless digest, or one that pushes only a "tap to see" prompt — was considered and rejected as a worse product for the one surface a parent actually reads.

The carve-out is bounded to exactly this: **first names only**, in **push copy**, addressed to a **registered device of a parent of that child's own household**. Nothing else about a child crosses — not a pet name, a chore title, a reward title, a Join Code, an age or an id — and the child's own pushes stay nameless, taking no arguments at all.

It widens nothing about analytics. A child is still anonymous per device in PostHog; a digest tap reports its kind and nothing more, and the digest's `chore_date` and ids stay in the payload, never in an event. The same holds for crash reports and for anything logged off-device (ADR-0015).
