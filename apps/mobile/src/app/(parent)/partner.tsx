import type { Parent, ParentInvite } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { useThemedStyles, type Theme } from '@/theme';

const KNOWN_ERRORS = ['gated', 'already_in_household', 'invalid_body'] as const;
const isKnownError = (code: string): code is (typeof KNOWN_ERRORS)[number] =>
  (KNOWN_ERRORS as readonly string[]).includes(code);

/** Add the partner by email: they become a parent of this household on their first sign-in. */
export default function Partner() {
  const state = useHousehold();
  const router = useRouter();
  const styles = useThemedStyles(partnerStyles);
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
      setError(null);
    } catch (e) {
      // An empty list and a list that failed to load look identical on screen, and the second one
      // reads as "no partner yet" — so the parent is told which one this is, and why.
      setPeople(null);
      setError(withCause(t('partner.error.loadFailed'), e));
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
        // A code the screen has words for reads as those words; anything else keeps the cause.
        setError(
          isKnownError(code) ? t(`partner.error.${code}`) : withCause(t('partner.error.failed'), e),
        );
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

/** A parent who has signed in reads as text; one who has only been invited reads as muted. */
const partnerStyles = (theme: Theme) => ({
  hint: { ...theme.type.label, color: theme.colors.muted },
  people: { gap: theme.space.xs },
  person: { ...theme.type.body, color: theme.colors.text },
  pending: { ...theme.type.body, color: theme.colors.muted },
});
