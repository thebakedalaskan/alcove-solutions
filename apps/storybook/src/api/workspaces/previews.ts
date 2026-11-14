/*
 * What the Drive reads across the world's workspaces, as the API answers it (apps/api/src/features/workspaces/drive.ts): what a
 * document says at the top, for its card, read from its page as the server reads it from the document, and one Trash for every
 * workspace. Only what the world's trees open is answered; anything else asked about is left out.
 */
import { AlcoveApiError, PREVIEW_CHARS, PREVIEW_LINES, type DocumentPreview, type PreviewLineKind, type Trashed } from '@alcove/api';
import type { BlockJSON } from '~/features/workspace/editor/types';
import type { Page, World } from '../../world/world';

/** How long something stays in Trash, as the API keeps it. */
const TRASH_DAYS = 30;

/** What a line says, as the server reads it: words, a tag's name, a date's day. */
const said = (parts: readonly BlockJSON[] | undefined): string => (parts ?? []).map((p) => {
  if (p.type === 'text') return p.text ?? '';
  const name = p.attrs?.['name'];
  if (p.type === 'mention') return typeof name === 'string' ? name : '';
  const date = p.attrs?.['date'];
  if (p.type === 'dateChip' && typeof date === 'string') return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
  return '';
}).join('');
function kindOf(line: BlockJSON): PreviewLineKind {
  const kind = line.attrs?.['kind'];
  if (kind === 'heading') return 'heading';
  if (kind === 'bullet' || kind === 'numbered') return 'bullet';
  if (kind === 'todo') return line.attrs?.['done'] === true ? 'done' : 'todo';
  return 'text';
}
/** Cut at a word, with an ellipsis, as the server cuts it. */
function atWord(text: string): string {
  if (text.length <= PREVIEW_CHARS) return text;
  const cut = text.slice(0, PREVIEW_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > PREVIEW_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}
/** What a card shows of a page: its first lines with words, the pictures, videos and files it holds. A new one has nothing yet. */
export function previewOf(id: string, page: Page | undefined): DocumentPreview {
  const out: DocumentPreview = { id, lines: [], pictures: 0, videos: 0, file: null };
  for (const b of page?.blocks ?? []) {
    if (b.type === 'gallery') { const items = b.attrs?.['items']; out.pictures += Array.isArray(items) ? items.length : 0; }
    else if (b.type === 'video') out.videos += 1;
    else if (b.type === 'file' && out.file === null) { const name = b.attrs?.['name']; out.file = (typeof name === 'string' ? /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toUpperCase() : undefined) ?? 'FILE'; }
    else if (b.type === 'line' && out.lines.length < PREVIEW_LINES) {
      const text = said(b.content).replace(/\s+/g, ' ').trim();
      if (text) out.lines.push({ text: atWord(text), kind: kindOf(b) });
    }
  }
  return out;
}

/** What these documents say at the top: the ones in this workspace, out of Trash. A workspace that isn't there is `not-found`. */
export function previewsIn(w: World, workspaceId: string, items: readonly string[]): DocumentPreview[] {
  const space = w.workspaces.find((x) => x.id === workspaceId);
  if (!space) throw new AlcoveApiError('not-found', 'That workspace isn’t there, or you can’t open it.');
  return [...new Set(items)].flatMap((id) => {
    const item = space.items.find((i) => i.id === id);
    return item?.kind === 'document' && item.trashedAt === null ? [previewOf(id, w.pages[id])] : [];
  });
}

/** Everything in Trash in every workspace, the latest sent there first, with when it goes for good. */
export function trashIn(w: World): Trashed[] {
  return w.workspaces.flatMap((space) => space.items.flatMap((item): Trashed[] => (item.trashedAt === null ? [] : [{
    workspaceId: space.id, item, deletesAt: new Date(Date.parse(item.trashedAt) + TRASH_DAYS * 86_400_000).toISOString()
  }]))).sort((a, b) => (b.item.trashedAt ?? '').localeCompare(a.item.trashedAt ?? ''));
}
