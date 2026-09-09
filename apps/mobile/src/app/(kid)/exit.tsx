import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { ParentSignIn } from '@/components/parent-sign-in';
import { Button, Loading, Screen, Title } from '@/components/ui';
import { useDeviceSession } from '@/lib/device-session';
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
        title="Parents only"
        footer={<Button title="Back" secondary onPress={() => router.back()} />}
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
      <Title>Leave kid mode?</Title>
      <Text style={{ fontSize: 16, color: '#555' }}>
        This device will forget {device.session?.child.first_name ?? 'the child'} and switch to
        parent mode. Show a new join code to connect it again.
      </Text>
      <Button title="Leave kid mode" onPress={() => void leave()} />
      <Button title="Stay" secondary onPress={() => router.back()} />
    </Screen>
  );
}
