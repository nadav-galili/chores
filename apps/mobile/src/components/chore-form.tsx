import {
  ALL_WEEKDAYS,
  CHORE_FIELDS,
  choreFieldsSchema,
  type Child,
  type ChoreFields,
  type ChoreKind,
  type UpsertChoreOp,
} from '@chores/shared';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { Pressable, Text } from 'react-native';
import {
  Button,
  Chip,
  ChipGroup,
  Choice,
  ErrorText,
  Field,
  ScrollScreen,
  Title,
} from '@/components/ui';
import { fieldError, t, weekdayLabels } from '@/lib/i18n';
import { useThemedStyles, type Theme } from '@/theme';

/** Labels by mask bit, Mon=0 … Sun=6, in the phone's language. */
export const WEEKDAYS = weekdayLabels;

/** The default for a new chore: daily, for every child. */
export function emptyChore(children: Child[]): ChoreFields {
  return {
    title: '',
    icon: null,
    kind: 'daily',
    weekday_mask: null,
    start_date: null,
    end_date: null,
    due_date: null,
    requires_photo: false,
    assignees: children.map((c) => c.id),
  };
}

/** Only the fields that differ from `initial`, so two parents' edits merge field by field. */
export function diffChore(initial: ChoreFields, next: ChoreFields): UpsertChoreOp['fields'] {
  const fields: UpsertChoreOp['fields'] = {};
  for (const key of CHORE_FIELDS) {
    const a = initial[key];
    const b = next[key];
    const same = Array.isArray(a) && Array.isArray(b) ? sameSet(a, b) : a === b;
    if (!same) Object.assign(fields, { [key]: b });
  }
  return fields;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function ChoreForm({
  title,
  children,
  initial,
  onSubmit,
  onDelete,
}: {
  title: string;
  children: Child[];
  initial: ChoreFields;
  onSubmit: (fields: ChoreFields) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const styles = useThemedStyles(choreFormStyles);
  const [choreTitle, setChoreTitle] = useState(initial.title);
  const [kind, setKind] = useState<ChoreKind>(initial.kind);
  const [mask, setMask] = useState(initial.weekday_mask ?? 0);
  const [dueDate, setDueDate] = useState(initial.due_date ?? '');
  const [assignees, setAssignees] = useState<string[]>(initial.assignees);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAssigned = children.length > 0 && children.every((c) => assignees.includes(c.id));
  const toggleAssignee = (id: string) =>
    setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const toggleDay = (i: number) => setMask((m) => m ^ (1 << i));

  const submit = async () => {
    const parsed = choreFieldsSchema.safeParse({
      ...initial,
      title: choreTitle,
      kind,
      weekday_mask: kind === 'weekdays' ? mask : null,
      due_date: kind === 'once' ? dueDate.trim() || null : null,
      assignees,
    });
    if (!parsed.success) {
      return setError(fieldError(parsed.error.issues[0]));
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(withCause(t('errors.save'), e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(withCause(t('errors.delete'), e));
      setBusy(false);
    }
  };

  return (
    <ScrollScreen>
      <Title>{title}</Title>
      <Field
        label={t('choreForm.title')}
        value={choreTitle}
        onChangeText={setChoreTitle}
        autoFocus
      />
      <Choice
        label={t('choreForm.howOften')}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'daily', title: t('choreForm.kind.daily') },
          { value: 'weekdays', title: t('choreForm.kind.weekdays') },
          { value: 'once', title: t('choreForm.kind.once') },
        ]}
      />
      {kind === 'weekdays' && (
        <ChipGroup
          label={t('choreForm.whichDays')}
          footer={
            <Pressable
              style={styles.linkTarget}
              onPress={() => setMask(mask === ALL_WEEKDAYS ? 0 : ALL_WEEKDAYS)}
              accessibilityRole="button"
            >
              <Text style={styles.link}>
                {t(mask === ALL_WEEKDAYS ? 'choreForm.clearAll' : 'choreForm.selectAll')}
              </Text>
            </Pressable>
          }
        >
          {WEEKDAYS().map((day: string, i: number) => (
            <Chip
              key={day}
              title={day}
              active={(mask & (1 << i)) !== 0}
              onPress={() => toggleDay(i)}
            />
          ))}
        </ChipGroup>
      )}
      {kind === 'once' && (
        <Field
          label={t('choreForm.dueDate')}
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="2026-09-12"
          keyboardType="numbers-and-punctuation"
        />
      )}
      <ChipGroup label={t('choreForm.who')}>
        <Chip
          title={t('common.all')}
          active={allAssigned}
          onPress={() => setAssignees(allAssigned ? [] : children.map((c) => c.id))}
        />
        {children.map((c) => (
          <Chip
            key={c.id}
            title={c.first_name}
            active={assignees.includes(c.id)}
            onPress={() => toggleAssignee(c.id)}
          />
        ))}
      </ChipGroup>
      <ErrorText>{error}</ErrorText>
      <Button title={t('common.save')} onPress={submit} disabled={busy} />
      {onDelete && (
        <Button title={t('choreForm.delete')} onPress={remove} disabled={busy} secondary />
      )}
    </ScrollScreen>
  );
}

/**
 * The form scrolls rather than centring — it is the one parent screen that can grow taller than
 * a phone, because choosing weekdays and choosing who adds two rows of chips to it — which is
 * `ScrollScreen`'s whole job, so the page itself is not redescribed here.
 */
const choreFormStyles = (theme: Theme) => ({
  // A text link is the one place outside a button that wears `action`, and it still has to be
  // as tappable as a button is.
  linkTarget: { minHeight: theme.touchTarget, justifyContent: 'center' as const },
  link: { ...theme.type.label, color: theme.colors.action },
});

/**
 * A failed write, with the reason attached.
 *
 * The bare string was untranslatable into action: "Could not save" reads the same whether the
 * server rejected the shape, the token had expired, or the phone was offline — and the parent is
 * the only person who can see it. The status and code are not localized on purpose; they are for
 * repeating back, not for reading.
 */
function withCause(message: string, e: unknown): string {
  if (e instanceof ApiError) return `${message} (${e.status} ${e.code})`;
  return e instanceof Error && e.message ? `${message} (${e.message})` : message;
}
