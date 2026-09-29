# Review notes

Two boxes in App Store Connect are filled from this file, so they are pasted, not retyped. Update
it when the app changes what a reviewer sees (#100).

Before pasting, fill the two marked placeholders:

- `<<REVIEW_SECRET>>` — the value of `REVIEW_SECRET` on Railway. It is never written into this
  repo; paste it into App Store Connect only.
- `<<SCREEN_RECORDING_URL>>` — the link to the recording of the child's side (see the end of this
  file).

Before every submission, rebuild the household the reviewer lands in, so they never inherit the
last reviewer's state:

```
DATABASE_URL=… CLERK_SECRET_KEY=… \
R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
pnpm --filter api seed:review
```

Every `R2_*` variable is required: the photo proof is stored in R2, and the seed stops before
writing anything when one is missing. The review address is not an input; it is `REVIEW_EMAIL`
in `packages/shared/src/review.ts`, which the app matches on the sign-in screen. The API's own
`REVIEW_EMAIL` on Railway must be that same address, or the API refuses to start.

It builds "The Review Family" (two children — Maya on the little layout, Leo on the big one — a
week of chores with some done and some approved, one photo chore awaiting approval with no photo
and a second waiting with its photo proof, a reward catalogue with one request waiting, coins, a
grove, Parent PIN `1234`) and sets premium by a manual write, not a webhook — the one exception
the amendment to `docs/adr/0016-revenuecat-webhook-is-the-only-entitlement-writer.md` names
(`REVIEW_ENTITLEMENT_SOURCE` in `apps/api/src/review-household.ts` says why).

---

## 1. App Review Information

App Store Connect → the version → App Review Information.

**Sign-in required:** yes

**User name:** `review@mibokids.app`

**Password:** `<<REVIEW_SECRET>>`

**Notes** (paste everything in the box below):

```
SIGNING IN
Choose "Parent" on the first screen. On the sign-in screen, type review@mibokids.app in the email field and tap "Email me a code". This address is not sent a code: the app asks for a password instead. Type the password given above where the code would go and tap Continue. You land in a demo household, "The Review Family", already set up with two children, a week of chores, rewards and a paid subscription.

HOW CHILDREN USE MIBO
Children never sign in and have no account (they are not users of any identity provider). A child's side runs on a second device that is joined to one child with a short Join Code:
1. On the parent phone (signed in as above): Children tab → tap Maya or Leo → "Show join code". A six-character Join Code appears.
2. On a second device: install Mibo, choose "Kid" on the first screen, and type that code.
The second device now shows that child's chores, coins, pet and grove. Tap a chore to mark it done; the parent phone sees it on its next refresh.

If you have only one device, a screen recording of the child's side on a simulator, made from this same household, is here:
<<SCREEN_RECORDING_URL>>

LEAVING KID MODE
Kid mode has no visible way out, by design: a child must not be able to leave it. To leave it, long-press the top-right corner of the child's Today screen for two seconds and enter the Parent PIN: 1234. This PIN is the only way out of kid mode.

SUBSCRIPTION
The demo household is already premium. Premium unlocks: more than one child, more than two parents, custom rewards, full history, the money ledger and payouts, and photo proof (a chore can ask the child for a photo, which a parent approves). The child's side is never gated. Purchases use the sandbox environment and are fine to make: to see the paywall, sign in with your own Apple ID instead (Continue with Apple), create a household, and add a second child.

WHAT IS WAITING FOR YOU
In the demo household, on the parent's Today: Leo's "Water the plants" from today is done with a photo and waiting for approval, yesterday's is waiting for approval without a photo, and Maya has asked for a reward that is waiting too.

Privacy policy: https://mibokids.app/privacy · Terms: https://mibokids.app/terms
```

---

## 2. TestFlight Test Information

App Store Connect → TestFlight → Test Information.

**Feedback email:** `support@mibokids.app`

**Beta App Description:**

```
Mibo is a chores and allowance app a child actually wants to use. A parent sets up the household and the chores on their phone; the child taps each chore when it is done on their own device, earns coins, grows a pet and a grove, and spends coins on rewards the parent approves.
```

**Sign-in information** (the same account App Review uses):

- User name: `review@mibokids.app`
- Password: `<<REVIEW_SECRET>>`

**What to Test** (paste the box below):

```
Sign in: choose Parent, type review@mibokids.app, tap "Email me a code", then type the password you were given where the code would go. You land in a demo household with two children. Or sign in with your own Apple or Google account to start from nothing. Kid mode needs a second device: on the parent phone open Children → a child → Show join code, and type the Join Code on the other device after choosing "Kid". To leave kid mode, long-press the top-right corner of the child's screen for two seconds and enter the Parent PIN (1234 in the demo household).

Please check:
1. Language: More → Language, pick the other language. The app says it will apply on the next open and changes nothing yet; after closing and reopening, everything is in the new language and direction.
2. Tabs: in Hebrew, Today is the rightmost tab on both iPhone and Android, and Android's back button returns towards Today.
3. Reinstall: deleting and reinstalling the app on a kid device opens on the Parent / Kid choice, and the parent's list shows that device as no longer active.
4. Notifications: finishing setup asks whether to allow notifications; the evening summary arrives, names the child by first name only, and opens Today.
5. Rewards: on the kid device, ask for a reward you can afford (coins leave at once); approve or decline it on the parent phone and see the kid device follow. A reward you cannot afford cannot be asked for.
6. Photo proof: a chore that asks for a photo opens the camera; the chore then waits for a parent, who sees the photo and approves it. It works in airplane mode too and uploads when the network returns.
7. Allowance: the Money tab shows each child's balance and history; recording a payout lowers the balance by exactly that amount, and the kid device shows the same number.
8. The next morning: yesterday's undone chore shows as missed, not carried over; that child's streak is back to 0.
9. Sign-in: Apple, Google and email code all complete, and you stay signed in after closing the app.
10. Partner: invite a second parent by email from the household; they sign in on another phone, land in the same household, and see the same subscription.

Feedback and screenshots: use TestFlight's "Send Beta Feedback", or write to support@mibokids.app.
```

---

## The screen recording

App Review accepts a demo video for a reviewer with one device. Record it on a simulator from a
freshly seeded household, then put the link where `<<SCREEN_RECORDING_URL>>` stands above (an
unlisted video or a shared file link that needs no sign-in):

1. `pnpm --filter api seed:review`.
2. Simulator A signed in as the review account: Children → Leo → Show join code.
3. Simulator B: Kid → the Join Code. Show Today, mark a chore done (coins and the pet react), the
   Shop and a reward request, the grove. (A simulator has no camera; the photo proof already
   waiting on A's Today stands in for that step.)
4. Back on A: the new request and the two waiting photo chores are on Today; approve them.
5. On B: long-press the top-right corner for two seconds, enter `1234`, and leave kid mode.
