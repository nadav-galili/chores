import { Hono } from 'hono';

/**
 * The web half of Account Deletion (ADR-0019). Google Play requires a URL, reachable without the
 * app, that names the app and its developer, says how to delete in the app, and lets someone who
 * no longer has the app ask anyway. That request is an email handled by hand; the in-app path is
 * the self-serve one. Served like `/privacy`: no auth, no database, linked from the Play listing
 * by absolute URL, so it may not move.
 */

/** Same address as the privacy policy: one place a parent can write to. */
const CONTACT_EMAIL = 'nadavg1000@gmail.com';

/** The developer as the Play listing names them. */
const DEVELOPER_NAME = 'Nadav Galili';

const REQUEST_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  'Mibo account deletion request',
)}&body=${encodeURIComponent(
  'Please delete my Mibo account.\n\nThe email address I sign in to Mibo with: \n',
)}`;

const DELETE_ACCOUNT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mibo — Delete your account</title>
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
  .sub { opacity: 0.7; font-size: 0.9rem; }
  ol, ul { padding-left: 1.25rem; }
  li { margin: 0.35rem 0; }
  .button {
    display: inline-block;
    margin-top: 0.5rem;
    padding: 0.6rem 1rem;
    border: 1px solid currentColor;
    border-radius: 0.5rem;
    text-decoration: none;
  }
</style>
</head>
<body>
<h1>Delete your Mibo account</h1>
<p class="sub">Mibo: Chores Tracker (<code>com.mibokids.app</code>), developed by ${DEVELOPER_NAME}.</p>

<p>A parent can delete their Mibo account at any time. Children do not have accounts: a child’s
profile and history belong to their household and are deleted with it.</p>

<h2>Delete it in the app</h2>
<ol>
  <li>Open Mibo on your own phone and sign in as the parent.</li>
  <li>Go to <strong>More</strong> → <strong>Delete my account</strong>.</li>
  <li>Confirm twice. Deletion is immediate.</li>
</ol>
<p>Deleting your account does not cancel a subscription. Cancel it in Google Play or the App Store
first, or it will keep renewing.</p>

<h2>No longer have the app?</h2>
<p>Email us from the address you sign in to Mibo with, and we will delete the account by hand
within 30 days.</p>
<p><a class="button" href="${REQUEST_MAILTO}">Request deletion by email</a></p>
<p class="sub">Or write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

<h2>What is deleted</h2>
<ul>
  <li>Your parent account, your sign-in with our authentication provider, and your phone’s
  notification registration.</li>
  <li>If another parent is still in your household, only your account goes; the household and the
  children’s history stay with them.</li>
  <li>If you are the household’s last parent, the whole household is deleted with you: every child’s
  profile, chores, completions, coins, rewards, redemptions and grove, every child device’s access,
  and every photo proof.</li>
</ul>
<p>Nothing is retained. Deletion is permanent and cannot be undone; a child’s device that was
connected to a deleted household returns to its join screen.</p>

<p class="sub">See also the <a href="/privacy">privacy policy</a>.</p>
</body>
</html>
`;

export function deleteAccountRoutes() {
  const app = new Hono();
  app.get('/delete-account', (c) => c.html(DELETE_ACCOUNT_HTML));
  return app;
}
