import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const publishableKey = requireEnv(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout() {
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
