/**
 * Builds "The Review Family" for the App Review account (#100). Rerun it after every review:
 *
 *   DATABASE_URL=<Railway Postgres> CLERK_SECRET_KEY=<production sk_live_…> \
 *   REVIEW_EMAIL=review@mibokids.app R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… \
 *   R2_SECRET_ACCESS_KEY=… pnpm --filter api seed:review
 *
 * Premium is set by a documented manual write, not the RevenueCat webhook — the reasoning is on
 * `REVIEW_ENTITLEMENT_SOURCE` in `review-household.ts`. It runs no migrations: the target
 * database belongs to the deployed API, which migrates it itself (`scripts/check-deploy.sh` says
 * whether that API is this commit). It never reads or prints REVIEW_SECRET.
 */
import { readFile } from 'node:fs/promises';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDb } from './db/client.ts';
import { CLERK_API, findClerkUserId } from './review-access.ts';
import { seedReviewHousehold } from './review-household.ts';

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const databaseUrl = need('DATABASE_URL');
const clerkSecretKey = need('CLERK_SECRET_KEY');
const email = need('REVIEW_EMAIL').trim().toLowerCase();

/** The review account is a real Clerk user with nothing special about it; created if missing. */
async function reviewUserId(): Promise<string> {
  const existing = await findClerkUserId(clerkSecretKey, email);
  if (existing) return existing;
  const res = await fetch(`${CLERK_API}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${clerkSecretKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email_address: [email], skip_password_requirement: true }),
  });
  if (!res.ok) throw new Error(`creating the Clerk review user failed: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  console.log(`created Clerk user ${id} for ${email}`);
  return id;
}

/** The photo proof, stored where the parent's photo route will look for it (ADR-0017). */
function photoUploader() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    console.warn('R2_* not set: the waiting completion will carry no photo');
    return undefined;
  }
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
const uploadPhoto = photoUploader();
const seeded = await seedReviewHousehold(db, {
  clerkUserId,
  email,
  ...(uploadPhoto ? { uploadPhoto } : {}),
});
console.log(`seeded household ${seeded.householdId} for ${email}`);
process.exit(0);
