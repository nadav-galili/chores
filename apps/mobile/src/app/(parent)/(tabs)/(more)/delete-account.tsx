import { useAuth } from '@clerk/expo';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, ErrorText, ScrollScreen } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * Account Deletion, and Household Deletion when this is the last parent (ADR-0019).
 *
 * Only here, under the parent's own signed-in More tab: the route needs a Clerk session, which a
 * Kid Device never holds. Its PIN exit leads here only on a phone where a parent is signed in. Two confirmations and no
 * modal, as the device revoke does it: the first tap arms, the second deletes. The last parent's
 * second step names the children whose history goes, because that sentence is the one that
 * matters. The subscription warning comes before either tap — deleting cancels nothing at the
 * store, and after deletion there is no account left to remind.
 *
 * Immediate, with no grace period. On success the Clerk user no longer exists, so signing out is
 * all that is left to do; the root layout takes the device back to sign-in.
 */
export default function DeleteAccount() {
  const state = useHousehold();
  const { signOut } = useAuth();
  const styles = useThemedStyles(deleteStyles);
  const [parentCount, setParentCount] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const householdId = state.status === 'ready' ? (state.me.household?.id ?? null) : null;
  const { api } = state;

  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      setParentCount((await api.listParents(householdId)).parents.length);
      setError(null);
    } catch (e) {
      // Without the count the screen cannot say what will be deleted, so it does not offer to.
      setError(withCause(t('deleteAccount.loadFailed'), e));
    }
  }, [api, householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status !== 'ready') return null;
  const countLoaded = !householdId || parentCount !== null;
  const lastParent = !householdId || parentCount === 1;
  const names = state.me.children.map((c) => c.first_name).join(', ');

  const deleteForGood = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await api.deleteAccount();
      } catch (e) {
        setError(withCause(t('deleteAccount.failed'), e));
        setBusy(false);
        return;
      }
      try {
        await signOut();
      } catch (e) {
        // The account is already gone server-side; a sign-out that fails leaves a session for a
        // user Clerk no longer has, which the next request answers with 401 and sign-in.
        console.error('sign-out after account deletion failed', e);
      }
    })();
  };

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: t('deleteAccount.title') }} />
      <Body>{t('deleteAccount.intro')}</Body>
      {countLoaded ? (
        <Body>{t(lastParent ? 'deleteAccount.lastParent' : 'deleteAccount.partnerStays')}</Body>
      ) : null}
      <Text style={styles.warning}>{t('deleteAccount.subscription')}</Text>
      <ErrorText>{error}</ErrorText>
      {armed ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmTitle}>{t('deleteAccount.confirmTitle')}</Text>
          <Text style={styles.confirmBody}>
            {!lastParent
              ? t('deleteAccount.confirmPartner')
              : names
                ? t('deleteAccount.confirmLast', { names })
                : t('deleteAccount.confirmLastNoChildren')}
          </Text>
          <Button
            name="delete_account_confirm"
            title={busy ? t('deleteAccount.deleting') : t('deleteAccount.confirm')}
            onPress={deleteForGood}
            disabled={busy}
          />
          <Button
            name="delete_account_cancel"
            title={t('deleteAccount.cancel')}
            secondary
            onPress={() => setArmed(false)}
            disabled={busy}
          />
        </View>
      ) : (
        <Button
          name="delete_account"
          title={t('deleteAccount.start')}
          secondary
          onPress={() => setArmed(true)}
          disabled={!countLoaded}
        />
      )}
    </ScrollScreen>
  );
}

const deleteStyles = (theme: Theme) => ({
  warning: { ...theme.type.body, color: theme.colors.danger },
  confirm: { gap: theme.space.sm },
  confirmTitle: { ...theme.type.body, color: theme.colors.danger },
  confirmBody: { ...theme.type.label, color: theme.colors.muted },
});
