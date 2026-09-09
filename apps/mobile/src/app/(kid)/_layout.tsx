import { Redirect, Stack, usePathname } from 'expo-router';
import { Loading } from '@/components/ui';
import { DeviceSessionProvider, useDeviceSession } from '@/lib/device-session';

/** No session → the join screen; a session → kid mode, and nothing routes back out but /exit. */
function KidGate() {
  const device = useDeviceSession();
  const pathname = usePathname();
  if (device.status === 'loading') return <Loading />;
  const onJoin = pathname === '/join';
  if (!device.session && !onJoin) return <Redirect href="/(kid)/join" />;
  if (device.session && onJoin) return <Redirect href="/(kid)" />;
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}

export default function KidLayout() {
  return (
    <DeviceSessionProvider>
      <KidGate />
    </DeviceSessionProvider>
  );
}
