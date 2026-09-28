import type { SetupStep } from '@chores/shared';
import type { Href } from 'expo-router';

/** Where "I'll finish later" lands, and where setup ends: the Today tab. */
export const TODAY: Href = '/(parent)/(tabs)/(today)';

/**
 * Where each unfinished setup step lives. The routes sit above the tab bar (`(parent)/setup/*`),
 * so a step covers the tabs and cannot be skipped by tapping one. The Join Code is the first
 * child's: guided setup sets up one child. `household` is `create-household`, which the gate
 * owns, and `done` has nowhere to go.
 */
export function setupStepHref(step: SetupStep, firstChildId: string | undefined): Href | null {
  switch (step) {
    case 'child':
      return '/setup/child';
    case 'chore':
      return '/setup/chore';
    case 'pin':
      return '/setup/pin';
    case 'join_code':
      return firstChildId ? { pathname: '/setup/join-code', params: { id: firstChildId } } : null;
    case 'household':
    case 'done':
      return null;
  }
}
