import type { Chore } from '@chores/shared';
import { useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { WEEKDAYS } from '@/components/chore-form';
import {
  Button,
  EmptyState,
  ErrorState,
  ErrorText,
  FILL,
  ListRow,
  Screen,
  Title,
} from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { useChores } from '@/lib/use-chores';
import { formatChoreDate, t } from '@/lib/i18n';

function recurrenceLabel(chore: Chore): string {
  switch (chore.kind) {
    case 'daily':
      return t('chores.everyDay');
    case 'once':
      return t('chores.once', { date: chore.due_date ? formatChoreDate(chore.due_date) : '' });
    case 'weekdays':
      return WEEKDAYS()
        .filter((_: string, i: number) => ((chore.weekday_mask ?? 0) & (1 << i)) !== 0)
        .join(' ');
  }
}

export default function ChoresList() {
  const state = useHousehold();
  const chores = useChores();
  const router = useRouter();
  if (state.status !== 'ready' || !state.me.household) return null;
  const { children } = state.me;
  const nameOf = (id: string) => children.find((c) => c.id === id)?.first_name ?? '?';

  return (
    <Screen list>
      <Title>{t('chores.title')}</Title>
      {chores.status === 'error' && (
        <ErrorState
          title={chores.message || t('parent.loadFailed')}
          body={t('parent.unreachable')}
          actionTitle={t('common.tryAgain')}
          onAction={() => void chores.refresh()}
        />
      )}
      <FlatList
        style={FILL}
        data={chores.chores}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={
          chores.status === 'ready' ? <EmptyState title={t('chores.empty')} /> : null
        }
        renderItem={({ item }) => (
          <ListRow
            title={`${item.icon ? `${item.icon} ` : ''}${item.title}`}
            meta={t('chores.meta', {
              recurrence: recurrenceLabel(item),
              who: item.assignees.map(nameOf).join(', '),
            })}
            onPress={() =>
              router.push({ pathname: '/(parent)/chores/[id]', params: { id: item.id } })
            }
          />
        )}
      />
      <Button
        title={t('chores.add')}
        onPress={() => router.push('/(parent)/chores/new')}
        disabled={children.length === 0}
      />
      {children.length === 0 && <ErrorText>{t('chores.needAChild')}</ErrorText>}
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}
