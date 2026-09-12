import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { CHEVRON, formatNumber, t } from '@/lib/i18n';
import { usePop } from '@/lib/motion';
import { useCountUp } from '@/lib/use-count-up';
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

/**
 * The page. A form centres its handful of fields, which is what most of this app's screens are;
 * a list does not — `list` starts it at the top and tightens the gap, because the parent's
 * evening scan wants as many children on screen as will fit and a centred column with a
 * form's air around it wastes the half of the screen the scan is for.
 */
export function Screen({ children, list = false }: { children: React.ReactNode; list?: boolean }) {
  const styles = useThemedStyles(screenStyles);
  return <View style={[styles.screen, list && styles.listScreen]}>{children}</View>;
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

/** A line of copy on a page. The `Title`'s counterpart, and the only body text a screen needs. */
export function Body({ children }: { children: string }) {
  const styles = useThemedStyles(textStyles);
  return <Text style={styles.body}>{children}</Text>;
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
  return (
    <ChipGroup label={label}>
      {options.map((o) => (
        <Chip
          key={o.value}
          title={o.title}
          active={o.value === value}
          onPress={() => onChange(o.value)}
          role="radio"
        />
      ))}
    </ChipGroup>
  );
}

/**
 * A label above a wrapping row of chips. Both the single-choice `Choice` and the multi-select
 * rows in the chore form are this shape, so the shape lives here once and neither of them
 * holds a spacing or a colour of its own.
 *
 * `footer` is for a control that acts on the chips — "select all", and nothing else so far. It
 * sits inside the group rather than after it, on the field's tight gap, so it reads as belonging
 * to the chips it changes instead of as the form's next row.
 */
export function ChipGroup({
  label,
  children,
  footer,
}: {
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const styles = useThemedStyles(fieldStyles);
  const chips = useThemedStyles(chipStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={chips.row}>{children}</View>
      {footer}
    </View>
  );
}

/**
 * One chip. Active is the `action` fill — the one colour that means "act" — and nothing else in
 * the app draws a chip, so a second chip elsewhere cannot drift from this one.
 *
 * `role` is how it announces itself: `radio` where one of the set is chosen, `checkbox` where
 * any number may be.
 */
export function Chip({
  title,
  active,
  onPress,
  role = 'checkbox',
}: {
  title: string;
  active: boolean;
  onPress: () => void;
  role?: 'radio' | 'checkbox';
}) {
  const chips = useThemedStyles(chipStyles);
  return (
    <Pressable
      style={[chips.chip, active && chips.chipActive]}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected: active } : { checked: active }}
    >
      <Text style={[chips.chipText, active && chips.chipTextActive]}>{title}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  const styles = useThemedStyles(textStyles);
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

/**
 * The typographic states (docs/spec/06-design.md): a line of copy and an action, no
 * illustration. Six of the eight empty, error and offline states are these — everything
 * except the child's two happy-path moments, which reuse the Pet instead.
 *
 * `EmptyState` is for nothing-to-show; `ErrorState` is for something-went-wrong, so its
 * title wears the danger colour and says what happened while `body` says what the reader
 * can do. Both centre their copy, pad symmetrically, and never name a direction, so they
 * lay out correctly right-to-left without a single conditional.
 */
export function EmptyState({
  title,
  body,
  actionTitle,
  onAction,
}: {
  title: string;
  body?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  return (
    <StateShell
      title={title}
      body={body}
      actionTitle={actionTitle}
      onAction={onAction}
      error={false}
    />
  );
}

export function ErrorState({
  title,
  body,
  actionTitle,
  onAction,
}: {
  title: string;
  body?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  return (
    <StateShell title={title} body={body} actionTitle={actionTitle} onAction={onAction} error />
  );
}

function StateShell({
  title,
  body,
  actionTitle,
  onAction,
  error,
}: {
  title: string;
  body?: string;
  actionTitle?: string;
  onAction?: () => void;
  error: boolean;
}) {
  const styles = useThemedStyles(stateStyles);
  return (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, error && styles.errorTitle]}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} secondary={!error} onPress={onAction} />
      ) : null}
    </View>
  );
}

/**
 * Offline is an inline strip, never a full-screen state. The app is offline-first; a
 * blocking "you're offline" screen would contradict the product, so this leaves whatever
 * screen it sits on fully usable and only says what is saved.
 */
export function OfflineStrip({ message }: { message: string }) {
  const styles = useThemedStyles(stateStyles);
  return (
    <View style={styles.strip}>
      <Text style={styles.stripText}>{message}</Text>
    </View>
  );
}

/**
 * The same page, for a screen that can grow taller than the phone. It is the `Screen` chrome on
 * a scroll rather than a second page shape declared somewhere else, so there is one definition
 * of what a page looks like and a form cannot drift from it.
 */
