import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PetFigure, XpBar } from '@/components/pet';
import { useDeviceSession } from '@/lib/device-session';
import { usePet } from '@/lib/use-pet';
import type { DeviceSession, PetMood } from '@chores/shared';

export default function PetScreen() {
  const device = useDeviceSession();
  if (!device.session) return null;
  return <Pet session={device.session} />;
}

/**
 * The pet's own screen: what level it is, how it feels about today, and how far it has to go.
 * Every number is read from the local database, so it is the same picture offline.
 *
 * Only reachable from the header pet, which is drawn only while `pet_enabled` is on, so there is
 * no pet-off variant of this screen — that fallback lives in the done moment.
 */
function Pet({ session }: { session: DeviceSession }) {
  const router = useRouter();
  const pet = usePet(session);

  return (
    <View style={styles.screen}>
      <Pressable style={styles.back} onPress={() => router.back()} accessibilityRole="button">
        <Text style={styles.backText}>← Today</Text>
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.name}>{pet.name}</Text>
        <PetFigure name={pet.name} level={pet.progress.level} mood={pet.mood} size={200} />
        <Text style={styles.level}>Level {pet.progress.level}</Text>
        <Text style={styles.mood}>{MOOD_LINE[pet.mood](pet.name)}</Text>
        <XpBar progress={pet.progress} />
      </View>
    </View>
  );
}

const MOOD_LINE: Record<PetMood, (name: string) => string> = {
  happy: (name) => `${name} is delighted — everything is done!`,
  content: (name) => `${name} is pleased. Keep going!`,
  sleepy: (name) => `${name} is dozing. Tap a chore to wake them up.`,
};

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56, paddingHorizontal: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 16 },
  backText: { fontSize: 18, fontWeight: '600', color: '#7C5CFF' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingBottom: 64 },
  name: { fontSize: 32, fontWeight: '700' },
  level: { fontSize: 24, fontWeight: '700' },
  mood: { fontSize: 17, color: '#555', textAlign: 'center' },
});
