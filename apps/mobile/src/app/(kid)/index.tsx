import { COINS_PER_CHORE } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { wipeDeviceDb } from '@/db/client';
import { createDeviceApi } from '@/lib/api';
import { useDeviceSession, type DeviceSessionValue } from '@/lib/device-session';
import { clearRole } from '@/lib/role';
import { useToday } from '@/lib/use-today';
import type { TodayItem } from '@/sync/engine';
import type { DeviceSession } from '@chores/shared';

export default function KidHome() {
  const device = useDeviceSession();
  if (!device.session) return null;
  return <Today device={device} session={device.session} />;
}

function Today({ device, session }: { device: DeviceSessionValue; session: DeviceSession }) {
  const router = useRouter();

  // Household tz and boundary never ride the change log, so refresh them on open; the local
  // rows carry everything else.
  useEffect(() => {
    createDeviceApi(session.device_token)
      .me()
      .then((me) => device.save({ ...session, child: me.child, household: me.household }))
      .catch(() => {});
    // Once per token; a save above rewrites `session` and must not loop.
  }, [session.device_token]);

  // A revoked device wipes its local copy and goes back to the code screen.
  const onRevoked = useCallback(async () => {
    router.replace({ pathname: '/(kid)/join', params: { reason: 'revoked' } });
    await wipeDeviceDb();
    await device.clear();
    await clearRole();
  }, [router, device]);

  const today = useToday(session, () => void onRevoked());
  const little = today.uiMode === 'little';

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
      <View style={styles.header}>
        <Text style={little ? styles.greetingLittle : styles.greeting}>Hi {today.firstName}!</Text>
        {!little && (
          <Text style={styles.streak}>
            🔥 {today.streak} day{today.streak === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      {today.offline && <Text style={styles.offline}>Showing what’s saved on this device.</Text>}
      <FlatList
        key={today.uiMode}
        data={today.items}
        keyExtractor={(i) => i.id}
        numColumns={little ? 2 : 1}
        columnWrapperStyle={little ? styles.tileRow : undefined}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (little ? <Tile item={item} /> : <Row item={item} />)}
        ListEmptyComponent={
          today.status === 'ready' ? (
            <Text style={little ? styles.emptyLittle : styles.empty}>
              {little ? '🎈 Nothing to do today!' : 'Nothing to do today.'}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

/** Little mode: one big icon per chore, the title underneath. */
function Tile({ item }: { item: TodayItem }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileIcon}>{item.icon ?? '⭐'}</Text>
      <Text style={styles.tileTitle} numberOfLines={2}>
        {item.title}
      </Text>
    </View>
  );
}

/** Big mode: a compact row with the coins the chore pays. */
function Row({ item }: { item: TodayItem }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowIcon}>{item.icon ?? '⭐'}</Text>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.coins}>+{COINS_PER_CHORE} 🪙</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56, paddingHorizontal: 16 },
  secretCorner: { position: 'absolute', top: 0, right: 0, width: 72, height: 72, zIndex: 1 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  greeting: { fontSize: 28, fontWeight: '700' },
  greetingLittle: { fontSize: 36, fontWeight: '700' },
  streak: { fontSize: 18, fontWeight: '600', color: '#e65100' },
  offline: { color: '#777', marginTop: 4 },
  list: { paddingVertical: 16, gap: 12 },
  tileRow: { gap: 12 },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: '#E6F4FE',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 8,
  },
  tileIcon: { fontSize: 64 },
  tileTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#f4f4f4',
  },
  rowIcon: { fontSize: 28 },
  rowTitle: { flex: 1, fontSize: 18, fontWeight: '500' },
  coins: { fontSize: 16, fontWeight: '600', color: '#555' },
  empty: { textAlign: 'center', color: '#777', marginTop: 32, fontSize: 16 },
  emptyLittle: { textAlign: 'center', marginTop: 32, fontSize: 28 },
});
