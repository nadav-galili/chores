import { childInputSchema, type ChildInput, type UiMode } from '@chores/shared';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Button, Choice, ErrorText, Field, ScrollScreen } from '@/components/ui';
import { fieldError, t } from '@/lib/i18n';

const empty: ChildInput = { first_name: '', ui_mode: 'little', pet_name: '', reminder_time: null };

export function ChildForm({
  title,
  initial = empty,
  onSubmit,
  intro,
  footer,
}: {
  title: string;
  initial?: ChildInput;
  onSubmit: (input: ChildInput) => Promise<void>;
  /** Above the fields: guided setup's line on what this step is for. */
  intro?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [firstName, setFirstName] = useState(initial.first_name);
  const [uiMode, setUiMode] = useState<UiMode>(initial.ui_mode);
  const [petName, setPetName] = useState(initial.pet_name);
  const [reminder, setReminder] = useState(initial.reminder_time ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = childInputSchema.safeParse({
      first_name: firstName,
      ui_mode: uiMode,
      pet_name: petName,
      reminder_time: reminder.trim() === '' ? null : reminder.trim(),
    });
    if (!parsed.success) {
      return setError(fieldError(parsed.error.issues[0]));
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.save'));
      setBusy(false);
    }
  };

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: title }} />
      {intro}
      <Field
        label={t('childForm.firstName')}
        value={firstName}
        onChangeText={setFirstName}
        autoFocus
      />
      <Choice
        label={t('childForm.uiMode')}
        value={uiMode}
        onChange={setUiMode}
        options={[
          { value: 'little', title: t('childForm.little') },
          { value: 'big', title: t('childForm.big') },
        ]}
      />
      <Field label={t('childForm.petName')} value={petName} onChangeText={setPetName} />
      <Field
        label={t('childForm.reminder')}
        value={reminder}
        onChangeText={setReminder}
        placeholder="17:00"
        keyboardType="numbers-and-punctuation"
      />
      <ErrorText>{error}</ErrorText>
      <Button title={t('common.save')} onPress={submit} disabled={busy} />
      {footer}
    </ScrollScreen>
  );
}
