/*
 * A board in a call, loaded only once one is open, so a call without one pays nothing for it: the board inside its frame on the
 * stage (features/call/layout/frame.tsx, whose bar has its name, its menu, Present and Close), with how it stands (its seal, and
 * Reconnecting and Couldn't save in its pill, as on its page) and the call's one pill, and ideas from the call. Presented, it's a
 * frame at a time: whoever presents steps through them with the pager at the frame's foot, and their notes beside each frame are
 * in their side (`CallBoardMine`); everyone following sees the frame alone, until they unfollow. The same board, drawn small, is
 * its presented tile (`CallBoardMini`). The call (features/call/boards/callBoard.ts) holds the board's session and says what's
 * true; this draws it.
 */
import type { DocSession } from '@alcove/api';
import { readBoard } from '@alcove/board';
import { BoardHeard, BoardPop, BoardTray, Icon, type BoardNaming, type IconName } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BoardIdeas } from '~/features/call/boards/callBoard';
import { typing } from '~/lib/keys';
import { BoardSurface, type BoardHandle, type BoardLanding, type BoardPerson, type BoardPictures } from './BoardSurface';
import type { BoardCommenting } from './comments';
import type { BoardUpload, BoardWorkspace } from './more/items';
import type { BoardLinks } from './more/objects';
import { FollowingPill, type CallPills, type PillKind, type Pills } from './pills';
import { slideAt, useSlides } from './slides';
import type { Standing } from './standing';
import type { BoardRun, RunPills } from './tools/run';
import type { SortAsk } from './useBoard';

/** This board presented where you are: by whom, which frame, and what you can do about it. */
export interface BoardPresentation {
  /** Whoever's presenting, by first name. */
  by: string;
  /** You're presenting it. */
  mine: boolean;
  /** The frame everyone's on, from 0: what the call says, or where you've just moved it, if you're presenting. */
  section: number;
  /** You're following whoever presents it, rather than working on your own. */
  watching: boolean;
  /** Follow, and work on your own: a scroll, a drag or a pinch on the frame does the second. */
  onWatch: (watching: boolean) => void;
  /** Whoever's presenting: to a frame. */
  onMove: (section: number) => void;
  /** Whoever's presenting, with an account: their notes in the side, open or not. */
  notes: { on: boolean; onToggle: () => void } | null;
}
/** Where whoever presents a board is in it, for the pager at the frame's foot. */
export interface BoardPager { at: number; total: number; part: string }

/** How long the tools take to fade before a presentation takes the sheet: `--duration-2`. */
const FADE_MS = 240;

export interface CallBoardSheetProps {
  session: DocSession;
  name: string;
  /** What you can do with it: someone who can only read looks round it. */
  role: 'edit' | 'read';
  /** Everyone in the call can add to it: the call made it. */
  everyone: boolean;
  /** How it stands: what its seal says, on hover and pressed. Its pill, when it has one, comes in `pills`. */
  seal: Standing;
  /** Renames it, for anyone who can change it: Rename in the frame's name menu asks (`renameAsk` goes up), and its name becomes a field. A rename that doesn't take puts the name back. */
  rename?: ((name: string) => Promise<void>) | undefined;
  renameAsk: number;
  people: readonly BoardPerson[];
  talking: ReadonlySet<string>;
  pictures: BoardPictures;
  /** The call's own pills, besides the board's (following, a vote, its results): how it stands, and the rooms' time. */
  pills: CallPills;
  /** Which kind of pill shows on it, as that changes: none while it's a tile or sinking. */
  onPill?: ((kind: PillKind | null) => void) | undefined;
  /** What the call runs on the board: its vote, and what the bar's Vote does (`useBoardRun`). */
  run?: BoardRun | undefined;
  /** It has just opened, or come back: it rises through the arch. */
  fresh: boolean;
  /** Rooms' boards coming back to it, which land frame by frame. */
  landing: BoardLanding | null;
  /** It's being presented where you are. */
  present: BoardPresentation | null;
  /** Where whoever presents it is, for their pager at the frame's foot and Follow on everyone else's bar: told as it changes, and null while it isn't presented. */
  onPager?: ((pager: BoardPager | null) => void) | undefined;
  /** It's been closed for everyone: it sinks back through the arch, and takes nothing more. */
  sinking?: boolean | undefined;
  theme: 'light' | 'dark';
  /** Ideas from the call, for someone who can add to it. */
  ideas?: BoardIdeas | undefined;
  /** Sort into themes: not given while notes are paused, so the bar doesn't offer it. */
  onSort?: SortAsk | undefined;
  /** On a phone: the board opens where it can be read, + adds a sticky, and a tap votes. */
  phone: boolean;
  /** Keeps a picture in the board's files, for Image under More: whoever can add to it. */
  upload?: BoardUpload | undefined;
  /** What From your workspace under More can link to. */
  workspace?: BoardWorkspace | undefined;
  /** Each link's name for you, and opening it. */
  links?: BoardLinks | undefined;
  /** The board's own link, for Copy link in the bar's More. */
  link?: string | undefined;
  /** Comments on it: K and More's Comment for whoever can add to it, and every thread for whoever can see it. */
  comments?: BoardCommenting | undefined;
  onFollow: (id: string | null) => void;
  onSay: (text: string, icon: IconName) => void;
}

