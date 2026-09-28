import { useLocalSearchParams } from 'expo-router';
import { JoinCodeView } from '@/components/join-code-view';
import { FinishLater, SetupPurpose, useSetupStep } from '@/components/setup-step';

/**
 * Guided setup's Join Code step, above the tab bar (spec #86), for the child in `?id=`. Setup ends
 * when that child's device joins; until then the way out is "I'll finish later". This file is the
 * step's alone, so reshaping it touches no other step.
 */
export default function SetupJoinCode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { finishLater } = useSetupStep('join_code');
  return (
    <JoinCodeView
      id={id}
      intro={<SetupPurpose step="join_code" />}
      pinHref="/setup/pin"
      footer={<FinishLater onPress={finishLater} />}
    />
  );
}
