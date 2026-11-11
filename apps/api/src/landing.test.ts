import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

/**
 * `/` is the apex of `mibokids.app`, which since #84 is also the API's hostname. Four audiences
 * reach it and none of them have an account: Google's OAuth consent screen links it as the
 * application home page, App Review trims the privacy URL to see what is there, a parent does the
 * same, and a parent follows a link from a post. A 404 reads as an abandoned app to all four, so
 * the apex answers.
 *
 * It is the page a post links to: what the app does, one button to the App Store, and the two
 * documents. English at `/`, Hebrew at `/he`.
 */
let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

const get = () => app.request('/');

describe('GET /', () => {
  it('is public HTML, not a 404', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/^<!doctype html>/i);
  });

  it('says which app this is', async () => {
    expect(await (await get()).text()).toMatch(/Mibo/);
  });

  it('links both documents the consent screen also links', async () => {
    const body = await (await get()).text();
    expect(body).toMatch(/href="\/privacy"/);
    expect(body).toMatch(/href="\/terms"/);
  });

  it('offers a way to reach a human', async () => {
    expect(await (await get()).text()).toMatch(/nadavg1000@gmail\.com/);
  });

  it('does not name children as the audience (ADR-0018)', async () => {
    for (const path of ['/', '/he']) {
      const body = await (await app.request(path)).text();
      expect(body).not.toMatch(/for kids/i);
      expect(body).not.toMatch(/לילדים<|אפליקציה לילדים/);
    }
  });

  it('sends nothing to a third party: no script and no file from another host', async () => {
    for (const path of ['/', '/he']) {
      const body = await (await app.request(path)).text();
      expect(body).not.toMatch(/<script/i);
      expect(body).not.toMatch(/(src|href)="https?:\/\/(?!apps\.apple\.com|mibokids\.app)/);
    }
  });

  it('does not shadow the API', async () => {
    // Mounting a route at `/` is the one change that can swallow the rest of the app, and
    // `/health` is what `scripts/check-deploy.sh` asks. So it is asserted from here too.
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('the App Store link', () => {
  const STORE = 'https://apps.apple.com/app/id6812645404?pt=128262932&amp;ct=';

  it('is counted under the campaign `site` for a visitor with no campaign', async () => {
    const body = await (await get()).text();
    expect(body).toContain(`href="${STORE}site&amp;mt=8"`);
    expect(body).toContain('affiliate-data=pt=128262932&amp;ct=site');
  });

  it('is counted under the campaign that the link of the post names', async () => {
    const body = await (await app.request('/?c=facebook-il_1')).text();
    expect(body).toContain(`href="${STORE}facebook-il_1&amp;mt=8"`);
    expect(body).toContain('affiliate-data=pt=128262932&amp;ct=facebook-il_1');
  });

  it('never puts a campaign that is not a plain name into the page', async () => {
    for (const bad of ['"><script>alert(1)</script>', 'a b', 'x'.repeat(31), '']) {
      const body = await (await app.request(`/?c=${encodeURIComponent(bad)}`)).text();
      expect(body).toContain(`href="${STORE}site&amp;mt=8"`);
      expect(body).not.toContain('<script');
    }
  });
});

describe('GET /he', () => {
  const getHe = (query = '') => app.request(`/he${query}`);

  it('is the same page in Hebrew, right to left', async () => {
    const res = await getHe();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<html lang="he" dir="rtl">/);
    expect(body).toContain('<title>Mibo: מטלות בית, לוח משימות</title>');
    expect(body).toMatch(/href="\/privacy"/);
    expect(body).toMatch(/href="\/terms"/);
  });

  it('keeps the campaign when the visitor changes the language', async () => {
    expect(await (await getHe('?c=whatsapp')).text()).toContain('href="/?c=whatsapp"');
    expect(await (await app.request('/?c=whatsapp')).text()).toContain('href="/he?c=whatsapp"');
    expect(await (await get()).text()).toContain('href="/he"');
  });

  it('names each language to a search engine', async () => {
    const body = await (await getHe()).text();
    expect(body).toContain('<link rel="canonical" href="https://mibokids.app/he" />');
    expect(body).toContain('hreflang="en" href="https://mibokids.app/"');
  });
});

describe('GET /landing/:file', () => {
  it('serves each image that the page names', async () => {
    const body = await (await get()).text();
    const names = [...body.matchAll(/"(?:https:\/\/mibokids\.app)?\/landing\/([a-z.]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(names)).toEqual(
      new Set(['icon.png', 'hero.webp', 'approve.webp', 'pet.webp', 'og.jpg']),
    );
    for (const name of new Set(names)) {
      const res = await app.request(`/landing/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^image\//);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
  });

  it('serves nothing else', async () => {
    expect((await app.request('/landing/landing.ts')).status).toBe(404);
    expect((await app.request('/landing/..%2Fsrc%2Fapp.ts')).status).toBe(404);
  });
});
