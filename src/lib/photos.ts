// Entry photos (D30): system photo picker (no permission) or camera (permission at first "Take photo"), downscaled to
// a long edge ≤ 1600 px, JPEG 0.8, stored as `Paths.document/photos/<uuid>.jpg`.
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { retryRace } from '@/db/native-retry';
import { withLockSuspended } from '@/lib/lock-controller';
import type { PhotoInput } from '@/db/entries';

export const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export function photosDir(): Directory {
  return new Directory(Paths.document, 'photos');
}

export function photoFile(name: string): File {
  return new File(photosDir(), name);
}

export function photoUri(name: string): string {
  return photoFile(name).uri;
}

export function photoExists(name: string): boolean {
  try {
    return photoFile(name).exists;
  } catch {
    return false;
  }
}

/** Size that fits inside maxEdge, or null when the image is small enough. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } | null {
  const long = Math.max(width, height);
  if (long <= maxEdge || long === 0) return null;
  const k = maxEdge / long;
  return width >= height ? { width: maxEdge, height: Math.round(height * k) } : { width: Math.round(width * k), height: maxEdge };
}

export function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Downscales and stores one picked image; returns the photo row data. */
export async function storePhoto(sourceUri: string, width: number, height: number): Promise<PhotoInput> {
  const dir = photosDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const context = ImageManipulator.manipulate(sourceUri);
  try {
    const size = fitWithin(width, height, MAX_EDGE);
    if (size) context.resize(size);
    const image = await retryRace(() => context.renderAsync());
    try {
      const saved = await retryRace(() => image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG }));
      const name = `${randomUUID()}.jpg`;
      const target = photoFile(name);
      new File(saved.uri).moveSync(target);
      const bytes = await target.bytes();
      const sha256 = hex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
      return { file: name, width: saved.width, height: saved.height, bytes: bytes.length, sha256 };
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

export type PickResult = { photo: PhotoInput } | { cancelled: true } | { denied: true };

/** "Choose photo" (system picker, no permission) or "Take photo" (camera permission asked now, not earlier). */
export async function pickPhoto(source: 'library' | 'camera'): Promise<PickResult> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { denied: true };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false };
  // The system picker / camera leaves the app on purpose: the app lock must not cover it on return.
  const result = await withLockSuspended(() => (source === 'camera' ? ImagePicker.launchCameraAsync(options) : ImagePicker.launchImageLibraryAsync(options)));
  if (result.canceled || !result.assets[0]) return { cancelled: true };
  const asset = result.assets[0];
  return { photo: await storePhoto(asset.uri, asset.width, asset.height) };
}

/** Removes the app's own photo files of a deleted entry/photo (the user's delete; missing files are fine). */
export function removePhotoFiles(names: readonly string[]): void {
  for (const name of names) {
    try {
      const f = photoFile(name);
      if (f.exists) f.delete();
    } catch (e) {
      console.warn('photo file not removed', name, e);
    }
  }
}

/**
 * A photo from an import file: decoded and downscaled like a picked one; bytes the image decoder cannot read are kept
 * as they are (the entry keeps its photo; width/height 0).
 */
export async function storePhotoBytes(bytes: Uint8Array): Promise<PhotoInput> {
  const dir = photosDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const temp = new File(Paths.cache, `import-${randomUUID()}.jpg`);
  temp.create();
  temp.write(bytes);
  try {
    const context = ImageManipulator.manipulate(temp.uri);
    let size: { width: number; height: number };
    try {
      const image = await retryRace(() => context.renderAsync());
      size = { width: image.width, height: image.height };
      image.release();
    } finally {
      context.release();
    }
    return await storePhoto(temp.uri, size.width, size.height);
  } catch {
    const name = `${randomUUID()}.jpg`;
    const target = photoFile(name);
    target.create();
    target.write(bytes);
    return { file: name, width: 0, height: 0, bytes: bytes.length, sha256: hex(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))) };
  } finally {
    if (temp.exists) temp.delete(); // our own temporary copy
  }
}
