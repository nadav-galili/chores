# Build prompt — kids chores app (paste into a fresh session in the new project dir)

---

I'm building a **kids chores and allowance app** for iOS and Android. Before we write code, read this whole brief. Ask me questions about anything ambiguous, then propose a plan — do not start implementing until I approve it.

## Why this app exists

This niche was chosen from App Store keyword research, not a hunch. The keyword cluster is real (AppTweak 5–100 index, US iPhone): `chores tracker` 47, `chores` 43, `chore chart` 41, `kids chore app` 34, `chores and allowance` 34, `chore app` 33, `behavior tracker` 31, `chores app` 30, `chores for kids` 27, `kids chores` 25. Category ceiling is low — no competitor exceeds ~12k iOS ratings.

**I am the target user: I have a 10-year-old daughter, a 7-year-old son, and a newborn.**

## The one problem that matters

Every competitor (Chorsee 11.7k ratings, Chores & Allowance Bot 10.9k, Joon 6.5k, Homey 2.8k) tracks chores adequately. **Every one of them loses the child in week two.** That novelty cliff is the entire opportunity. Direct evidence from their App Store reviews:

- A **child**, 2★ on Chorsee: *"My mom loves it which means I have to do it… it's only fun for like a day and then it just gets boring. I would love if like after you get all your chores done, you get to do something fun on the app."*
- Parent, 1★ on Bot: *"The app worked good for about a week then the free trial ended. Then got the premium but my son stopped after a few days. Couldn't motivate him with this app anymore."*
- Parent, 3★ on Joon: *"after the newness had worn off… I was back in nag mode. There is so much management needed on the parents' side that it became too much of a task to maintain daily."*
- Child, 1★ on Chorsee: *"my mom is spamming chores… i need 250 points to get one singular reward!"*
- Child, 1★ on Bot: *"all my parents do is torcher me all day."*

**The core insight: in every existing app the child is a coerced user, not a customer.** The apps are built for the parent and inflicted on the child. Design for the child first; the parent is already motivated.

## Known, quoted gaps nobody has filled

1. **No age-differentiated child UI.** A 7-year-old and a 10-year-old need different screens. *"My 10 year old daughter is enjoying the game… My 4 year old is not so much into the game but is motivated by the coins."*
2. **Sibling isolation** — kids can see/modify each other's accounts.
3. **Kid login failures lock children out entirely.** *"I can't get it to let me push login on my daughters phone… My daughter is upset that she is getting left out."*
4. **Payouts are a ledger, not money.** Parents want real transfer; a kid wrote *"my dad and my mom keeps saying it's not real money and I wanna buy stuff with it."* (We are NOT building money movement in v1 — but design the ledger so it could later.)
5. **Sync/reliability decay.** *"around the 3rd week started getting glitchy… she can't take pictures."*
6. **Paywall before value.** *"you can't even use this app without getting a subscription."*
7. **Notification spam.** *"We're all getting 20+ emails a day."*

## Product constraints — these are decisions already made, not open questions

- **The child's side is NEVER paywalled.** If the kid can't use it, the household stops.
- **Free tier is real, not a trial**: 1–2 children, unlimited chores, fully functional. **No credit card for the free tier.**
- **Premium** (parent-facing, sold after they're invested): more children, allowance/payout ledger, history & stats, custom rewards, multi-parent sync. Anchor $39.99/yr, ~$7.99–8.99/mo, plus a lifetime tier.
- **Kids do not have emails or passwords.** Household join code + device-bound session. This is the single biggest adoption blocker in the category.
- **Offline-first.** A child tapping "done" must work with no network, and sync later. Never block on the server.
- **Notification digests, not per-event blasts.**
- **COPPA-minimal data**: child first name only, no child email, no third-party ad SDKs, no analytics tied to a child profile.

## Stack (decided)

- **TypeScript everywhere.**
- **React Native + Expo** (managed workflow, EAS Build, expo-updates for OTA).
- **RevenueCat** for subscriptions on both stores.
- **Clerk** for **parent** authentication (`@clerk/clerk-expo`, with `expo-secure-store` as the token cache).
- **Node.js + PostgreSQL** backend, containerised, deployed on **Railway**.
- Ship to both the App Store and Google Play.

### Auth model — important, and not negotiable

**Parents are Clerk users. Children are NOT.** Children exist only as rows in our own Postgres.

A child gets access through a **device-bound session**: the parent generates a household join code, the child's device redeems it once, and the backend issues a long-lived token scoped to `household_id` + `child_id`. After setup the child never sees a login screen. A parent can revoke any device.

Reasons, so you don't "improve" this later:
1. Children have no email or phone. Forcing them through an identity provider recreates the #1 adoption failure in this category — competitors lose whole households at the kid-login step.
2. COPPA: keeping children out of a third-party identity provider keeps child data minimal and in our own database.
3. Clerk bills per monthly active user. Children will be the most active users while the parent pays — putting them in Clerk inverts the cost curve.

A side benefit: a token scoped to one child gives us **sibling isolation** by construction, which is a quoted gap in competitor reviews.

Push back if any of the rest of the stack is wrong for the requirements — but the parent/child auth split above is settled.

## What I want from you first

1. **Ask me the questions you need answered** to design this well — especially about the reward mechanic, since that's where the retention problem lives and I haven't decided it.
2. Propose a **data model**: households, parents, children, chores (one-off / recurring / daily), completions, approvals, points, rewards, redemptions, ledger entries. Pay attention to recurrence rules and to **daily reset in the household's local timezone** — this is a known bug factory and the points ledger must be trustworthy.
3. Propose the **sync design** (local-first writes, conflict handling, what happens when two parents approve at once).
4. Propose a **milestone plan**. Milestone 1 must be the smallest thing I can put in front of my own 7- and 10-year-old to test whether they still open it in week three. Not a full app.
5. Then stop and wait for my approval.

## How I want to work

- Terse. No summaries of what you just did.
- Don't build beyond what's asked; no speculative abstractions or "while I'm here" refactors.
- Tests for the logic that must be right: recurrence, timezone rollover, points arithmetic, entitlement gating.
- Ask before adding a dependency.

## Out of scope for v1

Real money movement / bank links / debit cards. ADHD-specific positioning (Joon owns it). Google Play launch can follow iOS. Web app.
