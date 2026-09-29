import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from '@chores/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from './parse-body.ts';
import { rateLimit, type RateLimit } from './rate-limit.ts';

/**
 * The one door App Review and TestFlight testers can walk through (#100): an allow-listed email
 * and a shared secret, answered with a Clerk sign-in token the app redeems as a `ticket`. The
 * review account is an ordinary Clerk user and an ordinary Parent — this route mints a sign-in for
 * it and grants nothing else.
 */
export type ReviewAccess = {
  email: string;
  secret: string;
  /** A Clerk sign-in token for the user holding `email`, or null when there is no such user. */
  mintSignInToken: (email: string) => Promise<string | null>;
};

export const CLERK_API = 'https://api.clerk.com/v1';
/** Long enough to type nothing more; the app redeems it within the same second. */
const TOKEN_SECONDS = 5 * 60;
const DEFAULT_LIMIT: RateLimit = { max: 10, windowMs: 15 * 60 * 1000 };

const bodySchema = z.object({ email: z.string().min(1), secret: z.string().min(1) });

/**
 * Hashed first so both sides are 32 bytes: `timingSafeEqual` throws on a length mismatch, and
 * refusing early on length would say how long the secret is.
 */
const digest = (value: string) => createHash('sha256').update(value).digest();
const constantTimeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export const clerkHeaders = (secretKey: string) => ({
  authorization: `Bearer ${secretKey}`,
  'content-type': 'application/json',
});

/** The Clerk user whose address is `email`, or null when there is none. */
export async function findClerkUserId(
  secretKey: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const found = await fetchImpl(
    `${CLERK_API}/users?${new URLSearchParams({ email_address: email })}`,
    { headers: clerkHeaders(secretKey) },
  );
  if (!found.ok) throw new Error(`clerk user lookup failed: ${found.status}`);
  const users = (await found.json()) as { id: string }[];
  return users[0]?.id ?? null;
}

/**
 * Two plain Backend API calls rather than `@clerk/backend`: the SDK binds `fetch` when it is
 * imported, so a test could not stand in for Clerk at the HTTP boundary, and these two requests
 * are all the route needs. `fetchImpl` is that boundary.
 */
export function clerkSignInTokens(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): ReviewAccess['mintSignInToken'] {
  const headers = clerkHeaders(secretKey);
  return async (email) => {
    const userId = await findClerkUserId(secretKey, email, fetchImpl);
    if (!userId) return null;
    const minted = await fetchImpl(`${CLERK_API}/sign_in_tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: userId, expires_in_seconds: TOKEN_SECONDS }),
    });
    if (!minted.ok) throw new Error(`clerk sign-in token failed: ${minted.status}`);
    const { token } = (await minted.json()) as { token?: string };
    if (!token) throw new Error('clerk sign-in token response carried no token');
    return token;
  };
}

/**
 * `POST /review-access`. With no configuration the route does not exist at all (404), so a
 * deployment that never set the two variables has nothing to guess at. Nothing here logs or
 * reports the body: the secret must not reach a log line or analytics.
 */
export function reviewAccessRoutes(config: ReviewAccess | undefined, limit = DEFAULT_LIMIT) {
  const app = new Hono();
  if (!config) return app;
  const allowed = normalizeEmail(config.email);

  app.use('/review-access', rateLimit(limit));
  app.post('/review-access', async (c) => {
    const body = await parseBody(c, bodySchema);
    if (!body.ok) return c.json({ error: 'invalid_body' }, 400);
    // Both compared every time, so a wrong email and a wrong secret take the same path.
    const emailOk = constantTimeEqual(normalizeEmail(body.data.email), allowed);
    const secretOk = constantTimeEqual(body.data.secret, config.secret);
    if (!emailOk || !secretOk) return c.json({ error: 'unauthorized' }, 401);

    let token: string | null;
    try {
      token = await config.mintSignInToken(allowed);
    } catch (e) {
      // The error names a status from Clerk, never the secret, which never left this handler.
      console.error('review access: minting a sign-in token failed', e);
      return c.json({ error: 'review_unavailable' }, 503);
    }
    if (!token) {
      console.error('review access: no Clerk user holds the review email');
      return c.json({ error: 'review_unavailable' }, 503);
    }
    return c.json({ token });
  });
  return app;
}
