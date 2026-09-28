import { ChildForm } from '@/components/child-form';
import { FinishLater, SetupPurpose, useSetupStep } from '@/components/setup-step';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

/**
 * Guided setup's Child step, above the tab bar (spec #86): first name, pet name and Little / Big
 * as picture cards. No reminder time, so the child is created without one; it stays editable from
 * the child's edit screen.
 */
export default function SetupChild() {
  const state = useHousehold();
  const { advance, finishLater } = useSetupStep('child');
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;

  return (
    <ChildForm
      title={t('childForm.add')}
      setup
      intro={<SetupPurpose step="child" />}
      onSubmit={async (input) => {
        await state.api.createChild(householdId, input);
        await advance();
      }}
      footer={<FinishLater onPress={finishLater} />}
    />
  );
}
