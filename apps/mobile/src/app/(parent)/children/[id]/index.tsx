import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChildForm } from '@/components/child-form';
import { Button } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

export default function EditChild() {
  const state = useHousehold();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;
  const child = state.me.children.find((c) => c.id === id);
  if (!child) return null;

  return (
    <ChildForm
      title={t('childForm.edit', { name: child.first_name })}
      initial={{
        first_name: child.first_name,
        ui_mode: child.ui_mode,
        pet_name: child.pet_name,
        reminder_time: child.reminder_time,
      }}
      onSubmit={async (input) => {
        await state.api.updateChild(householdId, child.id, input);
        await state.refresh();
        router.back();
      }}
      footer={
        <>
          <Button
            title={t('childForm.showJoinCode')}
            secondary
            onPress={() =>
              router.push({
                pathname: '/(parent)/children/[id]/join-code',
                params: { id: child.id },
              })
            }
          />
          <Button
            title={t('childForm.devices')}
            secondary
            onPress={() =>
              router.push({ pathname: '/(parent)/children/[id]/devices', params: { id: child.id } })
            }
          />
        </>
      }
    />
  );
}
