import { Image, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { GROVE_GROUND, TREE_BASE, treeArt, treeArtLabel } from '@/lib/grove-art';
import type { Tree } from '@/sync/grove';
import { useThemedStyles, type Theme } from '@/theme';

/**
 * One tree, at whatever size the screen asks for. Pure display; it reads no data.
 *
 * Its layout bottom is the tree's base, not the bottom edge of the art: the drawing sits 10%
 * lower than the box it is measured in, so trees drawn at two sizes beside each other stand on
 * one line rather than on two. That is the whole reason the row reads as a grove.
 *
 * The child's own tree is drawn larger and named for them, so it is findable in a row of
 * siblings' trees without anything on screen ranking the children against each other.
 */
export function TreeFigure({
  tree,
  ownName,
  size = 120,
  showLabel = true,
}: {
  tree: Tree;
  /** The device's own child, for the one tree whose row may not have been pulled yet. */
  ownName: string;
  size?: number;
  showLabel?: boolean;
}) {
  const styles = useThemedStyles(treeStyles);
  // A sibling's tree only exists because their row arrived, so only the own tree can be nameless.
  const name = tree.firstName ?? (tree.isSelf ? ownName : '');
  const who = tree.isSelf ? t('grove.mine') : name;
  const base = Math.round(size * TREE_BASE);
  return (
    <View style={styles.figure}>
      <View
        style={{ width: size, height: base }}
        accessibilityRole="image"
        accessibilityLabel={treeArtLabel(name, tree.stage)}
      >
        <Image
          source={treeArt(tree.stage)}
          style={[styles.art, { width: size, height: size, bottom: base - size }]}
          resizeMode="contain"
        />
      </View>
      {showLabel && (
        <View style={styles.labels}>
          <Text style={[styles.who, tree.isSelf && styles.whoMine]} numberOfLines={1}>
            {who}
          </Text>
          <Text style={styles.count} numberOfLines={1}>
            {t('grove.trees', { count: tree.stage })}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * The ground line the whole row stands on: one image across the width of the row, cropped to a
 * band, so a grove of one tree and a grove of five share the same horizon.
 *
 * It belongs behind a row of labelled `TreeFigure`s and nowhere else: both read the same label
 * block height, which is what puts the top of the band on the trees' bases.
 *
 * `cover` rather than `repeat`, though the strip is painted to tile (`docs/design/prompts.md`,
 * entry 17): React Native repeats an image at its own pixel size, and a 3x 1536x512 strip tiles
 * as a band 512 points deep. Cropping one copy is what a band this shallow can actually use;
 * the seamless edges keep their point the day the grove wants a deeper one.
 */
export function GroveGround() {
  const styles = useThemedStyles(treeStyles);
  return (
    <Image
      source={GROVE_GROUND}
      style={styles.ground}
      resizeMode="cover"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * How deep the ground band is, and therefore how far below a tree's base its name is printed:
 * the names stay on the page's ground rather than on the grass, where the theme's text colours
 * are the contrast they were chosen for.
 */
const groundBand = (theme: Theme) => theme.space.xl;

/** The exact height of a tree's two label lines, so the band can be positioned above them. */
function labelBlockHeight(theme: Theme): number {
  return theme.type.label.lineHeight + theme.type.caption.lineHeight;
}

/**
 * How tall a labelled tree stands: its art down to the base, the ground band, and its two
 * lines of label. The screen sizes the row from this rather than from a guess.
 */
export function treeFigureHeight(theme: Theme, size: number): number {
  return Math.round(size * TREE_BASE) + groundBand(theme) + labelBlockHeight(theme);
}

const treeStyles = (theme: Theme) => ({
  figure: { alignItems: 'center' as const },
  art: { position: 'absolute' as const },
  // The band sits in this gap, so the name is clear of the grass.
  labels: {
    alignItems: 'center' as const,
    marginTop: groundBand(theme),
    // Fixed, so the band's offset from the bottom and the tree's base are the same line.
    height: labelBlockHeight(theme),
  },
  who: { ...theme.type.label, color: theme.colors.muted },
  whoMine: { ...theme.type.label, color: theme.colors.text, fontWeight: '700' as const },
  count: { ...theme.type.caption, color: theme.colors.muted },
  ground: {
    position: 'absolute' as const,
    start: 0,
    end: 0,
    bottom: labelBlockHeight(theme),
    height: groundBand(theme),
  },
});
