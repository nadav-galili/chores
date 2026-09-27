import { Hono } from 'hono';

/**
 * The apex of `mibokids.app`, which since #84 is the API's own hostname. Three audiences arrive
 * here with no account and no install: Google's OAuth consent screen links it as the application
 * home page (and refuses a link whose domain it cannot verify, which is why the apex is ours at
 * all), App Review trims the privacy URL to see what is behind it, and so does a parent. A 404
 * reads as an abandoned app to all three.
 *
 * It is the smallest honest page, not a marketing site: the name, one line from
 * `docs/spec/05-store-listing.md`, and the two documents a parent is entitled to read before
 * installing anything. When a real site exists it takes this hostname and the API moves to a
 * subdomain — nothing else in the app depends on this route.
 */

/** Same address as the privacy policy and the terms: one place a parent can write to. */
const CONTACT_EMAIL = 'nadavg1000@gmail.com';

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mibo: Chores Tracker</title>
<meta name="description" content="Mibo is a chores and allowance app for a parent and their children." />
<style>
  :root { color-scheme: light dark; }
  body {
    max-width: 34rem;
    margin: 0 auto;
    padding: 5rem 1rem 6rem;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  h1 { font-size: 2.25rem; margin: 0 0 0.5rem; }
  .tagline { font-size: 1.1rem; margin-top: 0; }
  nav { margin-top: 2.5rem; display: flex; flex-wrap: wrap; gap: 1.25rem; }
  footer { margin-top: 3rem; opacity: 0.7; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Mibo</h1>
<p class="tagline">A chores and allowance app for a parent and their children — the child does the
chores, keeps the coins and grows the grove on their own phone.</p>
<nav>
  <a href="/privacy">Privacy Policy</a>
  <a href="/terms">Terms of Service</a>
</nav>
<footer>
<p>Mibo — <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</footer>
</body>
</html>
`;

export function landingRoutes() {
  const app = new Hono();

  // Public by construction, like `/privacy` and `/terms`: mounted before any auth middleware.
  app.get('/', (c) => c.html(LANDING_HTML));

  return app;
}
