/* Reading a JPEG without decoding it: shared screens' frames (features/recordings/screens) and pictures' previews (features/workspaces/uploads). */

/**
 * A JPEG's size, read from its frame header, or null if it isn't a JPEG. Nothing else of the image is read here:
 * only the notes model, in its attested VM, ever decodes it.
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    // Fill bytes, and markers that stand alone.
    if (marker === 0xff) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (length < 2) return null;
    // Start of frame (baseline, progressive and the rest, never DHT, JPG or DAC): its height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= b.length) return null;
      const height = ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0);
      const width = ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0);
      return width && height ? { width, height } : null;
    }
    // The image data starts before any frame header: not a JPEG we can place.
    if (marker === 0xda) return null;
    i += 2 + length;
  }
  return null;
}
