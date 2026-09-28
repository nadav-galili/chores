import { appLinkMessage } from '@chores/shared';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Share } from 'react-native';
import { JoinCodeView } from '@/components/join-code-view';
import { FinishLater, SetupPurpose, useSetupStep } from '@/components/setup-step';
import { Button } from '@/components/ui';
import { writeAwaitingDeviceRecord } from '@/lib/connected';
import { useHousehold, useHouseholdId } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/** How often the step asks whether the child's device has joined, while it is on screen. */
const WATCH_MS = 3000;

/**
 * Where the `409 pin_required` backstop sets the PIN: setup's own PIN step, told to come back here
 * once saved rather than advance to a second Join Code step on top of this one.
 */
const PIN_BACKSTOP: Href = { pathname: '/setup/pin', params: { then: 'back' } };

/**
 * Guided setup's Join Code step, above the tab bar (spec #86), for the child in `?id=`. Setup ends
 * when that child's device joins: while this screen is focused it watches the child's devices and
 * moves on to "connected" by itself. Until then the way out is "I'll finish later", and this phone
 * remembers it was waiting, so the confirmation still shows once on the parent's next open.
 */
export default function SetupJoinCode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { finishLater } = useSetupStep('join_code');
  const { api } = useHousehold();
  const householdId = useHouseholdId();
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      if (!householdId || !id) return;
      writeAwaitingDeviceRecord(id);
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
      pinHref={PIN_BACKSTOP}
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
