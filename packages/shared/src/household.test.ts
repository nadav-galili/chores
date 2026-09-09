import { describe, expect, it } from 'vitest';
import { householdSchema } from './household.ts';

const row = {
  id: '3c9c5b2a-0d4e-4c1a-9a4f-1f0d8b7e6a21',
  name: 'Galili',
  tz: 'Asia/Jerusalem',
  day_boundary_hour: 3,
  digest_hour: 20,
  currency: 'ILS',
  coins_per_unit: 10,
  entitlement: 'free',
  entitlement_source: null,
  created_at: '2026-09-09T06:00:00.000Z',
};

describe('householdSchema', () => {
  it('accepts a household row from the data model', () => {
    expect(householdSchema.parse(row)).toEqual(row);
  });

  it('rejects a day boundary outside 0–6', () => {
    expect(householdSchema.safeParse({ ...row, day_boundary_hour: 7 }).success).toBe(false);
  });
});
