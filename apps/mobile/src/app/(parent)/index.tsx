import { useAuth } from '@clerk/expo';
import type { ParentTodayChild, ParentTodayItem } from '@chores/shared';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { StreakBadge } from '@/components/streak-badge';
import {
  Card,
  Coins,
  EmptyState,
  ErrorState,
  FILL,
  Loading,
  NavRow,
  Screen,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { formatNumber, formatWallClock, t } from '@/lib/i18n';
import { useParentToday } from '@/lib/use-parent-today';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * One chore of one child's day. Done is drawn by striking the title through, the same way the
 * child's own list draws it (`ChoreRow`), and never by tinting the row: the palette has one
 * green and it means "act", so a finished chore may not borrow it.
 *
 * The time it was done then carries the weight the colour used to, so the two states still
 * separate at a glance — which is the entire point of an evening scan.
 */
function ChoreLine({ item, tz }: { item: ParentTodayItem; tz: string }) {
  const styles = useThemedStyles(todayStyles);
  const done = item.status === 'done' && item.completed_at !== null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, done && styles.rowTitleDone]}>
        {item.icon ? `${item.icon} ` : ''}
        {item.title}
      </Text>
      <Text style={[styles.rowState, done && styles.rowStateDone]}>
        {done
          ? t('parent.doneAt', { time: formatWallClock(item.completed_at!, tz) })
          : t('parent.notYet')}
      </Text>
    </View>
  );
}

function ChildCard({ child, tz }: { child: ParentTodayChild; tz: string }) {
  const styles = useThemedStyles(todayStyles);
  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.name}>{child.first_name}</Text>
        <Coins amount={child.balance} step="heading" />
      </View>
      <View style={styles.head}>
        <Text style={styles.progress}>
          {t('parent.progress', {
            done: formatNumber(child.done_count),
            due: formatNumber(child.due_count),
          })}
        </Text>
        <StreakBadge days={child.streak} />
      </View>
      {child.items.length === 0 ? (
        <Text style={styles.nothingDue}>{t('parent.nothingDue')}</Text>
      ) : (
        <View style={styles.rows}>
          {child.items.map((item) => (
            <ChoreLine key={item.instance_id} item={item} tz={tz} />
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * The evening scan: every child of the household, what each of them owes today and what each of
 * them has done, read top to bottom in one pass. Read-only by design — a parent does not tick a
 * child's chore off for them.
 *
 * Nothing here moves and nothing buzzes. The scan is the whole screen, so it gets the height:
 * the four places a parent can go from here are a wrapping row of pills rather than a stack of
 * full-width buttons that would push the second child off the bottom of the phone.
 */
export default function ParentToday() {
  const state = useHousehold();
  const router = useRouter();
  const { signOut } = useAuth();
  const styles = useThemedStyles(todayStyles);
  const household = state.status === 'ready' ? state.me.household : null;
  const today = useParentToday(household?.id ?? null);
  if (!household) return null;

  return (
    <Screen list>
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
        <ScrollView style={FILL} contentContainerStyle={styles.listContent}>
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
      <NavRow
        items={[
          { title: t('parent.nav.children'), onPress: () => router.push('/(parent)/children') },
          { title: t('parent.nav.chores'), onPress: () => router.push('/(parent)/chores') },
          { title: t('parent.nav.partner'), onPress: () => router.push('/(parent)/partner') },
          { title: t('parent.nav.signOut'), onPress: () => void signOut() },
        ]}
      />
    </Screen>
  );
}

const todayStyles = (theme: Theme) => ({
  listContent: { gap: theme.space.md, paddingBottom: theme.space.md },
  head: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  name: { ...theme.type.heading, color: theme.colors.text, fontWeight: '600' as const },
  progress: { ...theme.type.label, color: theme.colors.muted },
  rows: { gap: theme.space.xs },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    paddingTop: theme.space.xs,
  },
  rowTitle: { ...theme.type.body, flexShrink: 1, color: theme.colors.text },
  rowTitleDone: { textDecorationLine: 'line-through' as const, color: theme.colors.muted },
  rowState: { ...theme.type.label, color: theme.colors.muted },
  rowStateDone: { color: theme.colors.text, fontWeight: '600' as const },
  nothingDue: { ...theme.type.label, color: theme.colors.muted },
});
