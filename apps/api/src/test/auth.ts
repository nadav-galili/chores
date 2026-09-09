import type { VerifyToken } from '../auth.ts';

/** Stands in for Clerk: any bearer token starting with `user_` is that Clerk user. */
export const fakeVerifyToken: VerifyToken = async (token) =>
  token.startsWith('user_') ? { clerkUserId: token } : null;

export function asParent(clerkUserId: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${clerkUserId}`,
      ...(init.headers ?? {}),
    },
  };
}
