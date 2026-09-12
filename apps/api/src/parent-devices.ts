import { parentDeviceId, parentDeviceInputSchema } from '@chores/shared';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import { parentDevices } from './db/schema.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';
import { parentDeviceToApi } from './serialize.ts';

/**
 * The parent's own phone, as a push target. This is the parent side of a Kid Device and nothing
 * to do with one: a child's device is bound by a join code and revoked by a parent, while this
 * row exists only so the digest and the three immediate kinds have somewhere to land.
 */
export function parentDeviceRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/devices', householdScope(db));

  /**
   * This parent's phone registering for push, on every app open: a token rots, and the language
   * the phone reads can change between opens. The id is derived from the parent and the token
   * (ADR-0010), so re-registering is the same row rather than a second phone.
   */
  app.post('/households/:householdId/devices', async (c) => {
    const body = await parseBody(c, parentDeviceInputSchema);
    if (!body.ok) return body.response;
    const parentId = c.get('parentId');
    const { expo_push_token, platform, locale } = body.data;
    const [row] = await db
      .insert(parentDevices)
      .values({
        id: parentDeviceId(parentId, expo_push_token),
        parentId,
        expoPushToken: expo_push_token,
        platform,
        locale,
      })
      .onConflictDoUpdate({
        target: parentDevices.id,
        // The token is the id's own input, so only what can differ between opens is written —
        // plus the last seen, which is what says this phone is still the one to push to.
        set: { platform, locale, expoPushToken: expo_push_token, lastSeenAt: new Date() },
      })
      .returning();
    return c.json(parentDeviceToApi(row!), 201);
  });

  return app;
}
