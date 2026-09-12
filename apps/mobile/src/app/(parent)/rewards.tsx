import { customRewardInputSchema, uuid7, type Reward } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Body, Button, Coins, ErrorState, FILL, Field, Screen, Title } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { rewardTitle } from '@/lib/reward-title';
import { useRewards } from '@/lib/use-rewards';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * One reward and the one thing a parent may do to it. The toggle borrows the chip's pill rather
 * than a filled button, for the reason the Reject control does: it sits inside a scan, and the
 * one green means "act" on the child's side.
 */
function RewardLine({
  reward,
  onToggle,
  busy,
  onEdit,
}: {
  reward: Reward;
  onToggle: () => void;
  busy: boolean;
  onEdit: () => void;
}) {
  const styles = useThemedStyles(rewardStyles);
  const title = rewardTitle(reward);
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[styles.title, !reward.active && styles.titleHidden]}>
          {reward.icon ? `${reward.icon} ${title}` : title}
        </Text>
        <Text style={styles.state}>{t(reward.active ? 'rewards.shown' : 'rewards.hidden')}</Text>
      </View>
      <Coins amount={reward.cost_coins} />
      <Pressable
        style={[styles.toggle, busy && styles.toggleBusy]}
        onPress={onToggle}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Text style={styles.toggleText}>
          {busy ? t('rewards.saving') : t(reward.active ? 'rewards.hide' : 'rewards.show')}
        </Text>
      </Pressable>
      {!reward.is_builtin ? (
        <Pressable
          style={styles.toggle}
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t('rewards.editNamed', { title })}
        >
          <Text style={styles.toggleText}>{t('rewards.edit')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type Draft = {
  rewardId: string;
  title: string;
  icon: string;
  cost: string;
  sort: number;
  active: boolean;
};

/**
 * The household's reward shop as the parent edits it: the built-ins the catalog seeded, each
 * shown or hidden. Hiding is `active = false` on this household's own row and reaches the child's
 * shop on their next pull. Adding a reward is not offered — that is M3's `custom_reward` gate.
 */
export default function Rewards() {
  const state = useHousehold();
  const rewards = useRewards();
  const router = useRouter();
  const styles = useThemedStyles(rewardStyles);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const householdId = state.me?.household?.id ?? null;

  async function toggle(reward: Reward) {
    if (!householdId) return;
    setBusy(reward.id);
    setNotice(null);
    try {
      await state.api.setRewardActive(householdId, reward.id, !reward.active);
      await rewards.refresh();
    } catch (e) {
      setNotice(withCause(t('rewards.saveFailed', { title: rewardTitle(reward) }), e));
    } finally {
      setBusy(null);
    }
  }

  function edit(reward: Reward) {
    if (state.me?.household?.entitlement !== 'premium') {
      router.push({ pathname: '/(parent)/paywall', params: { gate: 'custom_rewards' } });
      return;
    }
    setConfirmDelete(false);
    setDraft({
      rewardId: reward.id,
      title: reward.title ?? '',
      icon: reward.icon ?? '',
      cost: String(reward.cost_coins),
      sort: reward.sort,
      active: reward.active,
    });
  }

  function add() {
    if (state.me?.household?.entitlement !== 'premium') {
      router.push({ pathname: '/(parent)/paywall', params: { gate: 'custom_rewards' } });
      return;
    }
    setConfirmDelete(false);
    setDraft({
      rewardId: uuid7(),
      title: '',
      icon: '',
      cost: '',
      sort: Math.max(-1, ...rewards.rewards.map((reward) => reward.sort)) + 1,
      active: true,
    });
  }

  async function saveCustom() {
    if (!draft || !householdId) return;
    const input = customRewardInputSchema.safeParse({
      title: draft.title,
      icon: draft.icon.trim() || null,
      cost_coins: Number(draft.cost),
      active: draft.active,
      sort: draft.sort,
      updated_at: new Date().toISOString(),
    });
    if (!input.success) return setNotice(t('rewards.invalid'));
    setBusy(draft.rewardId);
    setNotice(null);
    try {
      await state.api.upsertCustomReward(householdId, draft.rewardId, input.data);
      await rewards.refresh();
      setDraft(null);
    } catch (e) {
      setNotice(withCause(t('rewards.customSaveFailed'), e));
    } finally {
      setBusy(null);
    }
  }

  async function removeCustom() {
    if (!draft || !householdId) return;
    setBusy(draft.rewardId);
    setNotice(null);
    try {
      await state.api.deleteCustomReward(householdId, draft.rewardId);
      await rewards.refresh();
      setDraft(null);
      setConfirmDelete(false);
    } catch (e) {
      setNotice(withCause(t('rewards.customDeleteFailed'), e));
    } finally {
      setBusy(null);
    }
  }

  if (state.status !== 'ready' || !householdId) return null;

  return (
    <Screen list>
      <Title>{t('rewards.title')}</Title>
      <Body>{t('rewards.hint')}</Body>
      <Button
        title={
          state.me.household?.entitlement === 'premium' ? t('rewards.add') : t('rewards.addPremium')
        }
        onPress={add}
        secondary
      />
      {draft ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>{t('rewards.customTitle')}</Text>
          <Field
            label={t('rewards.customName')}
            value={draft.title}
            onChangeText={(title) => setDraft((value) => (value ? { ...value, title } : value))}
            autoFocus
          />
          <Field
            label={t('rewards.customIcon')}
            value={draft.icon}
            onChangeText={(icon) => setDraft((value) => (value ? { ...value, icon } : value))}
          />
          <Field
            label={t('rewards.customCost')}
            value={draft.cost}
            onChangeText={(cost) => setDraft((value) => (value ? { ...value, cost } : value))}
            keyboardType="number-pad"
          />
          <Button
            title={busy === draft.rewardId ? t('rewards.saving') : t('rewards.saveCustom')}
            onPress={() => void saveCustom()}
            disabled={busy === draft.rewardId}
          />
          <Button title={t('rewards.cancel')} onPress={() => setDraft(null)} secondary />
          {rewards.rewards.some((reward) => reward.id === draft.rewardId) ? (
            confirmDelete ? (
              <View style={styles.confirm}>
                <Text style={styles.deleteText}>{t('rewards.deleteConfirm')}</Text>
                <Button
                  title={t('rewards.delete')}
                  onPress={() => void removeCustom()}
                  disabled={busy === draft.rewardId}
                  secondary
                />
                <Button
                  title={t('rewards.keep')}
                  onPress={() => setConfirmDelete(false)}
                  secondary
                />
              </View>
            ) : (
              <Button
                title={t('rewards.delete')}
                onPress={() => setConfirmDelete(true)}
                secondary
              />
            )
          ) : null}
        </View>
      ) : null}
      {rewards.status === 'error' && (
        <ErrorState
          title={rewards.message || t('rewards.loadFailed')}
          body={t('parent.unreachable')}
          actionTitle={t('common.tryAgain')}
          onAction={() => void rewards.refresh()}
        />
      )}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <FlatList
        style={FILL}
        data={rewards.rewards}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <RewardLine
            reward={item}
            onToggle={() => void toggle(item)}
            onEdit={() => edit(item)}
            busy={busy === item.id}
          />
        )}
      />
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}

const rewardStyles = (theme: Theme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    paddingVertical: theme.space.sm,
  },
  text: { flex: 1, gap: theme.space.xs },
  title: { ...theme.type.body, color: theme.colors.text },
  titleHidden: { color: theme.colors.muted },
  state: { ...theme.type.label, color: theme.colors.muted },
  toggle: {
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  toggleBusy: { opacity: 0.5 },
  toggleText: { ...theme.type.label, color: theme.colors.muted },
  notice: { ...theme.type.label, color: theme.colors.danger },
  form: {
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  formTitle: { ...theme.type.heading, color: theme.colors.text },
  confirm: { gap: theme.space.sm },
  deleteText: { ...theme.type.body, color: theme.colors.danger },
});
