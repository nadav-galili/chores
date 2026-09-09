import { childInputSchema, type ChildInput, type UiMode } from '@chores/shared';
import { useState } from 'react';
import { Button, Choice, ErrorText, Field, Screen, Title } from '@/components/ui';

const empty: ChildInput = { first_name: '', ui_mode: 'little', pet_name: '', reminder_time: null };

export function ChildForm({
  title,
  initial = empty,
  onSubmit,
  footer,
}: {
  title: string;
  initial?: ChildInput;
  onSubmit: (input: ChildInput) => Promise<void>;
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
      const issue = parsed.error.issues[0];
      return setError(`${issue?.path.join('.') ?? 'form'}: ${issue?.message ?? 'invalid'}`);
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{title}</Title>
      <Field label="First name" value={firstName} onChangeText={setFirstName} autoFocus />
      <Choice
        label="Screen mode"
        value={uiMode}
        onChange={setUiMode}
        options={[
          { value: 'little', title: 'Little' },
          { value: 'big', title: 'Big' },
        ]}
      />
      <Field label="Pet name" value={petName} onChangeText={setPetName} />
      <Field
        label="Reminder time (HH:MM, optional)"
        value={reminder}
        onChangeText={setReminder}
        placeholder="17:00"
        keyboardType="numbers-and-punctuation"
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={submit} disabled={busy} />
      {footer}
    </Screen>
  );
}
