import { StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { treeArt, treeArtLabel } from '@/lib/grove-art';
import type { Tree } from '@/sync/grove';

/**
 * One tree, at whatever size the screen asks for. Pure display; it reads no data.
 *
 * The child's own tree is drawn larger and named for them, so their tree is findable in a row of
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
  // A sibling's tree only exists because their row arrived, so only the own tree can be nameless.
  const name = tree.firstName ?? (tree.isSelf ? ownName : '');
  const who = tree.isSelf ? t('grove.mine') : name;
  const art = treeArt(tree.stage);
  return (
    <View style={styles.figure}>
      <View
        style={[
          styles.ground,
          { backgroundColor: art.ground, width: size, height: size, borderRadius: size / 4 },
          tree.isSelf && styles.mine,
        ]}
        accessibilityRole="image"
        accessibilityLabel={treeArtLabel(name, tree.stage)}
      >
        <Text style={{ fontSize: size * 0.55 }}>{art.glyph}</Text>
      </View>
      {showLabel && (
        <>
          <Text style={[styles.who, tree.isSelf && styles.whoMine]} numberOfLines={1}>
            {who}
          </Text>
          <Text style={styles.count}>{t('grove.trees', { count: tree.stage })}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { alignItems: 'center', gap: 6 },
  ground: { alignItems: 'center', justifyContent: 'center' },
  mine: { borderWidth: 3, borderColor: '#7C5CFF' },
  who: { fontSize: 16, fontWeight: '600', color: '#555' },
  whoMine: { color: '#7C5CFF', fontWeight: '700' },
  count: { fontSize: 14, color: '#777' },
});
