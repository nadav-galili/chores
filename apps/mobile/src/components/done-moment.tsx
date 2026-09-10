import type { PetMood } from '@chores/shared';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { PetFigure } from '@/components/pet';
import { StreakBadge } from '@/components/streak-badge';
import { formatNumber, t } from '@/lib/i18n';
import type { DoneReaction } from '@/lib/use-today';

/**
 * The done moment: the coins the tap paid, the streak, and the pet reacting.
 *
 * The animation is driven off `reaction.key`, which the tap handler sets in the same tick as the
 * press, so the first frame of this is the first frame after the tap — nothing here waits on
 * SQLite or the network. With the pet switched off the coins and the streak still play.
 */
export function DoneMoment({
  reaction,
  pet,
  streak,
  onDone,
}: {
  reaction: DoneReaction;
  pet: { enabled: boolean; name: string; level: number; mood: PetMood };
  streak: number;
  onDone: () => void;
}) {
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
        accessibilityLabel={t('kid.doneMoment', { coins: reaction.coins })}
      >
        <Text style={styles.coins}>
          {t('kid.chorePays', { coins: formatNumber(reaction.coins) })}
        </Text>
        {pet.enabled && (
          <PetFigure
            name={pet.name}
            level={pet.level}
            mood={pet.mood}
            size={96}
            showStage={false}
          />
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
  coins: { fontSize: 40, fontWeight: '800' },
});
