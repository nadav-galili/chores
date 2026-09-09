import { useAuth } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';

export default function ChildrenList() {
  const state = useHousehold();
  const router = useRouter();
  const { signOut } = useAuth();
  if (state.status !== 'ready' || !state.me.household) return null;
  const { household, children } = state.me;

  return (
    <Screen>
      <Title>{household.name}</Title>
      <FlatList
        data={children}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<Text style={styles.empty}>No children yet. Add the first one.</Text>}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/(parent)/children/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.row}>
              <View>
                <Text style={styles.name}>{item.first_name}</Text>
                <Text style={styles.meta}>
                  {item.ui_mode === 'little' ? 'Little' : 'Big'} · pet {item.pet_name}
                  {item.reminder_time ? ` · reminder ${item.reminder_time}` : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Link>
        )}
      />
      <Button title="Add a child" onPress={() => router.push('/(parent)/children/new')} />
      <Button title="Sign out" onPress={() => void signOut()} secondary />
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
  name: { fontSize: 20, fontWeight: '600' },
  meta: { color: '#666', marginTop: 2 },
  chevron: { fontSize: 24, color: '#999' },
});
