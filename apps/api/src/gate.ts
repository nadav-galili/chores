import { canDo, type GateContext, type GatedAction, type GateResult } from '@chores/shared';
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
