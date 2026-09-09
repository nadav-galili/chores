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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorText, Field, Title, Choice } from '@/components/ui';

/** Labels by mask bit, Mon=0 … Sun=6. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Title>{title}</Title>
      <Field label="Title" value={choreTitle} onChangeText={setChoreTitle} autoFocus />
      <Choice
        label="How often"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'daily', title: 'Every day' },
          { value: 'weekdays', title: 'Some days' },
          { value: 'once', title: 'Once' },
        ]}
      />
      {kind === 'weekdays' && (
        <View style={styles.field}>
          <Text style={styles.label}>Which days</Text>
          <View style={styles.row}>
            {WEEKDAYS.map((day, i) => (
              <Chip
                key={day}
                title={day}
                active={(mask & (1 << i)) !== 0}
                onPress={() => toggleDay(i)}
              />
            ))}
          </View>
          <Pressable onPress={() => setMask(mask === ALL_WEEKDAYS ? 0 : ALL_WEEKDAYS)}>
            <Text style={styles.link}>{mask === ALL_WEEKDAYS ? 'Clear all' : 'Every day'}</Text>
          </Pressable>
        </View>
      )}
      {kind === 'once' && (
        <Field
          label="Due date (YYYY-MM-DD)"
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="2026-09-12"
          keyboardType="numbers-and-punctuation"
        />
      )}
      <View style={styles.field}>
        <Text style={styles.label}>Who</Text>
        <View style={styles.row}>
          <Chip
            title="All"
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
        </View>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={submit} disabled={busy} />
      {onDelete && <Button title="Delete chore" onPress={remove} disabled={busy} secondary />}
    </ScrollView>
  );
}

function Chip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, paddingTop: 48, gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 14, color: '#555' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { color: '#208AEF', fontSize: 14, marginTop: 4 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#eee' },
  chipActive: { backgroundColor: '#208AEF' },
  chipText: { fontSize: 16, color: '#333' },
  chipTextActive: { color: 'white', fontWeight: '600' },
});
