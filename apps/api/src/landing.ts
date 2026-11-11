import { readFileSync } from 'node:fs';
import { APP_STORE_URL } from '@chores/shared';
import { Hono } from 'hono';

/**
 * The apex of `mibokids.app`, which since #84 is the API's own hostname. Four audiences arrive
 * here with no account and no install: Google's OAuth consent screen links it as the application
 * home page (and refuses a link whose domain it cannot verify, which is why the apex is ours at
 * all), App Review trims the privacy URL to see what is behind it, a parent does the same, and a
 * parent follows a link from a post. A 404 reads as an abandoned app to all four.
 *
 * It is the page a post links to: what the app does, in the words of the store listing
 * (`docs/store/listing.md`), and one button to the App Store. English at `/`, Hebrew at `/he`.
 * The copy is parent-facing, as the listing is (ADR-0018).
 *
 * The page sends nothing to a third party: no script, no cookie, no font from another host. A
 * link measures its source with Apple's campaign token, which Apple counts and this server never
 * sees: `/?c=<name>` puts `<name>` on the App Store link.
 */

/** Same address as the privacy policy and the terms: one place a parent can write to. */
const CONTACT_EMAIL = 'nadavg1000@gmail.com';

/** The public origin: a link preview needs an absolute URL for its image. */
const SITE = 'https://mibokids.app';

/** The numeric app id, read from the one place that holds the App Store link. */
const APP_STORE_ID = APP_STORE_URL.slice(APP_STORE_URL.lastIndexOf('/id') + 3);

/**
 * The provider id of the developer account, from the campaign link generator of App Store Connect.
 * Apple counts a campaign only when the link has it. It is public: it is in every campaign link.
 */
const APP_STORE_PROVIDER_ID = '128262932';

/** The campaign of a visitor who came with no `?c=`. */
const DEFAULT_CAMPAIGN = 'site';

/**
 * A campaign name as Apple accepts it: 30 characters at most. Only these characters go into the
 * page, so a `?c=` value can never carry markup.
 */
const CAMPAIGN = /^[A-Za-z0-9_-]{1,30}$/;

export function campaignToken(raw: string | undefined): string {
  return raw !== undefined && CAMPAIGN.test(raw) ? raw : DEFAULT_CAMPAIGN;
}

/** The App Store link that Apple counts under this campaign (App Analytics, Campaigns). */
export function appStoreCampaignUrl(campaign: string): string {
  return `${APP_STORE_URL}?pt=${APP_STORE_PROVIDER_ID}&ct=${campaign}&mt=8`;
}

type Lang = 'en' | 'he';

type Section = { title: string; bullets?: readonly string[]; text?: string };

type Copy = {
  dir: 'ltr' | 'rtl';
  path: string;
  ogLocale: string;
  title: string;
  headline: string;
  lead: string;
  cta: string;
  androidNote: string;
  shots: readonly [string, string, string];
  sections: readonly Section[];
  privacy: string;
  terms: string;
  other: { lang: Lang; label: string };
};

/**
 * The words are the store listing's own (`docs/store/listing.md`, `docs/spec/05-store-listing.md`):
 * a change of the listing is a change here.
 */
