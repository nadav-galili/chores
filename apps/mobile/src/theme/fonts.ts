import { useFonts } from 'expo-font';
import RubikSemiBold from '../../assets/fonts/Rubik-SemiBold.ttf';
import { displayFontFamily } from './tokens';

/**
 * Loads Rubik 600 — the only bundled face. Rubik was drawn for Hebrew and Latin
 * together, which the tested locale makes non-negotiable; body text stays on the
 * system font so the parent side feels native and the bundle stays small.
 *
 * Returns true once the face is registered. Text rendered before then falls back
 * to the system font rather than disappearing, so callers need not block on it.
 */
export function useDisplayFont(): boolean {
  const [loaded] = useFonts({
    [displayFontFamily]: RubikSemiBold,
  });
  return loaded;
}
