import { uuid7 } from '@chores/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import {
  Body,
  Button,
  Card,
  Coins,
  ErrorState,
  Field,
  Loading,
  Screen,
  Title,
} from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { formatNumber, formatWallClock, locale, t } from '@/lib/i18n';
import { ApiError, type MoneyLedgerChildView, type MoneyLedgerView } from '@/lib/api';
import { useThemedStyles, type Theme } from '@/theme';

/** Minor currency units to a priced string, in the household's currency. */
function formatMoney(minor: number, currency: string): string {
  const tag = locale === 'he' ? 'he-IL' : 'en-GB';
  try {
    return new Intl.NumberFormat(tag, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${formatNumber(minor / 100)} ${currency}`;
  }
}

function EntryLine({
  entry,
  currency,
  tz,
}: {
  entry: MoneyLedgerChildView['entries'][number];
  currency: string;
  tz: string;
}) {
  const styles = useThemedStyles(allowanceStyles);
  const detail =
    entry.kind === 'payout' && entry.money_amount !== null
      ? `${formatNumber(-entry.coins)} → ${formatMoney(entry.money_amount, currency)}`
      : `${formatNumber(entry.coins)}${entry.note ? ` · ${entry.note}` : ''}`;
  return (
    <View style={styles.entry}>
      <Text style={styles.entryKind}>{entry.kind}</Text>
      <Text style={styles.entryDetail}>{detail}</Text>
      <Text style={styles.entryWhen}>{formatWallClock(entry.created_at, tz)}</Text>
    </View>
  );
}

/**
 * One child's money: the server's balance and owed, the two appends, and the
 * payout/adjustment history. Balance is never typed in — it is read from the view.
 */
function ChildMoney({
  view,
  currency,
  tz,
  name,
  householdId,
  onChanged,
}: {
  view: MoneyLedgerChildView;
  currency: string;
  tz: string;
  name: string;
  householdId: string;
  onChanged: () => Promise<void>;
}) {
  const state = useHousehold();
  const styles = useThemedStyles(allowanceStyles);
  const [payoutCoins, setPayoutCoins] = useState('');
  const [adjustCoins, setAdjustCoins] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const history = view.entries.filter((e) => e.kind === 'payout' || e.kind === 'adjust');

  async function payout() {
    const coins = Number(payoutCoins);
    if (!Number.isInteger(coins) || coins <= 0) {
      setNotice(t('allowance.rateInvalid'));
      return;
    }
    setBusy('payout');
    setNotice(null);
    try {
      await state.api.recordPayout(householdId, { id: uuid7(), child_id: view.child_id, coins });
      setPayoutCoins('');
      await onChanged();
    } catch (e) {
      setNotice(
        withCause(
          e instanceof ApiError && e.code === 'insufficient_coins'
            ? t('allowance.payoutTooMuch', { name })
            : t('allowance.payoutFailed'),
          e,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function adjust() {
    const coins = Number(adjustCoins);
    if (!Number.isInteger(coins) || coins === 0 || adjustNote.trim().length === 0) {
      setNotice(t('allowance.adjustInvalid'));
      return;
    }
    setBusy('adjust');
    setNotice(null);
    try {
      await state.api.recordAdjustment(householdId, {
        id: uuid7(),
        child_id: view.child_id,
        coins,
        note: adjustNote.trim(),
      });
      setAdjustCoins('');
      setAdjustNote('');
      await onChanged();
    } catch (e) {
      setNotice(withCause(t('allowance.adjustFailed'), e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.name}>{name}</Text>
        <Coins amount={view.balance} />
      </View>
      <Text style={styles.owed}>
        {t('allowance.owed', { amount: formatMoney(view.owed, currency) })}
      </Text>
      <Text style={styles.balance}>
        {t('allowance.balance', { coins: formatNumber(view.balance) })}
      </Text>
      <Field
        label={t('allowance.payoutCoins')}
        value={payoutCoins}
        onChangeText={setPayoutCoins}
        keyboardType="number-pad"
      />
      <Button
        title={busy === 'payout' ? t('allowance.saving') : t('allowance.payout')}
        onPress={() => void payout()}
        disabled={busy !== null}
        secondary
      />
      <Field
        label={t('allowance.adjustCoins')}
        value={adjustCoins}
        onChangeText={setAdjustCoins}
        keyboardType="numbers-and-punctuation"
      />
      <Field label={t('allowance.adjustNote')} value={adjustNote} onChangeText={setAdjustNote} />
      <Button
        title={busy === 'adjust' ? t('allowance.saving') : t('allowance.adjust')}
        onPress={() => void adjust()}
        disabled={busy !== null}
        secondary
      />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={styles.historyTitle}>{t('allowance.history')}</Text>
      {history.length === 0 ? (
        <Text style={styles.historyEmpty}>{t('allowance.historyEmpty')}</Text>
      ) : (
        history.map((entry) => (
          <EntryLine key={entry.id} entry={entry} currency={currency} tz={tz} />
        ))
      )}
    </Card>
  );
}

/**
 * What a coin is worth, what is owed, and the payout. Premium-only: on the
 * free tier this names the feature and opens the paywall with gate
 * `money_ledger`, and a stale mirror's 402 still routes there via onGate.
 */
export default function Allowance() {
  const state = useHousehold();
  const router = useRouter();
  const styles = useThemedStyles(allowanceStyles);
  const [view, setView] = useState<MoneyLedgerView | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const householdId = state.me?.household?.id ?? null;
  const premium = state.me?.household?.entitlement === 'premium';

  const reload = useCallback(async () => {
    if (!householdId || !premium) return;
    try {
      const loaded = await state.api.getMoneyLedger(householdId);
      setView(loaded);
      setRate((current) => current ?? String(loaded.coins_per_unit));
      setStatus('ready');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'failed');
      setStatus('error');
    }
  }, [householdId, premium, state.api]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function saveRate() {
    if (!householdId || rate === null) return;
    const coinsPerUnit = Number(rate);
    if (!Number.isInteger(coinsPerUnit) || coinsPerUnit <= 0) {
      setNotice(t('allowance.rateInvalid'));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await state.api.setCoinsPerUnit(householdId, coinsPerUnit);
      setView((current) =>
        current === null
          ? current
          : { ...current, coins_per_unit: saved.coins_per_unit, currency: saved.currency },
      );
      setNotice(t('allowance.rateSaved'));
    } catch (e) {
      setNotice(withCause(t('allowance.rateFailed'), e));
    } finally {
      setBusy(false);
    }
  }

  if (state.status !== 'ready' || !householdId) return null;

  if (!premium) {
    return (
      <Screen>
        <Title>{t('allowance.lockedTitle')}</Title>
        <Body>{t('allowance.lockedHint')}</Body>
        <Button
          title={t('allowance.lockedAction')}
          onPress={() =>
            router.push({ pathname: '/(parent)/paywall', params: { gate: 'money_ledger' } })
          }
        />
        <Button title={t('common.back')} onPress={() => router.back()} secondary />
      </Screen>
    );
  }

  if (status === 'loading' && view === null) return <Loading />;
  if (status === 'error' && view === null) {
    return (
      <Screen>
        <ErrorState
          title={message || t('allowance.loadFailed')}
          body={t('parent.unreachable')}
          actionTitle={t('common.tryAgain')}
          onAction={() => {
            setStatus('loading');
            void reload();
          }}
        />
      </Screen>
    );
  }

  const household = state.me.household!;
  const children = state.me.children ?? [];
  const childName = (id: string) => children.find((c) => c.id === id)?.first_name ?? id;

  return (
    <Screen list>
      <Title>{t('allowance.title')}</Title>
      <Body>{t('allowance.hint')}</Body>
      {view !== null && (
        <Card>
          <Field
            label={t('allowance.rateLabel', { currency: view.currency })}
            value={rate ?? String(view.coins_per_unit)}
            onChangeText={setRate}
            keyboardType="number-pad"
          />
          <Button
            title={busy ? t('allowance.saving') : t('allowance.saveRate')}
            onPress={() => void saveRate()}
            disabled={busy}
            secondary
          />
        </Card>
      )}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {view?.children.map((child) => (
        <ChildMoney
          key={child.child_id}
          view={child}
          currency={view.currency}
          tz={household.tz}
          name={childName(child.child_id)}
          householdId={householdId}
          onChanged={reload}
        />
      ))}
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}

const allowanceStyles = (theme: Theme) => ({
  head: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  name: { ...theme.type.heading, color: theme.colors.text, fontWeight: '600' as const },
  owed: { ...theme.type.body, color: theme.colors.text, fontWeight: '600' as const },
  balance: { ...theme.type.label, color: theme.colors.muted },
  notice: { ...theme.type.label, color: theme.colors.danger },
  historyTitle: { ...theme.type.heading, color: theme.colors.text },
  historyEmpty: { ...theme.type.label, color: theme.colors.muted },
  entry: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  entryKind: { ...theme.type.label, color: theme.colors.muted },
  entryDetail: { ...theme.type.body, flexShrink: 1, color: theme.colors.text },
  entryWhen: { ...theme.type.label, color: theme.colors.muted },
});
