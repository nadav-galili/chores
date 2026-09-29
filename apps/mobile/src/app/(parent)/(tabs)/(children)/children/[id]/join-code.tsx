import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { JoinCodeView } from '@/components/join-code-view';
import { Button } from '@/components/ui';
import { useHousehold, useHouseholdId } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/** How often the screen asks whether the child's device has joined, while it is on screen. */
const WATCH_MS = 3000;

/**
 * One child's join code, reached from the child's screen. Like setup's step it watches for the
 * device while focused, and turns into "connected" the moment it joins — a redeemed code with a
 * running countdown would say the opposite of what happened.
 */
export default function JoinCode() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useHousehold();
  const householdId = useHouseholdId();
  const [connected, setConnected] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!householdId || !id) return;
      let live = true;
      // The devices the child already had when the screen opened. Only a device that is not
      // among them is the news: a child with an older device is here to connect a new one, and
      // the older one syncing in the meantime must not read as it.
      let known: Set<string> | null = null;
      const check = async () => {
        try {
          const devices = await api.listChildDevices(householdId, id);
          if (known === null) {
            known = new Set(devices.map((d) => d.id));
            return;
          }
          const fresh = devices.some((d) => d.revoked_at === null && !known!.has(d.id));
          if (live && fresh) {
            live = false;
            setConnected(true);
          }
        } catch {
          // The next tick asks again; the code on screen works whether or not this answer arrives.
        }
      };
      void check();
      const timer = setInterval(() => void check(), WATCH_MS);
      return () => {
        live = false;
        clearInterval(timer);
      };
    }, [api, householdId, id]),
  );

  return (
    <JoinCodeView
      id={id}
      pinHref="/pin"
      connected={connected}
      footer={<Button name="done" title={t('common.done')} onPress={() => router.back()} />}
    />
  );
}
