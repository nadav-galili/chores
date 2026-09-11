---
status: accepted
---
# The Parent PIN is checked on the kid device, against a hash the device holds

Kid mode exits only with the Parent PIN, and kid mode lives on a Kid Device — which has no parent session, and which the whole product promises will work with no network. A child's room being a dead spot must change nothing (`docs/spec/06-design.md`). A PIN checked by the server inherits that dead spot: it either fails open, which is no door at all, or fails closed, which locks a parent out of their own child's phone at exactly the moment they are holding it.

So the household's PIN hash and salt travel to the kid device in its sync scope, and the device compares locally. This is the first secret that deliberately crosses to a Kid Device; `docs/spec/03-sync.md` says "whole household minus tokens/secrets" for a parent device and was silent for a kid one, and now says this instead. Nothing else about the parent side crosses with it.

The threat is a curious child holding the phone, not an attacker. That is the decision, and everything else follows from it. `expo-crypto` gives Hermes SHA-256 and nothing stronger — no PBKDF2, no bcrypt, no argon — so the stored value is `SHA-256(salt ‖ pin)`, one round, over four digits. Ten thousand candidates against one round of SHA-256 is instant for someone holding a debugger and the device's SQLite file, and that is worth stating plainly rather than dressing up: iterating the hash ten thousand times would defend only against an adversary we have explicitly declined to defend against, and would cost a visible pause on a screen a nine-year-old will hammer. What stops the realistic attack is the attempt limit — five tries, then a sixty-second cooldown, with the counter in secure store so a restart does not clear it. The realistic attack is a child typing 1234, then 1111, then 0000.

The PIN is one per household and lives on `households`, not on a parent. It is a door, not a credential: nothing downstream needs to know which parent opened it, and a per-parent PIN would multiply the synced payload to answer a question nobody asks. It gates leaving kid mode and nothing else — approving a redemption, editing a chore and every other parent action sit behind a Clerk session, which is strictly stronger.

Two consequences worth naming. A parent must set a PIN before their first join code is issued, which makes "a Kid Device with no way out" unreachable rather than handled. And any signed-in parent can replace the PIN without knowing the old one — their Clerk session outranks it — which means a changed PIN does not reach an offline device until it next syncs, and the old one keeps working until then. That lag is a property of putting the check on the device, not a defect in it.

The comparison itself is a pure function in `packages/shared`, so the logic reaches the first testing seam. Only the screen's navigation is hand-tested; without that split the whole feature would be device-only.
