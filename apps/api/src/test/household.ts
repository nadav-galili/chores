import { choreDate, uuid7, type DeviceSession, type SyncResponse } from '@chores/shared';
import type { createApp } from '../app.ts';
import { asParent } from './auth.ts';

/** The fixture every HTTP test builds on: one household, two children, a device each. */

type App = ReturnType<typeof createApp>;

export const TEST_TZ = 'Asia/Jerusalem';
export const testToday = () => choreDate(new Date(), TEST_TZ, 0);

/** A household with two children on kid devices, plus helpers to write chores as the parent. */
export async function setupHousehold(app: App, clerkUserId: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: TEST_TZ, currency: 'ILS' }),
    }),
  );
  const { household } = (await res.json()) as { household: { id: string } };
  const joined: { id: string; session: DeviceSession }[] = [];
  for (const first_name of ['Noa', 'Ori']) {
    const c = await app.request(
      `/households/${household.id}/children`,
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ first_name, ui_mode: 'little', pet_name: 'Pip' }),
      }),
    );
    const child = (await c.json()) as { id: string };
    const issued = (await (
      await app.request(
        `/households/${household.id}/children/${child.id}/join-code`,
        asParent(clerkUserId, { method: 'POST' }),
      )
    ).json()) as { code: string };
    const redeemed = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code, platform: 'android' }),
    });
    joined.push({ id: child.id, session: (await redeemed.json()) as DeviceSession });
  }
  const addChore = async (title: string, assignees: string[]) => {
    const choreId = uuid7();
    await app.request(
      `/households/${household.id}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title, kind: 'daily', assignees },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    return choreId;
  };
  const deleteChore = (choreId: string) =>
    app.request(
      `/households/${household.id}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'DELETE',
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
      }),
    );
  return { householdId: household.id, noa: joined[0]!, ori: joined[1]!, addChore, deleteChore };
}

/** One `POST /sync` as a kid device. */
export async function syncAs(
  app: App,
  session: DeviceSession,
  ops: unknown[] = [],
  cursor = 0,
): Promise<{ status: number; body: SyncResponse }> {
  const res = await app.request('/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.device_token}`,
    },
    body: JSON.stringify({ device_id: session.device_id, cursor, ops }),
  });
  return { status: res.status, body: (await res.json()) as SyncResponse };
}

export const completeOp = (choreId: string, over: Record<string, unknown> = {}) => ({
  op_id: uuid7(),
  type: 'complete',
  payload: {
    completion_id: uuid7(),
    chore_id: choreId,
    chore_date: testToday(),
    completed_at: new Date().toISOString(),
    ...over,
  },
});
