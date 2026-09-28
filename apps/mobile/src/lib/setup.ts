import { nextSetupStep, type SetupStep } from '@chores/shared';
import type { Href } from 'expo-router';
import type { Me } from '@/lib/api';
import { t, type TranslationKey } from '@/lib/i18n';

/** The Today tab's route: where "I'll finish later" lands, and where setup ends. */
export const TODAY_HREF: Href = '/(parent)/(tabs)/(today)';

/** A guided-setup step that is a screen of its own — every step but `done`. */
export type SetupStepScreen = Exclude<SetupStep, 'done'>;

type FirstChild = Pick<Me['children'][number], 'id' | 'first_name'> | undefined;

/**
 * Each setup step's route, its name on Today's Finish setup card, and its one line on what it is
 * for. The routes sit above the tab bar (`(parent)/setup/*`), so a step covers the tabs and cannot
 * be skipped by tapping one. The Join Code is the first child's: guided setup sets up one child.
 * `household` is `create-household`, which the gate owns, so it has no route or card here.
 */
const STEPS: Record<
  SetupStepScreen,
  {
    href: (child: FirstChild) => Href | null;
    card: (child: FirstChild) => string | null;
    purpose: TranslationKey;
  }
> = {
  household: { href: () => null, card: () => null, purpose: 'setup.purpose.household' },
  child: {
    href: () => '/setup/child',
    card: () => t('parent.setup.child'),
    purpose: 'setup.purpose.child',
  },
  chore: {
    href: () => '/setup/chore',
    card: () => t('parent.setup.chore'),
    purpose: 'setup.purpose.chore',
  },
  pin: {
    href: () => '/setup/pin',
    card: () => t('parent.setup.pin'),
    purpose: 'setup.purpose.pin',
  },
  join_code: {
    href: (child) => (child ? { pathname: '/setup/join-code', params: { id: child.id } } : null),
    card: (child) => (child ? t('parent.setup.joinCode', { name: child.first_name }) : null),
    purpose: 'setup.purpose.join_code',
  },
};

/** Where `step` lives for this household, or null for a step with no screen to go to. */
export function setupStepHref(step: SetupStep, me: Pick<Me, 'children'>): Href | null {
  return step === 'done' ? null : STEPS[step].href(me.children[0]);
}

/** Where this household's first unfinished setup step lives, or null for none. */
export function nextSetupHref(me: Pick<Me, 'setup' | 'children'>): Href | null {
  return setupStepHref(nextSetupStep(me.setup), me);
}

/** The next step as Today's Finish setup card names it, or null when there is no card. */
export function setupCardLabel(step: SetupStep, firstChild: FirstChild): string | null {
  return step === 'done' ? null : STEPS[step].card(firstChild);
}

/** The step's one line on what it is for. */
export function setupPurpose(step: SetupStepScreen): string {
  return t(STEPS[step].purpose);
}
