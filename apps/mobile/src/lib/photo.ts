import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import { t } from '@/lib/i18n';

/**
 * The child's camera (M3.12): one photo, taken in the app at the done moment of a
 * `requires_photo` chore. The camera itself is device-only — no test seam covers it, and the
 * hand-test note travels with the ticket — so everything around it (the write, the upload, the
 * queue) is written against injectable seams instead (`sync/local`, `sync/photo`).
 */

export type TakenPhoto = {
  /** Where this device holds the bytes until the upload succeeds. */
  local_uri: string;
  content_type: 'image/jpeg' | 'image/png' | 'image/webp';
};

/**
 * Opens the camera and returns the photo, or null when the child backs out. A denial is not an
 * error either: the chore stays due and the child can tap it again. The cause of a real failure
 * is logged, never shown — there is nothing a child can do with it.
 *
 * Except a denial the OS will not ask about again (on iOS, every one after the first): then a
 * tap would open nothing at all, so the child is told the camera is off and offered Settings.
 * The tap that refused it says nothing — the child has just answered the question.
 */
export async function takePhoto(): Promise<TakenPhoto | null> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (!current.granted && !current.canAskAgain) {
    explainCameraOff();
    return null;
  }
  const permission = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: false,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  // Aligned with the presign route's accepted types (uploads.ts): png and webp pass through,
  // anything else is jpeg.
  return {
    local_uri: asset.uri,
    content_type:
      asset.mimeType === 'image/png'
        ? 'image/png'
        : asset.mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg',
  };
}

/**
 * PUTs the photo's bytes to its presigned URL. Reads the `file://` asset through `fetch` into
 * a blob, so no native file module is needed; the upload itself is plain HTTPS against R2.
 */
export async function putPhoto(
  upload_url: string,
  photo: { local_uri: string; content_type: string },
): Promise<void> {
  const asset = await fetch(photo.local_uri);
  const body = await asset.blob();
  const res = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'content-type': photo.content_type },
    body,
  });
  if (!res.ok) throw new Error(`photo PUT failed ${res.status}`);
}

function explainCameraOff() {
  Alert.alert(t('kid.camera.title'), t('kid.camera.body'), [
    { text: t('kid.camera.ok'), style: 'cancel' },
    {
      text: t('kid.camera.settings'),
      onPress: () => {
        Linking.openSettings().catch((e: unknown) => console.error('open settings failed', e));
      },
    },
  ]);
}
