import { serve } from '@hono/node-server';
import { posthogAnalytics } from './analytics.ts';
import { createApp } from './app.ts';
import { clerkVerifyToken } from './auth.ts';
import { startCron } from './cron.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { expoPush } from './push.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
if (!clerkSecretKey) throw new Error('CLERK_SECRET_KEY is required');
const revenuecatWebhookSigningSecret = process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET;
if (!revenuecatWebhookSigningSecret) {
  throw new Error('REVENUECAT_WEBHOOK_SIGNING_SECRET is required');
}
const port = Number(process.env.PORT ?? 3000);

const r2AccountId = process.env.R2_ACCOUNT_ID;
const r2Bucket = process.env.R2_BUCKET;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2Values = [r2AccountId, r2Bucket, r2AccessKeyId, r2SecretAccessKey];
if (r2Values.some(Boolean) && !r2Values.every(Boolean)) {
  throw new Error(
    'R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set together',
  );
}

const db = createDb(databaseUrl);
await runMigrations(db);

// The minute cron lives in this process: one container, one household clock per row (ADR-0003).
startCron(db, expoPush(process.env.EXPO_ACCESS_TOKEN));

const analytics = posthogAnalytics(process.env.POSTHOG_API_KEY);

const app = createApp(db, {
  verifyToken: clerkVerifyToken(clerkSecretKey),
  analytics,
  ...(r2AccountId && r2Bucket && r2AccessKeyId && r2SecretAccessKey
    ? {
        r2: {
          endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
          bucket: r2Bucket,
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
        },
      }
    : {}),
  revenuecatWebhookSigningSecret,
});
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on :${info.port}`);
});

// Events are batched, so a container going away has to be given the chance to send what it holds
// — and analytics is never load-bearing, so a flush that fails must not hold the process open.
process.on('SIGTERM', () => {
  void analytics.shutdown().finally(() => process.exit(0));
});
