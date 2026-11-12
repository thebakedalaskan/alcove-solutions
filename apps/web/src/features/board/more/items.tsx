/*
 * What More does. Beside the rail: Image, kept in the board's own files; From your workspace, a link to something there, by
 * each reader's own name for it; Table; Mind map; Comment, which the board's comments give; and Templates. In the bar: Copy
 * link, Download as an image and Download as a PDF, which change nothing, so they're there for someone who can only look too,
 * and Night board, the board's own setting, for whoever can change it. An item with nothing to do it isn't offered, so nothing
 * in either is a dead end.
 */
import { errorMessage } from '@alcove/api';
import type { TemplateName } from '@alcove/board';
import { BoardFlyList, BoardPop, type IconName } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { StorageFullError } from '~/features/plans/storageFull';
import { log as rootLog } from '~/lib/log';
import type { BoardBarItem, BoardBarItems, BoardMoreItems } from '../state';
import { useBoardState, type Board } from '../useBoard';
import type { BoardItem } from './objects';

const log = rootLog.child({ component: 'board-more' });

/** Keeps a picture in the board's own files and says its file's id; told its size in pixels, where the browser could read it. */
export type BoardUpload = (file: File, size: { width: number; height: number } | null) => Promise<string>;

/** The board's workspace, for From your workspace: what this person can open there to link to (null while it's being read). */
export interface BoardWorkspace {
  items: readonly BoardItem[] | null;
}

/** How big a picture lands, at most, in board units on its long side. */
const PICTURE_SIDE = 480;
/** What a link takes up on the board. */
export const LINK_SIZE = { w: 300, h: 76 } as const;

/** The templates More offers beside what's on the board. Blank adds nothing, so it isn't one. */
const TEMPLATES: readonly { id: Exclude<TemplateName, 'blank'>; label: string; icon: IconName }[] = [
  { id: 'retro', label: 'Retro', icon: 'layoutTemplate' },
  { id: 'ideas', label: 'Ideas', icon: 'stickyNote' },
  { id: 'flow', label: 'Flow', icon: 'workflow' },
  { id: 'what-why-next', label: 'What, why, next', icon: 'layoutTemplate' }
];

/** What the hidden field that takes a picture is called: one at a time, on the page while someone chooses. */
const PICKING = 'A picture to put on the board';
/**
 * A picture someone picks. The field is on the page, hidden and named, until they choose one, so whatever puts a file there
 * finds it; one they let be stays until the next time Image is pressed, which takes its place, and nothing waits on it.
 */
