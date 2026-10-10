import { paywallShown, paywallStep, gateSchema, type Gate } from '@chores/shared';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { Button, ErrorText, Loading, ScrollScreen } from '@/components/ui';
import { capture } from '@/lib/analytics';
import { LEGAL_URLS, type Api } from '@/lib/api';
import { reportError } from '@/lib/error-reporting';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import {
  packageName,
  premiumPackages,
  purchase,
  purchaseWasCancelled,
  restore,
} from '@/lib/purchases';
import { useThemedStyles, type Theme } from '@/theme';

type Status =
  | 'loading'
  | 'idle'
  | 'purchasing'
  | 'restoring'
  | 'verifying'
  | 'ready'
  | 'load_error'
  | 'purchase_error'
  | 'restore_error'
  | 'verification_error';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How long a store result waits for the server. RevenueCat's webhook usually lands in seconds but
 * is documented to take up to a minute; a wait shorter than that tells a parent who has paid that
 * the purchase failed.
 */
const ENTITLEMENT_WAIT_MS = 90_000;

/**
 * A store result is only a reason to poll. The server webhook remains the Entitlement writer. A
 * read of /me that fails on the way is one more reason to keep waiting, not an answer.
 */
async function waitForServerEntitlement(api: Api): Promise<void> {
  const deadline = Date.now() + ENTITLEMENT_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const me = await api.me();
      if (me.household?.entitlement === 'premium') return;
    } catch {
      // The deadline decides; a blip in the middle does not.
    }
    await wait(1_000);
  }
  throw new Error('server entitlement did not arrive');
}

export default function Paywall() {
  const { gate: rawGate } = useLocalSearchParams<{ gate?: string }>();
  const parsed = gateSchema.safeParse(rawGate);
  const gate = parsed.success ? parsed.data : null;
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (gate) capture(paywallShown({ gate }));
    else reportError(new Error('paywall opened without a gate'), 'paywall_missing_gate');
  }, [gate]);

  if (!gate) return <Redirect href="/(parent)/(tabs)/(today)" />;
  return <GatedPaywall gate={gate} />;
}

