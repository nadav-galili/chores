import { LOCALES, type Locale } from '@chores/shared';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Choice, ErrorText, ScrollScreen } from '@/components/ui';
import { withCause } from '@/lib/errors';
import { locale as current, t } from '@/lib/i18n';
import { chooseLocale } from '@/lib/locale-choice';

/** Each language names itself, so it is readable to the person looking for it. */
const ENDONYM: Readonly<Record<Locale, string>> = { en: 'English', he: 'עברית' };

/**
 * The language, and the warning that picking one restarts the app.
 *
 * The restart is said out loud rather than sprung: Hebrew mirrors the whole layout, React Native
 * can only change direction at startup, and an app that blinks out and back with no explanation
 * reads as a crash — particularly to the parent who just tapped something.
 */
export default function Language() {
  const [choice, setChoice] = useState<Locale>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (choice === current) return;
    setBusy(true);
    setError(null);
    try {
      await chooseLocale(choice);
    } catch (e) {
      // Reaching here means the restart itself failed, so the app is still in the old language
      // and the choice is already stored — it will be in the new one whenever it next opens.
      setError(withCause(t('language.restartFailed'), e));
      setBusy(false);
    }
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
      <Button
        title={busy ? t('language.restarting') : t('language.apply')}
        onPress={() => void apply()}
        disabled={busy || choice === current}
      />
    </ScrollScreen>
  );
}
