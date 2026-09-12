import { choreDate, weekdayOf, type InstanceStatus, type ParentWeekChore } from '@chores/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, EmptyState, ErrorState, FILL, Loading, Screen, Title } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { formatChoreDate, formatNumber, t, weekdayLabels } from '@/lib/i18n';
import { useChildWeek } from '@/lib/use-child-week';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * What a cell shows. Glyphs rather than colour: the palette has one green and it means "act",
 * so a finished chore may not wear it (ADR-0012) — the same reason the today screen strikes a
 * done title through instead of tinting its row.
 */
const GLYPH: Record<InstanceStatus, string> = {
  due: '·',
  done: '✓',
  redo: '↻',
  pending_photo: '◔',
};

/** The day a column is, in two lines: the weekday, and the date within the month. */
function DayHeader({ date }: { date: string }) {
  const styles = useThemedStyles(weekStyles);
  return (
    <View style={styles.cell}>
      <Text style={styles.dayName}>{weekdayLabels()[weekdayOf(date)]}</Text>
      <Text style={styles.dayNumber}>{formatNumber(Number(date.slice(8)))}</Text>
    </View>
  );
}

/**
 * One chore across the returned dates. `cells` is sparse — a chore has no cell on a day it was not
 * due — so each column is looked up by its Chore Date and an absent one draws nothing, which is
 * the truth about a weekly chore on a Tuesday.
 *
 * A done cell is the reject control, and it calls the very endpoint the today screen calls: the
 * completion id the cell carries is the only thing on a parent surface that can name what is
 * being rejected. Nothing confirms first — the today screen does not either, and the answer says
 * what happened.
 */
