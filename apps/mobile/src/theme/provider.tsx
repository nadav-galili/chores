import { createContext, useContext, useMemo } from 'react';
import type { UiMode } from '@chores/shared';
import type { Role } from '@/lib/role';
import { selectTheme, type Theme } from './themes';

const ThemeContext = createContext<Theme | null>(null);

/**
 * Resolves the active theme from runtime state — the role this binary is
 * running as, and, for a child, their `ui_mode`. Both are things a static
 * import cannot express, which is why this is a provider and not a constant.
 */
export function ThemeProvider({
  role,
  uiMode = 'big',
  children,
}: {
  role: Role;
  uiMode?: UiMode;
  children: React.ReactNode;
}) {
  const theme = useMemo(() => selectTheme(role, uiMode), [role, uiMode]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside a ThemeProvider');
  return theme;
}
