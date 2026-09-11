import type { PetMood } from '@chores/shared';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { TreeFigure } from '@/components/grove';
import { PetFigure } from '@/components/pet';
import { StreakBadge } from '@/components/streak-badge';
import { Coins } from '@/components/ui';
import { t } from '@/lib/i18n';
import { MOTION, usePop, useRise } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/theme';
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
  const styles = useThemedStyles(doneMomentStyles);
  const progress = useRef(new Animated.Value(0)).current;
  const finished = useRef(onDone);
  finished.current = onDone;
  // The pet's own reaction, a beat behind the card so it reads as the pet answering the tap
  // rather than as part of the card arriving. The tree's, when the tap planted one: it pushes up
  // out of nothing, which is the only moment in the app a tree is ever seen to move.
  const bounce = usePop(true, { delay: MOTION.in, onMount: true });
  const grow = useRise(reaction.grew);
  // A day complete has more to look at, so the card holds longer before it goes.
  const hold = reaction.grew ? MOTION.holdGrew : MOTION.hold;
  // When this card appeared. The screen mounts one of these per tap, keyed, so this is the tap.
  const appeared = useRef(Date.now()).current;

  // The card arrives. Once per tap and nothing else: the tap's own correction a few milliseconds
  // later — the bonus it paid, the tree it planted — must not restart this, or the card would be
  // seen to pop in twice.
  useEffect(() => {
    progress.setValue(0);
    const arrive = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.in,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: true,
    });
    arrive.start();
    return () => arrive.stop();
  }, [reaction.key, progress]);

  // And, after its hold, goes — but never before the tap's own write has reported, so a slow
  // device cannot take the tree away from the child by ending the moment before the row that
  // planted it was counted. It is only ever SQLite that is waited on here; the network is not
  // part of the moment at all.
  //
  // Scheduled separately from the arrival, and measured from the moment the card appeared rather
  // than from now, so that learning the tap grew a tree lengthens the hold without disturbing
  // anything already on screen or pushing the whole moment later.
  useEffect(() => {
    if (!reaction.settled) return;
    const leave = Animated.timing(progress, {
      toValue: 0,
      duration: MOTION.out,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    const remaining = Math.max(0, appeared + MOTION.in + hold - Date.now());
    const timer = setTimeout(() => {
      leave.start(({ finished: ok }) => {
        if (ok) finished.current();
      });
    }, remaining);
    return () => {
      clearTimeout(timer);
      leave.stop();
    };
  }, [reaction.key, reaction.settled, hold, appeared, progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const lift = progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  const petScale = bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const treeScale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View
        style={[styles.card, { opacity: progress, transform: [{ scale }, { translateY: lift }] }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={t(`kid.${uiMode}.doneMoment`, { coins: reaction.coins })}
      >
        <Coins amount={reaction.coins} variant="pays" step="display" />
        {pet.enabled && (
          <Animated.View style={{ transform: [{ scale: petScale }] }}>
            <PetFigure
              name={pet.name}
              level={pet.level}
              mood={pet.mood}
              size={96}
              showStage={false}
            />
          </Animated.View>
        )}
        {/* Only the tap that completed the day planted one, so only that tap shows a tree. */}
        {reaction.grew && grove.enabled && (
          <Animated.View
            style={[styles.grew, { opacity: grow, transform: [{ scale: treeScale }] }]}
          >
            <TreeFigure tree={grove.tree} ownName={grove.ownName} size={72} showLabel={false} />
            <Text style={styles.grewText}>{t(`kid.${uiMode}.grew`)}</Text>
          </Animated.View>
        )}
        <StreakBadge days={streak} />
      </Animated.View>
    </View>
  );
}

const doneMomentStyles = (theme: Theme) => ({
  overlay: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  card: {
    alignItems: 'center' as const,
    gap: theme.space.md,
    paddingVertical: theme.space.xl,
    paddingHorizontal: theme.space.xxl,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    // The text colour doubles as the shadow: it is the darkest value the palette has, and a
    // shadow is the one place a colour is spent on something other than being seen.
    shadowColor: theme.colors.text,
    shadowOpacity: 0.18,
    // A blur, not a corner: the radius scale is corner radii and has nothing to say here.
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  grew: { alignItems: 'center' as const, gap: theme.space.xs },
  // The line under the tree is copy, so it is text: the green on this card is the tree's own.
  grewText: { ...theme.type.label, color: theme.colors.text, fontWeight: '600' as const },
});
