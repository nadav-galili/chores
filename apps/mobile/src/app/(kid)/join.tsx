import { useAuth } from '@clerk/expo';
import { joinCodeSchema, platformSchema } from '@chores/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';
import { Button, ErrorText, Screen, Title } from '@/components/ui';
import { ApiError, redeemJoinCode } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useDeviceSession } from '@/lib/device-session';
import { clearRole, setRole } from '@/lib/role';

const REDEEM_ERRORS = ['invalid_code', 'code_expired', 'code_redeemed', 'rate_limited'] as const;
type RedeemError = (typeof REDEEM_ERRORS)[number];
const isRedeemError = (code: string): code is RedeemError =>
  (REDEEM_ERRORS as readonly string[]).includes(code);

/** The one and only login a child ever sees: six characters, typed once. */
export default function Join() {
  const device = useDeviceSession();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = platformSchema.safeParse(Platform.OS);
  const parsed = joinCodeSchema.safeParse(code);

  const join = async () => {
    if (!parsed.success) return setError(t('join.error.invalid_code'));
    if (!platform.success) return setError(t('join.error.platform'));
    setBusy(true);
    setError(null);
    try {
      const session = await redeemJoinCode({
        code: parsed.data,
        platform: platform.data,
      });
      // A kid device holds no parent session, so leaving kid mode always needs a fresh sign-in.
      if (isSignedIn) await signOut();
      await device.save(session);
      await setRole('kid');
      router.replace('/(kid)');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      setError(code && isRedeemError(code) ? t(`join.error.${code}`) : t('join.error.failed'));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t(reason === 'revoked' ? 'join.titleRevoked' : 'join.title')}</Title>
      <Text style={styles.hint}>{t(reason === 'revoked' ? 'join.hintRevoked' : 'join.hint')}</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(typed) => setCode(typed.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={6}
        placeholder="ABC123"
        placeholderTextColor="#bbb"
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={t('join.action')}
        onPress={() => void join()}
        disabled={busy || !parsed.success}
      />
      <Button
        title={t('join.imAParent')}
        secondary
        onPress={() => {
          void clearRole().then(() => router.replace('/'));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 16, color: '#555' },
  input: {
    borderWidth: 2,
    borderColor: '#208AEF',
    borderRadius: 16,
    paddingVertical: 18,
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
  },
});
