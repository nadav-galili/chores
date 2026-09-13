import { uuid7 } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { households, ledgerEntries } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setupHousehold, syncAs } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

const request = (user: string, householdId: string, path = '', init: RequestInit = {}) =>
  app.request(`/households/${householdId}/money-ledger${path}`, asParent(user, init));

async function makePremium(user: string) {
  const fixture = await setupHousehold(app, user);
  await db
    .update(households)
    .set({ entitlement: 'premium' })
    .where(eq(households.id, fixture.householdId));
  return fixture;
}

async function earn(fixture: Awaited<ReturnType<typeof setupHousehold>>, count: number) {
  const ops = [];
  for (let i = 0; i < count; i++) {
    ops.push(completeOp(await fixture.addChore(`Money ${i}`, [fixture.noa.id])));
  }
  await syncAs(app, fixture.noa.session, ops);
}

async function balance(childId: string) {
  const rows = await db
    .select({ coins: ledgerEntries.coins })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.childId, childId));
  return rows.reduce((sum, row) => sum + row.coins, 0);
}

const post = (
  user: string,
  householdId: string,
  action: 'payout' | 'adjust',
  body: Record<string, unknown>,
) =>
  request(user, householdId, `/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('the gated money ledger', () => {
  it('refuses free households and lets premium households read it', async () => {
    const free = await setupHousehold(app, 'user_money_free');
    const refused = await request('user_money_free', free.householdId);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual({ error: 'gated', gate: 'money_ledger' });
    for (const [path, init] of [
      [
        '/payout',
        { method: 'POST', body: JSON.stringify({ id: uuid7(), child_id: free.noa.id, coins: 1 }) },
      ],
      [
        '/adjust',
        {
          method: 'POST',
          body: JSON.stringify({ id: uuid7(), child_id: free.noa.id, coins: 1, note: 'No' }),
        },
      ],
      ['', { method: 'PATCH', body: JSON.stringify({ coins_per_unit: 20 }) }],
    ] as const) {
      const response = await request('user_money_free', free.householdId, path, init);
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({ error: 'gated', gate: 'money_ledger' });
    }

    const premium = await makePremium('user_money_premium');
    const allowed = await request('user_money_premium', premium.householdId);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      currency: 'ILS',
      coins_per_unit: 10,
      children: [
        { child_id: premium.noa.id, balance: 0, owed: 0, entries: [] },
        { child_id: premium.ori.id, balance: 0, owed: 0, entries: [] },
      ],
    });
  });

  it('reads and writes the household coin-to-currency rate', async () => {
    const fixture = await makePremium('user_money_rate');
    const changed = await request('user_money_rate', fixture.householdId, '', {
      method: 'PATCH',
      body: JSON.stringify({ coins_per_unit: 25 }),
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ currency: 'ILS', coins_per_unit: 25 });

    const view = await request('user_money_rate', fixture.householdId);
    expect(await view.json()).toMatchObject({ currency: 'ILS', coins_per_unit: 25 });
  });

  it('records a payout that drops the balance by exactly the coins paid', async () => {
    const fixture = await makePremium('user_money_payout');
    await earn(fixture, 3);
    const before = await balance(fixture.noa.id);
    const id = uuid7();
    const paid = await post('user_money_payout', fixture.householdId, 'payout', {
      id,
      child_id: fixture.noa.id,
      coins: 20,
    });
    expect(paid.status).toBe(201);
    expect(await paid.json()).toMatchObject({
      id,
      child_id: fixture.noa.id,
      kind: 'payout',
      coins: -20,
      money_amount: 200,
      note: null,
      ref_type: null,
      ref_id: null,
    });

    const view = (await (await request('user_money_payout', fixture.householdId)).json()) as {
      children: { child_id: string; balance: number; owed: number; entries: unknown[] }[];
    };
    expect(view.children.find((child) => child.child_id === fixture.noa.id)).toMatchObject({
      balance: before - 20,
      owed: 200,
    });
  });

  it('refuses an over-balance payout without changing SUM(coins)', async () => {
    const fixture = await makePremium('user_money_over');
    await earn(fixture, 1);
    const before = await balance(fixture.noa.id);

    const refused = await post('user_money_over', fixture.householdId, 'payout', {
      id: uuid7(),
      child_id: fixture.noa.id,
      coins: before + 1,
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'insufficient_coins' });

    expect(await balance(fixture.noa.id)).toBe(before);
  });

  it('serializes payouts so concurrent requests cannot overdraw', async () => {
    const fixture = await makePremium('user_money_race');
    await earn(fixture, 1);
    const available = await balance(fixture.noa.id);
    const responses = await Promise.all(
      [uuid7(), uuid7()].map((id) =>
        post('user_money_race', fixture.householdId, 'payout', {
          id,
          child_id: fixture.noa.id,
          coins: available,
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    expect(await balance(fixture.noa.id)).toBe(0);
  });

  it('treats a retried client UUID as the same payout', async () => {
    const fixture = await makePremium('user_money_retry');
    await earn(fixture, 2);
    const body = { id: uuid7(), child_id: fixture.noa.id, coins: 10 };
    const first = await post('user_money_retry', fixture.householdId, 'payout', body);
    const retried = await post('user_money_retry', fixture.householdId, 'payout', body);
    expect(first.status).toBe(201);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(await first.json());
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, body.id))).toHaveLength(
      1,
    );
  });

  it('records a signed adjustment with its first-class note', async () => {
    const fixture = await makePremium('user_money_adjust');
    const id = uuid7();
    const adjusted = await post('user_money_adjust', fixture.householdId, 'adjust', {
      id,
      child_id: fixture.noa.id,
      coins: 12,
      note: 'Birthday correction',
    });
    expect(adjusted.status).toBe(201);
    expect(await adjusted.json()).toMatchObject({
      id,
      kind: 'adjust',
      coins: 12,
      money_amount: null,
      note: 'Birthday correction',
      ref_type: null,
      ref_id: null,
    });

    const retried = await post('user_money_adjust', fixture.householdId, 'adjust', {
      id,
      child_id: fixture.noa.id,
      coins: 12,
      note: 'Birthday correction',
    });
    expect(retried.status).toBe(200);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id))).toHaveLength(1);

    const view = (await (await request('user_money_adjust', fixture.householdId)).json()) as {
      children: { child_id: string; entries: { id: string; note: string | null }[] }[];
    };
    expect(
      view.children
        .find((child) => child.child_id === fixture.noa.id)
        ?.entries.find((entry) => entry.id === id)?.note,
    ).toBe('Birthday correction');
  });
});
