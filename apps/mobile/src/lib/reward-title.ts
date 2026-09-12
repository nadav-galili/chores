import type { BuiltinRewardKey } from '@chores/shared';
import { t, type TranslationKey } from './i18n';

/**
 * A built-in's name, in the reader's language. The seeded row carries the key and no title
 * (packages/shared/src/reward.ts), so the household is never stuck in the language it was created
 * in: the parent reads the same reward in theirs and the child in theirs. A custom reward, when
 * M3 has them, carries the words a parent wrote and is rendered as written.
 */
const BUILTIN_TITLES = {
  snack: 'rewards.builtin.snack',
  screen_time: 'rewards.builtin.screen_time',
  friday_dinner: 'rewards.builtin.friday_dinner',
} as const satisfies Record<BuiltinRewardKey, TranslationKey>;

/** Everything with a name: a catalog row, a shop row, a request on the parent's today screen. */
export type Titled = { builtin_key: BuiltinRewardKey | null; title: string | null };

export const rewardTitle = (reward: Titled) =>
  reward.title ?? (reward.builtin_key ? t(BUILTIN_TITLES[reward.builtin_key]) : '');
