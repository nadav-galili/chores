import type { DeviceSession, RedemptionStatus } from '@chores/shared';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Card, Coins, EmptyState } from '@/components/ui';
import { wipeDeviceDb } from '@/db/client';
import { shutdownAnalytics } from '@/lib/analytics';
import { useDeviceSession, type DeviceSessionValue } from '@/lib/device-session';
import { BACK_ARROW, t, type TranslationKey } from '@/lib/i18n';
import { rewardTitle } from '@/lib/reward-title';
import { clearRole } from '@/lib/role';
import { useShop, type Shop } from '@/lib/use-shop';
import { useTheme, useThemedStyles, type Theme } from '@/theme';
import type { ShopReward } from '@/sync/shop';

export default function ShopScreen() {
  const device = useDeviceSession();
  if (!device.session) return null;
  return <ShopPage device={device} session={device.session} />;
}

/**
 * Where coins become something (ADR-0014, docs/spec/01-product.md).
 *
 * The catalog the household has, priced against what the child holds; one tap asks and the coins
 * go immediately, offline and all; a request is the child's to take back until a parent has
 * decided it. Decisions are shown quietly below, a few at a time — a child should be able to see
 * that they were told no without being told again every time they open the shop.
 *
 * `ui_mode` changes what it always changes and no more: the type and target size arrive through
 * the theme, and the section's name is in the mode's voice. Not the set of rewards, and not the
 * number of taps it takes to spend.
 */
function ShopPage({ device, session }: { device: DeviceSessionValue; session: DeviceSession }) {
  const router = useRouter();
  const styles = useThemedStyles(shopStyles);
  const mode = useTheme().uiMode;

  const onRevoked = useCallback(async () => {
    router.replace({ pathname: '/(kid)/join', params: { reason: 'revoked' } });
    await shutdownAnalytics();
    await wipeDeviceDb();
    await device.clear();
    await clearRole();
  }, [router, device]);

  const shop = useShop(session, () => void onRevoked());

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable style={styles.back} onPress={() => router.back()} accessibilityRole="button">
        <Text style={styles.backText}>{`${BACK_ARROW} ${t('shop.back')}`}</Text>
      </Pressable>
      <Text style={styles.title}>{t(`kid.${mode}.shop`)}</Text>

      <View style={styles.balance}>
        <Text style={styles.label}>{t('shop.yours')}</Text>
        <Coins amount={shop.coins} step="display" />
      </View>

      {shop.status === 'ready' && shop.rewards.length === 0 ? (
        <EmptyState title={t('shop.empty')} />
      ) : (
        <View style={styles.rows}>
          {shop.rewards.map((reward) => (
            <RewardRow key={reward.id} reward={reward} onAsk={() => shop.ask(reward)} />
          ))}
        </View>
      )}

      {shop.requests.length > 0 && <Requests shop={shop} />}
    </ScrollView>
  );
}

/**
 * One reward, and the tap that asks for it. A reward the balance does not cover says so where
 * the action would be and is not tappable at all: the refusal is the screen's, before the child
 * has committed to anything. The server asks the same question again when the op reaches it,
 * which is what makes this a kindness rather than the rule.
 */
function RewardRow({ reward, onAsk }: { reward: ShopReward; onAsk: () => void }) {
  const styles = useThemedStyles(shopStyles);
  const title = rewardTitle(reward);
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.icon}>{reward.icon ?? REWARD_GLYPH}</Text>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, !reward.affordable && styles.unaffordable]}>{title}</Text>
          <Coins amount={reward.cost_coins} variant="pays" step="label" />
        </View>
        {reward.affordable ? (
          <Pressable
            style={styles.ask}
            onPress={onAsk}
            accessibilityRole="button"
            accessibilityLabel={`${t('shop.ask')} — ${title}`}
          >
            <Text style={styles.askText}>{t('shop.ask')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.cantAfford}>{t('shop.cantAfford')}</Text>
        )}
      </View>
    </Card>
  );
}

/**
 * What the child has asked for: everything still waiting, then the last few answers. A waiting
 * request carries the way out of it — until a parent decides, the request is still the child's.
 */
function Requests({ shop }: { shop: Shop }) {
  const styles = useThemedStyles(shopStyles);
  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('shop.requests')}</Text>
      <View style={styles.rows}>
        {shop.requests.map((request) => (
          <View key={request.id} style={styles.row}>
            <Text style={styles.icon}>{request.icon ?? REWARD_GLYPH}</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{rewardTitle(request)}</Text>
              <Text style={styles.status}>{t(STATUS_LINE[request.status])}</Text>
            </View>
            {request.status === 'requested' && (
              <Pressable
                style={styles.cancel}
                onPress={() => shop.cancel(request)}
                accessibilityRole="button"
                accessibilityLabel={`${t('shop.cancel')} — ${rewardTitle(request)}`}
              >
                <Text style={styles.cancelText}>{t('shop.cancel')}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Placeholder art, swapped for drawn assets with the rest of it. */
const REWARD_GLYPH = '🎁';

/** A cancelled request is never drawn, so there is no line for one. */
const STATUS_LINE = {
  requested: 'shop.waiting',
  approved: 'shop.approved',
  declined: 'shop.declined',
  cancelled: 'shop.waiting',
} as const satisfies Record<RedemptionStatus, TranslationKey>;

const shopStyles = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.ground },
  content: {
    paddingTop: theme.space.xxl * 2,
    paddingHorizontal: theme.space.xl,
    paddingBottom: theme.space.xxl,
    gap: theme.space.md,
  },
  back: {
    alignSelf: 'flex-start' as const,
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    paddingEnd: theme.space.lg,
  },
  backText: { ...theme.type.body, color: theme.colors.action },
  title: { ...theme.type.title, color: theme.colors.text },
  balance: { alignItems: 'center' as const, gap: theme.space.xs },
  label: { ...theme.type.label, color: theme.colors.muted },
  sectionTitle: { ...theme.type.heading, color: theme.colors.text },
  rows: { gap: theme.space.sm },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.space.md },
  rowText: { flex: 1, gap: theme.space.xs },
  rowTitle: { ...theme.type.body, color: theme.colors.text },
  // Out of reach, said by the type rather than by a colour: nothing here is an error.
  unaffordable: { color: theme.colors.muted },
  icon: { ...theme.type.title, color: theme.colors.text },
  ask: {
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.action,
  },
  askText: { ...theme.type.label, color: theme.colors.onAction, fontWeight: '600' as const },
  cantAfford: { ...theme.type.label, color: theme.colors.muted, flexShrink: 1 },
  status: { ...theme.type.label, color: theme.colors.muted },
  cancel: {
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.muted,
  },
  cancelText: { ...theme.type.label, color: theme.colors.text },
});
