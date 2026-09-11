import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme } from './provider';
import type { Theme } from './themes';

type Sheet = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * There are three themes, they are frozen, and they are built once at module load, so a sheet
 * built from one is good for the life of the process. Cache by theme, then by factory: a
 * component's styles are created the first time any instance of it renders under a theme, and
 * every later instance — and every re-render — reads the same registered sheet back.
 */
const sheets = new WeakMap<Theme, WeakMap<object, Sheet>>();

/**
 * The one way a component gets its styles. The factory is a module-level constant, never an
 * inline closure: an inline one is a new key on every render and would defeat the cache.
 */
export function useThemedStyles<T extends Sheet>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  let byFactory = sheets.get(theme);
  if (!byFactory) {
    byFactory = new WeakMap();
    sheets.set(theme, byFactory);
  }
  const cached = byFactory.get(factory);
  if (cached) return cached as T;
  const created = StyleSheet.create(factory(theme));
  byFactory.set(factory, created);
  return created;
}
