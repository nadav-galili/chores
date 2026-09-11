import { useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { Button, EmptyState, FILL, ListRow, Screen, Title } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

export default function ChildrenList() {
  const state = useHousehold();
  const router = useRouter();
  if (state.status !== 'ready' || !state.me.household) return null;
  const { household, children } = state.me;

  return (
    <Screen list>
      <Title>{t('children.title', { household: household.name })}</Title>
      <FlatList
        style={FILL}
        data={children}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<EmptyState title={t('parent.noChildren')} />}
        renderItem={({ item }) => (
          <ListRow
            title={item.first_name}
            meta={
              t('children.meta', {
                mode: t(item.ui_mode === 'little' ? 'childForm.little' : 'childForm.big'),
                pet: item.pet_name,
              }) +
              (item.reminder_time ? t('children.reminderMeta', { time: item.reminder_time }) : '')
            }
            onPress={() =>
              router.push({ pathname: '/(parent)/children/[id]', params: { id: item.id } })
            }
          />
        )}
      />
      <Button title={t('children.add')} onPress={() => router.push('/(parent)/children/new')} />
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}
