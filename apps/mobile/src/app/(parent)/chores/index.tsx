import type { Chore } from '@chores/shared';
import { Link, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { WEEKDAYS } from '@/components/chore-form';
import { Button, ErrorText, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { useChores } from '@/lib/use-chores';

function recurrenceLabel(chore: Chore): string {
  switch (chore.kind) {
    case 'daily':
      return 'Every day';
    case 'once':
      return `Once · ${chore.due_date}`;
    case 'weekdays':
      return WEEKDAYS.filter((_, i) => ((chore.weekday_mask ?? 0) & (1 << i)) !== 0).join(' ');
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
      <Title>Chores</Title>
      {chores.status === 'error' && <ErrorText>{chores.message}</ErrorText>}
      <FlatList
        data={chores.chores}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={
          chores.status === 'ready' ? (
            <Text style={styles.empty}>No chores yet. Add the first one.</Text>
          ) : null
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
                  {recurrenceLabel(item)} · {item.assignees.map(nameOf).join(', ')}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Link>
        )}
      />
      <Button
        title="Add a chore"
        onPress={() => router.push('/(parent)/chores/new')}
        disabled={children.length === 0}
      />
      {children.length === 0 && <ErrorText>Add a child before adding chores.</ErrorText>}
      <Button title="Back" onPress={() => router.back()} secondary />
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
