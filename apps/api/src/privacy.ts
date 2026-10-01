import { Hono } from 'hono';

/**
 * The public privacy policy. App Review requires a permanent URL for a child-directed app, and
 * COPPA requires the disclosure to be reachable by a parent who has not installed anything — so it
 * is served by the API rather than shipped in the bundle, with no auth, no database read and no
 * dependency on a store release to correct a sentence.
 *
 * It is a restatement of decisions already made, not a new one: children have no accounts
 * (ADR-0001), they are anonymous per device in analytics (ADR-0009), crash reports are rebuilt from
 * an allowlist (ADR-0015), and Photo Proof lives in a private bucket for 30 days (ADR-0017). If an
 * ADR changes, this page is part of the change.
 */

/** Where a parent's access or deletion request goes. `privacy.test.ts` asserts it literally. */
const PRIVACY_CONTACT_EMAIL = 'nadavg1000@gmail.com';

/** The date the text below last changed. A policy without one cannot be reviewed. */
const PRIVACY_LAST_UPDATED = '1 October 2026';

const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mibo — Privacy Policy</title>
<style>
  :root { color-scheme: light dark; }
  body {
    max-width: 44rem;
    margin: 0 auto;
    padding: 2rem 1rem 6rem;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2.25rem; }
  .updated { opacity: 0.7; font-size: 0.9rem; }
  ul { padding-left: 1.25rem; }
  li { margin: 0.35rem 0; }
  code { font-size: 0.9em; }
</style>
</head>
<body>
<h1>Mibo — Privacy Policy</h1>
<p class="updated">Last updated ${PRIVACY_LAST_UPDATED}. Applies to the Mibo app
(<code>com.mibokids.app</code>) and to the Mibo API.</p>

<p>Mibo is a chores and allowance app used by a parent and by their children. It is directed to
children, so it is written to comply with the Children’s Online Privacy Protection Act (COPPA) and
with Apple’s and Google’s rules for apps children use. The short version: a child using Mibo has no
account, gives us no contact details, and is anonymous in everything we measure.</p>

<h2>What a parent should know in one minute</h2>
<ul>
  <li>Children do not have accounts. A child never signs in, and has no email, no password, no
  phone number and no location in Mibo.</li>
  <li>Children are anonymous in our analytics. Nothing we measure is tied to a child’s name,
  identity or device owner.</li>
  <li>A photo a child takes as proof of a chore is private to that child’s own household and is
  deleted after 30 days.</li>
  <li>Crash reports are built from a fixed list of allowed technical fields and carry no child
  identifier.</li>
  <li>A parent can revoke a child’s device at any time, and can delete their account — and with
  it, as the household’s last parent, the household and everything in it — from the app or from
  <a href="/delete-account">mibokids.app/delete-account</a>.</li>
  <li>We do not sell personal information, we show no ads, and we do not track anyone across other
  apps or websites.</li>
</ul>

<h2>Children have no accounts</h2>
<p>A parent creates the child’s profile in the app, and a child’s phone or tablet joins the
household by entering a short Join Code the parent generates. There is no sign-up, no identity
provider and no credential belonging to a child. Because of that, the only things stored about a
child are the ones a parent typed or the child’s own use of the app produced:</p>
<ul>
  <li>a first name, and a pet name the parent chooses and the child may change;</li>
  <li>which of the two age-appropriate interface modes the child uses, and an optional time of
  day for a chore reminder;</li>
  <li>the chores, completions, coin ledger entries, rewards, redemptions and the grove that make
  up the child’s history in the app;</li>
  <li>the child device’s platform and language, a hashed device token, and — only if notifications
  are allowed — a push token issued by Expo’s push service.</li>
</ul>
<p>We do not ask a child for, and do not collect, an email address, a password, a birthday, a
precise or coarse location, a phone number, contacts, photos from the camera roll, biometrics or
anything else that would identify a child outside their own family’s household.</p>

<h2>Parental consent and parental control</h2>
<p>A household exists only after a parent signs in, and a child’s device gets access only through a
Join Code that a signed-in parent created. Parent mode is protected by a PIN so a child’s device
cannot reach it. A parent can, at any time, revoke a child’s device — which immediately and permanently ends
that device’s access, and the anonymous analytics identifier it was using is never used again — delete chores and
rewards, or delete the household outright.</p>

<h2>Analytics</h2>
<p>We use PostHog, hosted in the European Union, to count how the app is used. In parent mode the
signed-in parent is identified by their account id and grouped by household. On a child’s device
analytics is anonymous: the device is given a random identifier at the moment the Join Code is
redeemed, that per-device identifier is retired when a parent revokes the
device — a device that joins again is given a new one, and the two cannot be connected, and the only
properties attached to it are the interface mode, a broad age band and a one-way hash of the
household id. A child’s id, first name and pet name are never sent. Automatic event capture and
session replay are switched off everywhere in the app.</p>

