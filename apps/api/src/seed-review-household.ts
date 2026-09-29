/**
 * Builds "The Review Family" for the App Review account (#100). Rerun it after every review:
 *
 *   DATABASE_URL=<Railway Postgres> CLERK_SECRET_KEY=<production sk_live_…> \
 *   R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *   pnpm --filter api seed:review
 *
 * The review address is `REVIEW_EMAIL` from `@chores/shared`. Every R2_* variable is required:
 * without them there is no photo proof, and the script stops before touching anything.
 *
 * Premium is set by a manual write, not the RevenueCat webhook — the one exception ADR-0016's
 * amendment names; the reasoning is on `REVIEW_ENTITLEMENT_SOURCE` in `review-household.ts`. It runs no migrations: the target
 * database belongs to the deployed API, which migrates it itself (`scripts/check-deploy.sh` says
 * whether that API is this commit). It never reads or prints REVIEW_SECRET.
 */
import { readFile } from 'node:fs/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { REVIEW_EMAIL } from '@chores/shared';
import { createDb } from './db/client.ts';
import { CLERK_API, clerkHeaders, findClerkUserId } from './review-access.ts';
import { seedReviewHousehold } from './review-household.ts';

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const databaseUrl = need('DATABASE_URL');
const clerkSecretKey = need('CLERK_SECRET_KEY');
const email = REVIEW_EMAIL;
const r2 = {
  accountId: need('R2_ACCOUNT_ID'),
  bucket: need('R2_BUCKET'),
  accessKeyId: need('R2_ACCESS_KEY_ID'),
  secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
};

/** The review account is a real Clerk user with nothing special about it; created if missing. */
async function reviewUserId(): Promise<string> {
  const existing = await findClerkUserId(clerkSecretKey, email);
  if (existing) return existing;
  const res = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: clerkHeaders(clerkSecretKey),
    body: JSON.stringify({ email_address: [email], skip_password_requirement: true }),
  });
  if (!res.ok) throw new Error(`creating the Clerk review user failed: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  console.log(`created Clerk user ${id} for ${email}`);
  return id;
}

/** The photo proof, stored where the parent's photo route will look for it (ADR-0017). */
function photoUploader() {
  const { accountId, bucket, accessKeyId, secretAccessKey } = r2;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  // A watered plant for "Water the plants": the grove's own art, so no photo of anyone is used.
  const image = new URL('../../mobile/assets/grove/tree-s5.webp', import.meta.url);
  return async (key: string) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(image),
        ContentType: 'image/webp',
      }),
    );
  };
}

const clerkUserId = await reviewUserId();
const db = createDb(databaseUrl);
const seeded = await seedReviewHousehold(db, { clerkUserId, email, uploadPhoto: photoUploader() });
console.log(`seeded household ${seeded.householdId} for ${email}`);
process.exit(0);
