import { StyleSheet, Text } from 'react-native';

/** The streak, said the same way everywhere it appears. Renders nothing at zero. */
export function StreakBadge({ days, style }: { days: number; style?: 'badge' | 'line' }) {
  if (days <= 0) return null;
  const label = `🔥 ${days} day${days === 1 ? '' : 's'}`;
  return (
    <Text style={style === 'line' ? styles.line : styles.badge}>
      {style === 'line' ? `${label} in a row` : label}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: { fontSize: 18, fontWeight: '600', color: '#e65100' },
  line: { fontSize: 17, color: '#555', textAlign: 'center' },
});
