import { COINS_PER_CHORE } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { DoneMoment } from '@/components/done-moment';
import { TreeFigure } from '@/components/grove';
import { PetFigure } from '@/components/pet';
import { StreakBadge } from '@/components/streak-badge';
import { Card, ChoreRow, Coins } from '@/components/ui';
import { wipeDeviceDb } from '@/db/client';
import { shutdownAnalytics } from '@/lib/analytics';
import { createDeviceApi } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useDeviceSession, type DeviceSessionValue } from '@/lib/device-session';
import { clearRole } from '@/lib/role';
import { useToday, type Today } from '@/lib/use-today';
import { useTheme, useThemedStyles, type Theme } from '@/theme';
import type { DeviceSession } from '@chores/shared';

export default function KidHome() {
  const device = useDeviceSession();
  if (!device.session) return null;
  return <Home device={device} session={device.session} />;
}

/**
 * The child's whole app, on one screen they scroll: the pet, today's chores, and a strip of the
 * grove, in that order. There is no tab bar — a 7-year-old should not have to learn one, and a
 * flag that is off then hides its own section instead of leaving a dead destination behind. It is
 * also what puts the coins, the pet and the tree all on screen at the moment a child taps done.
 *
 * `ui_mode` changes three things here and only three (docs/spec/06-design.md): type and target
 * size, which arrive through the theme without anything here naming them; where the pet sits; and
 * the voice of the copy. The two this file does draw for itself read the mode off the theme, so
 * they cannot disagree with the type they are drawn in.
 *
 * Not different: the set of screens, how many chores are shown, and the motion — a 10-year-old
 * still wants the pet to react.
 */
