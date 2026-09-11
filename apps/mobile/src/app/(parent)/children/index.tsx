import { Link, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, EmptyState, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { CHEVRON, t } from '@/lib/i18n';

export default function ChildrenList() {
  const state = useHousehold();
  const router = useRouter();
  if (state.status !== 'ready' || !state.me.household) return null;
  const { household, children } = state.me;

  return (
    <Screen>
      <Title>{t('children.title', { household: household.name })}</Title>
      <FlatList
        data={children}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<EmptyState title={t('parent.noChildren')} />}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/(parent)/children/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.row}>
              <View>
                <Text style={styles.name}>{item.first_name}</Text>
                <Text style={styles.meta}>
                  {t('children.meta', {
                    mode: t(item.ui_mode === 'little' ? 'childForm.little' : 'childForm.big'),
                    pet: item.pet_name,
                  })}
                  {item.reminder_time
                    ? t('children.reminderMeta', { time: item.reminder_time })
                    : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>{CHEVRON}</Text>
            </Pressable>
          </Link>
        )}
      />
      <Button title={t('children.add')} onPress={() => router.push('/(parent)/children/new')} />
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
