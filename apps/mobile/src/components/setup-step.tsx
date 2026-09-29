import { onboardingStepViewed } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Body, Button } from '@/components/ui';
import { captureParentEvent } from '@/lib/analytics';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { nextSetupHref, setupPurpose, TODAY_HREF, type SetupStepScreen } from '@/lib/setup';

/**
 * What every guided-setup step shares, so a step screen is only its own form (spec #86, Routing).
 * Mounting counts one view of the step. `advance` re-reads `/me` and moves to whatever
 * `nextSetupStep` says is next — replacing this step, so setup never piles up a back stack —
 * and `finishLater` drops the parent on Today, where the Finish setup card takes over.
 */
export function useSetupStep(step: SetupStepScreen) {
  const { refresh } = useHousehold();
  const router = useRouter();

  // One mount is one view: advancing replaces the screen, so the next step mounts afresh.
  useEffect(() => {
    captureParentEvent(onboardingStepViewed({ step }));
  }, [step]);

  const finishLater = useCallback(() => router.dismissTo(TODAY_HREF), [router]);

  const advance = useCallback(async () => {
    const me = await refresh();
    const next = me ? nextSetupHref(me) : null;
    if (next) router.replace(next);
    else router.dismissTo(TODAY_HREF);
  }, [refresh, router]);

  return { advance, finishLater };
}

/** The step's one line on what it is for. */
export function SetupPurpose({ step }: { step: SetupStepScreen }) {
  return <Body>{setupPurpose(step)}</Body>;
}

/** "I'll finish later": off to Today, where the card names the step left. */
export function FinishLater({ onPress }: { onPress: () => void }) {
  return <Button name="finish_later" title={t('setup.finishLater')} onPress={onPress} secondary />;
}
