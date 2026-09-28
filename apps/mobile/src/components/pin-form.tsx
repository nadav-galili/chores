import { pinSchema } from '@chores/shared';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Body, Button, ErrorText, Field, ScrollScreen } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/**
 * Sets or replaces the household's Parent PIN. No old PIN is asked for: the session outranks it.
 * Shared by More → Parent PIN and guided setup's PIN step, which differ only in the line above the
 * field, where a save goes, and setup's way out.
 */
export function PinForm({
  intro,
  onSaved,
  footer,
}: {
  intro: string;
  onSaved: () => void | Promise<void>;
  footer?: React.ReactNode;
}) {
  const state = useHousehold();
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
        await onSaved();
      } catch (e) {
        setError(withCause(t('pin.failed'), e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: t('pin.title') }} />
      <Body>{intro}</Body>
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
      {footer}
    </ScrollScreen>
  );
}
