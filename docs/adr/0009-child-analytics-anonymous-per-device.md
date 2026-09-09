---
status: accepted
---
# PostHog (EU) with parents identified and children anonymous per device

Analytics is needed to measure the week-3 retention bet, but COPPA-minimal data forbids analytics tied to a child profile. Parent mode identifies the Clerk user and groups by household. Kid mode uses a random per-device analytics id generated at join-code redemption, rotated on revoke, with only ui mode, an age band and a hashed household id as properties; never child id, name or pet name. Autocapture and session replay are off everywhere. Feature flags are fetched in parent mode and cached to the device so kid devices never call PostHog for flags. Notifications are limited to exactly four kinds (kid reminder, parent evening digest, redemption requested, reward approved) as a product rule, not a technical one.