function Home({ device, session }: { device: DeviceSessionValue; session: DeviceSession }) {
  const router = useRouter();
  const styles = useThemedStyles(homeStyles);

  // Household tz and boundary never ride the change log, so refresh them on open; the local
  // rows carry everything else.
  useEffect(() => {
    createDeviceApi(session.device_token)
      .me()
      .then((me) => device.save({ ...session, child: me.child, household: me.household }))
      .catch(() => {});
    // Once per token; a save above rewrites `session` and must not loop.
  }, [session.device_token]);

  // A revoked device wipes its local copy and goes back to the code screen. Its analytics anon id
  // is rotated on revoke (ADR-0009), so the client that holds the old one goes too.
  const onRevoked = useCallback(async () => {
    router.replace({ pathname: '/(kid)/join', params: { reason: 'revoked' } });
    await shutdownAnalytics();
    await wipeDeviceDb();
    await device.clear();
    await clearRole();
  }, [router, device]);

  const today = useToday(session, () => void onRevoked());

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
      {/* One scroll, three sections. The list is the scroll container rather than a child of one,
          so today's chores stay virtualized and nothing nests a scroll inside a scroll. */}
      <FlatList
        data={today.items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.scroll}
        extraData={today.coins}
        ListHeaderComponent={<Head today={today} onPet={() => router.push('/(kid)/pet')} />}
        renderItem={({ item }) => (
          <ChoreRow
            title={item.title}
            icon={item.icon}
            done={item.status === 'done'}
            coins={COINS_PER_CHORE}
            onPress={() => today.toggle(item)}
          />
        )}
        ListEmptyComponent={today.status === 'ready' ? <Empty /> : null}
        ListFooterComponent={
          today.grove.enabled ? (
            <GroveStrip today={today} onPress={() => router.push('/(kid)/grove')} />
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

/** Nothing to do today. A frozen day is a good day, so it is not drawn as an error. */
function Empty() {
  const styles = useThemedStyles(homeStyles);
  const mode = useTheme().uiMode;
  return <Text style={styles.empty}>{t(`kid.${mode}.empty`)}</Text>;
}

/** Where the pet sits is a mode difference; how big it is there follows from that. */
const PET_SIZE = { little: 160, big: 56 } as const;

/**
 * Everything above today's list: the greeting, the pet, the tallies, and the two strips that only
 * appear when something has gone wrong.
 *
 * The pet's placement is the second of the three mode differences — above the list in `little`,
 * where it is the biggest thing on the screen, and collapsed into the header row in `big`.
 */
function Head({ today, onPet }: { today: Today; onPet: () => void }) {
  const styles = useThemedStyles(homeStyles);
  const mode = useTheme().uiMode;
  const little = mode === 'little';
  // Both bets are off for this child, so the coins carry the screen on their own rather than the
  // control cohort receiving something that reads as a stripped app. An uncached flag reads as
  // on, so this is the shipped experience until a parent's fetch says otherwise (`sync/flags`).
  const heroCoins = !today.pet.enabled && !today.grove.enabled;

  const petFigure = today.pet.enabled ? (
    <Pressable
      onPress={onPet}
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
        size={PET_SIZE[mode]}
        showStage={false}
      />
    </Pressable>
  ) : null;

  const greeting = (
    <Text style={styles.greeting}>{t(`kid.${mode}.greeting`, { name: today.firstName })}</Text>
  );

  const tallies = (step: 'title' | 'heading') => (
    <View style={styles.tallies}>
      <Coins amount={today.coins} step={step} />
      <StreakBadge days={today.streak} />
    </View>
  );

  return (
    <View style={styles.head}>
      {little ? (
        <>
          {greeting}
          {petFigure && <View style={styles.petAbove}>{petFigure}</View>}
          {!heroCoins && tallies('title')}
        </>
      ) : (
        <View style={styles.headRow}>
          {petFigure}
          <View style={styles.headRowText}>{greeting}</View>
          {!heroCoins && tallies('heading')}
        </View>
      )}

      {heroCoins && (
        <Card>
          <Text style={styles.sectionTitle}>{t(`kid.${mode}.coins`)}</Text>
          <View style={styles.hero}>
            <Coins amount={today.coins} step="display" />
            <StreakBadge days={today.streak} />
          </View>
        </Card>
      )}

      {today.offline && <Text style={styles.offline}>{t('kid.offline')}</Text>}
      {today.refused > 0 && (
        <Pressable style={styles.refused} onPress={today.dismissRefused}>
          <Text style={styles.refusedText}>{t('kid.refused', { count: today.refused })}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The end of the scroll: the household's trees at a glance, and the way into the full grove.
 *
 * The whole strip is one target, so it is as easy to hit in `little` as anything else here, and
 * the trees in it are drawn from local rows — the same picture offline, and one that only ever
 * gains trees (ADR-0011).
 */
function GroveStrip({ today, onPress }: { today: Today; onPress: () => void }) {
  const styles = useThemedStyles(homeStyles);
  const mode = useTheme().uiMode;
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={t('grove.buttonLabel', { count: today.grove.ownTree.stage })}
    >
      <Text style={styles.sectionTitle}>{t(`kid.${mode}.grove`)}</Text>
      {/* The trees stand on one ground line, so a short tree and a tall one share a horizon. The
          row wraps rather than scrolling sideways: a scroll inside this one would eat the tap. */}
      <View style={styles.groveRow}>
        {today.grove.trees.map((tree) => (
          <TreeFigure
            key={tree.childId}
            tree={tree}
            ownName={today.firstName}
            size={tree.isSelf ? 96 : 72}
            showLabel={false}
          />
        ))}
      </View>
    </Card>
  );
}

const homeStyles = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.ground },
  // The kid stack draws no header, so the scroll clears the status bar itself.
  scroll: {
    paddingTop: theme.space.xxl + theme.space.xl,
    paddingHorizontal: theme.space.lg,
    paddingBottom: theme.space.xxl,
    gap: theme.space.md,
  },
  secretCorner: { position: 'absolute' as const, top: 0, end: 0, width: 72, height: 72, zIndex: 1 },
  head: { gap: theme.space.md },
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.space.md },
  headRowText: { flex: 1 },
  petAbove: { alignItems: 'center' as const },
  greeting: { ...theme.type.title, color: theme.colors.text },
  tallies: { alignItems: 'center' as const, gap: theme.space.xs },
  hero: { alignItems: 'center' as const, gap: theme.space.sm },
  sectionTitle: { ...theme.type.heading, color: theme.colors.text, textAlign: 'center' as const },
  groveRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'flex-end' as const,
    justifyContent: 'center' as const,
    gap: theme.space.lg,
  },
  offline: { ...theme.type.label, color: theme.colors.muted },
  refused: {
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.surface,
  },
  refusedText: { ...theme.type.label, color: theme.colors.danger },
  empty: {
    ...theme.type.heading,
    color: theme.colors.muted,
    textAlign: 'center' as const,
    marginTop: theme.space.xxl,
  },
});
