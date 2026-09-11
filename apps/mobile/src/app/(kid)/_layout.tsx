import { Redirect, Stack, usePathname } from 'expo-router';
import { Loading } from '@/components/ui';
import { DeviceSessionProvider, useDeviceSession } from '@/lib/device-session';
import { ThemeProvider } from '@/theme';

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

/**
 * The child's theme, and the one place the app reads `ui_mode`: everything below it asks the
 * theme how big things are. A device that has not joined yet has no child to read a mode from,
 * so the join screen runs in `big` until the code is redeemed.
 */
function KidTheme({ children }: { children: React.ReactNode }) {
  const device = useDeviceSession();
  return (
    <ThemeProvider role="kid" uiMode={device.session?.child.ui_mode ?? 'big'}>
      {children}
    </ThemeProvider>
  );
}

export default function KidLayout() {
  return (
    <DeviceSessionProvider>
      <KidTheme>
        <KidGate />
      </KidTheme>
    </DeviceSessionProvider>
  );
}
