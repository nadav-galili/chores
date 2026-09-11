import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { formatNumber, t } from '@/lib/i18n';
import { useTheme, useThemedStyles, type Theme } from '@/theme';

/**
 * The shared primitives. Every one of them reads colour, spacing, radius and type from the theme,
 * so the same component is the child's world under the kid theme and the parent's quieter one
 * under the parent theme, and `little` mode's larger type and larger touch targets arrive without
 * anything in this file knowing that `ui_mode` exists.
 *
 * No literal colour appears here. That is the point of the file: `docs/spec/06-design.md`.
 *
 * Layout is right-to-left safe by construction. `flexDirection: 'row'` follows the reader's
 * direction, text is left to align itself, and padding is symmetric or `Start`/`End` rather than
 * `Left`/`Right` — so Hebrew mirrors without a single conditional.
 */

export function Screen({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(screenStyles);
  return <View style={styles.screen}>{children}</View>;
}

export function Loading() {
  const styles = useThemedStyles(screenStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.action} />
    </View>
  );
}

export function Title({ children }: { children: string }) {
  const styles = useThemedStyles(textStyles);
  return <Text style={styles.title}>{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const styles = useThemedStyles(fieldStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.muted} {...props} />
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  secondary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const styles = useThemedStyles(buttonStyles);
  return (
    <Pressable
      style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; title: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const styles = useThemedStyles(fieldStyles);
  const chips = useThemedStyles(chipStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={chips.row}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            style={[chips.chip, o.value === value && chips.chipActive]}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: o.value === value }}
          >
            <Text style={[chips.chipText, o.value === value && chips.chipTextActive]}>
              {o.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  const styles = useThemedStyles(textStyles);
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

/**
 * A surface standing on the ground. Tappable when given an `onPress`, and then never smaller
 * than the theme's touch target — which is the size `little` grows.
 */
export function Card({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(cardStyles);
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable
      style={[styles.card, styles.tappable]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

/**
 * Coins — and the only thing in the app allowed to wear the coin colour. No button, chip, badge
 * or chrome element may (ADR-0012), which is a rule a token cannot enforce on its own and this
 * component can: everything that shows coins goes through here.
 *
 * `tally` is what a child has, `pays` is what a chore is worth.
 */
export function Coins({
  amount,
  variant = 'tally',
  step = 'body',
}: {
  amount: number;
  variant?: 'tally' | 'pays';
  step?: CoinStep;
}) {
  const styles = useThemedStyles(coinStyles);
  return (
    <Text style={[styles.coins, styles[step]]}>
      {t(variant === 'pays' ? 'coins.pays' : 'coins.tally', { coins: formatNumber(amount) })}
    </Text>
  );
}

type CoinStep = 'display' | 'title' | 'heading' | 'body' | 'label';

/**
 * One chore on a list: its icon, its title, and what it pays. Tapping it toggles done, and done
 * is drawn by striking the title through rather than by tinting the row — the grove's green is
 * not allowed in chrome, and the action green means "act", not "finished".
 */
export function ChoreRow({
  title,
  icon,
  done,
  coins,
  onPress,
}: {
  title: string;
  icon?: string | null;
  done: boolean;
  coins?: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(choreRowStyles);
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={title}
    >
      <Text style={styles.icon}>{done ? DONE_GLYPH : (icon ?? CHORE_GLYPH)}</Text>
      <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
        {title}
      </Text>
      {coins !== undefined && <Coins amount={coins} variant="pays" step="label" />}
    </Pressable>
  );
}

/** Placeholder art, swapped for drawn assets with the rest of it. */
const DONE_GLYPH = '✅';
const CHORE_GLYPH = '⭐';

const screenStyles = (theme: Theme) => ({
  screen: {
    flex: 1,
    padding: theme.space.xl,
    gap: theme.space.lg,
    justifyContent: 'center' as const,
    backgroundColor: theme.colors.ground,
  },
  loading: { flex: 1, justifyContent: 'center' as const, backgroundColor: theme.colors.ground },
});

const textStyles = (theme: Theme) => ({
  title: { ...theme.type.title, color: theme.colors.text, marginBottom: theme.space.sm },
  error: { ...theme.type.label, color: theme.colors.danger },
});

const fieldStyles = (theme: Theme) => ({
  field: { gap: theme.space.xs },
  label: { ...theme.type.label, color: theme.colors.muted },
  input: {
    ...theme.type.body,
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
});

const chipStyles = (theme: Theme) => ({
  row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.space.sm },
  chip: {
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    backgroundColor: theme.colors.surface,
  },
  chipActive: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  chipText: { ...theme.type.label, color: theme.colors.text },
  // The fill does most of the work; the weight is what the chip had before the theme arrived.
  chipTextActive: { color: theme.colors.onAction, fontWeight: '600' as const },
});

const buttonStyles = (theme: Theme) => ({
  button: {
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: theme.space.lg,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.action,
  },
  buttonSecondary: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.muted,
  },
  buttonText: { ...theme.type.body, color: theme.colors.onAction },
  buttonTextSecondary: { color: theme.colors.text },
  disabled: { opacity: 0.5 },
});

const cardStyles = (theme: Theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    gap: theme.space.md,
  },
  tappable: { minHeight: theme.touchTarget, justifyContent: 'center' as const },
});

const coinStyles = (theme: Theme) => ({
  coins: { color: theme.colors.coin },
  display: theme.type.display,
  title: theme.type.title,
  heading: theme.type.heading,
  body: theme.type.body,
  label: theme.type.label,
});

const choreRowStyles = (theme: Theme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
    minHeight: theme.touchTarget,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  icon: { ...theme.type.title, color: theme.colors.text },
  title: { ...theme.type.body, flex: 1, color: theme.colors.text },
  titleDone: { textDecorationLine: 'line-through' as const, color: theme.colors.muted },
});
