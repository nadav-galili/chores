import { onboardingStepViewed } from '@chores/shared';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { PetFigure } from '@/components/pet';
import { Button, Screen } from '@/components/ui';
import { capture, startWelcomeAnalytics } from '@/lib/analytics';
import { t } from '@/lib/i18n';
import { getRole, setRole, type Role } from '@/lib/role';
import { ThemeProvider, useThemedStyles, type Theme } from '@/theme';

const ROLE_HOME = { parent: '/(parent)/(tabs)/(today)', kid: '/(kid)' } as const;

/**
 * The first launch, and the one screen that runs before there is a role to theme for. It gets
 * the parent theme: whoever is choosing here is setting the device up, and the child's world
 * starts on the other side of the choice.
 *
 * It is a welcome as well as a picker: what Mibo is, in a headline and a line, with the choice on
 * the same screen so saying so costs no tap.
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

  return <Welcome onChoose={(r) => void choose(r)} />;
}

function Welcome({ onChoose }: { onChoose: (role: Role) => void }) {
  const styles = useThemedStyles(welcomeStyles);

  // Mounted only on a device with no role, so one mount is one view of the welcome step.
  useEffect(() => {
    void startWelcomeAnalytics().then(() => capture(onboardingStepViewed({ step: 'welcome' })));
  }, []);

  return (
    <Screen>
      <View style={styles.intro}>
        <PetFigure name="Mibo" level={3} mood="happy" showStage={false} />
        <Text style={styles.headline} accessibilityRole="header">
          {t('role.headline')}
        </Text>
        <Text style={styles.subline}>{t('role.subline')}</Text>
      </View>
      <Button title={t('role.parent')} onPress={() => onChoose('parent')} />
      <Button title={t('role.kid')} onPress={() => onChoose('kid')} />
    </Screen>
  );
}

const welcomeStyles = (theme: Theme) => ({
  intro: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.space.lg,
  },
  headline: { ...theme.type.display, color: theme.colors.text, textAlign: 'center' as const },
  subline: { ...theme.type.body, color: theme.colors.muted, textAlign: 'center' as const },
});