const COPY: Record<Lang, Copy> = {
  en: {
    dir: 'ltr',
    path: '/',
    ogLocale: 'en_US',
    title: 'Mibo: Chores Tracker',
    headline: 'Chores get done. No nagging.',
    lead: 'Chores, coins and a pet that cheers them on. Each child ticks off their own list on their own device, even offline, and you get one summary of the day each evening.',
    cta: 'Download on the App Store',
    androidNote: 'Android version coming soon.',
    shots: [
      'The list of chores of a child',
      'A parent approves a photo of a finished chore',
      'The pet that cheers the child on',
    ],
    sections: [
      {
        title: 'For the parent who runs the house',
        bullets: [
          'Daily chores, chores on chosen weekdays, or one-off chores — for one child or several',
          "One evening summary of the day, while there is still time to finish what's left, instead of a notification for every chore",
          "A chore marked done that wasn't? Reject it: it comes back as a redo, and the coins it earned go back too",
        ],
      },
      {
        title: 'What your child sees',
        bullets: [
          'Coins for every chore, a daily bonus when the whole list is done, and a streak that grows',
          'A pet whose mood follows today and whose level follows the effort over time',
          'A reward shop to spend coins in — pick a snack, 30 minutes of screen time, pick Friday dinner, or rewards you create',
        ],
      },
      {
        title: 'Allowance without the arguments',
        text: 'Set what a coin is worth, see what each child is owed, and record payouts and adjustments. No money moves through Mibo: it keeps the ledger, and you hand over the pocket money.',
      },
      {
        title: 'Private by design',
        text: "Children have no account, no email address and no password. A parent adds a child by first name and connects the child's device with a one-time join code. Mibo shows no ads and contains no advertising or tracking SDK. Parents sign in with Apple, with Google or with email.",
      },
      {
        title: 'Free and Premium',
        text: "Free: one child, two parents, unlimited chores, the pet, the built-in rewards and seven days of history. Mibo Premium adds more children, a third parent, your own rewards, the allowance ledger and payouts, full history and photo proof — for the whole household. A child's side of the app is never behind a paywall.",
      },
    ],
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    other: { lang: 'he', label: 'עברית' },
  },
  he: {
    dir: 'rtl',
    path: '/he',
    ogLocale: 'he_IL',
    title: 'Mibo: מטלות בית, לוח משימות',
    headline: 'מטלות, מטבעות וחיה שמעודדת אותם.',
    lead: 'כל ילד מסמן את הרשימה שלו במכשיר שלו, גם בלי אינטרנט, ואתם מקבלים סיכום אחד של היום בכל ערב.',
    cta: 'להורדה מ־App Store',
    androidNote: 'בקרוב גם ב־Android.',
    shots: ['רשימת המטלות של הילד', 'הורה מאשר תמונה של מטלה שהושלמה', 'החיה שמעודדת את הילד'],
    sections: [
      {
        title: 'להורים שמנהלים את הבית',
        bullets: [
          'מטלות לכל יום, לימים מסוימים או לפעם אחת — לילד אחד או לכמה ילדים',
          'סיכום ערב אחד על היום, כשעוד יש זמן לסיים את מה שנשאר, במקום התראה על כל מטלה',
          'מטלה סומנה אבל לא באמת בוצעה? דוחים אותה: היא חוזרת לביצוע חוזר, והמטבעות שהרוויחה חוזרים איתה',
        ],
      },
      {
        title: 'מה הילדים רואים',
        bullets: [
          'מטבעות על כל מטלה, בונוס כשכל הרשימה הושלמה, ורצף ימים שהולך וגדל',
          'חיה שמצב הרוח שלה תלוי במה שנעשה היום, והרמה שלה במאמץ לאורך זמן',
          'חנות פרסים להוציא בה את המטבעות — לבחור חטיף, 30 דקות מסך, לבחור ארוחת שישי, או פרסים שאתם יוצרים',
        ],
      },
      {
        title: 'דמי כיס בלי ויכוחים',
        text: 'קובעים כמה שווה מטבע, רואים כמה מגיע לכל ילד, ורושמים תשלומים והתאמות. שום כסף לא עובר דרך Mibo: היא מנהלת את החשבון, ואתם נותנים את דמי הכיס.',
      },
      {
        title: 'פרטיות מהיסוד',
        text: 'לילדים אין חשבון, אין אימייל ואין סיסמה. הורה מוסיף ילד לפי שם פרטי ומחבר את המכשיר שלו בקוד הצטרפות חד־פעמי. ב־Mibo אין פרסומות, ואין בה רכיבי פרסום או מעקב. הורים נכנסים עם Apple, עם Google או עם אימייל.',
      },
      {
        title: 'חינם ו־Premium',
        text: 'בחינם: ילד אחד, שני הורים, מטלות ללא הגבלה, החיה, הפרסים המובנים ושבעה ימי היסטוריה. Mibo Premium מוסיף עוד ילדים, הורה שלישי, פרסים משלכם, דמי כיס ותשלומים, היסטוריה מלאה ודרישת תמונה — לכל משק הבית. הצד של הילד באפליקציה אף פעם לא נעול.',
      },
    ],
    privacy: 'מדיניות פרטיות',
    terms: 'תנאי שימוש',
    other: { lang: 'en', label: 'English' },
  },
};

/** The files of the page, read once at start. The name is the allowlist: nothing else is served. */
const ASSET_TYPES = {
  'icon.png': 'image/png',
  'hero.webp': 'image/webp',
  'approve.webp': 'image/webp',
  'pet.webp': 'image/webp',
  'og.jpg': 'image/jpeg',
} as const;

type AssetName = keyof typeof ASSET_TYPES;

const ASSETS = new Map(
  (Object.keys(ASSET_TYPES) as AssetName[]).map((name) => [
    name,
    new Uint8Array(readFileSync(new URL(`../assets/landing/${name}`, import.meta.url))),
  ]),
);

