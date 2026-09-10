import { StyleSheet, Text } from 'react-native';
import { t } from '@/lib/i18n';

/** The streak, said the same way everywhere it appears. Renders nothing at zero. */
export function StreakBadge({ days, style }: { days: number; style?: 'badge' | 'line' }) {
  if (days <= 0) return null;
  return (
    <Text style={style === 'line' ? styles.line : styles.badge}>
      {t(style === 'line' ? 'streak.line' : 'streak.badge', { count: days })}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: { fontSize: 18, fontWeight: '600', color: '#e65100' },
  line: { fontSize: 17, color: '#555', textAlign: 'center' },
});
