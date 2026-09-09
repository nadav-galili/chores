import { z } from 'zod';

export const currencySchema = z.enum(['ILS', 'USD']);
export const entitlementSchema = z.enum(['free', 'premium']);

export const householdSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tz: z.string().min(1),
  day_boundary_hour: z.number().int().min(0).max(6),
  digest_hour: z.number().int().min(0).max(23),
  currency: currencySchema,
  coins_per_unit: z.number().int().positive(),
  entitlement: entitlementSchema,
  entitlement_source: z.string().nullable(),
  created_at: z.string().datetime(),
});

export type Household = z.infer<typeof householdSchema>;
