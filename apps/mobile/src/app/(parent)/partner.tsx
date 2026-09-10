import type { Parent, ParentInvite } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

const KNOWN_ERRORS = ['gated', 'already_in_household', 'invalid_body'] as const;
const isKnownError = (code: string): code is (typeof KNOWN_ERRORS)[number] =>
  (KNOWN_ERRORS as readonly string[]).includes(code);

/** Add the partner by email: they become a parent of this household on their first sign-in. */
export default function Partner() {
  const state = useHousehold();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<{ parents: Parent[]; invites: ParentInvite[] } | null>(null);
  const householdId = state.status === 'ready' ? (state.me.household?.id ?? null) : null;
  const { api } = state;

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setPeople(await api.listParents(householdId));
    } catch {
      setPeople(null);
    }
  }, [api, householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!householdId) return null;

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await api.inviteParent(householdId, email);
        setEmail('');
        await load();
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'unknown';
        setError(isKnownError(code) ? t(`partner.error.${code}`) : t('partner.error.failed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const pending = people?.invites.filter((i) => i.accepted_at === null) ?? [];

  return (
    <Screen>
      <Title>{t('partner.title')}</Title>
      <Text style={styles.hint}>{t('partner.hint')}</Text>
      <View style={styles.people}>
        {people?.parents.map((p) => (
          <Text key={p.id} style={styles.person}>
            {p.email ?? p.display_name ?? t('partner.signedIn')}
          </Text>
        ))}
        {pending.map((i) => (
          <Text key={i.email} style={styles.pending}>
            {t('partner.pending', { email: i.email })}
          </Text>
        ))}
      </View>
      <Field
        label={t('partner.emailLabel')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="name@example.com"
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={t('partner.add')}
        onPress={submit}
        disabled={busy || email.trim().length === 0}
      />
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#555', fontSize: 15 },
  people: { gap: 4 },
  person: { fontSize: 17 },
  pending: { fontSize: 17, color: '#888' },
});
