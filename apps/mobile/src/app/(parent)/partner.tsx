import type { Parent, ParentInvite } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useHousehold } from '@/lib/household-context';

const MESSAGES: Record<string, string> = {
  gated: 'The free plan covers two parents.',
  already_in_household: 'That email already belongs to a household.',
  invalid_body: 'That does not look like an email address.',
};

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
        setError(MESSAGES[code] ?? 'Could not add them. Try again.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const pending = people?.invites.filter((i) => i.accepted_at === null) ?? [];

  return (
    <Screen>
      <Title>Your partner</Title>
      <Text style={styles.hint}>
        They sign in with this email and land in this household. Two parents on the free plan.
      </Text>
      <View style={styles.people}>
        {people?.parents.map((p) => (
          <Text key={p.id} style={styles.person}>
            {p.email ?? p.display_name ?? 'Signed in'}
          </Text>
        ))}
        {pending.map((i) => (
          <Text key={i.email} style={styles.pending}>{`${i.email} · waiting for sign-in`}</Text>
        ))}
      </View>
      <Field
        label="Partner’s email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="name@example.com"
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Add partner" onPress={submit} disabled={busy || email.trim().length === 0} />
      <Button title="Back" onPress={() => router.back()} secondary />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#555', fontSize: 15 },
  people: { gap: 4 },
  person: { fontSize: 17 },
  pending: { fontSize: 17, color: '#888' },
});
