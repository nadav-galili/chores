import { createContext, use } from 'react';

/**
 * Whether the stack around this page draws a native header.
 *
 * `Screen` needs to know, because a header has already consumed the top safe-area inset and
 * paying it twice leaves a band of empty ground under the title. The alternative was an `edges`
 * prop threaded through every screen in the parent group, which is twenty files saying something
 * their own layout already knows — and twenty chances for a new screen to forget it.
 *
 * `false` is the honest default: the kid group and the app's root draw no header, and a page
 * rendered outside any provider at all is likelier to be one of those than not.
 */
const HasHeaderContext = createContext(false);

export function HasHeaderProvider({ children }: { children: React.ReactNode }) {
  return <HasHeaderContext value={true}>{children}</HasHeaderContext>;
}

export function useHasHeader(): boolean {
  return use(HasHeaderContext);
}
