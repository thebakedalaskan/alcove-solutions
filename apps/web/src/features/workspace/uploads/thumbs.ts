/*
 * Small pictures of photos, for the photo picker (docs: Data and storage › Media). A photo uploaded from here has one made
 * as it goes, a small JPEG sealed beside it; one uploaded before that has none, so its small picture is made here from the
 * photo itself, read once, decoded at the small size, and not kept.
 */
import { MAX_MEDIA_PREVIEW_BYTES, MEDIA_PREVIEW_PIXELS } from '@alcove/api';
import { log } from '~/lib/log';

const tlog = log.child({ component: 'workspace-thumbs' });

/** How a small picture is squeezed, best first, until it's under what a preview may be. */
const QUALITIES = [0.8, 0.65, 0.5];

/** A size in pixels, as a picture's stored facts say it. */
export interface Pixels { width: number; height: number }

/** How big a picture's size the browser has to read for itself, when its stored facts don't say. */
async function sizeOf(picture: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(picture);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * A small JPEG of a picture, no more than MEDIA_PREVIEW_PIXELS on its longer side, or null if this browser can't read it.
 * `size` is what its stored facts say, so it's decoded once, at the small size.
 */
export async function smallJpeg(picture: Blob, size?: Pixels | null | undefined): Promise<Blob | null> {
  let small: ImageBitmap | null = null;
  try {
    const full = size && size.width > 0 && size.height > 0 ? size : await sizeOf(picture);
    const scale = Math.min(1, MEDIA_PREVIEW_PIXELS / Math.max(full.width, full.height));
    const width = Math.max(1, Math.round(full.width * scale));
    const height = Math.max(1, Math.round(full.height * scale));
    // Decoded at the small size: a whole photo is never held at full size to draw a thumbnail.
    small = await createImageBitmap(picture, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(small, 0, 0, width, height);
    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
      if (blob && blob.size <= MAX_MEDIA_PREVIEW_BYTES) return blob;
    }
    return null;
  } catch (err) {
    tlog.debug('a picture couldn’t be made small here', { err, bytes: picture.size });
    return null;
  } finally {
    small?.close();
  }
}
