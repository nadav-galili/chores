import { useRouter } from 'expo-router';
import { PinForm } from '@/components/pin-form';
import { t } from '@/lib/i18n';

/** More → Parent PIN: set or replace it, then back to where the parent came from. */
export default function Pin() {
  const router = useRouter();
  return <PinForm intro={t('pin.hint')} onSaved={() => router.back()} />;
}
