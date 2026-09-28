import { appLinkMessage } from '@chores/shared';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Share } from 'react-native';
import { JoinCodeView } from '@/components/join-code-view';
import { FinishLater, SetupPurpose, useSetupStep } from '@/components/setup-step';
import { Button } from '@/components/ui';
import { awaitDevice } from '@/lib/connected';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/** How often the step asks whether the child's device has joined, while it is on screen. */
const WATCH_MS = 3000;

/**
 * Guided setup's Join Code step, above the tab bar (spec #86), for the child in `?id=`. Setup ends
 * when that child's device joins: while this screen is focused it watches the child's devices and
 * moves on to "connected" by itself. Until then the way out is "I'll finish later", and this phone
 * remembers it was waiting, so the confirmation still shows once on the parent's next open.
 */
export default function SetupJoinCode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { finishLater } = useSetupStep('join_code');
  const state = useHousehold();
  const router = useRouter();
  const householdId = state.status === 'ready' ? state.me.household?.id : undefined;
  const { api } = state;

  useFocusEffect(
    useCallback(() => {
      if (!householdId || !id) return;
      awaitDevice(id);
      let live = true;
      const check = async () => {
        try {
          const devices = await api.listChildDevices(householdId, id);
          if (live && devices.length > 0) {
            live = false;
            router.replace({ pathname: '/setup/connected', params: { id } });
          }
        } catch {
          // The next tick asks again; the code on screen works whether or not this answer arrives.
        }
      };
      const timer = setInterval(() => void check(), WATCH_MS);
      return () => {
        live = false;
        clearInterval(timer);
      };
    }, [api, householdId, id, router]),
  );

  return (
    <JoinCodeView
      id={id}
      intro={<SetupPurpose step="join_code" />}
      pinHref="/setup/pin"
      footer={
        <>
          <Button title={t('setup.appLink.send')} onPress={() => void sendAppLink()} />
          <FinishLater onPress={finishLater} />
        </>
      }
    />
  );
}

/** The share sheet with both store links and one line. Never the Join Code. */
async function sendAppLink() {
  try {
    await Share.share({ message: appLinkMessage(t('setup.appLink.message')) });
  } catch {
    // The OS sheet failed to open; the parent is looking at the button and can tap it again, and
    // there is nothing else they could do with the cause.
  }
}
