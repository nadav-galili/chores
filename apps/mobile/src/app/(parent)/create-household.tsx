import type { Household } from '@chores/shared';
import { getCalendars, getLocales } from 'expo-localization';
import { useState } from 'react';
import { Button, Choice, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';

type Currency = Household['currency'];

const phoneTz = getCalendars()[0]?.timeZone ?? 'UTC';
const phoneCurrency: Currency = getLocales()[0]?.regionCode === 'IL' ? 'ILS' : 'USD';

export default function CreateHousehold() {
  const { api, refresh } = useHousehold();
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
      setError(e instanceof Error ? e.message : 'Could not create the household');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Set up your household</Title>
      <Field label="Household name" value={name} onChangeText={setName} placeholder="The Galilis" />
      <Choice
        label="Currency"
        value={currency}
        onChange={setCurrency}
        options={[
          { value: 'ILS', title: '₪ ILS' },
          { value: 'USD', title: '$ USD' },
        ]}
      />
      <Field label="Timezone (from this phone)" value={phoneTz} editable={false} />
      <ErrorText>{error}</ErrorText>
      <Button title="Create household" onPress={submit} disabled={busy || !name.trim()} />
    </Screen>
  );
}
