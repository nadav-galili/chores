import { paywallShown, gateSchema, type Gate } from '@chores/shared';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { Button, ErrorText, Loading, ScrollScreen, Title } from '@/components/ui';
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

/** A store result is only a reason to poll. The server webhook remains the Entitlement writer. */
async function waitForServerEntitlement(api: Api, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (signal.aborted) throw new Error('entitlement check cancelled');
    const me = await api.me();
    if (me.household?.entitlement === 'premium') return;
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

  if (!gate) return <Redirect href="/(parent)" />;
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
    abort.current?.abort();
    const check = new AbortController();
    abort.current = check;
    setStatus('verifying');
    setError(null);
    try {
      await waitForServerEntitlement(api, check.signal);
      await refresh();
      setStatus('ready');
      router.back();
    } catch (cause) {
      if (check.signal.aborted) return;
      reportError(cause, 'paywall_wait_for_entitlement');
      setStatus('verification_error');
      setError(t('paywall.verificationFailed'));
    }
  }, [api, refresh, router]);

  const buy = useCallback(
    async (aPackage: PurchasesPackage) => {
      setStatus('purchasing');
      setError(null);
      try {
        await purchase(aPackage);
      } catch (cause) {
        if (purchaseWasCancelled(cause)) return setStatus('idle');
        reportError(cause, 'paywall_purchase');
        setStatus('purchase_error');
        return setError(t('paywall.purchaseFailed'));
      }
      await confirmWithServer();
    },
    [confirmWithServer],
  );

  const restorePurchase = useCallback(async () => {
    setStatus('restoring');
    setError(null);
    try {
      if (!(await restore())) {
        setStatus('restore_error');
        return setError(t('paywall.restoreFailed'));
      }
    } catch (cause) {
      reportError(cause, 'paywall_restore');
      setStatus('restore_error');
      return setError(t('paywall.restoreFailed'));
    }
    await confirmWithServer();
  }, [confirmWithServer]);

  const busy = ['purchasing', 'restoring', 'verifying', 'ready'].includes(status);

  return (
    <ScrollScreen>
      <Title>{t('paywall.title')}</Title>
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
        <Button title={t('paywall.retry')} onPress={() => void load()} secondary />
      )}
      {status === 'verification_error' && (
        <Button title={t('common.tryAgain')} onPress={() => void confirmWithServer()} secondary />
      )}
      <Button
        title={t('paywall.restore')}
        onPress={() => void restorePurchase()}
        disabled={busy || status === 'loading'}
        secondary
      />
      <Button title={t('paywall.close')} onPress={() => router.back()} disabled={busy} secondary />
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
