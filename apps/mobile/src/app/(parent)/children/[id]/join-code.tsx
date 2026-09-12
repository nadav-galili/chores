import type { IssuedJoinCode } from '@chores/shared';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { useThemedStyles, type Theme } from '@/theme';

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Shows one child's join code large enough to read across the room; a new one on demand. */
export default function JoinCode() {
  const state = useHousehold();
  const router = useRouter();
  const styles = useThemedStyles(joinCodeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [issued, setIssued] = useState<IssuedJoinCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const householdId = state.status === 'ready' ? state.me.household?.id : undefined;
  const child = state.status === 'ready' ? state.me.children.find((c) => c.id === id) : undefined;
  const api = state.api;

  // Issuing is refused while the household has no Parent PIN, because kid mode would have no way
  // out (ADR-0013). That answer is a destination, not a failure: the parent is sent to set one,
  // and the next visit to this screen issues the code.
  const issuedFor = useRef<string | null>(null);
  const issue = useCallback(async () => {
    if (!householdId || !id) return;
    setError(null);
    try {
      setIssued(await api.issueJoinCode(householdId, id));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'pin_required') {
        issuedFor.current = null;
        setError(t('joinCode.pinRequired'));
        router.push('/(parent)/pin');
        return;
      }
      setError(withCause(t('joinCode.failed'), e));
    }
  }, [api, householdId, id, router]);

  // Issue once per child, and not once per `issue` identity. `api` is rebuilt whenever Clerk
  // hands back a new token getter, which makes `issue` a new function, and this screen
  // re-renders every second to move the countdown — so depending on the callback alone issued
  // a fresh code continuously, replacing the digits on screen before a parent could finish
  // reading them out. Old codes stay valid for their own fifteen minutes, so the cost was a
  // parent who could not use any of them, plus an unthrottled write loop against the API.
  useFocusEffect(
    useCallback(() => {
      const key = householdId && id ? `${householdId}/${id}` : null;
      if (key === null || issuedFor.current === key) return;
      issuedFor.current = key;
      void issue();
    }, [householdId, id, issue]),
  );

  if (!child) return null;
  const remaining = issued ? new Date(issued.expires_at).getTime() - now : 0;
  const expired = issued !== null && remaining <= 0;

  return (
    <Screen>
      <Title>{t('joinCode.title', { name: child.first_name })}</Title>
      <Text style={styles.hint}>{t('joinCode.hint', { name: child.first_name })}</Text>
      <View style={styles.codeBox}>
        <Text
          style={[styles.code, expired && styles.codeExpired]}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {issued ? issued.code : '······'}
        </Text>
        <Text style={styles.expiry}>
          {issued
            ? expired
              ? t('joinCode.expired')
              : t('joinCode.expiresIn', { time: mmss(remaining) })
            : t('joinCode.getting')}
        </Text>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title={t('joinCode.newCode')} onPress={() => void issue()} secondary />
      <Button title={t('common.done')} onPress={() => router.back()} />
    </Screen>
  );
}

/**
 * The "expired join code" state lives here: when the countdown reaches zero the code dims,
 * the copy says it expired, and getting a new one is one tap away. Copy plus an action,
 * no illustration.
 */
const joinCodeStyles = (theme: Theme) => ({
  hint: { ...theme.type.body, color: theme.colors.muted },
  codeBox: { alignItems: 'center' as const, paddingVertical: theme.space.xxl, gap: theme.space.md },
  code: {
    fontSize: 64,
    fontWeight: '700' as const,
    letterSpacing: 12,
    fontVariant: ['tabular-nums' as const],
    color: theme.colors.text,
  },
  codeExpired: { color: theme.colors.muted },
  expiry: { ...theme.type.body, color: theme.colors.muted },
});
