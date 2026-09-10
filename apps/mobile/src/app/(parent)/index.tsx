import { useAuth } from '@clerk/expo';
import type { ParentTodayChild, ParentTodayItem } from '@chores/shared';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StreakBadge } from '@/components/streak-badge';
import { Button, ErrorText, Loading, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { useParentToday } from '@/lib/use-parent-today';

/**
 * The completion's wall clock in the household's timezone, not the reading device's: a parent
 * away from home must still see the time their child saw.
 */
function doneTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function Row({ item, tz }: { item: ParentTodayItem; tz: string }) {
  const done = item.status === 'done' && item.completed_at !== null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, done && styles.rowTitleDone]}>
        {item.icon ? `${item.icon} ` : ''}
        {item.title}
      </Text>
      <Text style={done ? styles.doneAt : styles.due}>
        {done ? `✓ ${doneTime(item.completed_at!, tz)}` : 'Not yet'}
      </Text>
    </View>
  );
}

function ChildCard({ child, tz }: { child: ParentTodayChild; tz: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.name}>{child.first_name}</Text>
        <Text style={styles.coins}>{`🪙 ${child.balance}`}</Text>
      </View>
      <View style={styles.cardHead}>
        <Text style={styles.progress}>{`${child.done_count} of ${child.due_count} done`}</Text>
        <StreakBadge days={child.streak} />
      </View>
      {child.items.length === 0 ? (
        <Text style={styles.empty}>Nothing due today.</Text>
      ) : (
        child.items.map((item) => <Row key={item.instance_id} item={item} tz={tz} />)
      )}
    </View>
  );
}

export default function ParentToday() {
  const state = useHousehold();
  const router = useRouter();
  const { signOut } = useAuth();
  const household = state.status === 'ready' ? state.me.household : null;
  const today = useParentToday(household?.id ?? null);
  if (!household) return null;

  return (
    <Screen>
      <Title>{`Today · ${household.name}`}</Title>
      {today.status === 'error' && <ErrorText>{today.message}</ErrorText>}
      {today.status === 'loading' && today.today === null ? (
        <Loading />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {today.today?.children.length === 0 && (
            <Text style={styles.empty}>No children yet. Add the first one.</Text>
          )}
          {today.today?.children.map((child) => (
            <ChildCard key={child.child_id} child={child} tz={household.tz} />
          ))}
        </ScrollView>
      )}
      <Button title="Children" onPress={() => router.push('/(parent)/children')} secondary />
      <Button title="Chores" onPress={() => router.push('/(parent)/chores')} secondary />
      <Button title="Add a partner" onPress={() => router.push('/(parent)/partner')} secondary />
      <Button title="Sign out" onPress={() => void signOut()} secondary />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  listContent: { gap: 12, paddingVertical: 4 },
  card: { backgroundColor: '#f6f6f6', borderRadius: 16, padding: 16, gap: 6 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 22, fontWeight: '600' },
  coins: { fontSize: 20, fontWeight: '600' },
  progress: { color: '#555', fontSize: 15 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  rowTitle: { fontSize: 17, flexShrink: 1 },
  rowTitleDone: { color: '#2e7d32' },
  doneAt: { fontSize: 16, color: '#2e7d32', fontWeight: '600' },
  due: { fontSize: 16, color: '#999' },
  empty: { color: '#666', fontSize: 16, paddingVertical: 16 },
});
