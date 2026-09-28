import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { t } from '@/lib/i18n';

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
 * SF Symbols the OS already has — no icon package and no bundled asset. Android draws its own
 * bar from the same triggers and shows the labels; the symbols are iOS's and it ignores them.
 */
export default function ParentTabs() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Icon sf="checklist" />
        <NativeTabs.Trigger.Label>{t('parent.tabs.today')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(children)">
        <NativeTabs.Trigger.Icon sf="person.2" />
        <NativeTabs.Trigger.Label>{t('parent.tabs.children')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(chores)">
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" />
        <NativeTabs.Trigger.Label>{t('parent.tabs.chores')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(allowance)">
        <NativeTabs.Trigger.Icon sf="banknote" />
        <NativeTabs.Trigger.Label>{t('parent.tabs.allowance')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(more)">
        <NativeTabs.Trigger.Icon sf="ellipsis" />
        <NativeTabs.Trigger.Label>{t('parent.tabs.more')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
