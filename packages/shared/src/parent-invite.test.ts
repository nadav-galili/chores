import { describe, expect, it } from 'vitest';
import { parentInviteInputSchema } from './parent-invite.ts';

describe('parentInviteInputSchema', () => {
  it('normalizes an email so the invite is found whatever the partner types', () => {
    expect(parentInviteInputSchema.parse({ email: '  Dana@Example.COM ' })).toEqual({
      email: 'dana@example.com',
    });
  });

  it('rejects anything that is not an email', () => {
    expect(parentInviteInputSchema.safeParse({ email: 'dana' }).success).toBe(false);
    expect(parentInviteInputSchema.safeParse({ email: '' }).success).toBe(false);
  });
});
