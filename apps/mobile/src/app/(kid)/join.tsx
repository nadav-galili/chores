import { useAuth } from '@clerk/expo';
import { joinCodeSchema, platformSchema } from '@chores/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';
import { Button, ErrorText, Screen, Title } from '@/components/ui';
import { ApiError, redeemJoinCode } from '@/lib/api';
import { useDeviceSession } from '@/lib/device-session';
import { clearRole, setRole } from '@/lib/role';

type RedeemError = 'invalid_code' | 'code_expired' | 'code_redeemed' | 'rate_limited';
const MESSAGES: Record<RedeemError, string> = {
  invalid_code: "That code isn't right. Check it with a parent.",
  code_expired: 'That code has expired. Ask a parent for a new one.',
  code_redeemed: 'That code was already used. Ask a parent for a new one.',
  rate_limited: 'Too many tries. Wait a little and try again.',
};

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
    if (!parsed.success) return setError(MESSAGES.invalid_code);
    if (!platform.success) return setError('Mibo kid mode runs on a phone or tablet.');
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
      const known = e instanceof ApiError && e.code in MESSAGES;
      setError(known ? MESSAGES[e.code as RedeemError] : 'Could not join. Try again.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{reason === 'revoked' ? 'Ask a parent to reconnect' : 'Type your code'}</Title>
      <Text style={styles.hint}>
        {reason === 'revoked'
          ? 'This device was disconnected. A parent can show you a new code.'
          : 'A parent can show it to you.'}
      </Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={6}
        placeholder="ABC123"
        placeholderTextColor="#bbb"
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Join" onPress={() => void join()} disabled={busy || !parsed.success} />
      <Button
        title="I'm a parent"
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
