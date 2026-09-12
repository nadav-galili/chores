import { z } from 'zod';
import type { Household } from './household.ts';

// Tiers (docs/spec/01-product.md, ADR-0005). The child side is never gated.
export const FREE_CHILD_QUOTA = 1;
export const FREE_PARENT_QUOTA = 2;
/** Days an over-quota child stays parent-editable on the free tier. */
export const GRACE_DAYS = 14;

export const gatedActionSchema = z.enum([
  'add_child',
  'edit_child',
  'add_parent',
  'custom_reward',
  'money_ledger',
  'full_history',
  'photo_proof',
]);
export type GatedAction = z.infer<typeof gatedActionSchema>;

/** The gate an action hits; the name goes to `paywall_shown{gate}`. */
export const gateSchema = z.enum([
  'child_quota',
  'parent_quota',
  'custom_rewards',
  'money_ledger',
  'full_history',
  'photo_proof',
]);
export type Gate = z.infer<typeof gateSchema>;

export type GateContext = {
  /** ISO instant to evaluate `read_only_after` against. */
  now: string;
  /** Children already in the household. */
  child_count: number;
  /** Parents already in the household. */
  parent_count: number;
  /** The child whose row or chore-assignment membership a parent is editing. */
  child?: { read_only_after: string | null };
};

export type GateResult =
  | { ok: true }
  /** Allowed under the free tier's grace: the new child must be stamped with this `read_only_after`. */
  | { ok: true; read_only_after: string }
  | { ok: false; gate: Gate };

const GATE_BY_ACTION: Record<GatedAction, Gate> = {
  add_child: 'child_quota',
  edit_child: 'child_quota',
  add_parent: 'parent_quota',
  custom_reward: 'custom_rewards',
  money_ledger: 'money_ledger',
  full_history: 'full_history',
  photo_proof: 'photo_proof',
};

export function gateFor(action: GatedAction): Gate {
  return GATE_BY_ACTION[action];
}

/**
 * Whether a parent in `household` may perform `action`. Premium may do everything; the free
 * tier hits gates. `edit_child` narrowly covers the child's own row and adding or removing that
 * child as a chore assignee. It does not cover a chore's title, icon or recurrence: a shared chore
 * belongs to the household, not to any one assignee. Only parent actions are listed; the child
 * side is never gated (ADR-0005).
 */
export function canDo(
  household: Pick<Household, 'entitlement'>,
  action: GatedAction,
  ctx: GateContext,
): GateResult {
  if (household.entitlement === 'premium') return { ok: true };
  const gate = GATE_BY_ACTION[action];
  switch (action) {
    case 'add_child':
      // Beyond the quota the child is added under grace and becomes parent-read-only later.
      return ctx.child_count < FREE_CHILD_QUOTA
        ? { ok: true }
        : { ok: true, read_only_after: graceEndsAt(ctx.now) };
    case 'add_parent':
      return ctx.parent_count < FREE_PARENT_QUOTA ? { ok: true } : { ok: false, gate };
    case 'edit_child': {
      const after = ctx.child?.read_only_after ?? null;
      return after !== null && Date.parse(after) <= Date.parse(ctx.now)
        ? { ok: false, gate }
        : { ok: true };
    }
    default:
      return { ok: false, gate };
  }
}

/** When a child added at `addedAt` on the free tier beyond the quota becomes read-only for parents. */
export function graceEndsAt(addedAt: string): string {
  return new Date(new Date(addedAt).getTime() + GRACE_DAYS * 86_400_000).toISOString();
}
