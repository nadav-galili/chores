import { verifyToken as clerkVerify } from '@clerk/backend';
import type { Context, MiddlewareHandler } from 'hono';

/** Resolves a bearer token to a Clerk user, or null when it is not a valid session token. */
export type VerifyToken = (token: string) => Promise<{ clerkUserId: string } | null>;

export function clerkVerifyToken(secretKey: string): VerifyToken {
  return async (token) => {
    try {
      const claims = await clerkVerify(token, { secretKey });
      return { clerkUserId: claims.sub };
    } catch {
      return null;
    }
  };
}

export type AuthVariables = { clerkUserId: string };

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
    await next();
  };
}
