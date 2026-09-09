import { z } from 'zod';
import { currencySchema } from './household.ts';

export const uiModeSchema = z.enum(['little', 'big']);
export type UiMode = z.infer<typeof uiModeSchema>;

/** Household-local wall-clock time, `HH:MM`, 24h. */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

const name = z.string().trim().min(1).max(40);

/** What a parent submits when adding or editing a child. */
export const childInputSchema = z.object({
  first_name: name,
  ui_mode: uiModeSchema,
  pet_name: name,
  reminder_time: localTimeSchema.nullable().default(null),
});
export type ChildInput = z.infer<typeof childInputSchema>;

export const childSchema = childInputSchema.extend({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  read_only_after: z.string().datetime().nullable(),
  sort: z.number().int(),
  created_at: z.string().datetime(),
});
export type Child = z.infer<typeof childSchema>;

export const parentSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  clerk_user_id: z.string().min(1),
  display_name: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type Parent = z.infer<typeof parentSchema>;

function isIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const createHouseholdInputSchema = z.object({
  name: name,
  tz: z.string().refine(isIanaTimeZone, 'expected an IANA timezone'),
  currency: currencySchema,
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdInputSchema>;
