import { describe, expect, it } from 'vitest';
import {
  INSTANCE_WINDOW_DAYS,
  instanceWindow,
  syncRequestSchema,
  syncResponseSchema,
} from './sync.ts';

describe('instanceWindow', () => {
  it('is today ±14 days, inclusive', () => {
    expect(INSTANCE_WINDOW_DAYS).toBe(14);
    expect(instanceWindow('2026-09-09')).toEqual({ from: '2026-08-26', to: '2026-09-23' });
  });
});

describe('syncRequestSchema', () => {
  it('accepts a device id, a cursor and an (empty) ops list', () => {
    const parsed = syncRequestSchema.parse({
      device_id: '019930a0-0000-7000-8000-000000000000',
      cursor: 0,
      ops: [],
    });
    expect(parsed.cursor).toBe(0);
  });

  it('rejects a negative or fractional cursor', () => {
    const base = { device_id: '019930a0-0000-7000-8000-000000000000', ops: [] };
    expect(syncRequestSchema.safeParse({ ...base, cursor: -1 }).success).toBe(false);
    expect(syncRequestSchema.safeParse({ ...base, cursor: 1.5 }).success).toBe(false);
  });
});

describe('syncResponseSchema', () => {
  it('parses a pull page', () => {
    const parsed = syncResponseSchema.parse({
      acked: [],
      rejected: [],
      changes: [
        {
          seq: 7,
          table: 'chores',
          row_id: '019930a0-0000-7000-8000-000000000000',
          op: 'update',
          row: { id: '019930a0-0000-7000-8000-000000000000', title: 'Dishes' },
        },
      ],
      cursor: 7,
      has_more: false,
    });
    expect(parsed.changes[0]!.op).toBe('update');
  });
});
