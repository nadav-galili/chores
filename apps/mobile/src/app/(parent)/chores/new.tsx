import { uuid7 } from '@chores/shared';
import { useRouter } from 'expo-router';
import { ChoreForm, emptyChore } from '@/components/chore-form';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

export default function NewChore() {
  const state = useHousehold();
  const router = useRouter();
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;

  return (
    <ChoreForm
      title={t('chores.add')}
      children={state.me.children}
      initial={emptyChore(state.me.children)}
      onSubmit={async (fields) => {
        await state.api.upsertChore(householdId, uuid7(), {
          fields,
          updated_at: new Date().toISOString(),
        });
        router.back();
      }}
    />
  );
}
