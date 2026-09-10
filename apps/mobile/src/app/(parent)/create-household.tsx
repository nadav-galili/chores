import type { Household } from '@chores/shared';
import { getCalendars, getLocales } from 'expo-localization';
import { useState } from 'react';
import { Button, Choice, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

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
    } catch {
      setError(t('household.failed'));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('household.title')}</Title>
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
    </Screen>
  );
}
