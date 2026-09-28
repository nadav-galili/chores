import { createClerkClient, verifyToken as clerkVerify } from '@clerk/backend';
import type { Context, MiddlewareHandler } from 'hono';

/** The Clerk user behind a bearer token. `email` is null when the token carries no email claim. */
export type ClerkUser = { clerkUserId: string; email: string | null };

/** Resolves a bearer token to a Clerk user, or null when it is not a valid session token. */
export type VerifyToken = (token: string) => Promise<ClerkUser | null>;

/** How long a looked-up email is trusted before Clerk is asked again. */
const EMAIL_CACHE_MS = 10 * 60 * 1000;

export function clerkVerifyToken(secretKey: string): VerifyToken {
  const clerk = createClerkClient({ secretKey });
  // Per Clerk user, so a token with no email claim costs one lookup every ten minutes rather than
  // one per request. Only the primary, verified address is taken — the same address the claim
  // would have carried — which is what keeps placing a partner by email safe.
  const emails = new Map<string, { email: string | null; until: number }>();
  const lookUpEmail = async (clerkUserId: string): Promise<string | null> => {
    const cached = emails.get(clerkUserId);
    if (cached && cached.until > Date.now()) return cached.email;
    let email: string | null = null;
    try {
      const user = await clerk.users.getUser(clerkUserId);
      const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
      email =
        primary && primary.verification?.status === 'verified' ? primary.emailAddress : null;
    } catch (e) {
      // The request still goes through: a parent already in a household needs no email. Only an
      // invite claim is delayed, until the next request finds Clerk answering again.
      console.error('clerk user lookup failed', e);
      return null;
    }
    emails.set(clerkUserId, { email, until: Date.now() + EMAIL_CACHE_MS });
    return email;
  };
  return async (token) => {
    try {
      const claims = await clerkVerify(token, { secretKey });
      // `email` is a default claim of a v2 session token. A v1 token has none — every parent of
      // an instance still on v1 would arrive with no address and no invite could ever be claimed —
      // so a missing claim is answered by asking Clerk for the user instead.
      const claimed = (claims as { email?: unknown }).email;
      const email = typeof claimed === 'string' ? claimed : await lookUpEmail(claims.sub);
      return { clerkUserId: claims.sub, email };
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
