import type { ChildDevice } from '@chores/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Body, Button, EmptyState, ErrorState, FILL, Screen, Title } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { useHousehold } from '@/lib/household-context';
import { formatWallClock, t } from '@/lib/i18n';
import { useChildDevices } from '@/lib/use-child-devices';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * One Kid Device, and the confirmation in the row itself. There is no modal anywhere in this
 * app, so arming is a second state on the row: the first tap names what revoking will do, the
 * second does it. Nothing is revoked by a single tap, and the sentence a parent reads before
 * the second tap is the one that matters — the device stops syncing, and coming back is a new
 * join code.
 */
function DeviceLine({
  device,
  tz,
  armed,
  busy,
  onArm,
  onCancel,
  onRevoke,
}: {
  device: ChildDevice;
  tz: string;
  armed: boolean;
  busy: boolean;
  onArm: () => void;
  onCancel: () => void;
  onRevoke: () => void;
}) {
  const styles = useThemedStyles(deviceStyles);
  const revoked = device.revoked_at !== null;
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <View style={styles.text}>
          <Text style={[styles.name, revoked && styles.nameRevoked]}>
            {t(device.platform === 'ios' ? 'devices.ios' : 'devices.android')}
          </Text>
          <Text style={styles.when}>
            {revoked
              ? t('devices.revokedAt', { time: formatWallClock(device.revoked_at!, tz) })
              : t('devices.lastSeen', { time: formatWallClock(device.last_seen_at, tz) })}
          </Text>
        </View>
        {revoked ? null : (
          <Pressable
            style={[styles.pill, busy && styles.pillBusy]}
            onPress={armed ? onCancel : onArm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t(armed ? 'devices.cancel' : 'devices.revoke')}
          >
            <Text style={styles.pillText}>
              {busy ? t('devices.revoking') : t(armed ? 'devices.cancel' : 'devices.revoke')}
            </Text>
          </Pressable>
        )}
      </View>
      {armed && !revoked ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmTitle}>{t('devices.confirmTitle')}</Text>
          <Text style={styles.confirmBody}>{t('devices.confirmBody')}</Text>
          <Pressable
            style={[styles.pill, styles.pillDanger, busy && styles.pillBusy]}
            onPress={onRevoke}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('devices.confirmTitle')}
          >
            <Text style={[styles.pillText, styles.pillDangerText]}>{t('devices.revoke')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * What is bound to one child, and the one thing a parent may do about it. Revoked devices stay
 * on the list wearing their revocation date: the question this screen answers is "did the old
 * tablet stop syncing?", and a row that vanished would not answer it. Reconnecting is a join
 * code, never an un-revoke — redeeming rotates the device's analytics id (ADR-0009), so the
 * revoked row could not be brought back as the same device even if a route existed.
 */
export default function Devices() {
  const state = useHousehold();
  const router = useRouter();
  const styles = useThemedStyles(deviceStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const devices = useChildDevices(id);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const householdId = state.me?.household?.id ?? null;
  const child = state.me?.children.find((c) => c.id === id);

  async function revoke(device: ChildDevice) {
    if (!householdId || !id) return;
    setBusy(device.id);
    setNotice(null);
    try {
      await state.api.revokeChildDevice(householdId, id, device.id);
      setArmed(null);
      await devices.refresh();
    } catch (e) {
      setNotice(withCause(t('devices.revokeFailed'), e));
    } finally {
      setBusy(null);
    }
  }

  if (state.status !== 'ready' || !state.me.household || !child) return null;
  const tz = state.me.household.tz;

  return (
    <Screen list>
      <Title>{t('devices.title', { name: child.first_name })}</Title>
      <Body>{t('devices.hint', { name: child.first_name })}</Body>
      {devices.status === 'error' && (
        <ErrorState
          title={devices.message || t('devices.loadFailed')}
          body={t('parent.unreachable')}
          actionTitle={t('common.tryAgain')}
          onAction={() => void devices.refresh()}
        />
      )}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {devices.status === 'ready' && devices.devices.length === 0 ? (
        <EmptyState
          title={t('devices.empty', { name: child.first_name })}
          actionTitle={t('devices.showJoinCode')}
          onAction={() =>
            router.push({
              pathname: '/(parent)/children/[id]/join-code',
              params: { id: child.id },
            })
          }
        />
      ) : (
        <FlatList
          style={FILL}
          data={devices.devices}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DeviceLine
              device={item}
              tz={tz}
              armed={armed === item.id}
              busy={busy === item.id}
              onArm={() => setArmed(item.id)}
              onCancel={() => setArmed(null)}
              onRevoke={() => void revoke(item)}
            />
          )}
        />
      )}
      {/* The way back from a revocation, and the only way: there is no un-revoke. */}
      <Button
        title={t('devices.showJoinCode')}
        secondary
        onPress={() =>
          router.push({ pathname: '/(parent)/children/[id]/join-code', params: { id: child.id } })
        }
      />
      <Button title={t('common.back')} onPress={() => router.back()} secondary />
    </Screen>
  );
}

const deviceStyles = (theme: Theme) => ({
  row: { paddingVertical: theme.space.sm, gap: theme.space.sm },
  head: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  text: { flex: 1, gap: theme.space.xs },
  name: { ...theme.type.body, color: theme.colors.text },
  nameRevoked: { color: theme.colors.muted },
  when: { ...theme.type.label, color: theme.colors.muted },
  pill: {
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    alignSelf: 'flex-start' as const,
  },
  pillBusy: { opacity: 0.5 },
  pillText: { ...theme.type.label, color: theme.colors.muted },
  pillDanger: { borderColor: theme.colors.danger },
  pillDangerText: { color: theme.colors.danger },
  confirm: { gap: theme.space.xs },
  confirmTitle: { ...theme.type.body, color: theme.colors.danger },
  confirmBody: { ...theme.type.label, color: theme.colors.muted },
  notice: { ...theme.type.label, color: theme.colors.danger },
});
