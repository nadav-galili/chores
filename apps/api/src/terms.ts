import { Hono } from 'hono';

/**
 * The terms of service. Served by the API for the same reason the privacy policy is
 * (`privacy.ts`): a parent reading them has not installed anything, and correcting a sentence must
 * not wait for a store release. Google's OAuth consent screen links this page by absolute URL
 * (#84), so it has to answer at the apex of `mibokids.app` with no auth and no database read.
 *
 * Like the privacy policy, this is a restatement of decisions already made rather than a new one:
 * children have no accounts (ADR-0001), premium gates the parent's side only (ADR-0005), a
 * redemption's coins leave the ledger when the child asks (ADR-0014), and Photo Proof stops
 * existing after thirty days (ADR-0017). It also says the thing the product has always been but
 * never wrote down — the coin ledger is a record, not money, and Mibo moves none.
 */

/** Where notice under these terms goes. `terms.test.ts` asserts it literally. */
const TERMS_CONTACT_EMAIL = 'nadavg1000@gmail.com';

/** The date the text below last changed. Terms without one cannot be agreed to. */
const TERMS_LAST_UPDATED = '27 September 2026';

const TERMS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mibo — Terms of Service</title>
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
<h1>Mibo — Terms of Service</h1>
<p class="updated">Last updated ${TERMS_LAST_UPDATED}. Applies to the Mibo app
(<code>com.mibokids.app</code>) and to the Mibo API.</p>

<p>Mibo is a chores and allowance app used by a parent and by their children. These terms are the
agreement between you — the adult who creates the household — and Mibo. Using the app means you
accept them. The <a href="/privacy">Privacy Policy</a> is part of this agreement and describes what
Mibo stores; read it too, because it is the half of this document that concerns your children.</p>

<h2>Who may hold an account</h2>
<p>A Mibo household is created by a parent or legal guardian who is at least 18 years old, or the
age of majority where they live. A child has no account in Mibo: they never sign in, and their
device joins the household by entering a Join Code the parent generates. Parent mode is protected
by a PIN the parent sets. You are responsible for your account, for the PIN, for which devices you
admit to your household, and for the children you add to it.</p>

<h2>Coins are a record, not money</h2>
<p>The coins a child earns in Mibo are a record kept inside the app so a family can agree on what
was done and what it was worth. They are not money, not currency, not a stored balance and not a
claim on anyone. Mibo holds no funds, moves no money between people, issues nothing of value and is
not a bank, a payment service or a money transmitter. Whether an allowance is actually handed over,
in what form and when, is entirely a matter between a parent and their child and happens outside the
app. Mibo has no payout feature and makes no promise that one will exist.</p>
<p>Rewards work the same way: a reward is a description a parent wrote. When a child asks to redeem
one, the coins leave the child's ledger at that moment so the balance a child sees is the balance
they can spend; whether the parent then approves it and provides the thing described is the parent's
own undertaking, not Mibo's. A parent may correct a mistake, which appends a Clawback to the
ledger rather than rewriting it.</p>

<h2>Subscriptions</h2>
<p>Some parent-side features require Mibo Premium. It is sold as an auto-renewing subscription
through the Apple App Store or Google Play, never directly by us:</p>
<ul>
  <li>The price and the billing period are the ones shown to you at purchase, in your own
  currency, by Apple or by Google.</li>
  <li>A subscription renews automatically at the end of each period. To stop it, cancel it in the
  App Store or Google Play subscription settings on the account that bought it, at least 24 hours
  before it renews — not by writing to us, because we cannot cancel it for you.</li>
  <li>Refunds are Apple's and Google's to give under their own terms. Mibo never receives your
  payment details and cannot refund a charge it did not take.</li>
  <li>If a subscription lapses, the parent-side features it unlocked stop. Nothing a child earned
  is taken away: a child's side of Mibo is never gated, paywalled or locked behind a
  subscription, and the chores, coins, rewards and grove already recorded stay exactly as they
  are.</li>
</ul>

<h2>What you may not do</h2>
<ul>
  <li>Use Mibo to mistreat, coerce or punish a child, or to record anything about a child that is
  not theirs to have recorded.</li>
  <li>Add a child to a household when you are not that child's parent or guardian, or admit a
  device you do not control.</li>
  <li>Attack, overload, probe or reverse-engineer the service, or use it through anything other
  than the app.</li>
  <li>Resell, sublicense or rent Mibo, or use it to build a competing service.</li>
</ul>

<h2>What you and your children put into Mibo</h2>
<p>The chore titles, reward titles, first names, pet names and photos in your household stay yours.
You give Mibo only the permission it needs to run the app for you: to store that content, to sync it
between the devices in your own household, and to back it up. Nothing in your household is shown to
another household, sold, used for advertising or used to train anything. A photo a child takes as
proof of a chore is private to that household and is deleted after 30 days.</p>
<p>You confirm that you have the right to put into Mibo what you put into it, including any photo of
a child.</p>

<h2>Stopping, and deletion</h2>
<p>You may stop using Mibo whenever you like. A parent can revoke a child's device at any time, and
can ask us to delete the household — which deletes the children in it and everything recorded about
them, and cannot be undone. Cancelling a subscription is a separate act, done at the store, and does
not delete anything by itself.</p>
<p>We may suspend or end access to an account that breaches these terms, that is being used to harm
a child, or that we are required to act on by law. Where it is possible to warn you first, we will.</p>

<h2>Changes to the app and to these terms</h2>
<p>Mibo is under active development and its features will change. We may add, alter or withdraw a
feature, and we may change these terms; the date at the top of this page says when they last
changed. If a change materially reduces what a paid subscription provides, or materially alters your
rights, we will tell you at the email address on your account before it takes effect, and continuing
to use Mibo afterwards is how you accept it. If you do not accept it, cancel and stop using
the app.</p>

<h2>No warranty</h2>
<p>Mibo is provided as it is. We do not promise that it will be available without interruption,
free of defects, or that a reminder or notification will always arrive on time — so do not rely on
Mibo as the only record of something that matters, and do not rely on it for anything a family
cannot afford to lose. To the extent the law allows, we disclaim all warranties that are not
written here.</p>

<h2>Limits on liability</h2>
<p>To the extent the law allows, Mibo is not liable for indirect, incidental or consequential loss,
for lost data, or for a disagreement between a parent and a child about chores, coins or an
allowance. Our total liability for any claim under these terms is limited to the amount you paid for
Mibo in the twelve months before the claim, or, if you paid nothing, to nothing. Nothing here limits
liability that cannot be limited by law.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of the State of Israel, and the competent courts of
Tel Aviv-Yafo have exclusive jurisdiction over any dispute arising from them. If a mandatory
consumer-protection law where you live gives you a right this paragraph would take away, that law
applies instead.</p>

<h2>Contact</h2>
<p>Mibo — <a href="mailto:${TERMS_CONTACT_EMAIL}">${TERMS_CONTACT_EMAIL}</a>. Notice under these
terms may be sent to that address, and we will send notice to the email address on your account.</p>
</body>
</html>
`;

export function termsRoutes() {
  const app = new Hono();

  // Public by construction, like `/privacy`: mounted before any auth middleware, reads nothing.
  app.get('/terms', (c) => c.html(TERMS_HTML));

  return app;
}