<h2>Photo proof of a chore</h2>
<p>A chore may ask a child to take a photo as proof. The image is uploaded straight to a private
Cloudflare R2 bucket that is not publicly readable; only the object’s key is stored next to the
completion. A parent in the same household can view it through a link that expires after five
minutes, and the bucket deletes every such object after 30 days. The image is never shared outside
that household, is never sent to another child’s device, and is never used for advertising,
training or any purpose other than showing that parent the chore was done.</p>

<h2>Crash reports and diagnostics</h2>
<p>The app reports crashes and errors to Sentry so they can be fixed. Every report the app itself
sends is rebuilt from an allowlist of known technical fields — an error type, a status code, a route
whose variable parts are replaced by <code>*</code>, the app version and the platform — rather than
by removing the fields we happened to think of. A crash severe enough to stop the app is written to
disk and sent by Sentry’s own native code before ours can rebuild it; that report carries a stack
trace and device information and nothing of ours, because the settings that would attach personal
information or a screenshot of the screen are switched off. A child’s device sets no user identity in Sentry at all; the only properties it
reports about itself are the same three analytics already allows: interface mode, age band and the
hashed household id. Screenshots and session replay are off. Console logs are dropped rather than
attached. A parent is identified only by their account id.</p>

<h2>What we store about a parent</h2>
<ul>
  <li><strong>Account.</strong> Parents sign in with Apple, with Google or with an email address
  through our authentication provider, Clerk. We keep the account id, the email address and the
  display name the provider gives us. We never receive a password.</li>
  <li><strong>Subscription.</strong> Purchases are processed by Apple or Google and their status is
  relayed to us by RevenueCat. We store whether the household has an active subscription, which
  product it is and when it renews or expires, together with the purchase messages RevenueCat sends
  us, as we received them. We never see card or bank details.</li>
  <li><strong>A second parent.</strong> A parent may invite a partner by email address. We store
  that address so the invitation can be matched when that person signs in.</li>
  <li><strong>Notifications.</strong> If a parent allows them, we store a push token from Expo’s
  push service for that parent’s device.</li>
</ul>

<h2>Notifications</h2>
<p>Mibo sends exactly four kinds of notification: an optional reminder to a child, an evening
summary to a parent, a notice that a child has asked to redeem a reward, and a notice that a parent
approved one. A child’s notifications name nobody. A parent’s evening summary does name their own
children by first name, because a summary that named nobody would be unreadable in a household with
more than one child; that is the only place a child’s first name leaves our servers, it goes only to
a device registered by a parent of that same household, and it never includes a pet name, a chore
title or a reward title.</p>

<h2>Who we share data with</h2>
<p>We do not sell personal information and we do not share it for advertising. Mibo contains no ads
and no advertising or tracking SDKs, and we do not track users across other companies’ apps or
websites. Data is processed on our behalf only by the service providers named above — Clerk
(accounts), Railway (application hosting and the database), Cloudflare R2 (photo storage), PostHog
in the EU (analytics), Sentry (crash reports), RevenueCat with Apple and Google (subscriptions) and
Expo (push delivery) — each limited to what is described here. We may also disclose information if
the law requires it.</p>

<h2>How long we keep things</h2>
<p>Photo proof is deleted after 30 days. Chores, completions, coins and the grove are kept while
the household exists, because they are the child’s history in the app and the app would be wrong
without them. Account and subscription records are kept while the account exists.</p>

<h2>Deleting an account</h2>
<p>A parent can delete their account at any time, in the app under <strong>More</strong> →
<strong>Delete my account</strong>, or, without the app, by the request described at
<a href="/delete-account">mibokids.app/delete-account</a>. Deletion is immediate and permanent. If
another parent remains in the household, only the deleting parent’s account, sign-in and phone
registration go. If they are the household’s last parent, we delete the household and everything
in it: every child’s profile and history, every child device’s access and every photo proof.
Nothing is retained. Deleting an account does not cancel a subscription, which is cancelled in
Google Play or the App Store.</p>

<h2>A parent’s rights</h2>
<p>A parent may ask to see what we hold about their household or their child, ask us to correct it,
ask us to delete it, or refuse any further collection about their child by deleting the household —
in which case the child’s data goes with it. Deleting is self-serve in the app; for anything else,
write to
<a href="mailto:${PRIVACY_CONTACT_EMAIL}">${PRIVACY_CONTACT_EMAIL}</a> from the address the parent
account uses and we will act within 30 days.</p>

<h2>Changes to this policy</h2>
<p>If this policy changes we will update the date at the top of this page. If a change affects what
we collect about a child, we will tell parents at the email address on their account before it takes
effect.</p>

<h2>Contact</h2>
<p>Mibo — <a href="mailto:${PRIVACY_CONTACT_EMAIL}">${PRIVACY_CONTACT_EMAIL}</a></p>
</body>
</html>
`;

export function privacyRoutes() {
  const app = new Hono();

  // Public by construction: it is mounted before any auth middleware and reads nothing, so a
  // reviewer with no account and a parent with no install both get the same page.
  app.get('/privacy', (c) => c.html(PRIVACY_HTML));

  return app;
}