export function ScrollScreen({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(screenStyles);
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.screen, styles.scrollContent]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/**
 * One row of a list that goes somewhere: what it is, a line about it, and the chevron that says
 * there is more. Separated by a hairline rather than by a gap, so a household's children and a
 * household's chores read as one list at a glance instead of as a stack of cards — the parent
 * side is denser than the child's by exactly this kind of choice.
 *
 * The chevron points the way the reader is going, so it is already correct in Hebrew.
 */
export function ListRow({
  title,
  meta,
  onPress,
}: {
  title: string;
  meta?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(listRowStyles);
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <Text style={styles.chevron}>{CHEVRON}</Text>
    </Pressable>
  );
}

/**
 * Several destinations in the height one Button would take. The parent's today screen is a scan,
 * and a stack of full-width buttons pushes the thing being scanned off the bottom of the phone;
 * these wrap instead, and still meet the theme's touch target.
 *
 * It borrows the chip's pill rather than growing a third one beside `buttonSecondary` and
 * `chip` — the app has two tappable surfaces and a nav item is not a reason for a third. What it
 * does not borrow is the role: a chip announces a selection, and these go somewhere, so they
 * announce themselves as buttons. Keyed by position because the labels are translated copy.
 */
export function NavRow({ items }: { items: { title: string; onPress: () => void }[] }) {
  const chips = useThemedStyles(chipStyles);
  return (
    <View style={chips.row}>
      {items.map((item, i) => (
        <Pressable key={i} style={chips.chip} onPress={item.onPress} accessibilityRole="button">
          <Text style={chips.chipText}>{item.title}</Text>
        </Pressable>
      ))}
    </View>
  );
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
 *
 * `countUp` is the done moment's: while it is on, a balance that rises climbs to its new number
 * instead of being replaced by it. Off everywhere else, including on this same component the rest
 * of the time — a number that animates whenever a sync lands would be motion outside the moment.
 */
export function Coins({
  amount,
  variant = 'tally',
  step = 'body',
  countUp = false,
}: {
  amount: number;
  variant?: 'tally' | 'pays';
  step?: CoinStep;
  countUp?: boolean;
}) {
  const styles = useThemedStyles(coinStyles);
  const shown = useCountUp(amount, countUp);
  return (
    <Text style={[styles.coins, styles[step]]}>
      {t(variant === 'pays' ? 'coins.pays' : 'coins.tally', { coins: formatNumber(shown) })}
    </Text>
  );
}

type CoinStep = 'display' | 'title' | 'heading' | 'body' | 'label';

/**
 * One chore on a list: its icon, its title, and what it pays. Tapping it toggles done, and done
 * is drawn by striking the title through rather than by tinting the row — the grove's green is
 * not allowed in chrome, and the action green means "act", not "finished".
 *
 * Going done is the first half of the done moment: the row settles into the state rather than
 * cutting to it, and its tick lands with a pop of its own. Coming back undone does not animate —
 * an undo returns the screen to how it was, with no celebration — and neither does the row
 * arriving on screen already done, which is just today's list as it stands.
 *
 * The pop is a scale, so it is the same pop in Hebrew: nothing here moves along the reading axis.
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
  const pop = usePop(done);
  const rowScale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const tickScale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] });
  return (
    <Animated.View style={{ transform: [{ scale: rowScale }] }}>
      <Pressable
        style={styles.row}
        onPress={onPress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={title}
      >
        <Animated.Text style={[styles.icon, { transform: [{ scale: tickScale }] }]}>
          {done ? DONE_GLYPH : (icon ?? CHORE_GLYPH)}
        </Animated.Text>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {title}
        </Text>
        {coins !== undefined && <Coins amount={coins} variant="pays" step="label" />}
      </Pressable>
    </Animated.View>
  );
}

/**
 * For the one child of a `Screen list` that should take the height left over — the list itself.
 * React Native does not shrink a child to fit the way the web does, so without this a long
 * household overflows the screen and pushes the actions below it off the bottom instead of
 * scrolling inside its own bounds. It holds no colour and no spacing, so it needs no theme.
 */
export const FILL = { flex: 1 } as const;

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
  listScreen: {
    justifyContent: 'flex-start' as const,
    gap: theme.space.md,
    paddingVertical: theme.space.lg,
  },
  scroll: { flex: 1, backgroundColor: theme.colors.ground },
  scrollContent: { justifyContent: 'flex-start' as const, flexGrow: 1 },
  loading: { flex: 1, justifyContent: 'center' as const, backgroundColor: theme.colors.ground },
});

const textStyles = (theme: Theme) => ({
  title: { ...theme.type.title, color: theme.colors.text, marginBottom: theme.space.sm },
  body: { ...theme.type.body, color: theme.colors.text },
  error: { ...theme.type.label, color: theme.colors.danger },
});

const stateStyles = (theme: Theme) => ({
  state: { alignItems: 'center' as const, gap: theme.space.sm, paddingVertical: theme.space.xl },
  stateTitle: { ...theme.type.heading, color: theme.colors.text, textAlign: 'center' as const },
  errorTitle: { color: theme.colors.danger },
  stateBody: { ...theme.type.body, color: theme.colors.muted, textAlign: 'center' as const },
  strip: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.muted,
  },
  stripText: { ...theme.type.label, color: theme.colors.muted, textAlign: 'center' as const },
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

const listRowStyles = (theme: Theme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
    minHeight: theme.touchTarget,
    paddingVertical: theme.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.muted,
  },
  text: { flex: 1 },
  // A weight is safe on `body`: the no-`fontWeight` rule guards the two Rubik steps, whose
  // weight lives in the face (docs/spec/06-design.md). This step is the system font.
  title: { ...theme.type.body, color: theme.colors.text, fontWeight: '600' as const },
  meta: { ...theme.type.label, color: theme.colors.muted },
  chevron: { ...theme.type.heading, color: theme.colors.muted },
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
