import {
  canDo,
  gateFor,
  hasFeature,
  type FeatureAction,
  type GateContext,
  type GatedAction,
  type GateResult,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { households } from './db/schema.ts';

export type ApiGateContext = GateContext & { householdId: string };
export type GateAnswer = Extract<GateResult, { ok: true }> | Response;

/**
 * The one server-side entitlement boundary. A mirrored entitlement on a device is advisory only;
 * every parent action reaches the household row here immediately before it is performed.
 */
export async function gate(
  db: Pick<Db, 'query'>,
  action: GatedAction,
  { householdId, ...ctx }: ApiGateContext,
): Promise<GateAnswer> {
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
  if (!household) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const result = canDo(household, action, ctx);
  return result.ok ? result : Response.json({ error: 'gated', gate: result.gate }, { status: 402 });
}

/**
 * The same boundary for the gates the Entitlement alone decides. They have no quota to count and
 * no grace to date, so the call sites name the action and the household and nothing else — the
 * zeros a `GateContext` wants for them said nothing, and saying it eight times said it worse.
 */
export async function gateFeature(
  db: Pick<Db, 'query'>,
  action: FeatureAction,
  householdId: string,
): Promise<GateAnswer> {
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
  if (!household) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return hasFeature(household, action)
    ? { ok: true }
    : Response.json({ error: 'gated', gate: gateFor(action) }, { status: 402 });
}
