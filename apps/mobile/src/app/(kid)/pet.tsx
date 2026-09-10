import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PetFigure, XpBar } from '@/components/pet';
import { useDeviceSession } from '@/lib/device-session';
import { BACK_ARROW, t } from '@/lib/i18n';
import { usePet } from '@/lib/use-pet';
import type { DeviceSession } from '@chores/shared';

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
        <Text style={styles.backText}>{`${BACK_ARROW} ${t('pet.back')}`}</Text>
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.name}>{pet.name}</Text>
        <PetFigure name={pet.name} level={pet.progress.level} mood={pet.mood} size={200} />
        <Text style={styles.level}>{t('pet.level', { level: pet.progress.level })}</Text>
        <Text style={styles.mood}>{t(`pet.mood.${pet.mood}`, { name: pet.name })}</Text>
        <XpBar progress={pet.progress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56, paddingHorizontal: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 8, paddingEnd: 16 },
  backText: { fontSize: 18, fontWeight: '600', color: '#7C5CFF' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingBottom: 64 },
  name: { fontSize: 32, fontWeight: '700' },
  level: { fontSize: 24, fontWeight: '700' },
  mood: { fontSize: 17, color: '#555', textAlign: 'center' },
});
