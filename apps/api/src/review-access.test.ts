import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { clerkSignInTokens } from './review-access.ts';
import { fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

const EMAIL = 'review@mibokids.app';
const SECRET = 'test-only-review-secret';
const CLERK_KEY = 'sk_test_review';

let db: Db;

beforeAll(async () => {
  db = await freshDb();
});

/**
 * Clerk is replaced at the HTTP boundary and nowhere else: the route and `clerkSignInTokens` run
 * as they do in production, and only the two Backend API requests are answered here, because a
 * test cannot reach Clerk's live instance. The fake answers the documented shapes of
 * `GET /v1/users?email_address=` (an array of users) and `POST /v1/sign_in_tokens`.
 */
function fakeClerk(users: Record<string, string>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${CLERK_KEY}`) {
      return Response.json({ errors: [{ code: 'authentication_invalid' }] }, { status: 401 });
    }
    if (url.pathname === '/v1/users' && (init?.method ?? 'GET') === 'GET') {
      const id = users[url.searchParams.get('email_address') ?? ''];
      return Response.json(id ? [{ id, object: 'user' }] : []);
    }
    if (url.pathname === '/v1/sign_in_tokens' && init?.method === 'POST') {
      const { user_id } = JSON.parse(String(init.body)) as { user_id: string };
      return Response.json({ object: 'sign_in_token', user_id, token: `ticket_for_${user_id}` });
    }
    return Response.json({}, { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function appWith(users: Record<string, string> = { [EMAIL]: 'user_review' }) {
  const clerk = fakeClerk(users);
  const app = createApp(db, {
    verifyToken: fakeVerifyToken,
    reviewAccess: {
      email: EMAIL,
      secret: SECRET,
      mintSignInToken: clerkSignInTokens(CLERK_KEY, clerk.fetchImpl),
    },
  });
  return { app, clerk };
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /review-access', () => {
  it('does not exist when the review variables are unset', async () => {
    const app = createApp(db, { verifyToken: fakeVerifyToken });
    const res = await app.request('/review-access', post({ email: EMAIL, secret: SECRET }));
    expect(res.status).toBe(404);
  });

  it('refuses a wrong secret without asking Clerk', async () => {
    const { app, clerk } = appWith();
    const res = await app.request('/review-access', post({ email: EMAIL, secret: 'guess' }));
    expect(res.status).toBe(401);
    expect(clerk.calls).toHaveLength(0);
  });

  it('refuses the right secret for an address that is not the review email', async () => {
    const { app, clerk } = appWith({ [EMAIL]: 'user_review', 'parent@example.com': 'user_p' });
    const res = await app.request(
      '/review-access',
      post({ email: 'parent@example.com', secret: SECRET }),
    );
    expect(res.status).toBe(401);
    expect(clerk.calls).toHaveLength(0);
  });

  it('mints a sign-in token for the review user, whatever case the email is typed in', async () => {
    const { app, clerk } = appWith();
    const res = await app.request(
      '/review-access',
      post({ email: '  Review@MiboKids.app ', secret: SECRET }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'ticket_for_user_review' });
    const minted = clerk.calls.find((c) => c.url.endsWith('/v1/sign_in_tokens'));
    expect(JSON.parse(String(minted?.init?.body))).toMatchObject({ user_id: 'user_review' });
    expect(clerk.calls[0]?.url).toContain(`email_address=${encodeURIComponent(EMAIL)}`);
  });

  it('keeps the secret out of the log when Clerk has no such user', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {
      // Silenced: the assertion reads what would have been logged.
    });
    const { app } = appWith({});
    const res = await app.request('/review-access', post({ email: EMAIL, secret: SECRET }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SECRET);
    errors.mockRestore();
  });

  it('refuses a body with no secret', async () => {
    const { app } = appWith();
    const res = await app.request('/review-access', post({ email: EMAIL }));
    expect(res.status).toBe(400);
  });
});
