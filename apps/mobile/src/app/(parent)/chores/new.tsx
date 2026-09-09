import { uuid7 } from '@chores/shared';
import { useRouter } from 'expo-router';
import { ChoreForm, emptyChore } from '@/components/chore-form';
import { useHousehold } from '@/lib/household-context';

export default function NewChore() {
  const state = useHousehold();
  const router = useRouter();
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;

  return (
    <ChoreForm
      title="Add a chore"
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
