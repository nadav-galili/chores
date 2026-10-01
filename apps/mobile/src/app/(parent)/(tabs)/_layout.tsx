import type { AndroidSymbol } from 'expo-symbols';
import { NativeTabs, type SFSymbolIcon } from 'expo-router/unstable-native-tabs';
import { isRTL, nativeIsRTL, t, type TranslationKey } from '@/lib/i18n';

/**
 * The parent's five destinations.
 *
 * They used to be seven rows stacked under the today screen, which cost about half the phone: a
 * child's card was cropped mid-list so that `Parent PIN` — a screen a parent opens once, before
 * their first join code — could be on display every evening. The rarest screens had the most
 * permanent home in the app.
 *
 * So the tab bar carries what a parent comes back to, and `More` carries what they set once.
 * Rewards is in `More` on purpose: the decision that matters, approving a redemption, already
 * happens on Today, and editing the catalogue is a rainy-afternoon job.
 *
 * Five is the iOS maximum and this spends all five. The order is how often they are opened, which
 * is also roughly the order a household needs them in.
 *
 * Native rather than the JS tabs: the bar is drawn by UIKit, so it is the one the reviewer
 * expects, it picks up the system's own blur and iOS 26's minimise behaviour, and the icons are
 * SF Symbols the OS already has. Android draws its own bar from the same triggers and ignores SF
 * Symbols, so each tab also names a Material Symbol, rendered from the font `expo-symbols` bundles;
 * without one the bar was labels over blank space. Material's default for five items labels only
 * the selected tab, so Android is told to label every tab.
 *
 * The bar is the OS's, so it is laid out the OS's way, not React Native's: in Hebrew on an iPhone
 * the app reads right to left while UIKit still places the first trigger on the left, and Today
 * ends up at the far end of the bar from where a Hebrew reader starts. Where the two directions
 * disagree the triggers are handed over in reverse, so the bar reads in the app's direction
 * whichever way the OS fills it. (`nativeIsRTL` in `lib/i18n` says when they disagree.)
 */
// Today is the first tab whichever end of the bar it sits at: with the triggers reversed the
// router would otherwise take More for the group's first route, and Android's back button with it.
export const unstable_settings = { initialRouteName: '(today)' };

const TABS: readonly {
  name: string;
  sf: SFSymbolIcon['sf'];
  md: AndroidSymbol;
  label: TranslationKey;
}[] = [
  { name: '(today)', sf: 'checklist', md: 'checklist', label: 'parent.tabs.today' },
  { name: '(children)', sf: 'person.2', md: 'group', label: 'parent.tabs.children' },
  { name: '(chores)', sf: 'list.bullet.rectangle', md: 'list_alt', label: 'parent.tabs.chores' },
  { name: '(allowance)', sf: 'banknote', md: 'payments', label: 'parent.tabs.allowance' },
  { name: '(more)', sf: 'ellipsis', md: 'more_horiz', label: 'parent.tabs.more' },
];

export default function ParentTabs() {
  const tabs = isRTL === nativeIsRTL ? TABS : [...TABS].reverse();
  return (
    <NativeTabs labelVisibilityMode="labeled">
      {tabs.map(({ name, sf, md, label }) => (
        <NativeTabs.Trigger key={name} name={name}>
          <NativeTabs.Trigger.Icon sf={sf} md={md} />
          <NativeTabs.Trigger.Label>{t(label)}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
