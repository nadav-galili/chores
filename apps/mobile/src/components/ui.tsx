import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHEVRON, formatNumber, t } from '@/lib/i18n';
import { useHasHeader } from '@/lib/page-chrome';
import { usePop } from '@/lib/motion';
import { useCountUp } from '@/lib/use-count-up';
import { providerBrand, useTheme, useThemedStyles, type Theme } from '@/theme';

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
 * The page. Content starts at the top, because a screen that centres its content moves the first
 * line to a different height on every screen and the eye has to find it again each time. `list`
 * only tightens the gap now; it no longer changes the alignment, since nothing is centred.
 *
 * Padding is the theme's, plus whatever the hardware demands. The insets are added rather than
 * substituted: `space.xl` is 24 and a Dynamic Island wants 59, so replacing would be a regression
 * on a phone with no notch and ignoring them puts the first line under the status bar on one with.
 * Where a native header is drawn it has already consumed the top inset, which is what
 * `useHasHeader()` is for.
 */
export function Screen({ children, list = false }: { children: React.ReactNode; list?: boolean }) {
  const styles = useThemedStyles(screenStyles);
  const { space } = useTheme();
  const insets = useSafeAreaInsets();
  const hasHeader = useHasHeader();
  return (
    <View
      style={[
        styles.page,
        styles.screen,
        list && styles.listScreen,
        {
          paddingTop: (hasHeader ? 0 : insets.top) + space.xl,
          paddingBottom: insets.bottom + space.xl,
        },
      ]}
    >
      {children}
    </View>
  );
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

/**
 * A line of copy on a page. The `Title`'s counterpart, and the only body text a screen needs.
 *
 * `selectable` is for the lines that carry a value rather than a sentence — a join code a parent
 * is reading out, a balance, an id in a support message. It is off by default because a screen of
 * selectable prose swallows taps meant for what is under it.
 */
export function Body({ children, selectable }: { children: string; selectable?: boolean }) {
  const styles = useThemedStyles(textStyles);
  return (
    <Text style={styles.body} selectable={selectable}>
      {children}
    </Text>
  );
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

/**
 * A sign-in button in an identity provider's own clothes.
 *
 * Both of these used to be the app's `action` green with plain white text, which is wrong twice.
 * Apple's Sign in with Apple guidelines allow black, white or white-with-outline and nothing
 * else, and the button's appearance is checked at review — a green one is a rejection waiting to
 * happen on a build we are about to submit. Google's identity guidelines are equally specific
 * about their neutral button. Beyond compliance, a parent recognises these two shapes before they
 * read either label, and that recognition is the whole point of offering the providers at all.
 *
 * The Apple mark is U+F8FF, the Apple logo glyph carried by the system font on Apple platforms.
 * It costs no asset and no dependency, and it is safe precisely because this button only renders
 * on iOS — the glyph is in Apple's private use area and is a hollow box anywhere else.
 *
 * Google's G is a four-colour path that cannot honestly be drawn from text or Views, and the app
 * bundles no vector library, so the Google button ships as the correct neutral button without its
 * mark. `mark` is the slot it drops into the moment the asset exists.
 */
export function ProviderButton({
  provider,
  title,
  onPress,
  disabled,
  mark,
}: {
  provider: 'apple' | 'google';
  title: string;
  onPress: () => void;
  disabled?: boolean;
  /** The provider's logo, when there is an asset for it. Apple supplies its own from the font. */
  mark?: React.ReactNode;
}) {
  const styles = useThemedStyles(providerButtonStyles);
  const apple = provider === 'apple';
  return (
    <Pressable
      style={[styles.button, apple ? styles.apple : styles.google, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {apple ? <Text style={[styles.mark, styles.appleText]}>{APPLE_LOGO}</Text> : mark}
      <Text style={[styles.label, apple ? styles.appleText : styles.googleText]}>{title}</Text>
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
 * any number may be, `button` where tapping it does something rather than choosing (guided
 * setup's suggested chores), and so is never active.
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
  role?: 'radio' | 'checkbox' | 'button';
}) {
  const chips = useThemedStyles(chipStyles);
  return (
    <Pressable
      style={[chips.chip, active && chips.chipActive]}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={
        role === 'radio' ? { selected: active } : role === 'checkbox' ? { checked: active } : {}
      }
    >
      <Text style={[chips.chipText, active && chips.chipTextActive]}>{title}</Text>
    </Pressable>
  );
}

/** Always selectable: an error is the one line a parent may need to send to somebody else. */
export function ErrorText({ children }: { children: string | null }) {
  const styles = useThemedStyles(textStyles);
  return children ? (
    <Text style={styles.error} selectable>
      {children}
    </Text>
  ) : null;
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
export function ScrollScreen({
  children,
  refreshing,
  onRefresh,
}: {
  children: React.ReactNode;
  /** Supply both to give the page pull-to-refresh; supply neither and it has none. */
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const styles = useThemedStyles(screenStyles);
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.page,
        styles.scrollContent,
        // `contentInsetAdjustmentBehavior` handles the top under a native header and does nothing
        // without one, so the bottom inset is still ours to pay either way.
        { paddingBottom: insets.bottom + space.xl },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      // A field low on the form scrolls up above the keyboard instead of sitting under it.
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={colors.muted}
          />
        ) : undefined
      }
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
 * The parent's navigation, as grouped rows rather than a wrapped cloud of pills.
 *
 * It used to borrow the chip's pill, and that was the mistake: a chip means "selected / not
 * selected" everywhere else in the app, so seven of them in a row read as a filter rather than as
 * a menu, and `Sign out` came out the same weight as `Children`. Rows carry the same chevron the
 * children and chores lists already use, so the home screen now looks like the screens it opens.
 *
 * Groups are separated by a gap, iOS-style, which is what lets the destructive row sit apart
 * without needing a rule or a heading. Keyed by position because the labels are translated copy.
 */
export function NavList({
  groups,
}: {
  groups: { title: string; onPress: () => void; destructive?: boolean }[][];
}) {
  const styles = useThemedStyles(navListStyles);
  return (
    <View style={styles.groups}>
      {groups.map((group, g) => (
        <View key={g} style={styles.group}>
          {group.map((item, i) => (
            <Pressable
              key={i}
              style={[styles.item, i > 0 && styles.divided]}
              onPress={item.onPress}
              accessibilityRole="button"
            >
              <Text style={[styles.label, item.destructive && styles.destructive]}>
                {item.title}
              </Text>
              {item.destructive ? null : <Text style={styles.chevron}>{CHEVRON}</Text>}
            </Pressable>
          ))}
        </View>
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
  waiting,
  waitingLabel,
  onPress,
}: {
  title: string;
  icon?: string | null;
  done: boolean;
  coins?: number;
  /**
   * A photo chore whose proof is still with a grown-up: the title is not struck through — the
   * work is done, only the coins are waiting — and the camera glyph says where it stands. The
   * glyph is symmetric, so it reads the same in Hebrew.
   */
  waiting?: boolean;
  waitingLabel?: string;
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
        accessibilityLabel={waiting && waitingLabel ? `${title}, ${waitingLabel}` : title}
      >
        <Animated.Text style={[styles.icon, { transform: [{ scale: tickScale }] }]}>
          {done ? DONE_GLYPH : waiting ? WAITING_GLYPH : (icon ?? CHORE_GLYPH)}
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
const WAITING_GLYPH = '📷';

const screenStyles = (theme: Theme) => ({
  // What a page looks like, with no opinion about how it sizes. Vertical padding is supplied
  // per-render with the safe-area insets, so it is not set here either.
  page: {
    paddingHorizontal: theme.space.xl,
    gap: theme.space.lg,
    justifyContent: 'flex-start' as const,
    backgroundColor: theme.colors.ground,
  },
  // A `Screen` is a View that fills the space it is given.
  screen: { flex: 1 },
  listScreen: { gap: theme.space.md },
  scroll: { flex: 1, backgroundColor: theme.colors.ground },
  // A scroll's content is the opposite: it grows to fill a short page and is free to exceed the
  // viewport on a long one. `flexGrow` alone, never `flex` — `flex: 1` sets `flexShrink: 1` and
  // `flexBasis: 0` as well, which pins the content to the viewport's height and squashes anything
  // taller instead of scrolling it. That is why the allowance screen would not scroll to its end.
  scrollContent: { flexGrow: 1 },
  loading: { flex: 1, justifyContent: 'center' as const, backgroundColor: theme.colors.ground },
});

const textStyles = (theme: Theme) => ({
  title: { ...theme.type.title, color: theme.colors.text },
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

/** The Apple logo, as the system font draws it. iOS only — see `ProviderButton`. */
const APPLE_LOGO = '\uF8FF';

const providerButtonStyles = (theme: Theme) => ({
  button: {
    minHeight: theme.touchTarget,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.space.sm,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.lg,
  },
  apple: { backgroundColor: providerBrand.appleBackground },
  google: {
    backgroundColor: providerBrand.googleBackground,
    borderWidth: 1,
    borderColor: providerBrand.googleBorder,
  },
  // The providers set the label's weight and size, not the app's type scale: these buttons are
  // the two places on screen that are meant to look like somebody else's.
  label: { fontSize: 17, fontWeight: '600' as const },
  appleText: { color: providerBrand.appleForeground },
  googleText: { color: providerBrand.googleForeground },
  // The glyph sits slightly above the label's baseline in San Francisco, as Apple's own does.
  mark: { fontSize: 19, lineHeight: 22 },
  disabled: { opacity: 0.5 },
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

const navListStyles = (theme: Theme) => ({
  groups: { gap: theme.space.lg },
  group: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden' as const,
  },
  item: {
    minHeight: theme.touchTarget,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    gap: theme.space.sm,
  },
  // A hairline between rows, never above the first: the group's own edge is already the line.
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.muted },
  label: { ...theme.type.body, color: theme.colors.text },
  destructive: { color: theme.colors.danger },
  chevron: { ...theme.type.body, color: theme.colors.muted },
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