function chooseFile(accept: string): Promise<File | null> {
  return new Promise((done) => {
    for (const old of document.querySelectorAll(`input[type="file"][aria-label="${PICKING}"]`)) old.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.setAttribute('aria-label', PICKING);
    input.addEventListener('change', () => { input.remove(); done(input.files?.[0] ?? null); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

/** A picture's size in pixels, or null if this browser can't read it. */
async function sizeOf(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch (e: unknown) {
    log.info('a picture’s size couldn’t be read', { type: file.type, bytes: file.size, error: errorMessage(e) });
    return null;
  }
}

/** Image: a picture from this device, kept in the board's files, in the middle of the view at most `PICTURE_SIDE` across. */
async function addImage(board: Board, upload: BoardUpload): Promise<void> {
  const file = await chooseFile('image/png,image/jpeg,image/webp,image/gif,image/avif');
  if (!file) return;
  const size = await sizeOf(file);
  try {
    const media = await upload(file, size);
    const k = size ? Math.min(1, PICTURE_SIDE / Math.max(size.width, size.height)) : 1;
    const w = size ? Math.max(48, Math.round(size.width * k)) : 320, h = size ? Math.max(48, Math.round(size.height * k)) : 240;
    board.addHere({ k: 'image', ...board.middle(w, h), w, h, media });
  } catch (e: unknown) {
    // Storage full says what helps, as the doors do; anything else, the server's words.
    board.tell(errorMessage(e), e instanceof StorageFullError && e.said.action ? { action: e.said.action, ms: 9000 } : undefined);
  }
}

/**
 * What More beside the rail does here, and which of its items it offers. What the world round the board gives (`given`) takes
 * the place of the board's own, as Comment does.
 */
export function moreFor(board: Board, o: { upload?: BoardUpload | undefined; workspace?: BoardWorkspace | undefined; given: BoardMoreItems }): BoardMoreItems {
  const { upload, workspace } = o;
  return {
    image: upload ? () => { void addImage(board, upload); } : undefined,
    workspace: workspace ? () => board.set({ fly: 'items' }) : undefined,
    table: () => board.addTable(),
    mindMap: () => board.addMindMap(),
    templates: () => board.set({ fly: 'templates' }),
    ...o.given
  };
}

/** What Templates and From your workspace offer, beside the rail where More was. */
export function MoreLists({ board, workspace }: { board: Board; workspace?: BoardWorkspace | undefined }) {
  const fly = useBoardState(board, (s) => s.fly);
  const done = () => { board.set({ fly: null }); board.focusSheet(); };
  if (fly === 'templates') {
    return <BoardFlyList label="Templates" empty="" items={TEMPLATES.map((t) => ({ id: t.id, icon: t.icon, label: t.label, onPick: () => { done(); board.addTemplate(t.id); } }))} />;
  }
  if (fly === 'items' && workspace) {
    const items = workspace.items;
    return (
      <BoardFlyList label="From your workspace" empty={items ? 'Nothing here you can open yet.' : 'Getting what’s here…'}
        items={(items ?? []).map((item) => ({
          id: item.id, icon: item.kind === 'board' ? 'presentation' : 'fileText', label: item.name.trim() || (item.kind === 'board' ? 'Untitled board' : 'Untitled'),
          onPick: () => { done(); board.addHere({ k: 'link', ...board.middle(LINK_SIZE.w, LINK_SIZE.h), ...LINK_SIZE, item: item.id }); }
        }))} />
    );
  }
  return null;
}

const BAR_ITEMS: readonly { id: BoardBarItem; icon: IconName; label: string }[] = [
  { id: 'link', icon: 'link', label: 'Copy link' },
  { id: 'image', icon: 'download', label: 'Download as an image' },
  { id: 'pdf', icon: 'fileText', label: 'Download as a PDF' },
  { id: 'night', icon: 'moon', label: 'Night board' }
];

/**
 * The bar's More, under its button: whichever of its items this board was given. The keys go into it as it opens; picking one
 * gives them back to the board, and Escape to More. `night`: the board is a night board now, which Night board shows with a
 * tick, as the frame's name menu in a call does, and pressing it again turns off.
 */
export function BarMenu({ board, items, night }: { board: Board; items: BoardBarItems; night: boolean }) {
  const open = useBoardState(board, (s) => s.barMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return undefined;
    el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      const more = el.closest('.bd')?.querySelector<HTMLElement>('.bd-head button[aria-label="More"]');
      board.set({ barMenu: false });
      more?.focus({ preventScroll: true });
    };
    el.addEventListener('keydown', key);
    return () => el.removeEventListener('keydown', key);
  }, [open, board]);
  if (!open) return null;
  const rows = BAR_ITEMS.flatMap((item) => {
    const run = items[item.id];
    if (!run) return [];
    return [{ id: item.id, icon: item.icon, label: item.label, ...(item.id === 'night' ? { on: night } : {}), onPick: () => { board.set({ barMenu: false }); run(); board.focusSheet(); } }];
  });
  return rows.length ? <BoardPop ref={ref} right={14} top={60} label="More" items={rows} /> : null;
}

/** Whether the bar's More has anything in it, and so whether its button shows. */
export const anyIn = (items: BoardBarItems): boolean => BAR_ITEMS.some((i) => items[i.id] !== undefined);
