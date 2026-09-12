import { describe, expect, it } from 'vitest';
import { isMissingBrowser } from './browser-error';

/**
 * The regression is the middle case: a warm-up rejection used to count as "no browser", which
 * took the Google button away on a phone that could sign in perfectly well (MIBO-1).
 */
describe('isMissingBrowser', () => {
  it('is true for the open call finding no browser activity', () => {
    const e = new Error(
      "Call to function 'ExpoWebBrowser.openAuthSessionAsync' has been rejected.\n→ Caused by: No matching browser activity found",
    );
    expect(isMissingBrowser(e)).toBe(true);
  });

  it('is false for a warm-up that found no Custom Tabs service', () => {
    const e = new Error(
      "Call to function 'ExpoWebBrowser.warmUpAsync' has been rejected.\n→ Caused by: Cannot determine preferred package without satisfying it",
    );
    expect(isMissingBrowser(e)).toBe(false);
  });

  it('is false for every other failure', () => {
    expect(isMissingBrowser(new Error('Network request failed'))).toBe(false);
    expect(isMissingBrowser('No matching browser activity found')).toBe(false);
    expect(isMissingBrowser(null)).toBe(false);
  });
});
