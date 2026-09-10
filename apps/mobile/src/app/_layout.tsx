import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useDisplayFont } from '@/theme';

const publishableKey = requireEnv(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout() {
  // Registers Rubik so the type scale can name it. Nothing renders it yet, and
  // text before it lands falls back to the system font, so this never blocks.
  useDisplayFont();
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </ClerkProvider>
  );
}

function requireEnv(value: string | undefined): string {
  if (!value) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
  return value;
}
