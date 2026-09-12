import { useAuth } from '@clerk/expo';
import type { ParentTodayChild, ParentTodayItem } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { withCause } from '@/lib/errors';
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
 *
 * A done row also carries the reject action, because the completion id the payload now carries
 * is the only thing on any parent surface that can name what is being rejected.
 */
function ChoreLine({
  item,
  tz,
  onReject,
  busy,
}: {
  item: ParentTodayItem;
  tz: string;
  onReject: (item: ParentTodayItem) => void;
  busy: boolean;
}) {
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
      {done && item.completion_id !== null && (
        <Pressable
          style={[styles.reject, busy && styles.rejectBusy]}
          onPress={() => onReject(item)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('parent.reject')}
        >
          <Text style={styles.rejectText}>{busy ? t('parent.rejecting') : t('parent.reject')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ChildCard({
  child,
  tz,
  onReject,
  rejecting,
}: {
  child: ParentTodayChild;
  tz: string;
  onReject: (item: ParentTodayItem) => void;
  rejecting: string | null;
}) {
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
            <ChoreLine
              key={item.instance_id}
              item={item}
              tz={tz}
              onReject={onReject}
              busy={rejecting !== null && rejecting === item.completion_id}
            />
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * The evening scan: every child of the household, what each of them owes today and what each of
 * them has done, read top to bottom in one pass. A parent still does not tick a child's chore
 * off for them; the one thing they write from here is a rejection.
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
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const { api } = state;
  const householdId = household?.id ?? null;

  /**
   * Reject one completion and say what came back. `already_undone` is not a failure — the child
   * undid the tap first and nothing moved — so it reads as news rather than an error; only a
   * request that did not return does, and it names its cause, because the parent is the one
   * person who can act on `401 unauthenticated`.
   */
  const reject = useCallback(
    async (item: ParentTodayItem) => {
      const completionId = item.completion_id;
      if (!householdId || completionId === null) return;
      setRejecting(completionId);
      setNotice(null);
      try {
        const { status } = await api.rejectCompletion(householdId, completionId);
        setNotice({
          text:
            status === 'rejected'
              ? t('parent.rejected', { title: item.title })
              : t('parent.rejectAlreadyUndone', { title: item.title }),
          bad: false,
        });
        await today.refresh();
      } catch (e) {
        setNotice({
          text: withCause(t('parent.rejectFailed', { title: item.title }), e),
          bad: true,
        });
      } finally {
        setRejecting(null);
      }
    },
    [api, householdId, today],
  );

  if (!household) return null;

  return (
    <Screen list>
      <Title>{t('parent.todayTitle', { household: household.name })}</Title>
      {notice && <Text style={[styles.notice, notice.bad && styles.noticeBad]}>{notice.text}</Text>}
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
            <ChildCard
              key={child.child_id}
              child={child}
              tz={household.tz}
              onReject={(item) => void reject(item)}
              rejecting={rejecting}
            />
          ))}
        </ScrollView>
      )}
      <NavRow
        items={[
          { title: t('parent.nav.children'), onPress: () => router.push('/(parent)/children') },
          { title: t('parent.nav.chores'), onPress: () => router.push('/(parent)/chores') },
          { title: t('parent.nav.rewards'), onPress: () => router.push('/(parent)/rewards') },
          { title: t('parent.nav.partner'), onPress: () => router.push('/(parent)/partner') },
          { title: t('parent.nav.pin'), onPress: () => router.push('/(parent)/pin') },
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
  // The reject action borrows the chip's pill rather than the button's fill: it sits inside a
  // scan, and it may not take the one green, which means "act" on the child's side.
  reject: {
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  rejectBusy: { opacity: 0.5 },
  rejectText: { ...theme.type.label, color: theme.colors.muted },
  notice: { ...theme.type.label, color: theme.colors.text },
  noticeBad: { color: theme.colors.danger },
  nothingDue: { ...theme.type.label, color: theme.colors.muted },
});
