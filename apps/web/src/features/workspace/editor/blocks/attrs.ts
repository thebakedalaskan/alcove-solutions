/*
 * Reading what blocks that aren't text hold. Attributes come from other people's browsers, so a list only holds what's
 * really in it. A stored file is known here by its media ID: a document says which files it uses by naming them.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { blockFromJSON, captionKey, textAttr, textOf } from '../schema';
import type { BlockJSON, LiveLine } from '../types';

/** One picture in a `gallery`. `width` and `height` hold its space until it arrives. */
export interface GalleryItem { media: string | null; name: string; cap: string; width: number | null; height: number | null }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const numberOr = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function galleryItems(node: PMNode): GalleryItem[] {
  const items: unknown = node.attrs['items'];
  if (!Array.isArray(items)) return [];
  return items.flatMap((v: unknown) => {
    if (!isRecord(v)) return [];
    const media = textOf(v['media']);
    return [{ media, name: textOf(v['name']) ?? '', cap: media ? textAttr(node, captionKey(media)) ?? '' : '', width: numberOr(v['width']), height: numberOr(v['height']) }];
  });
}

export function liveLines(node: PMNode): LiveLine[] {
  const lines: unknown = node.attrs['lines'];
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((v: unknown) => {
    if (!isRecord(v)) return [];
    const text = textOf(v['text']);
    return text === null ? [] : [{ text, at: textOf(v['at']) ?? '', person: textOf(v['person']), name: textOf(v['name']) ?? '', due: textOf(v['due']) ?? '' }];
  });
}

/** The stored files a block uses. */
export function mediaIn(node: PMNode): string[] {
  switch (node.type.name) {
    case 'gallery': return galleryItems(node).flatMap((item) => item.media ?? []);
    case 'file': return [textAttr(node, 'media')].flatMap((id) => id ?? []);
    case 'video': return [textAttr(node, 'media'), textAttr(node, 'poster')].flatMap((id) => id ?? []);
    default: return [];
  }
}

/** The stored files a block uses, for a block on its way to a document that isn't open here. */
export const mediaOfBlock = (block: BlockJSON): string[] => mediaIn(blockFromJSON(block));
