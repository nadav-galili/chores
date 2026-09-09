import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getRole, setRole, type Role } from '@/lib/role';

const ROLE_HOME = { parent: '/(parent)', kid: '/(kid)' } as const;

export default function RolePicker() {
  const router = useRouter();
  const [role, setStoredRole] = useState<Role | null | undefined>(undefined);

  useEffect(() => {
    getRole().then(setStoredRole);
  }, []);

  if (role === undefined) return null;
  if (role !== null) return <Redirect href={ROLE_HOME[role]} />;

  // A parent is remembered now; a kid device is remembered only once it has redeemed a join code.
  const choose = async (r: Role) => {
    if (r === 'parent') await setRole(r);
    router.replace(ROLE_HOME[r]);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Who is using this device?</Text>
      <Pressable style={styles.button} onPress={() => choose('parent')}>
        <Text style={styles.buttonText}>Parent</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => choose('kid')}>
        <Text style={styles.buttonText}>Kid</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 16 },
  button: {
    width: '100%',
    paddingVertical: 20,
    borderRadius: 16,
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontSize: 22, fontWeight: '600' },
});