type Pop = 'seal' | null;

/**
 * The tray of ideas from the call, over the bottom of the sheet. It takes the keys as it opens, and Escape closes it; working on
 * the board meanwhile leaves it open. Adding one moves the keys to the next, or back to the sheet once the tray has gone.
 */
function IdeasTray({ ideas, onDone }: { ideas: BoardIdeas & { tray: NonNullable<BoardIdeas['tray']> }; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const next = () => requestAnimationFrame(() => {
    const to = ref.current?.querySelector<HTMLElement>('.ln .ac-btn:not(:disabled), .ft .ac-btn');
    if (to) to.focus({ preventScroll: true });
    else onDone();
  });
  useEffect(() => { next(); }, []);
  const close = () => { ideas.close(); onDone(); };
  return (
    <div ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <BoardTray ideas={ideas.tray} onClose={close} onAdd={(id) => { ideas.add(id); next(); }} onAddAll={() => { ideas.addAll(); onDone(); }} />
    </div>
  );
}

/** A pop over the sheet that closes with Escape, or a press anywhere else but the button that opened it. Focus goes into it as it opens. */
function usePop(close: () => void, from: () => HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ close, from });
  latest.current = { close, from };
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Into its field or first choice, or onto it when it only has words, so Escape is heard either way.
    const first = el.querySelector<HTMLElement>('input, button');
    if (first) first.focus({ preventScroll: true });
    else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.close();
      latest.current.from()?.focus({ preventScroll: true });
    };
    const onPress = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || el.contains(e.target) || latest.current.from()?.contains(e.target)) return;
      // A menu it opened, like a role in Share, is drawn elsewhere on the page and is still part of it.
      if (e.target instanceof Element && e.target.closest('[data-radix-popper-content-wrapper]')) return;
      latest.current.close();
    };
    el.addEventListener('keydown', onKey);
    addEventListener('pointerdown', onPress, true);
    return () => {
      el.removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onPress, true);
    };
  }, []);
  return ref;
}

/** Where a pop sits on the sheet: under the bar, or under the pill when there's one, which may hold what to press (Try again). */
const POP_TOP = 62;
const UNDER_PILL = 8;

