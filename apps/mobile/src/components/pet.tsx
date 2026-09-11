import type { PetMood, PetProgress } from '@chores/shared';
import { Image, StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { petArt, petArtLabel } from '@/lib/pet-art';
import { useThemedStyles, type Theme } from '@/theme';

/** The pet itself, at whatever size the screen asks for. Pure display; it reads no data. */
export function PetFigure({
  name,
  level,
  mood,
  size = 140,
  showStage = true,
}: {
  name: string;
  level: number;
  mood: PetMood;
  size?: number;
  showStage?: boolean;
}) {
  const styles = useThemedStyles(petStyles);
  const art = petArt(level, mood);
  // The art is square and the ground is a circle: the largest square that fits is the inscribed
  // one, so nothing a render puts in a corner — a cocked tail, a sprig — is cut off.
  const box = Math.round(size * 0.7);
  return (
    <View style={styles.figure}>
      <View
        style={[
          styles.ground,
          { backgroundColor: art.ground, width: size, height: size, borderRadius: size / 2 },
        ]}
        accessibilityRole="image"
        accessibilityLabel={petArtLabel(name, level, mood)}
      >
        <View style={{ width: box, height: box }}>
          <Image source={art.body} style={styles.art} resizeMode="contain" />
          <Image source={art.mark} style={styles.art} resizeMode="contain" />
        </View>
      </View>
      {showStage && <Text style={styles.stage}>{art.stage}</Text>}
    </View>
  );
}

/** How far the pet is through its level. Full and quiet at the top level. */
export function XpBar({ progress }: { progress: PetProgress }) {
  const styles = useThemedStyles(petStyles);
  const percent = `${Math.round(progress.fraction * 100)}%` as const;
  return (
    <View style={styles.bar}>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={
          progress.atMax
            ? { text: t('pet.fullyGrown') }
            : { min: 0, max: progress.needed, now: progress.into }
        }
      >
        <View style={[styles.fill, { width: percent }]} />
      </View>
      <Text style={styles.barText}>
        {progress.atMax
          ? t('pet.xpMax', { xp: progress.xp })
          : t('pet.xpToNext', {
              into: progress.into,
              needed: progress.needed,
              level: progress.level + 1,
            })}
      </Text>
    </View>
  );
}

const petStyles = (theme: Theme) => ({
  figure: { alignItems: 'center' as const, gap: theme.space.sm },
  ground: { alignItems: 'center' as const, justifyContent: 'center' as const },
  art: { position: 'absolute' as const, width: '100%' as const, height: '100%' as const },
  stage: { ...theme.type.label, color: theme.colors.muted, fontWeight: '600' as const },
  bar: { gap: theme.space.xs, width: '100%' as const },
  // The bar stands on the page's ground, so the empty part of it is a surface and the filled
  // part is the growth green: the pet growing is a growth affordance, never an action. The
  // hairline is what keeps the empty part of it legible against the ground, as on the offline
  // strip. The height is a bar's height, not a spacing step, so it stays a number.
  track: {
    height: 16,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.muted,
    overflow: 'hidden' as const,
  },
  fill: {
    height: '100%' as const,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.growth,
  },
  barText: { ...theme.type.caption, color: theme.colors.muted, textAlign: 'center' as const },
});
