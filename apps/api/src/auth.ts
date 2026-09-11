import { verifyToken as clerkVerify } from '@clerk/backend';
import type { Context, MiddlewareHandler } from 'hono';

/** The Clerk user behind a bearer token. `email` is null when the token carries no email claim. */
export type ClerkUser = { clerkUserId: string; email: string | null };

/** Resolves a bearer token to a Clerk user, or null when it is not a valid session token. */
export type VerifyToken = (token: string) => Promise<ClerkUser | null>;

export function clerkVerifyToken(secretKey: string): VerifyToken {
  return async (token) => {
    try {
      const claims = await clerkVerify(token, { secretKey });
      // `email` is a default claim of a v2 session token; a v1 token has none, and a parent
      // signed in with one simply cannot claim an invite until their next sign-in. Clerk only
      // issues the claim for a verified address, which is what makes it safe to place a partner
      // in a household by email alone.
      const email = (claims as { email?: unknown }).email;
      return { clerkUserId: claims.sub, email: typeof email === 'string' ? email : null };
    } catch (e) {
      // The caller gets 401 either way. A token that is expired or forged is the ordinary path
      // and says so here; a secret key that is wrong rejects every request in the same shape,
      // and without this line there is nothing to tell the two apart. Clerk's error describes the
      // token, never the household behind it, so nothing about a child can reach this line.
      console.error('clerk token verification failed', e);
      return null;
    }
  };
}

export type AuthVariables = { clerkUserId: string; email: string | null };

/** The bearer token on a request, or '' when there is none. */
export function bearerToken(c: Context): string {
  const header = c.req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

export function requireClerkUser(
  verify: VerifyToken,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = bearerToken(c);
    const user = token ? await verify(token) : null;
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    c.set('clerkUserId', user.clerkUserId);
    c.set('email', user.email);
    await next();
  };
}
