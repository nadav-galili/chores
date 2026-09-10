import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { ParentSignIn } from '@/components/parent-sign-in';
import { Button, Loading, Screen, Title } from '@/components/ui';
import { useDeviceSession } from '@/lib/device-session';
import { t } from '@/lib/i18n';
import { setRole } from '@/lib/role';

/** The only way out of kid mode in M1: a parent signs in with Clerk right here. */
export default function Exit() {
  const { isLoaded, isSignedIn } = useAuth();
  const device = useDeviceSession();
  const router = useRouter();

  if (!isLoaded) return <Loading />;
  if (!isSignedIn) {
    return (
      <ParentSignIn
        title={t('exit.parentsOnly')}
        footer={<Button title={t('common.back')} secondary onPress={() => router.back()} />}
      />
    );
  }

  const leave = async () => {
    await device.clear();
    await setRole('parent');
    router.replace('/(parent)');
  };

  return (
    <Screen>
      <Title>{t('exit.title')}</Title>
      <Text style={{ fontSize: 16, color: '#555' }}>
        {t('exit.body', {
          name: device.session?.child.first_name ?? t('exit.theChild'),
        })}
      </Text>
      <Button title={t('exit.leave')} onPress={() => void leave()} />
      <Button title={t('exit.stay')} secondary onPress={() => router.back()} />
    </Screen>
  );
}
