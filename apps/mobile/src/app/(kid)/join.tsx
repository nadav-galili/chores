import { useAuth } from '@clerk/expo';
import { joinCodeSchema, platformSchema } from '@chores/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, TextInput } from 'react-native';
import { Button, ErrorText, Screen, Title } from '@/components/ui';
import { ApiError, redeemJoinCode } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useDeviceSession } from '@/lib/device-session';
import { clearRole, setRole } from '@/lib/role';
import { useTheme, useThemedStyles, type Theme } from '@/theme';

const REDEEM_ERRORS = ['invalid_code', 'code_expired', 'code_redeemed', 'rate_limited'] as const;
type RedeemError = (typeof REDEEM_ERRORS)[number];
const isRedeemError = (code: string): code is RedeemError =>
  (REDEEM_ERRORS as readonly string[]).includes(code);

/** The one and only login a child ever sees: six characters, typed once. */
export default function Join() {
  const device = useDeviceSession();
  const router = useRouter();
  const styles = useThemedStyles(joinStyles);
  const { colors } = useTheme();
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
      // A wrong or expired code is the ordinary answer and reads as words. Anything else is a
      // failure the child cannot act on, so the screen stays calm and the device says why.
      if (code === null) console.error('join failed', e);
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
        placeholderTextColor={colors.muted}
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

/**
 * The "no devices" and "revoked device" states are this screen: a device with no session, or
 * one whose token was revoked, gets typographic copy and the join form as its action — never
 * an illustration, and never a dead end. An expired code is the same shape one step down:
 * the failure names the code and the copy says to ask a parent for a new one.
 */
const joinStyles = (theme: Theme) => ({
  hint: { ...theme.type.body, color: theme.colors.muted },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.action,
    borderRadius: theme.radius.lg,
    paddingVertical: theme.space.lg,
    fontSize: 40,
    fontWeight: '700' as const,
    letterSpacing: 10,
    textAlign: 'center' as const,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
});
