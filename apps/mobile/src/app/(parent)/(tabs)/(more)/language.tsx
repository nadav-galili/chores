import { LOCALES, type Locale } from '@chores/shared';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Choice, ErrorText, ScrollScreen, Title } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { locale as current, t } from '@/lib/i18n';
import { chooseLocale } from '@/lib/locale-choice';

/** Each language names itself, so it is readable to the person looking for it. */
const ENDONYM: Readonly<Record<Locale, string>> = { en: 'English', he: 'עברית' };

/**
 * The language, and the fact that a new one waits for the next open.
 *
 * Hebrew mirrors the whole layout and React Native can only change direction at startup, so the
 * choice is stored and the parent is asked to close and reopen Mibo (`lib/locale-choice.ts` says
 * why the app no longer reloads itself). The ask stays on screen once made: there is no way back
 * to the picker that would make sense, since the app is still running in the old language and the
 * choice is already kept.
 */
export default function Language() {
  const [choice, setChoice] = useState<Locale>(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    if (choice === current) return;
    setError(null);
    try {
      chooseLocale(choice);
      setSaved(true);
    } catch (e) {
      // The keychain refused the write: the app is in the old language and will stay there.
      setError(withCause(t('language.saveFailed'), e));
    }
  }

  if (saved) {
    return (
      <ScrollScreen>
        <Stack.Screen
          options={{ title: t('language.title'), headerBackVisible: false, gestureEnabled: false }}
        />
        <Title>{t('language.savedTitle')}</Title>
        <Body>{t('language.savedBody')}</Body>
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen>
      <Stack.Screen options={{ title: t('language.title') }} />
      <Body>{t('language.hint')}</Body>
      <Choice
        label={t('language.label')}
        value={choice}
        onChange={setChoice}
        options={LOCALES.map((value) => ({ value, title: ENDONYM[value] }))}
      />
      <ErrorText>{error}</ErrorText>
      <Button name="apply_language" title={t('language.apply')} onPress={apply} disabled={choice === current} />
    </ScrollScreen>
  );
}
