import { hashPin, setPinInputSchema } from '@chores/shared';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import { households } from './db/schema.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';
import { householdToApi } from './serialize.ts';

/**
 * The household's Parent PIN. It lives on `households` rather than on a parent because it is a
 * door, not a credential (ADR-0013); this file is the only place the hash is written, and the
 * kid device is the only place it is checked.
 */
export function pinRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/pin', householdScope(db));

  /**
   * Set or replace the household's Parent PIN. Any signed-in parent may: a Clerk session outranks
   * the PIN, so there is no old-PIN challenge to fail (ADR-0013). A replacement gets a new salt.
   *
   * The answer is the household the write left behind, the way every other write in this API
   * answers with its row. Nothing about the PIN itself is echoed: the hash and the salt reach a
   * Kid Device through its own sync scope and reach a parent nowhere.
   */
  app.put('/households/:householdId/pin', async (c) => {
    const body = await parseBody(c, setPinInputSchema);
    if (!body.ok) return body.response;
    const salt = randomBytes(16).toString('hex');
    const [row] = await db
      .update(households)
      .set({ pinSalt: salt, pinHash: hashPin(salt, body.data.pin) })
      .where(eq(households.id, c.get('householdId')))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(householdToApi(row));
  });

  return app;
}
