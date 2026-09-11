import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getRole, setRole, type Role } from '@/lib/role';
import { ThemeProvider } from '@/theme';

const ROLE_HOME = { parent: '/(parent)', kid: '/(kid)' } as const;

/**
 * The first launch, and the one screen that runs before there is a role to theme for. It gets
 * the parent theme: whoever is choosing here is setting the device up, and the child's world
 * starts on the other side of the choice.
 */
export default function RolePicker() {
  return (
    <ThemeProvider role="parent">
      <Picker />
    </ThemeProvider>
  );
}

function Picker() {
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
    <Screen>
      <Title>{t('role.question')}</Title>
      <Button title={t('role.parent')} onPress={() => void choose('parent')} />
      <Button title={t('role.kid')} onPress={() => void choose('kid')} />
    </Screen>
  );
}
