import { useLocalSearchParams, useRouter } from 'expo-router';
import { PinForm } from '@/components/pin-form';
import { FinishLater, useSetupStep } from '@/components/setup-step';
import { setupPurpose } from '@/lib/setup';

/**
 * Guided setup's Parent PIN step, above the tab bar (spec #86). Set before any Join Code is shown,
 * so a child's device never reaches kid mode with no way out; the `409 pin_required` guard on
 * issuing a code stays as the backstop (ADR-0013).
 *
 * That backstop pushes this step over the Join Code step with `?then=back`: saving then returns to
 * the Join Code screen already underneath, which issues the code on refocus, rather than advancing
 * to a second Join Code step stacked on the first.
 */
export default function SetupPin() {
  const { then } = useLocalSearchParams<{ then?: 'back' }>();
  const router = useRouter();
  const { advance, finishLater } = useSetupStep('pin');
  return (
    <PinForm
      intro={setupPurpose('pin')}
      onSaved={then === 'back' ? () => router.back() : advance}
      footer={<FinishLater onPress={finishLater} />}
    />
  );
}