/** What the seal says when it's pressed: how the board stands now, under the pill that says so too. */
function SealPop({ seal, onClose, from }: { seal: Standing; onClose: () => void; from: () => HTMLElement | null }) {
  const ref = usePop(onClose, from);
  const [top, setTop] = useState(POP_TOP);
  useLayoutEffect(() => {
    const sheet = ref.current?.offsetParent;
    if (!(sheet instanceof HTMLElement)) return;
    // By its layout, not how it's drawn now: a pill that has just come is still easing in.
    const pill = sheet.querySelector('.bd-pill');
    setTop(pill instanceof HTMLElement ? Math.max(POP_TOP, pill.offsetTop + pill.offsetHeight + UNDER_PILL) : POP_TOP);
  }, [seal.seal]);
  return <BoardPop ref={ref} left={12} top={top} title={seal.pop.title} rows={seal.pop.rows} />;
}

/** The board on the stage: everyone works on it here. */
export const CallBoardSheet = forwardRef<BoardHandle, CallBoardSheetProps>(function CallBoardSheet(props, ref) {
  const { session, name, role, everyone, seal, rename, renameAsk, people, talking, pictures, pills, onPill, run, fresh, sinking = false, landing, present, onPager, theme, phone, upload, workspace, links, link, comments, ideas, onSort, onFollow, onSay } = props;
  const [pop, setPop] = useState<Pop>(null);
  const [naming, setNaming] = useState<string | null>(null);
  /** What it was renamed to here, until the call says so too. */
  const [renamed, setRenamed] = useState<string | null>(null);
  useEffect(() => { if (renamed !== null && name === renamed) setRenamed(null); }, [name, renamed]);
  const shown = renamed ?? name;
  const wrap = useRef<HTMLDivElement>(null);
  const button = (sel: string) => () => wrap.current?.querySelector<HTMLElement>(sel) ?? null;
  /** Back to the sheet, for the keys, once something over it has closed. */
  const toSheet = () => requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>('[role="application"]')?.focus({ preventScroll: true }));
  const sealButton = button('.bd-head .sv');
  /* Rename, from the frame's name menu: the name is a field at the start of the board's bar until it's done. */
  const asked = useRef(renameAsk);
  useEffect(() => {
    if (renameAsk === asked.current) return;
    asked.current = renameAsk;
    if (rename) setNaming(shown);
  }, [renameAsk]);
  const nameField: BoardNaming | undefined = naming === null ? undefined : {
    value: naming,
    onChange: setNaming,
    onDone: () => {
      const to = naming.replace(/\s+/g, ' ').trim();
      setNaming(null);
      if (to && to !== shown && rename) { setRenamed(to); rename(to).catch(() => setRenamed(null)); }
      toSheet();
    },
    onCancel: () => {
      setNaming(null);
      toSheet();
    }
  };
  /*
   * Presented: frames are slides. Whoever's presenting sees the frame as everyone does, and can't move off it; everyone following
   * sees it alone, once the tools have faded, until they unfollow. Your own view waits, and comes back when it ends.
   */
  const slides = useSlides(session.doc);
  const presenting = present?.mine === true;
  const watching = present !== null && !present.mine && present.watching;
  const on = present ? slideAt(slides, present.section) : null;
  const reduce = useReducedMotion() === true;
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!watching || reduce) { setFading(false); return undefined; }
    setFading(true);
    const t = setTimeout(() => setFading(false), FADE_MS);
    return () => clearTimeout(t);
  }, [watching, reduce]);
  // A presentation has nothing to open over it: whatever was open closes as it takes the sheet.
  useEffect(() => { if (presenting || watching) setPop(null); }, [presenting, watching]);
  /*
   * Whoever's presenting moves on with → and back with ←, as a clicker's Page Down and Page Up do, while the presentation has the
   * keys: the frame, or the pager at the frame's foot. Keys anywhere else move nothing, nor does one something else has already
   * used, nor one aimed at any other control (the notes in the side, the pill).
   */
  const at = on?.at ?? 0;
  const total = slides.length;
  const move = present?.onMove;
  useEffect(() => {
    const el = wrap.current;
    if (!presenting || !move || !el) return undefined;
    const keys = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target)) return;
      if (!(e.target instanceof Element) || !(e.target.matches('[role="application"]') || e.target.closest('[data-pager]'))) return;
      const by = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (by === 0) return;
      e.preventDefault();
      const to = at + by;
      if (to >= 0 && to < total) move(to);
    };
    // The pager is the frame's, outside the board: its keys come by the document.
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [presenting, move, at, total]);
  /* Where whoever presents is: for their pager at the frame's foot, and for Follow on everyone else's bar. */
  const onId = present ? on?.id ?? null : null;
  const part = useMemo(() => (onId ? readBoard(session.doc).frames.find((f) => f.id === onId)?.title ?? '' : ''), [onId, slides, session.doc]);
  const toldPager = useRef(onPager);
  toldPager.current = onPager;
  useEffect(() => { toldPager.current?.(present && on ? { at: at + 1, total: Math.max(total, 1), part } : null); }, [present !== null, at, total, part]);
  useEffect(() => () => toldPager.current?.(null), []);
  const own = role === 'edit' ? (phone ? 'phone' : 'call') : 'read';
  const mode = presenting || (watching && !fading) ? 'present' : own;
  const slide = (presenting || watching) && on ? on.id : undefined;
  const theirs = present && !present.mine ? present : null;

  /*
   * Keys lost as a presentation lets the board go (its pager gone from under them, say) go to the sheet; anyone with the keys
   * anywhere else keeps them there, and so does someone typing a moment ago, who is mid-sentence: the rest of it must never press
   * a button. Where they go as presenting begins is the stage's (layout/landKeys.ts): Next frame, once the pager is drawn.
   */
  const seat = presenting ? 'presenting' : theirs ? (watching && !fading ? 'watching' : 'around') : null;
  const wasSeat = useRef(seat);
  useEffect(() => {
    const was = wasSeat.current;
    wasSeat.current = seat;
    const el = wrap.current;
    const now = document.activeElement;
    if (was === seat || seat !== null || !el || typing(now) || (now !== null && now !== document.body)) return;
    el.querySelector<HTMLElement>('[role="application"]')?.focus({ preventScroll: true });
  }, [seat]);
  /* Back on your stage (it rises as it comes back): the keys go to the sheet, if what they were on has gone with them. */
  const wasBack = useRef(fresh);
  useEffect(() => {
    const was = wasBack.current;
    wasBack.current = fresh;
    const now = document.activeElement;
    if (fresh && !was && (now === null || now === document.body) && !typing(now)) toSheet();
  }, [fresh]);

  // Every pill there is, from the call, the board's run and following: `BoardPills` shows the most pressing. Someone presenting is the frame's bar's to say.
  const pill = (following: BoardPerson | null, stop: () => void, running: RunPills): Pills => ({
    ...pills,
    ...running,
    following: following && <FollowingPill person={following} onStop={stop} />
  });
  /* Which pill shows, told to the call: none while the board is a tile, or sinking, when it's out of sight. */
  const [pillShown, setPillShown] = useState<PillKind | null>(null);
  const pillSeen = sinking ? null : pillShown;
  const toldPill = useRef(onPill);
  toldPill.current = onPill;
  useEffect(() => { toldPill.current?.(pillSeen); }, [pillSeen]);
  useEffect(() => () => toldPill.current?.(null), []);

  return (
    <div ref={wrap} className={sinking ? 'ic-board is-sinking' : 'ic-board'} inert={sinking || undefined}>
      <BoardSurface ref={ref} doc={session.doc} awareness={session.awareness} mode={mode} naming={nameField} slide={slide} still={presenting} faded={watching && fading}
        seal={seal.seal} sealIcon={seal.icon} sealTitle={seal.title} everyone={everyone} people={people} talking={talking} pictures={pictures} fresh={fresh} landing={landing} theme={theme} run={run} pill={pill} onPill={setPillShown}
        upload={upload} workspace={workspace} links={links} link={link} comments={comments}
        onSeal={() => setPop((p) => (p === 'seal' ? null : 'seal'))}
        onLook={watching ? () => theirs?.onWatch(false) : undefined} onFollow={onFollow} onSay={onSay} onSort={role === 'edit' ? onSort : undefined}>
        {pop === 'seal' && <SealPop seal={seal} onClose={() => setPop(null)} from={sealButton} />}
        {/* Ideas from the call are for working on the board, so they wait while it's presented. */}
        {role === 'edit' && ideas && mode !== 'present' && (ideas.tray
          ? <IdeasTray ideas={{ ...ideas, tray: ideas.tray }} onDone={toSheet} />
          : ideas.waiting > 0 && <BoardHeard count={ideas.waiting} onOpen={ideas.open} />)}
      </BoardSurface>
    </div>
  );
});

