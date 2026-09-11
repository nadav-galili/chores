import { doneHaptic, type DoneTap } from '@chores/shared';
import * as Haptics from 'expo-haptics';

/**
 * The only place in the app that makes the phone buzz (docs/spec/06-design.md): a medium impact
 * on a completion, the success notification on a Day Complete, and silence everywhere else. A
 * device that buzzes on every tap stops meaning anything, so this file having one caller is the
 * rule being kept.
 *
 * Which of the two — or neither — is `doneHaptic`'s decision, tested in `@chores/shared`; all
 * this does is play it.
 */
export function playDoneHaptic(tap: DoneTap): void {
  const kind = doneHaptic(tap);
  if (kind === null) return;
  const played =
    kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  void played.catch(() => {
    // Nothing waits on this, and a device with no taptic engine — or one with haptics switched
    // off — is not a failure the child should ever hear about. The one deliberate silence.
  });
}