function ChoreRow({
  chore,
  dates,
  onReject,
  rejecting,
}: {
  chore: ParentWeekChore;
  dates: string[];
  onReject: (chore: ParentWeekChore, completionId: string) => void;
  rejecting: string | null;
}) {
  const styles = useThemedStyles(weekStyles);
  const byDate = new Map(chore.cells.map((cell) => [cell.chore_date, cell]));
  return (
    <View style={styles.row}>
      <Text style={styles.choreTitle} numberOfLines={2}>
        {chore.icon ? `${chore.icon} ` : ''}
        {chore.title}
      </Text>
      {dates.map((date) => {
        const cell = byDate.get(date);
        if (!cell) return <View key={date} style={styles.cell} />;
        const label = t('parent.week.cell', {
          title: chore.title,
          date: formatChoreDate(date),
          state: t(`parent.week.state.${cell.status}`),
        });
        const completionId = cell.completion_id;
        if (cell.status !== 'done' || completionId === null) {
          return (
            <View key={date} style={styles.cell} accessible accessibilityLabel={label}>
              <Text style={styles.glyph}>{GLYPH[cell.status]}</Text>
            </View>
          );
        }
        const busy = rejecting === completionId;
        return (
          <Pressable
            key={date}
            style={[styles.cell, styles.doneCell, busy && styles.busyCell]}
            onPress={() => onReject(chore, completionId)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${label} — ${t('parent.reject')}`}
          >
            <Text style={styles.glyph}>{GLYPH.done}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One child's Chore Date history as chores against days. This is how a parent reaches a
 * completion from an earlier day at all: the Digest arrives at 20:00 and the parent acts the next
 * morning, still inside the Redo Window, so without this screen the window barely opens.
 *
 * Right to left without a conditional: the columns are laid out oldest first with
 * `flexDirection: 'row'`, which follows the reader, so in Hebrew they mirror and today lands at
 * the near edge. Nothing here names a side, and the grid scrolls inside its own bounds when a
 * household has more chores than the phone is wide.
 */
export default function ChildWeek() {
  const state = useHousehold();
  const router = useRouter();
  const styles = useThemedStyles(weekStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const child = state.status === 'ready' ? state.me.children.find((c) => c.id === id) : undefined;
  const household = state.status === 'ready' ? state.me.household : null;
  const householdId = household?.id ?? null;
  const historyFrom =
    child && household
      ? choreDate(new Date(child.created_at), household.tz, household.day_boundary_hour)
      : undefined;
  const week = useChildWeek(child?.id ?? null, historyFrom);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const { api } = state;

  /**
   * The same call the today screen makes, and the same three answers: `already_undone` is news
   * rather than a failure, because the child undid the tap first and nothing moved.
   */
  const reject = useCallback(
    async (chore: ParentWeekChore, completionId: string) => {
      if (!householdId) return;
      setRejecting(completionId);
      setNotice(null);
      try {
        const { status } = await api.rejectCompletion(householdId, completionId);
        setNotice({
          text:
            status === 'rejected'
              ? t('parent.rejected', { title: chore.title })
              : t('parent.rejectAlreadyUndone', { title: chore.title }),
          bad: false,
        });
        await week.refresh();
      } catch (e) {
        setNotice({
          text: withCause(t('parent.rejectFailed', { title: chore.title }), e),
          bad: true,
        });
      } finally {
        setRejecting(null);
      }
    },
    [api, householdId, week],
  );

  if (!child) return null;
  const dates = week.week?.chore_dates ?? [];

  return (
    <Screen list>
      <Title>
        {t(week.week?.clamped === false ? 'parent.week.fullTitle' : 'parent.week.title', {
          name: child.first_name,
        })}
      </Title>
      {notice && <Text style={[styles.notice, notice.bad && styles.noticeBad]}>{notice.text}</Text>}
      {week.status === 'error' && (
        <ErrorState
          title={t('parent.week.loadFailed')}
          body={week.message}
          actionTitle={t('common.tryAgain')}
          onAction={() => void week.refresh()}
        />
      )}
      {week.status === 'loading' && week.week === null ? (
        <Loading />
      ) : week.week !== null && week.week.chores.length === 0 ? (
        <EmptyState
          title={t(week.week.clamped === false ? 'parent.week.fullEmpty' : 'parent.week.empty')}
        />
      ) : (
        // Two scrolls, vertical outside: a household with more chores than the phone is tall
        // scrolls down, and a grid wider than the phone scrolls across with its day headers
        // still above the right column. The inner one measures its own content, which it can
        // only do with the height coming from outside it.
        <ScrollView style={FILL} contentContainerStyle={styles.grid}>
          <ScrollView horizontal>
            <View>
              <View style={styles.row}>
                <View style={styles.choreTitleSpacer} />
                {dates.map((date) => (
                  <DayHeader key={date} date={date} />
                ))}
              </View>
              {week.week?.chores.map((chore) => (
                <ChoreRow
                  key={chore.chore_id}
                  chore={chore}
                  dates={dates}
                  onReject={(c, completionId) => void reject(c, completionId)}
                  rejecting={rejecting}
                />
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      )}
      {week.week?.clamped === true && (
        <Button
          title={t('parent.week.seeMore')}
          onPress={() =>
            router.push({ pathname: '/(parent)/paywall', params: { gate: 'full_history' } })
          }
          secondary
        />
      )}
      <Button title={t('common.done')} onPress={() => router.back()} />
    </Screen>
  );
}

const CELL = 44;
const TITLE_COLUMN = 132;

const weekStyles = (theme: Theme) => ({
  grid: { paddingVertical: theme.space.sm, paddingBottom: theme.space.md },
  // Direction is never named: the row follows the reader, so the newest day sits at the near
  // edge in both languages and nothing reverses the array to get there.
  row: { flexDirection: 'row' as const, alignItems: 'center' as const },
  choreTitle: { ...theme.type.label, width: TITLE_COLUMN, color: theme.colors.text },
  choreTitleSpacer: { width: TITLE_COLUMN },
  cell: {
    width: CELL,
    height: CELL,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  doneCell: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    backgroundColor: theme.colors.surface,
  },
  busyCell: { opacity: 0.5 },
  glyph: { ...theme.type.body, color: theme.colors.text },
  dayName: { ...theme.type.label, color: theme.colors.muted },
  dayNumber: { ...theme.type.label, color: theme.colors.text },
  notice: { ...theme.type.label, color: theme.colors.text },
  noticeBad: { color: theme.colors.danger },
});