function GatedPaywall({ gate }: { gate: Gate }) {
  const state = useHousehold();
  const router = useRouter();
  const styles = useThemedStyles(paywallStyles);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const parentId = state.status === 'ready' ? state.me.parent?.clerk_user_id : null;
  const { api, refresh } = state;

  const load = useCallback(async () => {
    if (!parentId) return;
    setStatus('loading');
    setError(null);
    try {
      setPackages(await premiumPackages(parentId));
      setStatus('idle');
    } catch (cause) {
      reportError(cause, 'paywall_load_offering');
      setStatus('load_error');
      setError(t('paywall.loadFailed'));
    }
  }, [parentId]);

  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);

  const confirmWithServer = useCallback(async () => {
    // Aborted when this screen closes or a retry starts: the wait itself carries on either way,
    // because a parent who has paid and left still needs the household to say premium.
    abort.current?.abort();
    const check = new AbortController();
    abort.current = check;
    setStatus('verifying');
    setError(null);
    try {
      await waitForServerEntitlement(api);
    } catch (cause) {
      reportError(cause, 'paywall_wait_for_entitlement');
      if (check.signal.aborted) return;
      setStatus('verification_error');
      setError(t('paywall.verificationFailed'));
      return;
    }
    // Refreshed even after the parent has left, so the gate they went back to opens without
    // waiting for some later read of /me.
    await refresh();
    if (check.signal.aborted) return;
    setStatus('ready');
    router.back();
  }, [api, refresh, router]);

  const buy = useCallback(
    async (aPackage: PurchasesPackage) => {
      const product_id = aPackage.product.identifier;
      capture(paywallStep({ step: 'plan_selected', gate, product_id }));
      setStatus('purchasing');
      setError(null);
      capture(paywallStep({ step: 'purchase_started', gate, product_id }));
      try {
        await purchase(aPackage);
      } catch (cause) {
        if (purchaseWasCancelled(cause)) {
          capture(paywallStep({ step: 'purchase_cancelled', gate, product_id }));
          return setStatus('idle');
        }
        capture(paywallStep({ step: 'purchase_failed', gate, product_id }));
        reportError(cause, 'paywall_purchase');
        setStatus('purchase_error');
        return setError(t('paywall.purchaseFailed'));
      }
      await confirmWithServer();
    },
    [confirmWithServer, gate],
  );

  const restorePurchase = useCallback(async () => {
    capture(paywallStep({ step: 'restore_tapped', gate }));
    setStatus('restoring');
    setError(null);
    try {
      if (!(await restore())) {
        capture(paywallStep({ step: 'restore_failed', gate }));
        setStatus('restore_error');
        return setError(t('paywall.restoreFailed'));
      }
    } catch (cause) {
      capture(paywallStep({ step: 'restore_failed', gate }));
      reportError(cause, 'paywall_restore');
      setStatus('restore_error');
      return setError(t('paywall.restoreFailed'));
    }
    capture(paywallStep({ step: 'restore_completed', gate }));
    await confirmWithServer();
  }, [confirmWithServer, gate]);

  const busy = ['purchasing', 'restoring', 'verifying', 'ready'].includes(status);

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: t('paywall.title') }} />
      <Text style={styles.gate}>{t(`paywall.gate.${gate}`)}</Text>
      <Text style={styles.includes}>{t('paywall.includes')}</Text>
      {status === 'loading' ? (
        <View style={styles.loading}>
          <Loading />
          <Text style={styles.status}>{t('paywall.loading')}</Text>
        </View>
      ) : (
        <View style={styles.products}>
          {packages.map((item) => {
            const name = packageName(item.packageType);
            const title = t('paywall.buy', {
              plan: t(`paywall.${name}`),
              price: item.product.priceString,
            });
            return (
              <Pressable
                key={item.identifier}
                style={[styles.product, busy && styles.disabled]}
                disabled={busy}
                onPress={() => void buy(item)}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <Text style={styles.productTitle}>{t(`paywall.${name}`)}</Text>
                <Text style={styles.price}>{item.product.priceString}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={styles.renewal}>{t('paywall.renewal')}</Text>
      <View style={styles.legal}>
        <LegalLink label={t('paywall.terms')} url={LEGAL_URLS.terms} />
        <LegalLink label={t('paywall.privacy')} url={LEGAL_URLS.privacy} />
      </View>
      {status === 'purchasing' && <Text style={styles.status}>{t('paywall.purchasing')}</Text>}
      {status === 'restoring' && <Text style={styles.status}>{t('paywall.restoring')}</Text>}
      {status === 'verifying' && <Text style={styles.status}>{t('paywall.verifying')}</Text>}
      {status === 'ready' && <Text style={styles.status}>{t('paywall.ready')}</Text>}
      <ErrorText>{error}</ErrorText>
      {status === 'load_error' && (
        <Button
          title={t('paywall.retry')}
          name="retry_load"
          onPress={() => void load()}
          secondary
        />
      )}
      {status === 'verification_error' && (
        <Button
          title={t('common.tryAgain')}
          name="retry_verification"
          onPress={() => void confirmWithServer()}
          secondary
        />
      )}
      <Button
        title={t('paywall.restore')}
        name="restore"
        onPress={() => void restorePurchase()}
        disabled={busy || status === 'loading'}
        secondary
      />
      <Button
        title={t('paywall.close')}
        name="close"
        onPress={() => {
          capture(paywallStep({ step: 'dismissed', gate }));
          router.back();
        }}
        disabled={busy}
        secondary
      />
    </ScrollScreen>
  );
}

/**
 * One of the two documents guideline 3.1.2 wants reachable from the purchase screen. A failed
 * `openURL` is reported rather than swallowed: a link App Review taps and nothing happens is the
 * same rejection as no link at all, and on a parent's device it is the only trace we would get.
 */
function LegalLink({ label, url }: { label: string; url: string }) {
  const styles = useThemedStyles(paywallStyles);
  return (
    <Pressable
      onPress={() => {
        Linking.openURL(url).catch((cause: unknown) => reportError(cause, 'paywall_legal_link'));
      }}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={styles.legalHit}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const paywallStyles = (theme: Theme) => ({
  gate: { ...theme.type.heading, color: theme.colors.text, textAlign: 'center' as const },
  includes: { ...theme.type.body, color: theme.colors.muted, textAlign: 'center' as const },
  products: { gap: theme.space.md },
  product: {
    minHeight: theme.touchTarget,
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.action,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: theme.space.md,
  },
  productTitle: { ...theme.type.body, color: theme.colors.text },
  price: { ...theme.type.heading, color: theme.colors.text },
  disabled: { opacity: 0.5 },
  renewal: { ...theme.type.caption, color: theme.colors.muted, textAlign: 'center' as const },
  legal: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: theme.space.lg,
  },
  // The disclosure reads as fine print, but a link a parent has to hit is still a touch target.
  legalHit: { minHeight: theme.touchTarget, justifyContent: 'center' as const },
  link: { ...theme.type.label, color: theme.colors.action, textAlign: 'center' as const },
  loading: { minHeight: 120, gap: theme.space.sm },
  status: { ...theme.type.label, color: theme.colors.muted, textAlign: 'center' as const },
});
