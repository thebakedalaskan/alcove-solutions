/*
 * Shared and made in a call, under its stage: each screen that was shared and kept, which plays on the stage from its moment;
 * then what the call worked on that the reader can open now (`Note.workedOn`: documents, and every board open in it, a
 * breakout room's saying which room), each opening where it lives; and the way to the call's own workspace, for whoever is in
 * it (`Note.home`). A document shows its first lines as it is now, as its card in the Drive does (`q.previews`); a board is
 * drawn as it is, read once its card is on screen and never written. Nothing of either is kept here.
 */
import { errorCode, firstName, type DocSession, type DocumentPreview, type Note, type NoteWorkedOn } from '@alcove/api';
import { EmptyState, FileCard, Icon } from '@alcove/ui';
import { useQueries } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { BoardPictures } from '~/features/board/BoardSurface';
import { BoardSurface } from '~/features/board/lazy';
import { pictureOf } from '~/features/drive/Card';
import { openToRead } from '~/features/workspace/session';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { position } from '~/lib/time';
import { lengthOf } from './Line';
import { usePlayerAt, type PlayerState } from './Player';

const blog = log.child({ component: 'call-made' });

/** "Priya, Aiko and you edited it". You come last; past four people, the first few and how many more, you among them. */
export function workedBy(by: NoteWorkedOn['by']): string {
  const others = by.filter((b) => !b.isMe).map((b) => firstName(b.name) || 'Someone');
  const me = by.some((b) => b.isMe);
  const names = me ? [...others, 'you'] : others;
  const shown = names.length <= 4 ? names : me ? ['you', ...others.slice(0, 2)] : others.slice(0, 3);
  const more = names.length - shown.length;
  const list = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.length < 2 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}`;
  return list ? `${list.charAt(0).toUpperCase()}${list.slice(1)} edited it` : 'Open in the call';
}

/** The width a board is drawn at before it's shrunk into its card: about a board on a page. */
const DRAWN_W = 900;

/** The board's session, opened to read once `on` (its card is on screen), and closed when the card goes. One that won't open leaves the drawing. */
function useReading(workspaceId: string, documentId: string, on: boolean): DocSession | null {
  const [session, setSession] = useState<DocSession | null>(null);
  useEffect(() => {
    if (!on) return undefined;
    let gone = false;
    let held: DocSession | null = null;
    openToRead(workspaceId, documentId, undefined).then(async (s) => {
      held = s;
      if (gone) { s.close(); return; }
      await s.ready;
      if (!gone) setSession(s);
    }).catch((e: unknown) => {
      if (!gone) blog.info('a board on a call’s page wasn’t opened', { workspaceId, documentId, code: errorCode(e) });
    });
    return () => { gone = true; held?.close(); setSession(null); };
  }, [workspaceId, documentId, on]);
  return session;
}

/** A board drawn small into its card's picture, once the card is on screen, in the reader's theme as the board's own page is. */
function useBoardPicture(board: NoteWorkedOn): { box: RefObject<HTMLSpanElement | null>; picture: ReactNode } {
  const box = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const sizes = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    sizes.observe(el);
    const shown = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); shown.disconnect(); } }, { rootMargin: '240px' });
    shown.observe(el);
    return () => { sizes.disconnect(); shown.disconnect(); };
  }, []);
  const session = useReading(board.workspaceId, board.id, seen);
  const pictures = useMemo<BoardPictures>(() => (media, signal) => api.workspaces.media.picture(board.workspaceId, board.id, media, { signal }), [board.workspaceId, board.id]);
  const scale = size && size.w > 0 ? size.w / DRAWN_W : 1;
  const picture = session && size && size.w > 0 ? (
    <span className="cd-board-mini" style={{ width: DRAWN_W, height: Math.max(1, Math.round(size.h / scale)), transform: `scale(${scale})` }}>
      <Suspense fallback={null}><BoardSurface doc={session.doc} awareness={session.awareness} mode="tile" pictures={pictures} /></Suspense>
    </span>
  ) : undefined;
  return { box, picture };
}

/** What the documents among these say at the top, by ID: asked of each workspace once. */
function useDocPreviews(made: readonly NoteWorkedOn[]): Map<string, DocumentPreview> {
  const asks = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const w of made) if (w.kind === 'document') by.set(w.workspaceId, [...(by.get(w.workspaceId) ?? []), w.id]);
    return [...by].map(([workspaceId, ids]) => q.previews(workspaceId, [...ids].sort()));
  }, [made]);
  const found = useQueries({ queries: asks });
  return useMemo(() => new Map(found.flatMap((r) => r.data ?? []).map((p) => [p.id, p])), [found]);
}

/** What a thing worked on in a breakout room says of where it was. */
const roomOf = (note: Note, w: NoteWorkedOn) => (w.room ? note.rooms.find((r) => r.id === w.room)?.name : undefined);

function BoardCard({ note, board }: { note: Note; board: NoteWorkedOn }) {
  const navigate = useNavigate();
  const { box, picture } = useBoardPicture(board);
  const room = roomOf(note, board);
  return (
    <FileCard kind="board" name={board.name || 'Untitled board'} where={room ? `In ${room}` : undefined} by={workedBy(board.by)} thumb={{ picture, thumbRef: box }}
      onOpen={() => void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: board.workspaceId, documentId: board.id }, search: { from: 'calls' } })} />
  );
}

/** Each share's card, lit while it's the one playing on the stage. */
function ShareCards({ note, player, onPlay }: { note: Note; player: PlayerState; onPlay: (at: number) => void }) {
  const at = usePlayerAt(player, (p) => Math.floor(p));
  return note.shares.map((s) => (
    <FileCard key={s.id} kind="share" name={s.label} at={position(s.at)} by={lengthOf(s.until - s.at)} label={`Play ${s.label} from ${position(s.at)}`}
      current={player.playing && s.at <= at && at < s.until} onOpen={() => onPlay(s.at)} />
  ));
}

/**
 * Shared and made in the call. `onPlay` plays a moment on the stage. `tab`: it's the Shared tab's, in one column, rather than
 * under the stage.
 */
export function Made({ note, player, onPlay, tab = false }: { note: Note; player: PlayerState; onPlay: (at: number) => void; tab?: boolean | undefined }) {
  const navigate = useNavigate();
  const made = note.workedOn;
  const previews = useDocPreviews(made);
  const home = note.home;
  const nothing = !note.shares.length && !made.length;
  // One summary goes to everyone, so it reads a board only when everyone invited can open it: whoever can is told.
  const leftOut = made.filter((w) => w.kind === 'board' && !w.everyone).map((w) => w.name || 'Untitled board');
  return (
    <section className={tab ? 'cd-made is-tab' : 'cd-made'} aria-label="Shared and made in this call">
      <div className="cd-sh">
        <h2>Shared and made in this call</h2>
        {home && <Link to="/drive/$workspaceId" params={{ workspaceId: home.workspaceId }} search={{ from: 'calls' }} className="cd-link">Open its workspace<Icon name="right" size={15} /></Link>}
      </div>
      {nothing ? (
        <EmptyState title="Nothing shared or made" art={null} className="cd-none-made">
          {home ? 'Nobody shared a screen that was kept, or worked on anything you can open. Its workspace is still there.' : 'Nobody shared a screen that was kept, or worked on anything you can open.'}
        </EmptyState>
      ) : (
        <div className="cd-cards">
          <ShareCards note={note} player={player} onPlay={onPlay} />
          {made.map((w) => {
            if (w.kind === 'board') return <BoardCard key={`${w.workspaceId}/${w.id}`} note={note} board={w} />;
            const room = roomOf(note, w);
            const pic = pictureOf({ kind: 'doc' }, previews.get(w.id));
            return (
              <FileCard key={`${w.workspaceId}/${w.id}`} kind={pic.kind} icon={pic.icon} name={w.name || 'Untitled'} where={room ? `In ${room}` : undefined} by={workedBy(w.by)} thumb={pic.thumb}
                onOpen={() => void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: w.workspaceId, documentId: w.id }, search: { from: 'calls' } })} />
            );
          })}
        </div>
      )}
      {leftOut.length > 0 && (
        <p className="cd-left-out"><Icon name="eyeOff" size={14} />Not everyone invited can open {leftOut.length === 1 ? leftOut[0] : `${leftOut.slice(0, -1).join(', ')} and ${leftOut.at(-1) ?? ''}`}, so the summary leaves {leftOut.length === 1 ? 'it' : 'them'} out.</p>
      )}
    </section>
  );
}
