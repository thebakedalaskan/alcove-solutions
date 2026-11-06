/*
 * A board in a call, loaded only once one is open, so a call without one pays nothing for it: the board on the stage, with the
 * menu under its name, how it stands (its seal, and Reconnecting and Couldn't save in its pill, as on its page) and the call's
 * one pill, ideas from the call, and the same board as a live tile among the faces or above them. Presented, it's a frame at a
 * time: whoever's presenting has their view of it round it, and everyone else the frame alone, until they look around. The
 * call (features/call/callBoard.ts) holds the board's session and says what's true; this draws it.
 */
import type { DocSession } from '@alcove/api';
import { BoardHeard, BoardPop, BoardPresenter, BoardTile, BoardTray, type AvatarPerson, type BoardNaming, type BoardPresenting, type IconName } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BoardIdeas } from '~/features/call/callBoard';
import { typing } from '~/lib/keys';
import { BoardSurface, type BoardHandle, type BoardLanding, type BoardPerson, type BoardPictures } from './BoardSurface';
import type { BoardCommenting } from './comments';
import type { BoardUpload, BoardWorkspace } from './more/items';
import type { BoardLinks } from './more/objects';
import { FollowingPill, PresentingPill, type CallPills, type PillKind, type Pills } from './pills';
import { slideAt, useSlides } from './slides';
import type { Standing } from './standing';
import type { BoardRun, RunPills } from './tools/run';
import type { SortAsk } from './useBoard';

/** What's under the board's name, each offered only where it's true. */
export interface BoardNameMenu {
  /** Renames it, for anyone who can change it. A rename that doesn't take puts the name back. */
  rename?: ((name: string) => Promise<void>) | undefined;
  /** Where it's kept: its workspace's name, and opening it. */
  saved?: { name: string; onOpen: () => void } | undefined;
  /** Who can add to it: its item's share sheet, for whoever may share it. */
  share?: (() => ReactNode) | undefined;
  /** Closes it for everyone: whoever opened it, or the organizer. */
  close?: (() => void) | undefined;
}

/** This board presented where you are: by whom, which frame, and what you can do about it. */
export interface BoardPresentation {
  /** Whoever's presenting, by first name. */
  by: string;
  /** You're presenting it. */
  mine: boolean;
  /** The frame everyone's on, from 0: what the call says, or where you've just moved it, if you're presenting. */
  section: number;
  /** You're watching it with everyone, rather than looking around on your own. */
  watching: boolean;
  /** You can stop it though it isn't yours: you're the organizer. */
  canStop: boolean;
  /** Look around, and Back to them. */
  onWatch: (watching: boolean) => void;
  /** Whoever's presenting: to a frame. Whoever's presenting, or the organizer: stop. */
  onMove: (section: number) => void;
  onStop: () => void;
  /** Your notes beside each frame, by frame, or null without an account. */
  notes: Readonly<Record<string, string>> | null;
  onNotes: (frame: string, notes: string) => void;
}

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
  menu: BoardNameMenu;
  people: readonly BoardPerson[];
  talking: ReadonlySet<string>;
  pictures: BoardPictures;
  /** The call's own pills, besides the board's (following, someone presenting, a vote, its results, the timer): how it stands, and the rooms' time. */
  pills: CallPills;
  /** Which kind of pill shows on it, as that changes: none while it's a tile or sinking. */
  onPill?: ((kind: PillKind | null) => void) | undefined;
  /** What the call runs on the board: its timer and vote, and what the bar's Timer and Vote do (`useBoardRun`). */
  run?: BoardRun | undefined;
  /** It has just opened, or come back: it rises through the arch. */
  fresh: boolean;
  /** Rooms' boards coming back to it, which land frame by frame. */
  landing: BoardLanding | null;
  /** It's being presented where you are. */
  present: BoardPresentation | null;
  /** Presents it to everyone where you are, from its first frame: on a bigger screen than a phone. */
  onPresent: (() => void) | undefined;
  /** It's been closed for everyone: it sinks back through the arch, and takes nothing more. */
  sinking?: boolean | undefined;
  /** Out of sight while it's a tile, keeping where you were on it, what's selected and your undo. */
  hidden?: boolean | undefined;
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

