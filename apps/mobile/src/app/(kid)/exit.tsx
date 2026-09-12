import {
  afterWrongPin,
  NO_PIN_ATTEMPTS,
  pinCooldownMsLeft,
  pinSchema,
  verifyPin,
  type PinAttempts,
} from '@chores/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Body, Button, ErrorText, Field, Loading, Screen, Title } from '@/components/ui';
import { useDeviceSession } from '@/lib/device-session';
import { t } from '@/lib/i18n';
import { readPinAttempts, writePinAttempts } from '@/lib/pin-attempts';
import { setRole } from '@/lib/role';

/**
 * The only way out of kid mode: the Parent PIN, checked here against the hash and salt the session
 * carries, so a room with no signal is still a room a parent can leave (ADR-0013). Five wrong
 * tries cost a minute, and the count is on disk so a restart does not buy a fresh five.
 */
export default function Exit() {
  const device = useDeviceSession();
  const router = useRouter();
  const [attempts, setAttempts] = useState<PinAttempts | null>(null);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void readPinAttempts().then(setAttempts);
  }, []);

  // The cooldown counts down in front of the parent rather than making them guess at it.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!attempts) return <Loading />;

  const household = device.session?.household;
  const msLeft = pinCooldownMsLeft(attempts, now);

  const save = (next: PinAttempts) => {
    setAttempts(next);
    void writePinAttempts(next);
  };

  const submit = () => {
    setPin('');
    if (verifyPin(household?.pin_hash, household?.pin_salt, pin)) {
      setWrong(false);
      setUnlocked(true);
      save(NO_PIN_ATTEMPTS);
      return;
    }
    setWrong(true);
    save(afterWrongPin(attempts, Date.now()));
  };

  const leave = async () => {
    await device.clear();
    await setRole('parent');
    router.replace('/(parent)');
  };

  if (!unlocked) {
    return (
      <Screen>
        <Title>{t('exit.pinTitle')}</Title>
        <Body>{household?.pin_hash ? t('exit.pinBody') : t('exit.noPin')}</Body>
        <Field
          label={t('exit.pinLabel')}
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />
        <ErrorText>
          {msLeft > 0
            ? t('exit.cooldown', { seconds: Math.ceil(msLeft / 1000) })
            : wrong
              ? t('exit.wrongPin')
              : null}
        </ErrorText>
        <Button
          title={t('exit.unlock')}
          onPress={submit}
          disabled={msLeft > 0 || !pinSchema.safeParse(pin).success}
        />
        <Button title={t('exit.stay')} secondary onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t('exit.title')}</Title>
      <Body>
        {t('exit.body', {
          name: device.session?.child.first_name ?? t('exit.theChild'),
        })}
      </Body>
      <Button title={t('exit.leave')} onPress={() => void leave()} />
      <Button title={t('exit.stay')} secondary onPress={() => router.back()} />
    </Screen>
  );
}
