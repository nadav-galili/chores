import { pinSchema } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen, Title, Body } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/** Sets or replaces the household's Parent PIN. No old PIN is asked for: the session outranks it. */
export default function Pin() {
  const state = useHousehold();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const householdId = state.status === 'ready' ? (state.me.household?.id ?? null) : null;
  const { api } = state;

  if (!householdId) return null;

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await api.setPin(householdId, pin);
        router.back();
      } catch (e) {
        setError(withCause(t('pin.failed'), e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Screen>
      <Title>{t('pin.title')}</Title>
      <Body>{t('pin.hint')}</Body>
      <Field
        label={t('pin.label')}
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
        maxLength={4}
        secureTextEntry
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={t('pin.save')}
        onPress={submit}
        disabled={busy || !pinSchema.safeParse(pin).success}
      />
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}