type Pop = 'title' | 'seal' | 'share' | null;

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

function NamePop({ menu, onPick, onClose, from }: { menu: BoardNameMenu; onPick: (pick: 'rename' | 'saved' | 'share' | 'close') => void; onClose: () => void; from: () => HTMLElement | null }) {
  const ref = usePop(onClose, from);
  // Each is told apart by what it does, so one coming or going (Saved in, once the workspace's name is known) never puts another under a press.
  const items = [
    ...(menu.rename ? [{ id: 'rename', icon: 'pen' as const, label: 'Rename', onPick: () => onPick('rename') }] : []),
    ...(menu.saved ? [{ id: 'saved', icon: 'folderOpen' as const, label: `Saved in ${menu.saved.name}`, onPick: () => onPick('saved') }] : []),
    ...(menu.share ? [{ id: 'share', icon: 'people' as const, label: 'Who can add to it', onPick: () => onPick('share') }] : []),
    ...(menu.close ? [{ id: 'close', icon: 'x' as const, label: 'Close for everyone', onPick: () => onPick('close') }] : [])
  ];
  return <BoardPop ref={ref} left={12} top={62} label="The board" items={items} />;
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

/** Who can add to it, under the name: the board's own Share, as its workspace has it. */
function SharePop({ sheet, onClose, from }: { sheet: ReactNode; onClose: () => void; from: () => HTMLElement | null }) {
  const ref = usePop(onClose, from);
  return <div ref={ref} className="bp bp-share" style={{ left: 12, top: 62 }} role="dialog" aria-label="Who can add to it">{sheet}</div>;
}

/** The board on the stage: everyone works on it here. */
export const CallBoardSheet = forwardRef<BoardHandle, CallBoardSheetProps>(function CallBoardSheet(props, ref) {
  const { session, name, role, everyone, seal, menu, people, talking, pictures, pills, onPill, run, fresh, sinking = false, landing, present, onPresent, hidden = false, theme, phone, upload, workspace, links, link, comments, ideas, onSort, onFollow, onSay } = props;
  const [pop, setPop] = useState<Pop>(null);
  const [naming, setNaming] = useState<string | null>(null);
  /** What it was renamed to here, until the call says so too. */
  const [renamed, setRenamed] = useState<string | null>(null);
  useEffect(() => { if (renamed !== null && name === renamed) setRenamed(null); }, [name, renamed]);
  const shown = renamed ?? name;
  // A name's menu goes with what it offered: someone who loses the board's close, or its name, has nothing to choose from.
  useEffect(() => { if (pop === 'title' && !menu.rename && !menu.saved && !menu.share && !menu.close) setPop(null); }, [pop, menu.rename, menu.saved, menu.share, menu.close]);
  // Share goes with the right to share it.
  useEffect(() => { if (pop === 'share' && !menu.share) setPop(null); }, [pop, menu.share]);
  const wrap = useRef<HTMLDivElement>(null);
  const button = (sel: string) => () => wrap.current?.querySelector<HTMLElement>(sel) ?? null;
  /** Back to the sheet, for the keys, once something over it has closed. */
  const toSheet = () => requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>('[role="application"]')?.focus({ preventScroll: true }));
  const nameButton = button('.bd-head .nm');
  const sealButton = button('.bd-head .sv');

  const pick = (what: 'rename' | 'saved' | 'share' | 'close') => {
    setPop(what === 'share' ? 'share' : null);
    if (what === 'rename') setNaming(shown);
    else if (what === 'saved') menu.saved?.onOpen();
    else if (what === 'close') menu.close?.();
  };
  const nameField: BoardNaming | undefined = naming === null ? undefined : {
    value: naming,
    onChange: setNaming,
    onDone: () => {
      const to = naming.replace(/\s+/g, ' ').trim();
      setNaming(null);
      if (to && to !== shown && menu.rename) { setRenamed(to); menu.rename(to).catch(() => setRenamed(null)); }
      requestAnimationFrame(() => nameButton()?.focus({ preventScroll: true }));
    },
    onCancel: () => {
      setNaming(null);
      requestAnimationFrame(() => nameButton()?.focus({ preventScroll: true }));
    }
  };
  /*
   * Presented: frames are slides. Whoever's presenting sees the frame as everyone does, and can't move off it; everyone else
   * sees it alone, once the tools have faded, until they look around. Your own view waits, and comes back when it ends.
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
   * keys: the frame, or Back a frame, Next frame and Stop presenting under it. Keys anywhere else move nothing, nor does one
   * something else has already used, nor one aimed at any other control (the notes beside the frame, the pill).
   */
  const at = on?.at ?? 0;
  const total = slides.length;
  const move = present?.onMove;
  useEffect(() => {
    const el = wrap.current;
    if (!presenting || hidden || !move || !el) return undefined;
    const keys = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target)) return;
      if (!(e.target instanceof Element) || !(e.target.matches('[role="application"]') || e.target.closest('.bd-pres .ctl'))) return;
      const by = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (by === 0) return;
      e.preventDefault();
      const to = at + by;
      if (to >= 0 && to < total) move(to);
    };
    el.addEventListener('keydown', keys);
    return () => el.removeEventListener('keydown', keys);
  }, [presenting, hidden, move, at, total]);
  const own = role === 'edit' ? (phone ? 'phone' : 'call') : 'read';
  const mode = presenting || (watching && !fading) ? 'present' : own;
  const slide = (presenting || watching) && on ? on.id : undefined;
  const nextId = presenting && on ? slides[on.at + 1] ?? null : null;
  const parts: BoardPresenting | null = presenting && present && on ? {
    at: on.at + 1, total: Math.max(slides.length, 1),
    next: nextId ? <BoardSurface doc={session.doc} awareness={session.awareness} mode="tile" slide={nextId} pictures={pictures} links={links} theme={theme} /> : null,
    // Beside each frame its own; a board with no frames has nothing to keep them beside.
    notes: present.notes && on.id ? present.notes[on.id] ?? '' : null, onNotes: (text) => { if (on.id) present.onNotes(on.id, text); },
    onBack: () => present.onMove(on.at - 1), onNext: () => present.onMove(on.at + 1), onStop: present.onStop
  } : null;
  const theirs = present && !present.mine ? present : null;

  /*
   * Where the keys go as a presentation begins and ends, for whoever had them on the board or lost them as it changed under them;
   * anyone with the keys anywhere else keeps them there. Presenting, they go to Next frame (Stop presenting on a board of one
   * frame), and back to Present on the bar as it ends. Watching, they go to Look around in the pill as the frame takes the sheet,
   * and to the sheet as the presentation lets them go, if the pill took them with it. Someone who was typing a moment ago is
   * mid-sentence, and the rest of it must never press a button, so their keys stay where they are.
   */
  const seat = presenting ? 'presenting' : theirs ? (watching && !fading ? 'watching' : 'around') : null;
  const wasSeat = useRef(seat);
  useEffect(() => {
    const was = wasSeat.current;
    wasSeat.current = seat;
    const el = wrap.current;
    const now = document.activeElement;
    if (was === seat || !el || typing(now)) return;
    const lost = now === null || now === document.body;
    const here = lost || el.contains(now);
    const find = (sel: string) => el.querySelector<HTMLElement>(sel);
    const to = seat === 'presenting' ? (here ? find('.bd-pres .ctl .go[aria-label="Next frame"]:not([aria-disabled="true"])') ?? find('.bd-pres .ctl .stop') : null)
      : seat === 'watching' ? (here ? find('.bd-pill button') : null)
      : seat === null && was === 'presenting' ? (here ? find('.bd-head button[aria-label="Present"]') : null)
      : seat === null && lost ? find('[role="application"]') : null;
    to?.focus({ preventScroll: true });
  }, [seat]);
  /*
   * Back from being a tile, above the faces or among them (it rises as it comes back): the keys go to the sheet, if the tile
   * they were on has gone with them.
   */
  const wasBack = useRef({ hidden, fresh });
  useEffect(() => {
    const was = wasBack.current;
    wasBack.current = { hidden, fresh };
    const now = document.activeElement;
    const back = (was.hidden && !hidden) || (fresh && !was.fresh);
    if (back && !hidden && (now === null || now === document.body) && !typing(now)) toSheet();
  }, [hidden, fresh]);

  // Every pill there is, from the call, the board's run, someone presenting and following: `BoardPills` shows the most pressing.
  const pill = (following: BoardPerson | null, stop: () => void, running: RunPills): Pills => ({
    ...pills,
    ...running,
    presenting: theirs && <PresentingPill name={theirs.by} watching={theirs.watching} onToggle={() => theirs.onWatch(!theirs.watching)} onStop={theirs.canStop ? theirs.onStop : undefined} />,
    following: following && <FollowingPill person={following} onStop={stop} />
  });
  /* Which pill shows, told to the call: none while the board is a tile, or sinking, when it's out of sight. */
  const [pillShown, setPillShown] = useState<PillKind | null>(null);
  const pillSeen = hidden || sinking ? null : pillShown;
  const toldPill = useRef(onPill);
  toldPill.current = onPill;
  useEffect(() => { toldPill.current?.(pillSeen); }, [pillSeen]);
  useEffect(() => () => toldPill.current?.(null), []);

  return (
    <div ref={wrap} className={sinking ? 'ic-board is-sinking' : 'ic-board'} hidden={hidden} inert={sinking || undefined}>
      <BoardPresenter presenting={parts}>
        <BoardSurface ref={ref} doc={session.doc} awareness={session.awareness} mode={mode} name={shown} naming={nameField} slide={slide} still={presenting} faded={watching && fading}
          seal={seal.seal} sealIcon={seal.icon} sealTitle={seal.title} everyone={everyone} people={people} talking={talking} pictures={pictures} fresh={fresh} landing={landing} theme={theme} run={run} pill={pill} onPill={setPillShown}
          upload={upload} workspace={workspace} links={links} link={link} comments={comments}
          onName={() => setPop((p) => (p === 'title' ? null : 'title'))} onSeal={() => setPop((p) => (p === 'seal' ? null : 'seal'))}
          onPresent={phone ? undefined : onPresent} onLook={watching ? () => theirs?.onWatch(false) : undefined} onFollow={onFollow} onSay={onSay} onSort={role === 'edit' ? onSort : undefined}>
          {pop === 'title' && <NamePop menu={menu} onPick={pick} onClose={() => setPop(null)} from={nameButton} />}
          {pop === 'seal' && <SealPop seal={seal} onClose={() => setPop(null)} from={sealButton} />}
          {pop === 'share' && menu.share && <SharePop sheet={menu.share()} onClose={() => setPop(null)} from={nameButton} />}
          {/* Ideas from the call are for working on the board, so they wait while it's presented. */}
          {role === 'edit' && ideas && mode !== 'present' && (ideas.tray
            ? <IdeasTray ideas={{ ...ideas, tray: ideas.tray }} onDone={toSheet} />
            : ideas.waiting > 0 && <BoardHeard count={ideas.waiting} onOpen={ideas.open} />)}
        </BoardSurface>
      </BoardPresenter>
    </div>
  );
});

