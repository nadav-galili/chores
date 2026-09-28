import { PinForm } from '@/components/pin-form';
import { FinishLater, useSetupStep } from '@/components/setup-step';
import { t } from '@/lib/i18n';

/**
 * Guided setup's Parent PIN step, above the tab bar (spec #86). Set before any Join Code is shown,
 * so a child's device never reaches kid mode with no way out; the `409 pin_required` guard on
 * issuing a code stays as the backstop (ADR-0013).
 */
export default function SetupPin() {
  const { advance, finishLater } = useSetupStep('pin');
  return (
    <PinForm
      intro={t('setup.purpose.pin')}
      onSaved={advance}
      footer={<FinishLater onPress={finishLater} />}
    />
  );
}
