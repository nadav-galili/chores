import type { BuiltinRewardKey, Reward } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Body, Button, Coins, ErrorState, FILL, Screen, Title } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { t, type TranslationKey } from '@/lib/i18n';
import { useRewards } from '@/lib/use-rewards';
import { useThemedStyles, type Theme } from '@/theme';

/** A built-in carries a key and no title, so its name is read here rather than off the row. */
const BUILTIN_TITLES: Record<BuiltinRewardKey, TranslationKey> = {
  snack: 'rewards.builtin.snack',
  screen_time: 'rewards.builtin.screen_time',
  friday_dinner: 'rewards.builtin.friday_dinner',
};

const titleOf = (reward: Reward) =>
  reward.title ?? (reward.builtin_key ? t(BUILTIN_TITLES[reward.builtin_key]) : '');

/**
 * One reward and the one thing a parent may do to it. The toggle borrows the chip's pill rather
 * than a filled button, for the reason the Reject control does: it sits inside a scan, and the
 * one green means "act" on the child's side.
 */
function RewardLine({
  reward,
  onToggle,
  busy,
}: {
  reward: Reward;
  onToggle: () => void;
  busy: boolean;
}) {
  const styles = useThemedStyles(rewardStyles);
  const title = titleOf(reward);
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
    </View>
  );
}

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
  const householdId = state.me?.household?.id ?? null;

  async function toggle(reward: Reward) {
    if (!householdId) return;
    setBusy(reward.id);
    setNotice(null);
    try {
      await state.api.setRewardActive(householdId, reward.id, !reward.active);
      await rewards.refresh();
    } catch (e) {
      setNotice(withCause(t('rewards.saveFailed', { title: titleOf(reward) }), e));
    } finally {
      setBusy(null);
    }
  }

  if (state.status !== 'ready' || !householdId) return null;

  return (
    <Screen list>
      <Title>{t('rewards.title')}</Title>
      <Body>{t('rewards.hint')}</Body>
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
          <RewardLine reward={item} onToggle={() => void toggle(item)} busy={busy === item.id} />
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
});
