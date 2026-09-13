import { uuid7 } from '@chores/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { completions } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setupHousehold, testToday } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    r2: {
      endpoint: 'https://test-account.r2.cloudflarestorage.com',
      bucket: 'mibo-photo-proof',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    },
  });
});

const asKid = (token: string, body: Record<string, unknown>) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});

describe('photo-proof upload presigns', () => {
  it('chooses a short-lived upload key scoped to the token’s child and completion', async () => {
    const mine = await setupHousehold(app, 'user_upload_scope');
    const completionId = uuid7();
    const res = await app.request(
      '/uploads/presign',
      asKid(mine.noa.session.device_token, {
        completion_id: completionId,
        content_type: 'image/jpeg',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; upload_url: string; expires_in: number };
    expect(body.key).toBe(`children/${mine.noa.id}/completions/${completionId}`);
    expect(body.expires_in).toBe(300);
    const url = new URL(body.upload_url);
    expect(url.pathname).toBe(`/mibo-photo-proof/${body.key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('ignores a device-supplied key', async () => {
    const mine = await setupHousehold(app, 'user_upload_key');
    const completionId = uuid7();
    const res = await app.request(
      '/uploads/presign',
      asKid(mine.noa.session.device_token, {
        completion_id: completionId,
        content_type: 'image/jpeg',
        key: `children/${mine.ori.id}/completions/stolen`,
      }),
    );

    const body = (await res.json()) as { key: string; upload_url: string };
    expect(body.key).toBe(`children/${mine.noa.id}/completions/${completionId}`);
    expect(body.upload_url).not.toContain(mine.ori.id);
    expect(body.upload_url).not.toContain('stolen');
  });

  it('refuses an unauthenticated request', async () => {
    const res = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ completion_id: uuid7(), content_type: 'image/jpeg' }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });
});

describe('parent photo reads', () => {
  it('presigns the stored photo only for a parent in its household', async () => {
    const mine = await setupHousehold(app, 'user_photo_parent');
    const choreId = await mine.addChore('Take out bins', [mine.noa.id]);
    const completionId = uuid7();
    const key = `children/${mine.noa.id}/completions/${completionId}`;
    await db.insert(completions).values({
      id: completionId,
      instanceId: uuid7(),
      choreId,
      childId: mine.noa.id,
      householdId: mine.householdId,
      choreDate: testToday(),
      completedAt: new Date(),
      deviceId: mine.noa.session.device_id,
      photoKey: key,
      status: 'pending_photo',
    });

    const res = await app.request(
      `/households/${mine.householdId}/completions/${completionId}/photo`,
      asParent('user_photo_parent'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { read_url: string; expires_in: number };
    expect(new URL(body.read_url).pathname).toBe(`/mibo-photo-proof/${key}`);
    expect(body.expires_in).toBe(300);

    const theirs = await setupHousehold(app, 'user_photo_stranger');
    expect(
      (
        await app.request(
          `/households/${theirs.householdId}/completions/${completionId}/photo`,
          asParent('user_photo_stranger'),
        )
      ).status,
    ).toBe(404);
  });
});
