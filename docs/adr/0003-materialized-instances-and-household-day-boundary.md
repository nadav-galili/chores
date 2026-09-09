---
status: accepted
---
# Chore instances are materialized per child per local day, not computed at render time

Daily reset in the household's timezone is the category's bug factory. We store a household IANA timezone plus a day boundary hour (0–6) and derive a chore date from them; recurrence is evaluated only on local dates, never on instants, so DST cannot shift a day. Instances get a deterministic id (chore, child, chore date) and are created by the device on day open and by a server cron at the household's boundary, with `ON CONFLICT DO NOTHING` making the race harmless. The device computes chore date at tap time; the server accepts it within one day of its own computation, otherwise overrides and flags the op.

We rejected a "day end hour" (e.g. 21:00) because it would push a 22:00 completion into tomorrow; bedtime alignment is handled by reminder and digest times instead.
