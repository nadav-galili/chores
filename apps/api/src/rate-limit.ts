import type { Context, MiddlewareHandler } from 'hono';

export type RateLimit = { max: number; windowMs: number };

/**
 * The client address as the edge proxy appended it: the last entry is the one Railway wrote,
 * anything before it is caller-supplied. Callers with no header at all share one bucket.
 */
function clientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',').at(-1)?.trim() || 'unknown';
}

/** Fixed-window, in-memory, per-client. Enough for one API process guarding a 6-char code. */
export function rateLimit({ max, windowMs }: RateLimit): MiddlewareHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    const now = Date.now();
    const key = clientKey(c);
    const window = windows.get(key);
    if (!window || now - window.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
    } else if (window.count >= max) {
      return c.json({ error: 'rate_limited' }, 429);
    } else {
      window.count += 1;
    }
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
    }
    await next();
  };
}
