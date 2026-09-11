import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { PetFigure, XpBar } from '@/components/pet';
import { useDeviceSession } from '@/lib/device-session';
import { BACK_ARROW, t } from '@/lib/i18n';
import { usePet } from '@/lib/use-pet';
import { useThemedStyles, type Theme } from '@/theme';
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
  const styles = useThemedStyles(petScreenStyles);

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

const petScreenStyles = (theme: Theme) => ({
  screen: {
    flex: 1,
    paddingTop: 56,
    paddingHorizontal: theme.space.xl,
    backgroundColor: theme.colors.ground,
  },
  back: {
    alignSelf: 'flex-start' as const,
    paddingVertical: theme.space.sm,
    paddingEnd: theme.space.lg,
  },
  // Drawn exactly as the Grove screen's back link: a link wears the one colour that means "act".
  backText: { ...theme.type.body, color: theme.colors.action },
  body: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.space.lg,
    paddingBottom: 64,
  },
  name: { ...theme.type.title, color: theme.colors.text },
  level: { ...theme.type.heading, color: theme.colors.text, fontWeight: '700' as const },
  mood: { ...theme.type.body, color: theme.colors.muted, textAlign: 'center' as const },
});
