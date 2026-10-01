import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { accountDeletionRoutes, type DeleteClerkUser } from './account-deletion.ts';
import { noAnalytics, type Analytics, type DeleteAnalyticsPersons } from './analytics.ts';
import { requireClerkUser, type VerifyToken } from './auth.ts';
import type { Db } from './db/client.ts';
import { choreRoutes } from './chores.ts';
import { deleteAccountRoutes } from './delete-account.ts';
import { householdRoutes } from './households.ts';
import { joinRoutes } from './join.ts';
import { landingRoutes } from './landing.ts';
import { moneyLedgerRoutes } from './money-ledger.ts';
import { parentDeviceRoutes } from './parent-devices.ts';
import { pinRoutes } from './pin.ts';
import { privacyRoutes } from './privacy.ts';
import { photoApprovalRoutes } from './photo-approval.ts';
import type { RateLimit } from './rate-limit.ts';
import { redemptionRoutes } from './redemptions.ts';
import { revenuecatRoutes } from './revenuecat.ts';
import { rejectionRoutes } from './rejection.ts';
import { reviewAccessRoutes, type ReviewAccess } from './review-access.ts';
import { rewardRoutes } from './rewards.ts';
import { syncRoutes } from './sync.ts';
import { termsRoutes } from './terms.ts';
import { todayRoutes } from './today.ts';
import { uploadRoutes, type PurgePhotos, type R2Config } from './uploads.ts';
import { weekRoutes } from './week.ts';

export type AppOptions = {
  verifyToken: VerifyToken;
  /** Attempts per client at the public redeem endpoint; a 6-char code must not be guessable. */
  redeemLimit?: RateLimit;
  /** Change-log rows per `/sync` page. */
  syncPageSize?: number;
  /** Where server events go; nothing is sent when this is left out (ADR-0009). */
  analytics?: Analytics;
  /** Private R2 bucket used for 30-day Photo Proof objects. */
  r2?: R2Config;
  /** HMAC secret RevenueCat uses to sign the exact webhook request body (ADR-0016). */
  revenuecatWebhookSigningSecret?: string;
  /** The App Review sign-in (#100); left out, `POST /review-access` does not exist. */
  reviewAccess?: ReviewAccess;
  /** Account Deletion's last step (ADR-0019); left out, `DELETE /me` answers 503. */
  deleteClerkUser?: DeleteClerkUser;
  /** Household Deletion's R2 step; left out, there is no bucket to purge. */
  purgePhotos?: PurgePhotos;
  /** Account Deletion's analytics step; left out, there is no PostHog project to delete from. */
  deleteAnalyticsPersons?: DeleteAnalyticsPersons;
};

const DEFAULT_SYNC_PAGE_SIZE = 500;
const DEFAULT_REDEEM_LIMIT: RateLimit = { max: 10, windowMs: 15 * 60 * 1000 };

export function createApp(
  db: Db,
  {
    verifyToken,
    redeemLimit,
    syncPageSize,
    analytics = noAnalytics,
    r2,
    revenuecatWebhookSigningSecret,
    reviewAccess,
    deleteClerkUser,
    purgePhotos,
    deleteAnalyticsPersons,
  }: AppOptions,
) {
  const app = new Hono();

  // The commit is reported because a healthy container says nothing about *which* build is in it:
  // an API that predates a milestone answers `/health` exactly like one that does not, and the
  // routes it is missing only 404 for whoever happens to call them. `scripts/check-deploy.sh`
  // reads this. `unknown` means the image was built without the argument, not that it is current.
  app.get('/health', async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, sha: process.env.GIT_SHA ?? 'unknown' });
  });

  // Mounted above the auth middleware: these three are what a parent, a store reviewer or Google's
  // OAuth consent screen reads before there is an account at all (COPPA, App Review, #84). All
  // three are linked by absolute URL from records we do not control, so none of them may move.
  app.route('/', privacyRoutes());
  app.route('/', termsRoutes());
  app.route('/', landingRoutes());
  // Google Play's account-deletion URL (ADR-0019): read by someone who may no longer have the app.
  app.route('/', deleteAccountRoutes());
  // Before any account too: it is how the review account gets its session in the first place.
  app.route('/', reviewAccessRoutes(reviewAccess));

  app.use('/me', requireClerkUser(verifyToken));
  app.use('/households/*', requireClerkUser(verifyToken));
  app.use('/households', requireClerkUser(verifyToken));
  app.route('/', householdRoutes(db, analytics));
  app.route(
    '/',
    accountDeletionRoutes(db, { deleteClerkUser, purgePhotos, deleteAnalyticsPersons }),
  );
  app.route('/', choreRoutes(db, analytics));
  app.route('/', parentDeviceRoutes(db));
  app.route('/', pinRoutes(db, analytics));
  app.route('/', todayRoutes(db));
  app.route('/', weekRoutes(db));
  app.route('/', rejectionRoutes(db));
  app.route('/', photoApprovalRoutes(db));
  app.route('/', rewardRoutes(db));
  app.route('/', redemptionRoutes(db, analytics));
  app.route('/', joinRoutes(db, redeemLimit ?? DEFAULT_REDEEM_LIMIT, analytics));
  app.route('/', moneyLedgerRoutes(db));
  app.route('/', syncRoutes(db, syncPageSize ?? DEFAULT_SYNC_PAGE_SIZE));
  app.route('/', uploadRoutes(db, r2));
  app.route('/', revenuecatRoutes(db, analytics, revenuecatWebhookSigningSecret));

  return app;
}
