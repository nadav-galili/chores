import { z } from 'zod';

/** An email as it is stored and matched: trimmed and lower-cased, so `A@b.com` finds `a@b.com`. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.string().email().max(320));

/** What a parent submits to add their partner. */
export const parentInviteInputSchema = z.object({ email: emailSchema });
export type ParentInviteInput = z.infer<typeof parentInviteInputSchema>;

export const parentInviteSchema = z.object({
  email: z.string(),
  household_id: z.string().uuid(),
  invited_by: z.string().uuid(),
  created_at: z.string().datetime(),
  accepted_at: z.string().datetime().nullable(),
});
export type ParentInvite = z.infer<typeof parentInviteSchema>;
