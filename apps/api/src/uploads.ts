import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db/client.ts';
import { completions } from './db/schema.ts';
import { requireKidDevice, type DeviceEnv } from './device-auth.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const PRESIGN_SECONDS = 5 * 60;
const uploadBody = z.object({
  completion_id: z.string().uuid(),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

/** Photo Proof uses private R2 objects; possession of a five-minute URL grants one operation. */
export function uploadRoutes(db: Db, config?: R2Config) {
  const client = config
    ? new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      })
    : null;

  const kid = new Hono<DeviceEnv>();
  kid.use('/uploads/presign', requireKidDevice(db));
  kid.post('/uploads/presign', async (c) => {
    if (!client || !config) return c.json({ error: 'photo_storage_unavailable' }, 503);
    const parsed = await parseBody(c, uploadBody);
    if (!parsed.ok) return parsed.response;

    // The device contributes only the completion id. Its authenticated child scope is the only
    // source of the prefix, so it cannot name another child's object even with a forged `key`.
    const key = `children/${c.get('childId')}/completions/${parsed.data.completion_id}`;
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: parsed.data.content_type,
      }),
      { expiresIn: PRESIGN_SECONDS },
    );
    return c.json({ key, upload_url: uploadUrl, expires_in: PRESIGN_SECONDS });
  });

  const parent = new Hono<ScopedEnv>();
  parent.use('/households/:householdId/completions/:completionId/photo', householdScope(db));
  parent.get('/households/:householdId/completions/:completionId/photo', async (c) => {
    if (!client || !config) return c.json({ error: 'photo_storage_unavailable' }, 503);
    const [completion] = await db
      .select({ childId: completions.childId, photoKey: completions.photoKey })
      .from(completions)
      .where(
        and(
          eq(completions.id, c.req.param('completionId')),
          eq(completions.householdId, c.get('householdId')),
        ),
      );
    if (!completion?.photoKey) return c.json({ error: 'not_found' }, 404);

    // `photoKey` marks that a proof was attached, but the URL still names the canonical key. A
    // future sync bug cannot turn a stored, device-provided string into access to another object.
    const key = `children/${completion.childId}/completions/${c.req.param('completionId')}`;

    const readUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: PRESIGN_SECONDS },
    );
    return c.json({ read_url: readUrl, expires_in: PRESIGN_SECONDS });
  });

  const routes = new Hono();
  routes.route('/', kid);
  routes.route('/', parent);
  return routes;
}
