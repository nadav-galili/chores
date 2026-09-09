import * as SecureStore from 'expo-secure-store';

export type Role = 'parent' | 'kid';
const KEY = 'role';

export async function getRole(): Promise<Role | null> {
  const stored = await SecureStore.getItemAsync(KEY);
  return stored === 'parent' || stored === 'kid' ? stored : null;
}

export async function setRole(role: Role): Promise<void> {
  await SecureStore.setItemAsync(KEY, role);
}

export async function clearRole(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
