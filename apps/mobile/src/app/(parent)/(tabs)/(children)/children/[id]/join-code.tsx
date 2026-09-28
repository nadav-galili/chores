import { useLocalSearchParams, useRouter } from 'expo-router';
import { JoinCodeView } from '@/components/join-code-view';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';

/** One child's join code, reached from the child's screen. */
export default function JoinCode() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <JoinCodeView
      id={id}
      pinHref="/pin"
      footer={<Button title={t('common.done')} onPress={() => router.back()} />}
    />
  );
}
