import { ApiError } from '@/lib/api';

/**
 * A failed action, with the reason attached.
 *
 * The bare string was untranslatable into action: "Could not save" reads the same whether the
 * server rejected the shape, the token had expired, or the phone was offline — and the parent is
 * the only person who can see it. The status and code are not localized on purpose; they are for
 * repeating back, not for reading.
 *
 * Parent surfaces only. Where the screen belongs to a child there is nothing a 7-year-old can do
 * with `401 unauthenticated`, so the cause goes to `console.error` and the screen stays calm
 * (CODING_STANDARDS.md, "A catch never discards its cause").
 */
export function withCause(message: string, e: unknown): string {
  if (e instanceof ApiError) return `${message} (${e.status} ${e.code})`;
  return e instanceof Error && e.message ? `${message} (${e.message})` : message;
}
