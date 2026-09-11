import { useAuth } from '@clerk/expo';
import type { ParentTodayChild, ParentTodayItem } from '@chores/shared';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StreakBadge } from '@/components/streak-badge';
import { Button, EmptyState, ErrorState, Loading, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { formatNumber, formatWallClock, t } from '@/lib/i18n';
import { useParentToday } from '@/lib/use-parent-today';

function Row({ item, tz }: { item: ParentTodayItem; tz: string }) {
  const done = item.status === 'done' && item.completed_at !== null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, done && styles.rowTitleDone]}>
        {item.icon ? `${item.icon} ` : ''}
        {item.title}
      </Text>
      <Text style={done ? styles.doneAt : styles.due}>
        {done
          ? t('parent.doneAt', { time: formatWallClock(item.completed_at!, tz) })
          : t('parent.notYet')}
      </Text>
    </View>
  );
}

function ChildCard({ child, tz }: { child: ParentTodayChild; tz: string }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.name}>{child.first_name}</Text>
        <Text style={styles.coins}>{`🪙 ${formatNumber(child.balance)}`}</Text>
      </View>
      <View style={styles.cardHead}>
        <Text style={styles.progress}>
          {t('parent.progress', {
            done: formatNumber(child.done_count),
            due: formatNumber(child.due_count),
          })}
        </Text>
        <StreakBadge days={child.streak} />
      </View>
      {child.items.length === 0 ? (
        <Text style={styles.empty}>{t('parent.nothingDue')}</Text>
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
      <Title>{t('parent.todayTitle', { household: household.name })}</Title>
      {today.status === 'error' && (
        <ErrorState
          title={today.message ?? t('parent.loadFailed')}
          body={t('parent.unreachable')}
          actionTitle={t('common.tryAgain')}
          onAction={() => void today.refresh()}
        />
      )}
      {today.status === 'loading' && today.today === null ? (
        <Loading />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {today.today?.children.length === 0 && (
            <EmptyState
              title={t('parent.noChildren')}
              actionTitle={t('children.add')}
              onAction={() => router.push('/(parent)/children/new')}
            />
          )}
          {today.today?.children.map((child) => (
            <ChildCard key={child.child_id} child={child} tz={household.tz} />
          ))}
        </ScrollView>
      )}
      <Button
        title={t('parent.nav.children')}
        onPress={() => router.push('/(parent)/children')}
        secondary
      />
      <Button
        title={t('parent.nav.chores')}
        onPress={() => router.push('/(parent)/chores')}
        secondary
      />
      <Button
        title={t('parent.nav.partner')}
        onPress={() => router.push('/(parent)/partner')}
        secondary
      />
      <Button title={t('parent.nav.signOut')} onPress={() => void signOut()} secondary />
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
