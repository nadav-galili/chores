import type { Context } from 'hono';
import type { z } from 'zod';

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** JSON body → schema, or a ready-made 400 the handler returns as-is. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  const result = schema.safeParse(await c.req.json().catch(() => null));
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: c.json({ error: 'invalid_body', issues: result.error.issues }, 400) };
}
