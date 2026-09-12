import { z } from 'zod';
import { uiModeSchema } from './child.ts';

/** Upper-case letters and digits minus the look-alikes (0/O, 1/I/L), so a child can read it off a screen. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_TTL_MS = 15 * 60 * 1000;

/** A fresh code; `random` must return a float in [0, 1). Pass a CSPRNG-backed source in production. */
export function generateJoinCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    const index = Math.min(
      JOIN_CODE_ALPHABET.length - 1,
      Math.floor(random() * JOIN_CODE_ALPHABET.length),
    );
    code += JOIN_CODE_ALPHABET[index];
  }
  return code;
}

const codePattern = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** What a child types, normalized: case, spaces and dashes are forgiven. */
export const joinCodeSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(codePattern, 'expected a 6-character code'));

export type JoinCodeStatus = 'live' | 'expired' | 'redeemed';

export function joinCodeStatus(
  code: { expiresAt: Date; redeemedAt: Date | null },
  now: Date,
): JoinCodeStatus {
  if (code.redeemedAt) return 'redeemed';
  if (now.getTime() >= code.expiresAt.getTime()) return 'expired';
  return 'live';
}

export const platformSchema = z.enum(['ios', 'android']);
export type DevicePlatform = z.infer<typeof platformSchema>;

export const redeemJoinCodeInputSchema = z.object({
  code: joinCodeSchema,
  platform: platformSchema,
});
export type RedeemJoinCodeInput = z.infer<typeof redeemJoinCodeInputSchema>;

/** Issued to a parent; shown large on their screen. */
export const issuedJoinCodeSchema = z.object({
  code: z.string(),
  child_id: z.string().uuid(),
  expires_at: z.string().datetime(),
});
export type IssuedJoinCode = z.infer<typeof issuedJoinCodeSchema>;

/** The child as the kid device sees it: first name only, nothing else about the person. */
export const childSummarySchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  ui_mode: uiModeSchema,
  pet_name: z.string(),
});
export type ChildSummary = z.infer<typeof childSummarySchema>;

/**
 * The household as the kid device sees it. `tz` and `day_boundary_hour` never ride the change log,
 * and neither does the Parent PIN: all three arrive with the session and are refreshed from
 * `GET /device/me` on every open (ADR-0013). The two pin fields are optional so a session stored
 * before they existed still parses.
 */
export const householdSummarySchema = z.object({
  id: z.string().uuid(),
  tz: z.string(),
  day_boundary_hour: z.number().int().min(0).max(6),
  pin_hash: z.string().nullish(),
  pin_salt: z.string().nullish(),
});
export type HouseholdSummary = z.infer<typeof householdSummarySchema>;

/** The redeem response, which the kid device persists as its session. */
export const deviceSessionSchema = z.object({
  device_id: z.string().uuid(),
  device_token: z.string().min(1),
  analytics_anon_id: z.string().min(1),
  child: childSummarySchema,
  household: householdSummarySchema,
});
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
