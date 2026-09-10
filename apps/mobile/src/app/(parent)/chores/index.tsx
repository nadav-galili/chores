import type { Chore } from '@chores/shared';
import { Link, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { WEEKDAYS } from '@/components/chore-form';
import { Button, ErrorText, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { useChores } from '@/lib/use-chores';
import { CHEVRON, formatChoreDate, t } from '@/lib/i18n';

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
    <Screen>
      <Title>{t('chores.title')}</Title>
      {chores.status === 'error' && <ErrorText>{chores.message}</ErrorText>}
      <FlatList
        data={chores.chores}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={
          chores.status === 'ready' ? <Text style={styles.empty}>{t('chores.empty')}</Text> : null
        }
        renderItem={({ item }) => (
          <Link href={{ pathname: '/(parent)/chores/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.row}>
              <View style={styles.text}>
                <Text style={styles.name}>
                  {item.icon ? `${item.icon} ` : ''}
                  {item.title}
                </Text>
                <Text style={styles.meta}>
                  {t('chores.meta', {
                    recurrence: recurrenceLabel(item),
                    who: item.assignees.map(nameOf).join(', '),
                  })}
                </Text>
              </View>
              <Text style={styles.chevron}>{CHEVRON}</Text>
            </Pressable>
          </Link>
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

const styles = StyleSheet.create({
  empty: { color: '#666', fontSize: 16, paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  text: { flex: 1 },
  name: { fontSize: 20, fontWeight: '600' },
  meta: { color: '#666', marginTop: 2 },
  chevron: { fontSize: 24, color: '#999' },
});
