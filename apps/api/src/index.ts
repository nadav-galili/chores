import { appEnv, normalizeEmail, REVIEW_EMAIL } from '@chores/shared';
import { serve } from '@hono/node-server';
import { posthogAnalytics, posthogPersonDeletion } from './analytics.ts';
import { clerkUserDeleter } from './account-deletion.ts';
import { createApp } from './app.ts';
import { clerkVerifyToken } from './auth.ts';
import { startCron } from './cron.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { expoPush } from './push.ts';
import { clerkSignInTokens } from './review-access.ts';
import { r2PhotoPurge, type R2Config } from './uploads.ts';

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

// Both or neither: one without the other is a door with no lock or a lock with no door (#100).
const reviewEmail = process.env.REVIEW_EMAIL;
const reviewSecret = process.env.REVIEW_SECRET;
if (Boolean(reviewEmail) !== Boolean(reviewSecret)) {
  throw new Error('REVIEW_EMAIL and REVIEW_SECRET must be set together');
}
// The app asks for the secret only when the shared address is typed; any other address here is a
// door no app build can reach, so it fails loudly instead.
if (reviewEmail && normalizeEmail(reviewEmail) !== REVIEW_EMAIL) {
  throw new Error(`REVIEW_EMAIL must be ${REVIEW_EMAIL} (REVIEW_EMAIL in @chores/shared)`);
}

const db = createDb(databaseUrl);
await runMigrations(db);

// The minute cron lives in this process: one container, one household clock per row (ADR-0003).
startCron(db, expoPush(process.env.EXPO_ACCESS_TOKEN));

const posthogApiKey = process.env.POSTHOG_API_KEY;
const posthogPersonalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const posthogProjectId = process.env.POSTHOG_PROJECT_ID;
// A deployment that sends events must be able to delete them: the account-deletion page promises
// nothing is retained (ADR-0019), and a key that only writes would make that promise false.
if (posthogApiKey && !(posthogPersonalApiKey && posthogProjectId)) {
  throw new Error(
    'POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required with POSTHOG_API_KEY (account deletion)',
  );
}
const analytics = posthogAnalytics(posthogApiKey, appEnv(process.env.APP_ENV));

const r2: R2Config | undefined =
  r2AccountId && r2Bucket && r2AccessKeyId && r2SecretAccessKey
    ? {
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        bucket: r2Bucket,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      }
    : undefined;

const app = createApp(db, {
  verifyToken: clerkVerifyToken(clerkSecretKey),
  analytics,
  ...(r2 ? { r2, purgePhotos: r2PhotoPurge(r2) } : {}),
  deleteClerkUser: clerkUserDeleter(clerkSecretKey),
  ...(posthogApiKey && posthogPersonalApiKey && posthogProjectId
    ? { deleteAnalyticsPersons: posthogPersonDeletion(posthogPersonalApiKey, posthogProjectId) }
    : {}),
  revenuecatWebhookSigningSecret,
  ...(reviewEmail && reviewSecret
    ? {
        reviewAccess: {
          email: reviewEmail,
          secret: reviewSecret,
          mintSignInToken: clerkSignInTokens(clerkSecretKey),
        },
      }
    : {}),
});
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on :${info.port}`);
});

// Events are batched, so a container going away has to be given the chance to send what it holds
// — and analytics is never load-bearing, so a flush that fails must not hold the process open.
process.on('SIGTERM', () => {
  void analytics.shutdown().finally(() => process.exit(0));
});
