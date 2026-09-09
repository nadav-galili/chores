import { describe, expect, it } from 'vitest';
import { childInputSchema, createHouseholdInputSchema } from './child.ts';

describe('childInputSchema', () => {
  const base = { first_name: 'Noa', ui_mode: 'little', pet_name: 'Pip' };

  it('accepts a child with a local HH:MM reminder time', () => {
    const parsed = childInputSchema.parse({ ...base, reminder_time: '07:30' });
    expect(parsed.reminder_time).toBe('07:30');
  });

  it('defaults reminder_time to null', () => {
    expect(childInputSchema.parse(base).reminder_time).toBeNull();
  });

  it('rejects a reminder time that is not HH:MM', () => {
    expect(childInputSchema.safeParse({ ...base, reminder_time: '25:00' }).success).toBe(false);
    expect(childInputSchema.safeParse({ ...base, reminder_time: '7:30' }).success).toBe(false);
  });

  it('rejects ui_mode outside little|big and a blank first name', () => {
    expect(childInputSchema.safeParse({ ...base, ui_mode: 'teen' }).success).toBe(false);
    expect(childInputSchema.safeParse({ ...base, first_name: '  ' }).success).toBe(false);
  });

  it('trims the first name and pet name', () => {
    const parsed = childInputSchema.parse({ ...base, first_name: ' Noa ', pet_name: ' Pip ' });
    expect(parsed.first_name).toBe('Noa');
    expect(parsed.pet_name).toBe('Pip');
  });
});

describe('createHouseholdInputSchema', () => {
  it('requires an IANA timezone and a supported currency', () => {
    expect(
      createHouseholdInputSchema.safeParse({
        name: 'Galili',
        tz: 'Asia/Jerusalem',
        currency: 'ILS',
      }).success,
    ).toBe(true);
    expect(
      createHouseholdInputSchema.safeParse({ name: 'Galili', tz: 'Mars/Olympus', currency: 'ILS' })
        .success,
    ).toBe(false);
    expect(
      createHouseholdInputSchema.safeParse({
        name: 'Galili',
        tz: 'Asia/Jerusalem',
        currency: 'EUR',
      }).success,
    ).toBe(false);
  });
});
