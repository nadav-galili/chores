import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, createDeviceApi } from '@/lib/api';
import { useDeviceSession } from '@/lib/device-session';
import { clearRole } from '@/lib/role';

export default function KidHome() {
  const device = useDeviceSession();
  const router = useRouter();
  const session = device.session;
  const api = useMemo(() => (session ? createDeviceApi(session.device_token) : null), [session]);

  // Refresh the child's basics on open; a revoked device wipes itself and goes back to the code screen.
  useEffect(() => {
    if (!api || !session) return;
    api
      .me()
      .then((me) => device.save({ ...session, child: me.child, household: me.household }))
      .catch(async (e) => {
        if (e instanceof ApiError && e.code === 'device_revoked') {
          router.replace({ pathname: '/(kid)/join', params: { reason: 'revoked' } });
          await device.clear();
          await clearRole();
        }
      });
    // Runs when the token changes, not on every save above (which rewrites `session`).
  }, [api]);

  if (!session) return null;

  return (
    <View style={styles.screen}>
      {/* Hidden exit: a parent long-presses the top-right corner and signs in. */}
      <Pressable
        style={styles.secretCorner}
        delayLongPress={2000}
        onLongPress={() => router.push('/(kid)/exit')}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.greeting}>Hi {session.child.first_name}!</Text>
      <Text style={styles.pet}>{session.child.pet_name} is waiting for you.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 },
  secretCorner: { position: 'absolute', top: 0, right: 0, width: 72, height: 72 },
  greeting: { fontSize: 36, fontWeight: '700' },
  pet: { fontSize: 20, color: '#555' },
});
