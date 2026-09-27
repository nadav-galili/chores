import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

/**
 * The terms are one of the three links on Google's OAuth consent screen (#84) and the document a
 * parent agrees to when they subscribe. As with `privacy.test.ts`, the assertions are the promises
 * the document owes rather than the prose around them — wording is free to improve, but terms that
 * stop saying the coin ledger is not money, or that a subscription is cancelled at the store, have
 * started to misdescribe the product.
 */
let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

/** No `Authorization` header anywhere in this file: a consent screen has no session. */
const get = () => app.request('/terms');

describe('GET /terms', () => {
  it('is public HTML', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
    expect(body).toMatch(/Mibo/);
  });

  it('is dated, because terms without a date cannot be agreed to', async () => {
    expect(await (await get()).text()).toMatch(/Last updated/i);
  });

  const promises: [string, RegExp][] = [
    ['the account belongs to an adult, not a child (ADR-0001)', /parent or (legal )?guardian/i],
    ['children have no accounts', /child(ren)?[^.]{0,80}no account/i],
    ['the parent is answerable for their own household', /responsib/i],
    // The single most consequential sentence in the document: Mibo records an allowance, it does
    // not move money, and no payout feature exists to imply otherwise.
    ['coins are a record and not money', /not money|no money|hold no funds|does not hold/i],
    [
      'Mibo transfers nothing and is not a payment service',
      /payment (service|institution)|transfer no|moves no money/i,
    ],
    ['subscriptions are billed by Apple or Google', /Apple|Google/],
    [
      'a subscription is cancelled at the store, not by writing to us',
      /cancel[^.]{0,120}(App Store|Google Play|store)/i,
    ],
    ['refunds belong to the store', /refund/i],
    [
      "the child's side is never paywalled (ADR-0005)",
      /child[^.]{0,120}(never|not) (paywalled|gated|locked)|free[^.]{0,80}child/i,
    ],
    ['photo proof stops existing after 30 days (ADR-0017)', /30 days/],
    ['a parent can delete the household and everything in it', /delete the household/i],
    ['the privacy policy is part of the deal', /href="\/privacy"/],
    ['a law governs it', /governed by the laws/i],
    // Spelled out rather than imported: a test that reads the constant passes a placeholder too.
    ['a reachable contact', /nadavg1000@gmail\.com/],
  ];

  it.each(promises)('promises %s', async (_label, pattern) => {
    expect(await (await get()).text()).toMatch(pattern);
  });

  it('claims no feature the app does not have', async () => {
    const body = await (await get()).text();
    // Mibo has never paid a child anything: coins are a ledger a parent settles off the app
    // (`docs/spec/05-store-listing.md` demotes "allowance" for exactly this reason). A terms
    // document that promises a payout promises a regulated service nobody built.
    expect(body).not.toMatch(/we (will )?(pay|transfer|deposit|withdraw)/i);
  });
});