export interface CallBoardTileProps {
  session: DocSession;
  /** Whoever opened it, in the arch beside its name. */
  person: AvatarPerson;
  /** What the tile says: whose board it is. */
  name: string;
  /** What pressing it does. */
  label: string;
  /** The room it has. */
  width: number;
  height: number;
  /** The smaller one above the tiles beside a share shown big. */
  compact: boolean;
  pictures: BoardPictures;
  /** Each link's name for you, as on the board itself. */
  links: BoardLinks;
  theme: 'light' | 'dark';
  onOpen: () => void;
}

/** The size a tile draws the board at before shrinking it: the canvas's board on a call's stage. */
const TILE_W = 1114;

/** The board as a live tile: a picture of all of it, kept up to date, that brings it back when pressed. */
export function CallBoardTile({ session, person, name, label, width, height, compact, pictures, links, theme, onOpen }: CallBoardTileProps) {
  const scale = width > 0 ? width / TILE_W : 1;
  const h = Math.max(1, Math.round(height / scale));
  return (
    <BoardTile person={person} name={name} label={label} w={TILE_W} h={h} scale={scale} compact={compact} onOpen={onOpen} style={{ width, height }}>
      <BoardSurface doc={session.doc} awareness={session.awareness} mode="tile" pictures={pictures} links={links} theme={theme} />
    </BoardTile>
  );
}
