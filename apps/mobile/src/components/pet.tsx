import type { PetMood, PetProgress } from '@chores/shared';
import { StyleSheet, Text, View } from 'react-native';
import { petArt, petArtLabel } from '@/lib/pet-art';

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
  const art = petArt(level, mood);
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
        <Text style={{ fontSize: size * 0.5 }}>{art.glyph}</Text>
        <Text style={[styles.face, { fontSize: size * 0.22 }]}>{art.face}</Text>
      </View>
      {showStage && <Text style={styles.stage}>{art.stage}</Text>}
    </View>
  );
}

/** How far the pet is through its level. Full and quiet at the top level. */
export function XpBar({ progress }: { progress: PetProgress }) {
  const percent = `${Math.round(progress.fraction * 100)}%` as const;
  return (
    <View style={styles.bar}>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={
          progress.atMax
            ? { text: 'fully grown' }
            : { min: 0, max: progress.needed, now: progress.into }
        }
      >
        <View style={[styles.fill, { width: percent }]} />
      </View>
      <Text style={styles.barText}>
        {progress.atMax
          ? `${progress.xp} XP · fully grown`
          : `${progress.into} / ${progress.needed} XP to level ${progress.level + 1}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { alignItems: 'center', gap: 8 },
  ground: { alignItems: 'center', justifyContent: 'center' },
  face: { position: 'absolute', top: '12%', right: '12%' },
  stage: { fontSize: 16, fontWeight: '600', color: '#555' },
  bar: { gap: 6, width: '100%' },
  track: { height: 16, borderRadius: 8, backgroundColor: '#E4E4EA', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 8, backgroundColor: '#7C5CFF' },
  barText: { fontSize: 14, color: '#555', textAlign: 'center' },
});
