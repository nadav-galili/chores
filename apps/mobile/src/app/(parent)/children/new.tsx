import { useRouter } from 'expo-router';
import { ChildForm } from '@/components/child-form';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

export default function NewChild() {
  const state = useHousehold();
  const router = useRouter();
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;

  return (
    <ChildForm
      title={t('childForm.add')}
      onSubmit={async (input) => {
        await state.api.createChild(householdId, input);
        await state.refresh();
        router.back();
      }}
    />
  );
}
