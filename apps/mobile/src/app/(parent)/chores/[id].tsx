import { choreFieldsOf } from '@chores/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChoreForm, diffChore } from '@/components/chore-form';
import { useHousehold } from '@/lib/household-context';
import { useChores } from '@/lib/use-chores';

export default function EditChore() {
  const state = useHousehold();
  const chores = useChores();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;
  const chore = chores.chores.find((c) => c.id === id);
  if (!chore) return null;

  const initial = choreFieldsOf(chore);

  return (
    <ChoreForm
      title={`Edit ${chore.title}`}
      children={state.me.children}
      initial={initial}
      onSubmit={async (fields) => {
        const changed = diffChore(initial, fields);
        if (Object.keys(changed).length > 0) {
          await state.api.upsertChore(householdId, chore.id, {
            fields: changed,
            updated_at: new Date().toISOString(),
          });
        }
        router.back();
      }}
      onDelete={async () => {
        await state.api.deleteChore(householdId, chore.id);
        router.back();
      }}
    />
  );
}
