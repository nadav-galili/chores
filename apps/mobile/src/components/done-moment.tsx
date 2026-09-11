import type { PetMood } from '@chores/shared';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { TreeFigure } from '@/components/grove';
import { PetFigure } from '@/components/pet';
import { StreakBadge } from '@/components/streak-badge';
import { Coins } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useTheme } from '@/theme';
import type { Tree } from '@/sync/grove';
import type { DoneReaction } from '@/lib/use-today';

/**
 * The done moment: the coins the tap paid, the streak, the pet reacting, and — on the tap that
 * finished the day — the tree that tap just grew.
 *
 * The animation is driven off `reaction.key`, which the tap handler sets in the same tick as the
 * press, so the first frame of this is the first frame after the tap — nothing here waits on
 * SQLite or the network. The tree is drawn from rows the tap itself wrote, so it grows offline.
 * With the pet or the grove switched off, the coins and the streak still play.
 */
export function DoneMoment({
  reaction,
  pet,
  grove,
  streak,
  onDone,
}: {
  reaction: DoneReaction;
  pet: { enabled: boolean; name: string; level: number; mood: PetMood };
  grove: { enabled: boolean; ownName: string; tree: Tree };
  streak: number;
  onDone: () => void;
}) {
  // The voice of the copy is a `ui_mode` difference, and the theme is where the mode is read
  // from — the same value that sized the type this card is drawn in.
  const { uiMode } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const finished = useRef(onDone);
  finished.current = onDone;

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.delay(700),
      Animated.timing(progress, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished: ok }) => {
      if (ok) finished.current();
    });
    return () => animation.stop();
  }, [reaction.key, progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const lift = progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View
        style={[styles.card, { opacity: progress, transform: [{ scale }, { translateY: lift }] }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={t(`kid.${uiMode}.doneMoment`, { coins: reaction.coins })}
      >
        <Coins amount={reaction.coins} variant="pays" step="display" />
        {pet.enabled && (
          <PetFigure
            name={pet.name}
            level={pet.level}
            mood={pet.mood}
            size={96}
            showStage={false}
          />
        )}
        {/* Only the tap that completed the day planted one, so only that tap shows a tree. */}
        {reaction.grew && grove.enabled && (
          <View style={styles.grew}>
            <TreeFigure tree={grove.tree} ownName={grove.ownName} size={72} showLabel={false} />
            <Text style={styles.grewText}>{t(`kid.${uiMode}.grew`)}</Text>
          </View>
        )}
        <StreakBadge days={streak} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
    paddingHorizontal: 32,
    borderRadius: 28,
    backgroundColor: '#FFFFFFF2',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  grew: { alignItems: 'center', gap: 4 },
  grewText: { fontSize: 16, fontWeight: '600', color: '#2E7D32' },
});
