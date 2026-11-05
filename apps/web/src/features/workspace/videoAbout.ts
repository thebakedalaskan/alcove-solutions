/*
 * What a video block says about its file, read from its document without drawing it: the title the bar shows while it plays
 * for everyone in a call, and how long it is, for everyone in the call, whether or not they have that document open. It
 * loads Yjs, so it's imported only once something plays.
 */
import { DOC_FRAGMENT } from '@alcove/api';
import * as Y from 'yjs';
import { openToRead } from './session';

export interface VideoBlockAbout { title: string; seconds: number | null }

const seconds = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The first block on the page holding this file, or null if there's none. A block that has left the page holds no file. */
export function videoIn(doc: Y.Doc, mediaId: string): VideoBlockAbout | null {
  for (const el of doc.getXmlFragment(DOC_FRAGMENT).toArray()) {
    if (!(el instanceof Y.XmlElement) || el.nodeName !== 'video') continue;
    const media: unknown = el.getAttribute('media');
    if (media !== mediaId) continue;
    const title: unknown = el.getAttribute('title');
    return { title: typeof title === 'string' ? title : '', seconds: seconds(el.getAttribute('dur')) };
  }
  return null;
}

/** Opens the document just long enough to read it. */
export async function videoAbout(workspaceId: string, documentId: string, mediaId: string, pass: string | undefined): Promise<VideoBlockAbout | null> {
  const session = await openToRead(workspaceId, documentId, pass);
  try {
    await session.ready;
    return videoIn(session.doc, mediaId);
  } finally {
    session.close();
  }
}
