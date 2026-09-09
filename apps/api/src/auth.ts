import { verifyToken as clerkVerify } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';

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

export function requireClerkUser(
  verify: VerifyToken,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const user = token ? await verify(token) : null;
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    c.set('clerkUserId', user.clerkUserId);
    await next();
  };
}