/** The size the board is drawn at before shrinking it into a tile: the canvas's board on a call's stage. */
const TILE_W = 1114;

/** The board drawn small, kept up to date, for its tile among the people while it's presented and isn't on your stage. */
export function CallBoardMini({ session, width, height, pictures, links, theme }: {
  session: DocSession; width: number; height: number; pictures: BoardPictures; links: BoardLinks; theme: 'light' | 'dark';
}) {
  const scale = width > 0 ? width / TILE_W : 1;
  const h = Math.max(1, Math.round(height / scale));
  return (
    <span className="ic-ptile-board" style={{ width: TILE_W, height: h, transform: `scale(${scale})` }}>
      <BoardSurface doc={session.doc} awareness={session.awareness} mode="tile" pictures={pictures} links={links} theme={theme} />
    </span>
  );
}

/** The size the next frame's picture is drawn at before it's shrunk into the side. */
const NEXT = { w: 1114, h: 674 } as const;
/** The room the next frame's picture has in the side. */
const NEXT_W = 316;

/**
 * Your notes beside the board you present, in your side: which frame everyone's on, your words for it (only yours, kept for next
 * time), and the next frame. A board with no frames has nothing to keep them beside.
 */
export function CallBoardMine({ session, section, notes, onNote, pictures, links, theme }: {
  session: DocSession; section: number;
  /** Your notes by frame, or null without an account. */
  notes: Readonly<Record<string, string>> | null;
  onNote: (frame: string, text: string) => void;
  pictures: BoardPictures; links: BoardLinks; theme: 'light' | 'dark';
}) {
  const slides = useSlides(session.doc);
  const on = slideAt(slides, section);
  const frames = useMemo(() => new Map(readBoard(session.doc).frames.map((f) => [f.id, f.title])), [slides, session.doc]);
  const next = slides[on.at + 1] ?? null;
  const k = NEXT_W / NEXT.w;
  if (!on.id) return <p className="ic-mine-none">This board has no frames, so there’s nothing to keep notes beside.</p>;
  return (
    <div className="ic-mine">
      <span className="pos">{on.at + 1} of {slides.length} · you’re sharing it</span>
      <p className="now">{frames.get(on.id) || 'Untitled frame'}</p>
      {notes ? (
        <textarea className="notes" aria-label={`Your notes on ${frames.get(on.id) || 'this frame'}, only you see them`} placeholder="What you want to say about this frame"
          value={notes[on.id] ?? ''} onChange={(e) => { if (on.id) onNote(on.id, e.target.value); }} />
      ) : <p className="ic-mine-none">Sign in to keep notes beside each frame.</p>}
      <div className="next">
        <span className="pos">{next ? `Next: ${frames.get(next) || 'Untitled frame'}` : 'That’s the last one'}</span>
        {next && (
          <span className="pic" style={{ height: Math.round(NEXT.h * k) }} aria-hidden="true">
            <span style={{ width: NEXT.w, height: NEXT.h, transform: `scale(${k})` }}>
              <BoardSurface doc={session.doc} awareness={session.awareness} mode="tile" slide={next} pictures={pictures} links={links} theme={theme} />
            </span>
          </span>
        )}
      </div>
      <p className="foot"><Icon name="lock" size={15} />Kept for next time. Only you see them.</p>
    </div>
  );
}
