import { uuid7 } from '@chores/shared';
import { ChoreForm, emptyChore } from '@/components/chore-form';
import { FinishLater, SetupPurpose, useSetupStep } from '@/components/setup-step';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/**
 * Guided setup's First chore step, above the tab bar (spec #86). The existing chore form for now;
 * this file is the step's alone, so reshaping it touches no other step.
 */
export default function SetupChore() {
  const state = useHousehold();
  const { advance, finishLater } = useSetupStep('chore');
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;

  return (
    <ChoreForm
      title={t('chores.add')}
      children={state.me.children}
      initial={emptyChore(state.me.children)}
      intro={<SetupPurpose step="chore" />}
      onSubmit={async (fields) => {
        await state.api.upsertChore(householdId, uuid7(), {
          fields,
          updated_at: new Date().toISOString(),
        });
        await advance();
      }}
      footer={<FinishLater onPress={finishLater} />}
    />
  );
}
