import type { PetMood } from '@chores/shared';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PetFigure } from '@/components/pet';
import { useTheme, useThemedStyles, type Theme } from '@/theme';

/** Where the row the pet points at sits, in the same window coordinates as the overlay. */
export type HelloTarget = { y: number; height: number };

/**
 * The pet's one-time hello on a Kid Device's first open: a card with the pet and one line, and a
 * ring around the first due row with the card's tail pointing at it. A child who cannot read yet
 * gets the whole message from the ring, the pet and the tail. The first tap anywhere dismisses it.
 *
 * Nothing here is placed by `left` or `right`: the ring spans the row's width with the list's own
 * symmetric inset, and the tail sits at `start`, so the whole thing mirrors under RTL by itself.
 * Only the vertical position is measured.
 */
export function PetHello({
  text,
  pet,
  target,
  inset,
  onDismiss,
}: {
  text: string;
  pet: { name: string; level: number; mood: PetMood };
  /** Null when nothing is due today: the pet greets without pointing. */
  target: HelloTarget | null;
  /** The list's horizontal padding, so the ring lines up with the row. */
  inset: number;
  onDismiss: () => void;
}) {
  const styles = useThemedStyles(helloStyles);
  const theme = useTheme();
  // The overlay's own top in the window, so a row measured in window coordinates lands on itself.
  const self = useRef<View>(null);
  const [origin, setOrigin] = useState<{ top: number; height: number } | null>(null);
  const onLayout = () =>
    self.current?.measureInWindow((_x, top, _width, height) => setOrigin({ top, height }));

  const pointing = target !== null && origin !== null;
  const rowTop = pointing ? target.y - origin.top : 0;
  // The card goes below the row while there is room, above it otherwise, tail towards the row.
  const below = pointing && rowTop + target.height / 2 < origin.height * 0.6;
  const ring = theme.space.xs;

  const card = (
    <View style={styles.card}>
      {pointing && <View style={[styles.tail, below ? styles.tailUp : styles.tailDown]} />}
      <PetFigure name={pet.name} level={pet.level} mood={pet.mood} size={96} showStage={false} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );

  return (
    <Pressable
      ref={self}
      style={styles.overlay}
      onLayout={onLayout}
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityViewIsModal
    >
      {pointing ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                top: rowTop - ring,
                height: target.height + ring * 2,
                start: inset - ring,
                end: inset - ring,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.placed,
              { start: inset, end: inset },
              below
                ? { top: rowTop + target.height + theme.space.lg }
                : { bottom: origin.height - rowTop + theme.space.lg },
            ]}
          >
            {card}
          </View>
        </>
      ) : (
        <View pointerEvents="none" style={styles.centered}>
          {card}
        </View>
      )}
    </Pressable>
  );
}

/** How far the tail reaches past the card, and so how much of the diamond shows. */
const TAIL = 20;

const helloStyles = (theme: Theme) => ({
  overlay: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
  },
  centered: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: theme.space.lg,
  },
  placed: { position: 'absolute' as const },
  ring: {
    position: 'absolute' as const,
    borderWidth: 3,
    borderColor: theme.colors.action,
    borderRadius: theme.radius.lg + theme.space.xs,
  },
  card: {
    alignItems: 'center' as const,
    gap: theme.space.md,
    paddingVertical: theme.space.xl,
    paddingHorizontal: theme.space.xl,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    // As on the done moment: the darkest value the palette has doubles as the shadow.
    shadowColor: theme.colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  // A square turned on its corner behind the card, so only the point reaching the row shows. It
  // sits at `start`, beside the pet, and moves to the other side under RTL with everything else.
  tail: {
    position: 'absolute' as const,
    start: theme.space.xxl,
    width: TAIL * 1.4,
    height: TAIL * 1.4,
    backgroundColor: theme.colors.surface,
    transform: [{ rotate: '45deg' }],
  },
  tailUp: { top: -TAIL * 0.7 },
  tailDown: { bottom: -TAIL * 0.7 },
  text: { ...theme.type.heading, color: theme.colors.text, textAlign: 'center' as const },
});
