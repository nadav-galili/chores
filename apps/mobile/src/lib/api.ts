import type {
  Child,
  ChildInput,
  Chore,
  CreateHouseholdInput,
  Household,
  Parent,
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
