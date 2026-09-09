import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { bearerToken } from './auth.ts';
import type { Db } from './db/client.ts';
import { childDevices } from './db/schema.ts';

export type DeviceVariables = { deviceId: string; childId: string; householdId: string };
export type DeviceEnv = { Variables: DeviceVariables };

/** A fresh device token; only its hash is ever stored. */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Resolves the bearer device token to exactly one child. Nothing in the request can widen that:
 * every kid route reads the child from here, never from a parameter.
 */
export function requireKidDevice(db: Db): MiddlewareHandler<DeviceEnv> {
  return async (c, next) => {
    const token = bearerToken(c);
    const device = token
      ? await db.query.childDevices.findFirst({
          where: eq(childDevices.tokenHash, hashDeviceToken(token)),
        })
      : undefined;
    if (!device) return c.json({ error: 'unauthenticated' }, 401);
    if (device.revokedAt) return c.json({ error: 'device_revoked' }, 401);
    c.set('deviceId', device.id);
    c.set('childId', device.childId);
    c.set('householdId', device.householdId);
    await db
      .update(childDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(childDevices.id, device.id));
    await next();
  };
}
