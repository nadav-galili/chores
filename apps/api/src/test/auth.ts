import type { VerifyToken } from '../auth.ts';

/**
 * Stands in for Clerk: any bearer token starting with `user_` is that Clerk user. A token shaped
 * `user_<local>_at_<domain>` also carries `<local>@<domain>`, the way a session token carries its
 * `email` claim; anything else is a user whose token has no email.
 */
export const fakeVerifyToken: VerifyToken = async (token) => {
  if (!token.startsWith('user_')) return null;
  const [local, domain] = token.slice('user_'.length).split('_at_');
  return { clerkUserId: token, email: domain ? `${local}@${domain}` : null };
};

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
