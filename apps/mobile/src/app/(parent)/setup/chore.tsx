import { CATALOGS, uuid7, type Catalog, type ChoreFields } from '@chores/shared';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ChoreForm, emptyChore } from '@/components/chore-form';
import { FinishLater, SetupPurpose, useSetupStep } from '@/components/setup-step';
import { Button, Chip, ChipGroup, ErrorText, ScrollScreen } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';

type Suggestion = keyof Catalog['setup']['firstChore']['suggestions'];

/** The suggested chores, in the catalog's order: the catalog is the list (spec #86). */
const SUGGESTIONS = Object.keys(CATALOGS.en.setup.firstChore.suggestions) as Suggestion[];

/**
 * Guided setup's First chore step, above the tab bar (spec #86). A suggestion is one tap: a
 * `daily` chore with that title, no start date, the child setup is for as its only assignee and
 * no Photo Proof — so setup never touches a Gate (ADR-0005). "Write my own" swaps in the chore
 * form preset to that child, with its Photo Proof control left out for the same reason, and saving
 * it advances the same way.
 *
 * The child is the first one, as the Join Code step's is (`nextSetupHref`): guided setup sets up
 * one child.
 */
export default function SetupChore() {
  const state = useHousehold();
  const { advance, finishLater } = useSetupStep('chore');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: a second tap in the same frame must see the first one's claim.
  const busy = useRef(false);
  if (state.status !== 'ready' || !state.me.household) return null;
  const householdId = state.me.household.id;
  const child = state.me.children[0];
  if (!child) return null;

  const save = (fields: ChoreFields) =>
    state.api.upsertChore(householdId, uuid7(), {
      fields,
      updated_at: new Date().toISOString(),
    });

  if (writing) {
    return (
      <ChoreForm
        title={t('chores.add')}
        children={state.me.children}
        initial={{ ...emptyChore([]), assignees: [child.id] }}
        intro={<SetupPurpose step="chore" />}
        setup
        onSubmit={async (fields) => {
          await save(fields);
          await advance();
        }}
        footer={<FinishLater onPress={finishLater} />}
      />
    );
  }

  const pick = async (suggestion: Suggestion) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await save({
        ...emptyChore([]),
        title: t(`setup.firstChore.suggestions.${suggestion}`),
        assignees: [child.id],
      });
      await advance();
    } catch (e) {
      setError(withCause(t('errors.save'), e));
      busy.current = false;
    }
  };

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: t('chores.add') }} />
      <SetupPurpose step="chore" />
      <ChipGroup label={t('setup.firstChore.pick')}>
        {SUGGESTIONS.map((s) => (
          <Chip
            key={s}
            title={t(`setup.firstChore.suggestions.${s}`)}
            active={false}
            onPress={() => void pick(s)}
            role="button"
          />
        ))}
      </ChipGroup>
      <ErrorText>{error}</ErrorText>
      <Button name="write_own_chore" title={t('setup.firstChore.writeOwn')} onPress={() => setWriting(true)} secondary />
      <FinishLater onPress={finishLater} />
    </ScrollScreen>
  );
}
