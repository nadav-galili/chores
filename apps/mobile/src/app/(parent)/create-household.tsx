import type { Household } from '@chores/shared';
import { Stack } from 'expo-router';
import { getCalendars, getLocales } from 'expo-localization';
import { useState } from 'react';
import { SetupPurpose, useSetupStep } from '@/components/setup-step';
import { Button, Choice, ErrorText, Field, ScrollScreen } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

type Currency = Household['currency'];

const phoneTz = getCalendars()[0]?.timeZone ?? 'UTC';
const phoneCurrency: Currency = getLocales()[0]?.regionCode === 'IL' ? 'ILS' : 'USD';

/**
 * Guided setup's first step. There is no "I'll finish later" here: Today needs a household to
 * exist. Once one does, the gate moves the parent on to the next step.
 */
export default function CreateHousehold() {
  const { api, refresh } = useHousehold();
  useSetupStep('household');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>(phoneCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createHousehold({ name: name.trim(), tz: phoneTz, currency });
      await refresh();
    } catch (e) {
      setError(withCause(t('household.failed'), e));
      setBusy(false);
    }
  };

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: t('household.title') }} />
      <SetupPurpose step="household" />
      <Field
        label={t('household.name')}
        value={name}
        onChangeText={setName}
        placeholder={t('household.namePlaceholder')}
      />
      <Choice
        label={t('household.currency')}
        value={currency}
        onChange={setCurrency}
        options={[
          { value: 'ILS', title: t('household.ils') },
          { value: 'USD', title: t('household.usd') },
        ]}
      />
      <Field label={t('household.tz')} value={phoneTz} editable={false} />
      <ErrorText>{error}</ErrorText>
      <Button title={t('household.create')} onPress={submit} disabled={busy || !name.trim()} />
    </ScrollScreen>
  );
}
