import { COINS_PER_CHORE } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { DoneMoment } from '@/components/done-moment';
import { TreeFigure } from '@/components/grove';
import { PetFigure } from '@/components/pet';
import { StreakBadge } from '@/components/streak-badge';
import { wipeDeviceDb } from '@/db/client';
import { createDeviceApi } from '@/lib/api';
import { formatNumber, t } from '@/lib/i18n';
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
        {today.status === 'ready' && today.pet.enabled && (
          <Pressable
            onPress={() => router.push('/(kid)/pet')}
            accessibilityRole="button"
            accessibilityLabel={t('kid.petButton', {
              name: today.pet.name,
              level: today.pet.progress.level,
            })}
          >
            <PetFigure
              name={today.pet.name}
              level={today.pet.progress.level}
              mood={today.pet.mood}
              size={64}
              showStage={false}
            />
          </Pressable>
        )}
        <Text style={little ? styles.greetingLittle : styles.greeting}>
          {t('kid.greeting', { name: today.firstName })}
        </Text>
        <View style={styles.tallies}>
          <Text style={styles.coinTally}>
            {t('kid.coinTally', { coins: formatNumber(today.coins) })}
          </Text>
          {!little && <StreakBadge days={today.streak} />}
        </View>
        {/* The way into the grove, and a tree standing at the child's own stage. Drawn only
            while `grove_enabled` is on, so the flag hides the screen and its entry point
            together. Big enough to hit in little mode; the label carries the count either way. */}
        {today.status === 'ready' && today.grove.enabled && (
          <Pressable
            onPress={() => router.push('/(kid)/grove')}
            accessibilityRole="button"
            accessibilityLabel={t('grove.buttonLabel', { count: today.grove.ownTree.stage })}
          >
            <TreeFigure
              tree={today.grove.ownTree}
              ownName={today.firstName}
              size={little ? 72 : 56}
              showLabel={false}
            />
          </Pressable>
        )}
      </View>
      {today.offline && <Text style={styles.offline}>{t('kid.offline')}</Text>}
      {today.refused > 0 && (
        <Pressable style={styles.refused} onPress={today.dismissRefused}>
          <Text style={styles.refusedText}>{t('kid.refused', { count: today.refused })}</Text>
        </Pressable>
      )}
      <FlatList
        key={today.uiMode}
        data={today.items}
        keyExtractor={(i) => i.id}
        numColumns={little ? 2 : 1}
        columnWrapperStyle={little ? styles.tileRow : undefined}
        contentContainerStyle={styles.list}
        extraData={today.coins}
        renderItem={({ item }) =>
          little ? (
            <Tile item={item} onPress={() => today.toggle(item)} />
          ) : (
            <Row item={item} onPress={() => today.toggle(item)} />
          )
        }
        ListEmptyComponent={
          today.status === 'ready' ? (
            <Text style={little ? styles.emptyLittle : styles.empty}>
              {t(little ? 'kid.emptyLittle' : 'kid.empty')}
            </Text>
          ) : null
        }
      />
      {today.reaction && (
        <DoneMoment
          key={today.reaction.key}
          reaction={today.reaction}
          // The pet always reacts happily to a completion, whatever the rest of the day looks
          // like; the header pet goes on showing today's real mood.
          pet={{
            enabled: today.pet.enabled,
            name: today.pet.name,
            level: today.pet.progress.level,
            mood: 'happy',
          }}
          grove={{
            enabled: today.grove.enabled,
            ownName: today.firstName,
            tree: today.grove.ownTree,
          }}
          streak={today.streak}
          onDone={today.clearReaction}
        />
      )}
    </View>
  );
}

/** Little mode: one big icon per chore, the title underneath. Tapping it toggles done. */
function Tile({ item, onPress }: { item: TodayItem; onPress: () => void }) {
  const done = item.status === 'done';
  return (
    <Pressable
      style={[styles.tile, done && styles.tileDone]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={item.title}
    >
      <Text style={styles.tileIcon}>{done ? '✅' : (item.icon ?? '⭐')}</Text>
      <Text style={styles.tileTitle} numberOfLines={2}>
        {item.title}
      </Text>
    </Pressable>
  );
}

/** Big mode: a compact row with the coins the chore pays. */
function Row({ item, onPress }: { item: TodayItem; onPress: () => void }) {
  const done = item.status === 'done';
  return (
    <Pressable
      style={[styles.row, done && styles.rowDone]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={item.title}
    >
      <Text style={styles.rowIcon}>{done ? '✅' : (item.icon ?? '⭐')}</Text>
      <Text style={[styles.rowTitle, done && styles.rowTitleDone]} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.coins}>
        {t('kid.chorePays', { coins: formatNumber(COINS_PER_CHORE) })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56, paddingHorizontal: 16 },
  secretCorner: { position: 'absolute', top: 0, end: 0, width: 72, height: 72, zIndex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  greeting: { fontSize: 28, fontWeight: '700' },
  greetingLittle: { fontSize: 36, fontWeight: '700' },
  tallies: { alignItems: 'flex-end' },
  coinTally: { fontSize: 20, fontWeight: '700' },
  offline: { color: '#777', marginTop: 4 },
  refused: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FDE7E7',
  },
  refusedText: { color: '#8a1c1c', fontWeight: '600' },
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
  tileDone: { backgroundColor: '#DFF5E1' },
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
  rowDone: { backgroundColor: '#DFF5E1' },
  rowIcon: { fontSize: 28 },
  rowTitle: { flex: 1, fontSize: 18, fontWeight: '500' },
  rowTitleDone: { textDecorationLine: 'line-through', color: '#6b6b6b' },
  coins: { fontSize: 16, fontWeight: '600', color: '#555' },
  empty: { textAlign: 'center', color: '#777', marginTop: 32, fontSize: 16 },
  emptyLittle: { textAlign: 'center', marginTop: 32, fontSize: 28 },
});