const isAsset = (name: string): name is AssetName => name in ASSET_TYPES;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
  :root { --ground: #F2F6F1; --surface: #FFFFFF; --action: #2F6B4F; --text: #1B2A22; --muted: #5F7168; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--text);
    font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  a { color: var(--action); }
  .wrap { max-width: 60rem; margin: 0 auto; padding: 0 1.25rem; }
  header { display: flex; align-items: center; justify-content: space-between; padding-block: 1.25rem; }
  .brand { display: flex; align-items: center; gap: 0.75rem; font-weight: 700; font-size: 1.35rem; }
  .brand img { width: 44px; height: 44px; border-radius: 10px; }
  .hero { text-align: center; padding-block: 2rem 1rem; }
  h1 { font-size: clamp(2rem, 6vw, 3.25rem); line-height: 1.1; margin: 0 0 1rem; letter-spacing: -0.02em; }
  .lead { font-size: 1.15rem; color: var(--muted); max-width: 38rem; margin: 0 auto 1.75rem; }
  .cta {
    display: inline-block;
    background: var(--action);
    color: #FFFFFF;
    text-decoration: none;
    font-weight: 600;
    font-size: 1.1rem;
    padding: 0.9rem 1.75rem;
    border-radius: 999px;
  }
  .note { color: var(--muted); font-size: 0.95rem; margin: 0.75rem 0 0; }
  .shots {
    display: flex;
    gap: 1rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding: 1.5rem 1.25rem;
    justify-content: safe center;
  }
  .shots img {
    flex: none;
    width: min(70vw, 270px);
    height: auto;
    border-radius: 24px;
    scroll-snap-align: center;
    box-shadow: 0 8px 30px rgba(27, 42, 34, 0.12);
  }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); padding-block: 1.5rem; }
  .card { background: var(--surface); border-radius: 16px; padding: 1.5rem; }
  .card h2 { font-size: 1.2rem; margin: 0 0 0.75rem; }
  .card ul { margin: 0; padding-inline-start: 1.2rem; }
  .card li { margin-block: 0.4rem; }
  .card p { margin: 0; }
  .again { text-align: center; padding-block: 2rem 3rem; }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    border-top: 1px solid rgba(27, 42, 34, 0.1);
    padding-block: 1.5rem 3rem;
    color: var(--muted);
    font-size: 0.95rem;
  }
`;

function section(s: Section): string {
  const body = s.bullets
    ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : `<p>${escapeHtml(s.text ?? '')}</p>`;
  return `<section class="card"><h2>${escapeHtml(s.title)}</h2>${body}</section>`;
}

export function landingHtml(lang: Lang, campaign: string): string {
  const copy = COPY[lang];
  const store = escapeHtml(appStoreCampaignUrl(campaign));
  // A visitor who changes the language is still the visitor of the same post.
  const keep = campaign === DEFAULT_CAMPAIGN ? '' : `?c=${campaign}`;
  const shots = (['hero', 'approve', 'pet'] as const)
    .map(
      (name, i) =>
        `<img src="/landing/${name}.webp" width="540" height="1173" alt="${escapeHtml(copy.shots[i] ?? '')}"${i === 0 ? '' : ' loading="lazy"'} />`,
    )
    .join('\n  ');
  const cta = `<a class="cta" href="${store}">${escapeHtml(copy.cta)}</a>`;
  return `<!doctype html>
<html lang="${lang}" dir="${copy.dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.title)}</title>
<meta name="description" content="${escapeHtml(copy.lead)}" />
<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, affiliate-data=pt=${APP_STORE_PROVIDER_ID}&amp;ct=${campaign}" />
<link rel="canonical" href="${SITE}${copy.path}" />
<link rel="alternate" hreflang="en" href="${SITE}${COPY.en.path}" />
<link rel="alternate" hreflang="he" href="${SITE}${COPY.he.path}" />
<link rel="icon" href="/landing/icon.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Mibo" />
<meta property="og:locale" content="${copy.ogLocale}" />
<meta property="og:url" content="${SITE}${copy.path}" />
<meta property="og:title" content="${escapeHtml(copy.title)}" />
<meta property="og:description" content="${escapeHtml(copy.headline)}" />
<meta property="og:image" content="${SITE}/landing/og.jpg" />
<meta property="og:image:width" content="1024" />
<meta property="og:image:height" content="500" />
<meta name="twitter:card" content="summary_large_image" />
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand"><img src="/landing/icon.png" width="44" height="44" alt="" />Mibo</div>
  <a href="${COPY[copy.other.lang].path}${keep}" lang="${copy.other.lang}">${escapeHtml(copy.other.label)}</a>
</header>
<main>
<div class="hero">
  <h1>${escapeHtml(copy.headline)}</h1>
  <p class="lead">${escapeHtml(copy.lead)}</p>
  ${cta}
  <p class="note">${escapeHtml(copy.androidNote)}</p>
</div>
</main>
</div>
<div class="shots">
  ${shots}
</div>
<div class="wrap">
<div class="grid">
${copy.sections.map(section).join('\n')}
</div>
<div class="again">${cta}</div>
<footer>
  <a href="/privacy">${escapeHtml(copy.privacy)}</a>
  <a href="/terms">${escapeHtml(copy.terms)}</a>
  <span>Mibo — <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></span>
</footer>
</div>
</body>
</html>
`;
}

export function landingRoutes() {
  const app = new Hono();

  // Public by construction, like `/privacy` and `/terms`: mounted before any auth middleware.
  app.get('/', (c) => c.html(landingHtml('en', campaignToken(c.req.query('c')))));
  app.get('/he', (c) => c.html(landingHtml('he', campaignToken(c.req.query('c')))));

  app.get('/landing/:file', (c) => {
    const name = c.req.param('file');
    const bytes = isAsset(name) ? ASSETS.get(name) : undefined;
    if (!isAsset(name) || !bytes) return c.notFound();
    return c.body(bytes, 200, {
      'content-type': ASSET_TYPES[name],
      // The files change only with a deploy, and a post is opened many times in its first day.
      'cache-control': 'public, max-age=86400',
    });
  });

  return app;
}
