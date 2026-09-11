import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { GroveGround, TreeFigure, treeFigureHeight } from '@/components/grove';
import { useDeviceSession } from '@/lib/device-session';
import { BACK_ARROW, t } from '@/lib/i18n';
import { useGrove } from '@/lib/use-grove';
import { useThemedStyles, type Theme } from '@/theme';
import type { Tree } from '@/sync/grove';
import type { DeviceSession } from '@chores/shared';

export default function GroveScreen() {
  const device = useDeviceSession();
  if (!device.session) return null;
  return <Grove session={device.session} />;
}

/** The child's own tree, larger than a sibling's — the one distinction the row draws. */
const OWN_TREE = 168;
const SIBLING_TREE = 112;

/**
 * The household's grove: one tree per child, standing on a shared ground line, the child's own
 * centred and larger.
 *
 * Every form is read from the local database, so this is the same picture offline — and because
 * growth entries have no clawback (ADR-0011) and `treeForm` never decreases, it is a picture
 * that only ever grows, including after a rejection syncs in.
 *
 * The row scrolls rather than laying the trees out as a landscape: a landscape does not survive
 * five children on a narrow phone, and a row still reads as a grove with one tree in it.
 */
function Grove({ session }: { session: DeviceSession }) {
  const router = useRouter();
  const styles = useThemedStyles(groveStyles);
  const grove = useGrove(session);
  const row = centreOwn(grove.trees);

  // The flag is off: the screen does not exist, however the child got here.
  if (grove.status === 'ready' && !grove.enabled) return <Redirect href="/(kid)" />;

  return (
    <View style={styles.screen}>
      <Pressable style={styles.back} onPress={() => router.back()} accessibilityRole="button">
        <Text style={styles.backText}>{`${BACK_ARROW} ${t('grove.back')}`}</Text>
      </Pressable>
      <Text style={styles.title}>{t('grove.title')}</Text>
      <View style={styles.row}>
        <CentredRow>
          <GroveGround />
          {row.map((slot, i) =>
            slot === EMPTY_SLOT ? (
              <View key={`slot-${i}`} style={styles.slot} />
            ) : (
              <TreeFigure
                key={slot.childId}
                tree={slot}
                ownName={session.child.first_name}
                size={slot.isSelf ? OWN_TREE : SIBLING_TREE}
              />
            ),
          )}
        </CentredRow>
      </View>
      {grove.status === 'ready' && grove.ownTree.stage === 0 && (
        <Text style={styles.empty}>{t('grove.empty')}</Text>
      )}
    </View>
  );
}

/**
 * A horizontal scroller resting at its own middle.
 *
 * The trees are ordered with the child's own in the middle and their siblings split evenly
 * around it, so the middle of the content *is* the child's tree — which is what makes centring
 * it a single scroll to the midpoint rather than a measurement of one child's position. The
 * midpoint is also the one offset that is the same distance from either edge, so this lands in
 * the same place under RTL with no mirroring of its own.
 */
function CentredRow({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(groveStyles);
  const scroller = useRef<ScrollView>(null);
  // Both arrive, in either order, and a tree that grows changes the content width again.
  const [{ viewport, content }, measure] = useState({ viewport: 0, content: 0 });

  useEffect(() => {
    if (viewport > 0 && content > viewport) {
      scroller.current?.scrollTo({ x: (content - viewport) / 2, animated: false });
    }
  }, [viewport, content]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      onLayout={(e) => {
        const { width } = e.nativeEvent.layout;
        measure((m) => (m.viewport === width ? m : { ...m, viewport: width }));
      }}
      onContentSizeChange={(width) =>
        measure((m) => (m.content === width ? m : { ...m, content: width }))
      }
    >
      {children}
    </ScrollView>
  );
}

/** A tree-wide hole in the row, and the whole of what balances an odd number of siblings. */
const EMPTY_SLOT = 'empty' as const;

type Slot = Tree | typeof EMPTY_SLOT;

/**
 * Own tree in the middle, siblings split to either side in the order a parent arranged them —
 * and, where the split cannot come out even, empty slots on the short side so that both sides
 * are the same *width*, not merely the same count.
 *
 * That is what makes the middle of the content the child's own tree, which is the whole reason
 * `CentredRow` can centre it by scrolling to a midpoint rather than measuring one child. Every
 * sibling is one `SIBLING_TREE` wide and the row's gaps are even, so the balance is countable:
 * one empty slot per sibling of difference.
 *
 * `showGrove` hands the own tree over first, because that is the one the rest of the app asks
 * for; the grove screen is the only place the row order matters.
 */
function centreOwn(trees: readonly Tree[]): Slot[] {
  const own = trees.filter((tree) => tree.isSelf);
  const siblings = trees.filter((tree) => !tree.isSelf);
  const half = Math.floor(siblings.length / 2);
  const before = siblings.slice(0, half);
  const after = siblings.slice(half);
  const pad = Array<Slot>(after.length - before.length).fill(EMPTY_SLOT);
  return [...pad, ...before, ...own, ...after];
}

const groveStyles = (theme: Theme) => ({
  screen: {
    flex: 1,
    paddingTop: theme.space.xxl * 2,
    paddingHorizontal: theme.space.xl,
    backgroundColor: theme.colors.ground,
  },
  back: {
    alignSelf: 'flex-start' as const,
    minHeight: theme.touchTarget,
    justifyContent: 'center' as const,
    paddingEnd: theme.space.lg,
  },
  backText: { ...theme.type.body, color: theme.colors.action },
  title: { ...theme.type.title, color: theme.colors.text, marginBottom: theme.space.xl },
  // Bounded, so the row is a band of trees on a page rather than the whole page.
  row: { height: treeFigureHeight(theme, OWN_TREE) },
  slot: { width: SIBLING_TREE },
  content: {
    flexGrow: 1,
    // The trees stand on one ground line, so a short tree and a tall one share a horizon.
    alignItems: 'flex-end' as const,
    justifyContent: 'center' as const,
    gap: theme.space.lg,
    paddingHorizontal: theme.space.xs,
  },
  empty: {
    marginTop: theme.space.xl,
    ...theme.type.body,
    color: theme.colors.muted,
    textAlign: 'center' as const,
  },
});
