import { Text } from 'react-native';
import { t } from '@/lib/i18n';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * The streak, said the same way everywhere it appears. Renders nothing at zero.
 *
 * It wears `text`, not a colour of its own: the palette has one green, which means "act", and
 * one gold, which means coins (ADR-0012). A streak is neither, so it earns its emphasis from
 * weight rather than from a hue the system does not have.
 */
export function StreakBadge({ days, style }: { days: number; style?: 'badge' | 'line' }) {
  const styles = useThemedStyles(streakStyles);
  if (days <= 0) return null;
  return (
    <Text style={style === 'line' ? styles.line : styles.badge}>
      {t(style === 'line' ? 'streak.line' : 'streak.badge', { count: days })}
    </Text>
  );
}

const streakStyles = (theme: Theme) => ({
  // `body`, not `label`: this sits beside a coin tally drawn at `title` or `display` on the
  // child's side, and the emphasis has to survive that company now that it has no colour of
  // its own. A weight is safe here — the no-`fontWeight` rule guards the two Rubik steps.
  badge: { ...theme.type.body, color: theme.colors.text, fontWeight: '600' as const },
  line: { ...theme.type.body, color: theme.colors.muted, textAlign: 'center' as const },
});
