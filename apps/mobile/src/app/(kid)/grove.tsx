import { Redirect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TreeFigure } from '@/components/grove';
import { useDeviceSession } from '@/lib/device-session';
import { BACK_ARROW, t } from '@/lib/i18n';
import { useGrove } from '@/lib/use-grove';
import type { DeviceSession } from '@chores/shared';

export default function GroveScreen() {
  const device = useDeviceSession();
  if (!device.session) return null;
  return <Grove session={device.session} />;
}

/**
 * The household's grove: one tree per child, the child's own first and larger.
 *
 * Every stage is read from the local database, so this is the same picture offline — and because
 * growth entries have no clawback (ADR-0011), it is a picture that only ever gains trees.
 *
 * The row scrolls rather than laying the trees out as a landscape: a landscape does not survive
 * five children on a narrow phone, and it reads as a grove with one tree in it just the same.
 */
function Grove({ session }: { session: DeviceSession }) {
  const router = useRouter();
  const grove = useGrove(session);

  // The flag is off: the screen does not exist, however the child got here.
  if (grove.status === 'ready' && !grove.enabled) return <Redirect href="/(kid)" />;

  return (
    <View style={styles.screen}>
      <Pressable style={styles.back} onPress={() => router.back()} accessibilityRole="button">
        <Text style={styles.backText}>{`${BACK_ARROW} ${t('grove.back')}`}</Text>
      </Pressable>
      <Text style={styles.title}>{t('grove.title')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {grove.trees.map((tree) => (
          <TreeFigure
            key={tree.childId}
            tree={tree}
            ownName={session.child.first_name}
            size={tree.isSelf ? 168 : 112}
          />
        ))}
      </ScrollView>
      {grove.status === 'ready' && grove.ownTree.stage === 0 && (
        <Text style={styles.empty}>{t('grove.empty')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56, paddingHorizontal: 24 },
  back: { alignSelf: 'flex-start', paddingVertical: 8, paddingEnd: 16 },
  backText: { fontSize: 18, fontWeight: '600', color: '#7C5CFF' },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 24 },
  // The trees stand on one ground line, so a short tree and a tall one share a horizon.
  row: { alignItems: 'flex-end', gap: 20, paddingBottom: 8, paddingHorizontal: 4 },
  empty: { marginTop: 24, fontSize: 17, color: '#555', textAlign: 'center' },
});
