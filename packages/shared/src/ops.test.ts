import { describe, expect, it } from 'vitest';
import { kidOpSchema } from './ops.ts';
import { uuid7 } from './uuid7.ts';

const complete = (payload: Record<string, unknown>) => ({
  op_id: uuid7(),
  type: 'complete',
  payload: {
    completion_id: uuid7(),
    chore_id: uuid7(),
    chore_date: '2026-09-09',
    completed_at: '2026-09-09T10:00:00.000Z',
    ...payload,
  },
});

describe('kidOpSchema', () => {
  it('accepts a complete op', () => {
    expect(kidOpSchema.safeParse(complete({})).success).toBe(true);
  });

  it('accepts an uncomplete op', () => {
    const op = { op_id: uuid7(), type: 'uncomplete', payload: { completion_id: uuid7() } };
    expect(kidOpSchema.safeParse(op).success).toBe(true);
  });

  it('refuses a chore date that is not YYYY-MM-DD', () => {
    expect(kidOpSchema.safeParse(complete({ chore_date: '9/9/2026' })).success).toBe(false);
    expect(kidOpSchema.safeParse(complete({ chore_date: '2026-09-09T00:00:00Z' })).success).toBe(
      false,
    );
  });

  it('refuses a completed_at that is not an instant', () => {
    expect(kidOpSchema.safeParse(complete({ completed_at: '2026-09-09' })).success).toBe(false);
  });

  it('refuses an op type it does not know', () => {
    const op = { op_id: uuid7(), type: 'reject_completion', payload: {} };
    expect(kidOpSchema.safeParse(op).success).toBe(false);
  });
});
