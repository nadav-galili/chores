import { childInputSchema, type ChildInput, type UiMode } from '@chores/shared';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PetFigure } from '@/components/pet';
import { Button, Choice, ErrorText, Field, ScrollScreen } from '@/components/ui';
import { fieldError, t } from '@/lib/i18n';
import { useThemedStyles, type Theme } from '@/theme';

const empty: ChildInput = { first_name: '', ui_mode: 'little', pet_name: '', reminder_time: null };

export function ChildForm({
  title,
  initial = empty,
  onSubmit,
  intro,
  footer,
  setup = false,
}: {
  title: string;
  initial?: ChildInput;
  onSubmit: (input: ChildInput) => Promise<void>;
  /** Above the fields: guided setup's line on what this step is for. */
  intro?: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Guided setup's Child step (spec #86): only what the child needs to start. Little / Big become
   * two picture cards and the reminder time is not asked — it stays on the child's edit screen.
   */
  setup?: boolean;
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
      reminder_time: setup || reminder.trim() === '' ? null : reminder.trim(),
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
      {setup ? (
        <UiModeCards value={uiMode} onChange={setUiMode} />
      ) : (
        <Choice
          label={t('childForm.uiMode')}
          value={uiMode}
          onChange={setUiMode}
          options={[
            { value: 'little', title: t('childForm.little') },
            { value: 'big', title: t('childForm.big') },
          ]}
        />
      )}
      <Field label={t('childForm.petName')} value={petName} onChangeText={setPetName} />
      {!setup && (
        <Field
          label={t('childForm.reminder')}
          value={reminder}
          onChangeText={setReminder}
          placeholder="17:00"
          keyboardType="numbers-and-punctuation"
        />
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={t('common.save')} onPress={submit} disabled={busy} />
      {footer}
    </ScrollScreen>
  );
}

/**
 * Little / Big as two picture cards: the existing pet art, young against grown, so the choice
 * reads without the explanation under it. The row follows the reader's direction, so Hebrew puts
 * Little on the right with no conditional.
 */
function UiModeCards({ value, onChange }: { value: UiMode; onChange: (v: UiMode) => void }) {
  const styles = useThemedStyles(cardStyles);
  const cards = [
    { mode: 'little', level: 2 },
    { mode: 'big', level: 4 },
  ] as const;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{t('childForm.uiMode')}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {cards.map(({ mode, level }) => {
          const active = mode === value;
          const title = t(`childForm.${mode}`);
          const hint = t(`childForm.${mode}Hint`);
          return (
            <Pressable
              key={mode}
              style={[styles.card, active && styles.cardActive]}
              onPress={() => onChange(mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${title}. ${hint}`}
            >
              <PetFigure name={title} level={level} mood="happy" size={88} showStage={false} />
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.hint}>{hint}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const cardStyles = (theme: Theme) => ({
  field: { gap: theme.space.xs },
  label: { ...theme.type.label, color: theme.colors.muted },
  row: { flexDirection: 'row' as const, gap: theme.space.md },
  card: {
    flex: 1,
    alignItems: 'center' as const,
    gap: theme.space.xs,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.surface,
    backgroundColor: theme.colors.surface,
  },
  // Chosen is the `action` edge — the one colour that means "act" — not a fill, so the art stays
  // on the surface it was drawn for.
  cardActive: { borderColor: theme.colors.action },
  title: { ...theme.type.heading, color: theme.colors.text, fontWeight: '600' as const },
  hint: { ...theme.type.caption, color: theme.colors.muted, textAlign: 'center' as const },
});
