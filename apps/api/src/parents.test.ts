import { beforeAll, describe, expect, it } from 'vitest';
import type { Parent } from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

/**
 * The fake Clerk user carries its email in the token, the way a Clerk session token does:
 * `user_<local>_at_<domain>` signs in as `<local>@<domain>`.
 */
const as = (local: string, domain = 'example.com') => `user_${local}_at_${domain}`;

type Me = { parent: Parent | null; household: { id: string; name: string } | null };

const me = async (clerkUserId: string) =>
  (await (await app.request('/me', asParent(clerkUserId))).json()) as Me;

async function household(clerkUserId: string, name = 'Galili') {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name, tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { household: { id: string } }).household;
}

const invite = (clerkUserId: string, householdId: string, email: string) =>
  app.request(
    `/households/${householdId}/parents`,
    asParent(clerkUserId, { method: 'POST', body: JSON.stringify({ email }) }),
  );

describe('add partner by email', () => {
  it('lets the invited partner into the same household on their first sign-in', async () => {
    const owner = as('avi');
    const h = await household(owner);
    const res = await invite(owner, h.id, 'Dana@Example.com');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email: 'dana@example.com', accepted_at: null });

    // The partner has never signed in before: /me creates their parent row from the invite.
    const partner = await me(as('dana'));
    expect(partner.household?.id).toBe(h.id);
    expect(partner.parent?.household_id).toBe(h.id);

    // Both parents are now listed, and the invite is spent.
    const list = (await (
      await app.request(`/households/${h.id}/parents`, asParent(owner))
    ).json()) as { parents: Parent[]; invites: { email: string; accepted_at: string | null }[] };
    expect(list.parents).toHaveLength(2);
    expect(list.invites[0]?.accepted_at).not.toBeNull();

    // The partner administers the household like any parent.
    const children = await app.request(`/households/${h.id}/children`, asParent(as('dana')));
    expect(children.status).toBe(200);
  });

  it('refuses a third parent on the free tier', async () => {
    const owner = as('gil');
    const h = await household(owner, 'Cohen');
    expect((await invite(owner, h.id, 'lior@example.com')).status).toBe(201);
    await me(as('lior'));

    const third = await invite(owner, h.id, 'noam@example.com');
    expect(third.status).toBe(402);
    expect(await third.json()).toEqual({ error: 'gated', gate: 'parent_quota' });
  });

  it('counts a pending invite against the quota, and is idempotent for the same email', async () => {
    const owner = as('ron');
    const h = await household(owner, 'Levi');
    expect((await invite(owner, h.id, 'tal@example.com')).status).toBe(201);
    // Re-inviting the same address is the same one invite, not a second seat.
    expect((await invite(owner, h.id, 'TAL@example.com')).status).toBe(201);
    expect((await invite(owner, h.id, 'other@example.com')).status).toBe(402);
  });

  it('does not let an uninvited user in, and keeps them out of the household', async () => {
    const owner = as('yael');
    const h = await household(owner, 'Bar');
    expect(await me(as('stranger'))).toEqual({ parent: null, household: null, children: [] });
    expect(
      (await app.request(`/households/${h.id}/children`, asParent(as('stranger')))).status,
    ).toBe(404);
  });

  it('refuses an invite from someone outside the household, and one to a parent already placed', async () => {
    const owner = as('maya');
    const h = await household(owner, 'Shani');
    expect((await invite(as('outsider'), h.id, 'x@example.com')).status).toBe(404);

    const other = as('eitan');
    await household(other, 'Peretz');
    const taken = await invite(owner, h.id, 'eitan@example.com');
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'already_in_household' });
  });
});
