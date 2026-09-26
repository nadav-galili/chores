import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

/**
 * App Review reads this page, and so does a parent deciding whether to hand the app to a child.
 * The assertions are the five disclosures the milestone owes (#80), not the prose around them:
 * wording is free to improve, but a policy that stops saying a child has no account, or that the
 * photos expire, has stopped being true to the ADRs it restates.
 */
let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

/** No `Authorization` header anywhere in this file: the page is public or it is useless. */
const get = () => app.request('/privacy');

describe('GET /privacy', () => {
  it('is public HTML', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
    expect(body).toMatch(/Mibo/);
  });

  const disclosures: [string, RegExp][] = [
    ['children have no accounts (ADR-0001)', /child(ren)?[^.]{0,80}no account/i],
    ['no child email, password or location', /no email[^.]{0,120}no (password|location)/i],
    ['children are anonymous in analytics (ADR-0009)', /anonymous[^.]{0,120}analytics|analytics[^.]{0,120}anonymous/i],
    ['the analytics id is per device and retired on revoke', /per[- ]device identifier is retired/i],
    ['photo proof is deleted after 30 days (ADR-0017)', /bucket deletes every such object after 30 days/],
    ['photo proof is never shared outside the household', /never (shared|leaves)/i],
    ['crash reports are allowlisted, not scrubbed (ADR-0015)', /allowlist/i],
    ['crash reports carry no child identifier', /sets no user identity in Sentry/i],
    ['parents can revoke a kid device', /revoke/i],
    ['parents can have everything deleted', /delete the household/i],
    ['COPPA is named so a parent can search for it', /COPPA/],
    // Spelled out rather than read from `PRIVACY_CONTACT_EMAIL`: a test that imports the constant
    // passes whatever the constant says, including a typo or a placeholder nobody reads.
    ['a reachable contact for data requests', /nadavg1000@gmail\.com/],
  ];

  it.each(disclosures)('discloses %s', async (_label, pattern) => {
    expect(await (await get()).text()).toMatch(pattern);
  });

  it('never claims to sell or share child data', async () => {
    const body = await (await get()).text();
    expect(body).toMatch(/do(es)? not sell/i);
    expect(body).toMatch(/no (third-party )?(ads|advertis)/i);
  });
});
