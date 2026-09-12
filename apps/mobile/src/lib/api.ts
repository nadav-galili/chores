import type {
  Child,
  ChildDevice,
  ChildInput,
  Chore,
  CreateHouseholdInput,
  DecideRedemptionResult,
  Household,
  IssuedJoinCode,
  ChildSummary,
  HouseholdSummary,
  DeviceSession,
  Parent,
  ParentDevice,
  ParentDeviceInput,
  ParentInvite,
  ParentToday,
  ParentWeek,
  RedeemJoinCodeInput,
  RedemptionDecision,
  RejectCompletionResult,
  Reward,
  SyncRequest,
  SyncResponse,
  UpsertChoreOp,
  Gate,
} from '@chores/shared';
import { gateSchema } from '@chores/shared';
import { requireArrays } from '@/lib/payload';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type Me = { parent: Parent | null; household: Household | null; children: Child[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public gate: Gate | null = null,
  ) {
    super(`${status} ${code}`);
  }
}

type GetToken = () => Promise<string | null>;
type OnGate = (gate: Gate) => void;

async function call<T>(
  getToken: GetToken,
  path: string,
  init: RequestInit = {},
  onGate?: OnGate,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    // A body that is not JSON is the meaning: the status and 'unknown' are what the error then
    // carries, and the parse failure itself says nothing the status does not.
    const body = (await res.json().catch(() => ({}))) as { error?: string; gate?: unknown };
    const parsedGate =
      res.status === 402 && body.error === 'gated' ? gateSchema.safeParse(body.gate) : null;
    const gate = parsedGate?.success ? parsedGate.data : null;
    if (gate) onGate?.(gate);
    throw new ApiError(res.status, body.error ?? 'unknown', gate);
  }
  return (await res.json()) as T;
}

const json = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

/** The parent-side REST surface; every call carries the Clerk session token. */
export function createApi(getToken: GetToken, onGate?: OnGate) {
  const request = <T>(path: string, init?: RequestInit) => call<T>(getToken, path, init, onGate);
  return {
    me: () => request<Me>('/me'),
    createHousehold: (input: CreateHouseholdInput) =>
      request<{ household: Household; parent: Parent }>('/households', json('POST', input)),
    createChild: (householdId: string, input: ChildInput) =>
      request<Child>(`/households/${householdId}/children`, json('POST', input)),
    updateChild: (householdId: string, childId: string, input: ChildInput) =>
      request<Child>(`/households/${householdId}/children/${childId}`, json('PATCH', input)),
    // The two lists the today screen walks are checked on arrival rather than trusted: a server
    // older than the app returns neither, and the screen indexing them takes the process down.
    today: async (householdId: string) =>
      requireArrays(
        await request<ParentToday>(`/households/${householdId}/today`),
        ['children', 'redemptions'],
        'today',
      ),
    // History is clamped in a successful response rather than answering 402. The screen alone
    // turns that flag into an explicit path to the paywall.
    childWeek: (householdId: string, childId: string, from?: string) =>
      request<ParentWeek>(
        `/households/${householdId}/children/${childId}/week${from ? `?from=${encodeURIComponent(from)}` : ''}`,
      ),
    // Rejecting names a completion, never an instance: the id comes from the today payload.
    rejectCompletion: (householdId: string, completionId: string) =>
      request<{ status: RejectCompletionResult }>(
        `/households/${householdId}/completions/${completionId}/reject`,
        { method: 'POST' },
      ),
    // Deciding names a redemption, never a reward: the id comes from the today payload. Approving
    // moves no coins — they left when the child asked — and declining refunds (ADR-0014).
    decideRedemption: (householdId: string, redemptionId: string, decision: RedemptionDecision) =>
      request<{ status: DecideRedemptionResult }>(
        `/households/${householdId}/redemptions/${redemptionId}/decide`,
        json('POST', { decision }),
      ),
    listParents: (householdId: string) =>
      request<{ parents: Parent[]; invites: ParentInvite[] }>(`/households/${householdId}/parents`),
    inviteParent: (householdId: string, email: string) =>
      request<ParentInvite>(`/households/${householdId}/parents`, json('POST', { email })),
    setPin: (householdId: string, pin: string) =>
      request<Household>(`/households/${householdId}/pin`, json('PUT', { pin })),
    issueJoinCode: (householdId: string, childId: string) =>
      request<IssuedJoinCode>(`/households/${householdId}/children/${childId}/join-code`, {
        method: 'POST',
      }),
    listChildDevices: (householdId: string, childId: string) =>
      request<ChildDevice[]>(`/households/${householdId}/children/${childId}/devices`),
    // Revoking is idempotent server-side, so a second tap answers with the first revocation's
    // timestamp rather than an error. There is no un-revoke: reconnecting is a new join code.
    revokeChildDevice: (householdId: string, childId: string, deviceId: string) =>
      request<{ id: string; revoked_at: string }>(
        `/households/${householdId}/children/${childId}/devices/${deviceId}`,
        { method: 'DELETE' },
      ),
    listRewards: (householdId: string) => request<Reward[]>(`/households/${householdId}/rewards`),
    // Hiding a built-in, and nothing more: a custom reward is M3's `custom_reward` gate.
    setRewardActive: (householdId: string, rewardId: string, active: boolean) =>
      request<Reward>(`/households/${householdId}/rewards/${rewardId}`, json('PATCH', { active })),
    registerDevice: (householdId: string, input: ParentDeviceInput) =>
      request<ParentDevice>(`/households/${householdId}/devices`, json('POST', input)),
    listChores: (householdId: string) => request<Chore[]>(`/households/${householdId}/chores`),
    upsertChore: (householdId: string, choreId: string, op: UpsertChoreOp) =>
      request<Chore>(`/households/${householdId}/chores/${choreId}`, json('PUT', op)),
    deleteChore: (householdId: string, choreId: string) =>
      request<Chore>(
        `/households/${householdId}/chores/${choreId}`,
        json('DELETE', { updated_at: new Date().toISOString() }),
      ),
  };
}

export type Api = ReturnType<typeof createApi>;

const noToken: GetToken = () => Promise.resolve(null);

/** Public: turns a join code into this device's kid session. */
export const redeemJoinCode = (input: RedeemJoinCodeInput) =>
  call<DeviceSession>(noToken, '/join-codes/redeem', json('POST', input));

export type DeviceMe = { child: ChildSummary; household: HouseholdSummary };

/** The kid-side surface; every call carries the device token, which alone decides the child. */
export function createDeviceApi(deviceToken: string) {
  const getToken: GetToken = () => Promise.resolve(deviceToken);
  return {
    me: () => call<DeviceMe>(getToken, '/device/me'),
    sync: (body: SyncRequest) => call<SyncResponse>(getToken, '/sync', json('POST', body)),
  };
}
