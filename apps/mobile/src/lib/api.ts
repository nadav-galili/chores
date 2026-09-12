import type {
  Child,
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
} from '@chores/shared';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type Me = { parent: Parent | null; household: Household | null; children: Child[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${status} ${code}`);
  }
}

type GetToken = () => Promise<string | null>;

async function call<T>(getToken: GetToken, path: string, init: RequestInit = {}): Promise<T> {
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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? 'unknown');
  }
  return (await res.json()) as T;
}

const json = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

/** The parent-side REST surface; every call carries the Clerk session token. */
export function createApi(getToken: GetToken) {
  return {
    me: () => call<Me>(getToken, '/me'),
    createHousehold: (input: CreateHouseholdInput) =>
      call<{ household: Household; parent: Parent }>(getToken, '/households', json('POST', input)),
    createChild: (householdId: string, input: ChildInput) =>
      call<Child>(getToken, `/households/${householdId}/children`, json('POST', input)),
    updateChild: (householdId: string, childId: string, input: ChildInput) =>
      call<Child>(getToken, `/households/${householdId}/children/${childId}`, json('PATCH', input)),
    today: (householdId: string) => call<ParentToday>(getToken, `/households/${householdId}/today`),
    // The child's last seven Chore Dates. Ungated — seven days is the free tier's promise — so
    // there is nothing here to catch a paywall answer.
    childWeek: (householdId: string, childId: string) =>
      call<ParentWeek>(getToken, `/households/${householdId}/children/${childId}/week`),
    // Rejecting names a completion, never an instance: the id comes from the today payload.
    rejectCompletion: (householdId: string, completionId: string) =>
      call<{ status: RejectCompletionResult }>(
        getToken,
        `/households/${householdId}/completions/${completionId}/reject`,
        { method: 'POST' },
      ),
    // Deciding names a redemption, never a reward: the id comes from the today payload. Approving
    // moves no coins — they left when the child asked — and declining refunds (ADR-0014).
    decideRedemption: (householdId: string, redemptionId: string, decision: RedemptionDecision) =>
      call<{ status: DecideRedemptionResult }>(
        getToken,
        `/households/${householdId}/redemptions/${redemptionId}/decide`,
        json('POST', { decision }),
      ),
    listParents: (householdId: string) =>
      call<{ parents: Parent[]; invites: ParentInvite[] }>(
        getToken,
        `/households/${householdId}/parents`,
      ),
    inviteParent: (householdId: string, email: string) =>
      call<ParentInvite>(getToken, `/households/${householdId}/parents`, json('POST', { email })),
    setPin: (householdId: string, pin: string) =>
      call<Household>(getToken, `/households/${householdId}/pin`, json('PUT', { pin })),
    issueJoinCode: (householdId: string, childId: string) =>
      call<IssuedJoinCode>(getToken, `/households/${householdId}/children/${childId}/join-code`, {
        method: 'POST',
      }),
    listRewards: (householdId: string) =>
      call<Reward[]>(getToken, `/households/${householdId}/rewards`),
    // Hiding a built-in, and nothing more: a custom reward is M3's `custom_reward` gate.
    setRewardActive: (householdId: string, rewardId: string, active: boolean) =>
      call<Reward>(
        getToken,
        `/households/${householdId}/rewards/${rewardId}`,
        json('PATCH', { active }),
      ),
    registerDevice: (householdId: string, input: ParentDeviceInput) =>
      call<ParentDevice>(getToken, `/households/${householdId}/devices`, json('POST', input)),
    listChores: (householdId: string) =>
      call<Chore[]>(getToken, `/households/${householdId}/chores`),
    upsertChore: (householdId: string, choreId: string, op: UpsertChoreOp) =>
      call<Chore>(getToken, `/households/${householdId}/chores/${choreId}`, json('PUT', op)),
    deleteChore: (householdId: string, choreId: string) =>
      call<Chore>(
        getToken,
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
