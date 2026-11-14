/*
 * The call's area: the main area, where the people and what's open on your stage are (Stage.tsx and frame.tsx, placed by
 * panels.ts), and your side at its right. Your side shows one view at a time at a fixed width, sliding in as the main area
 * makes room for it. While the people stand beside what's open, they keep the window's right edge, and your side opens left of
 * them, fading in where it lands rather than sliding in over them. Where the stage would be too narrow beside it, it slides in over the stage instead, which dims behind it
 * as a phone's call does, and a press on the stage puts it away; the top bar and the dock stay as they are. On a phone it's a
 * sheet over the whole call, which keeps the keys while it's up: Tab goes round what's in it.
 *
 * What's open on your stage comes before the people in the page, so Tab reaches it first; it's drawn over them either way.
 */
import { ThemeScope, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { GAP, focusRoom, peopleEdge, placeMain, type FocusBounds, type Size } from './panels';
import { SIDE_MIN_HEIGHT, STAGE_BESIDE_SIDE, sideWidth, type SideView } from './side';
import type { CallView } from './view';
import { screenOf, type ThingId } from '../stage/onStage';
import { GLIDE, useStagePlan, type StageParticipant, type StageShare, type StageWaiter } from '../stage/Stage';
import type { Box, StageFrame } from '../stage/stageLayout';

/** Your side coming in from the right edge, or going back there; on a phone, rising over the call. */
const SLIDE = { duration: 0.38, ease: [0.45, 0, 0.2, 1] } as const;
const at = (r: Box) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** What your side (`side`) and the people (`edge`) take at the window's right edge, for toasts to keep to the stage left of them (call.css). */
export function useToastsKeepLeft(side: number, edge: number): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ic-right', `${side + GAP + edge}px`);
    return () => { root.style.removeProperty('--ic-right'); };
  }, [side, edge]);
}

/** The call's area, as it's measured. */
export function useCallArea() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

/** Where the call's area sits in the window, and the line just under the dock: what focus reaches past the bars to. */
export function useFocusBounds(area: RefObject<HTMLDivElement | null>, bar: RefObject<HTMLElement | null>, size: Size): FocusBounds {
  const [h, setH] = useState<FocusBounds>({ base: 0, top: 0, left: 0 });
  useLayoutEffect(() => {
    const a = area.current;
    const b = bar.current;
    if (!a || !b) return;
    const read = () => {
      const top = a.getBoundingClientRect();
      const next = { base: Math.round(b.getBoundingClientRect().bottom - top.top - 10), top: Math.round(top.top), left: Math.round(top.left) };
      setH((was) => (was.base === next.base && was.top === next.top && was.left === next.left ? was : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(b);
    return () => ro.disconnect();
  }, [area, bar, size]);
  return h;
}

/** Your side, as the area shows it. */
export interface HostSide {
  /** Which view it shows: a change of view keeps the side where it is, and changes what's in it. */
  view: string;
  /** What it's called, for the side itself and for putting it away. */
  label: string;
  width: number;
  /** A phone: it's a sheet over the call, with the call dimmed behind it. */
  phone: boolean;
  /** The stage would be too narrow beside it: it sits over the stage at the right, which keeps its width and dims under it. */
  over: boolean;
  /** Your theme, which the side follows while the call around it stays night. */
  theme: 'light' | 'dark';
  /** Room the people keep at the window's right edge while they stand beside what's open: your side stands left of it. */
  edge: number;
  onClose: () => void;
  children: ReactNode;
}

export function PanelHost({ area, size, tiles, frames, side, swap }: {
  /** The call's area and its size (`useCallArea`). */
  area: RefObject<HTMLDivElement | null>;
  size: Size;
  /** The one layer of people and what's presented as tiles. */
  tiles: ReactNode;
  /** What's open on your stage, each in its frame. */
  frames: ReactNode;
  /** Your side, while it shows something. */
  side: HostSide | null;
  /** On a phone, what's showing when two things take turns: it sits under the row of arches. */
  swap?: ReactNode;
}) {
  const reduce = useReducedMotion();
  // Nothing is placed until the area has been measured, which is before the first paint: at no size at all, everything would start from a corner.
  const measured = useRef(false);
  if (size.w > 0) measured.current = true;
  const slide = reduce ? { duration: 0 } : GLIDE;

  /* Your side: at the right of the area, the main area having made room, or on a phone a sheet risen over the call. */
  const sideBox: Box = { x: size.w - (side?.width ?? 0) - (side?.edge ?? 0), y: 0, w: side?.width ?? 0, h: size.h };
  /*
   * A sheet over the call takes the keys as it rises, and as it changes what it shows: what's under it can't be reached. Beside
   * the stage, your side takes them when what it shows changes under them (from inside it, where what had them is going), or
   * left them nowhere; keys anywhere else stay.
   */
  const sheet = useRef<HTMLElement>(null);
  const view = side?.view ?? null;
  const onPhone = side?.phone === true;
  useEffect(() => {
    if (!view) return;
    const at = document.activeElement;
    // An exact validated notification target has already taken focus in the mounted panel. Keep that row selected.
    if (at instanceof Element && sheet.current?.contains(at) && at.closest('[data-call-action]')) return;
    const lost = at === null || at === document.body;
    if (onPhone || lost || (at !== sheet.current && sheet.current?.contains(at))) sheet.current?.focus({ preventScroll: true });
  }, [view, onPhone]);
  /** Tab and Shift+Tab go round what's in the phone's sheet, never out to the call behind it. */
  const keepKeys = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !onPhone) return;
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')]
      .filter((el) => el.getClientRects().length > 0 && el.closest('[inert]') === null);
    const first = all[0];
    const last = all.at(-1);
    const at = document.activeElement;
    if (!first || !last) { e.preventDefault(); return; }
    if (e.shiftKey && (at === first || at === e.currentTarget)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  // With the people at the window's edge, your side fades in where it lands, beside them, rather than sliding in over them.
  const away = reduce ? { opacity: 0 } : side?.phone ? { y: '100%' } : side?.edge ? { opacity: 0, x: 28 } : { x: sideBox.w + 40 };
  const here = side?.phone ? { opacity: 1, y: 0 } : { ...at(sideBox), opacity: 1, x: 0 };
  return (
    <div ref={area} className="ic-main">
      {measured.current && frames}
      {measured.current && tiles}
      {swap && <div className="ic-swapbar">{swap}</div>}
      <AnimatePresence>
        {measured.current && (side?.phone || side?.over) && (
          <motion.div key={side.phone ? 'scrim' : 'dim'} className={cn('ic-scrim', !side.phone && 'is-over')} aria-hidden="true" onClick={side.onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.24 }} />
        )}
        {measured.current && side && (
          <motion.aside key={side.phone ? 'sheet' : 'side'} ref={sheet} tabIndex={-1} onKeyDown={keepKeys} className={cn('ic-side', side.theme, side.phone && 'is-sheet', side.over && !side.phone && 'is-over')} aria-label={side.label} data-view={side.view}
            initial={side.phone ? away : { ...at(sideBox), ...away }} animate={here} exit={away}
            transition={reduce ? { duration: 0 } : side.phone ? SLIDE : { ...slide, x: SLIDE }}>
            <ThemeScope theme={side.theme}>{side.children}</ThemeScope>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The main area (panels.ts): what's on your stage, each in its frame, and the people beside it. The people beside what's open keep
 * the window's right edge, your side takes its width left of them, and the main area makes room for both; in a narrow window your
 * side sits over the stage. Once the call is over for this tab (`over`: it ended, or you're leaving), nothing's open on it: the
 * workspace goes at once, its streams closing and no longer saying where you are, while its page says what happened.
 */
export function useMainArea({ width, phone, focus, side, timer, bar, caption, held, on, over, people, unit, waiting, tiles, spotlight, view, front }: {
  width: number;
  phone: boolean;
  /** What's open fills your window. */
  focus: boolean;
  side: SideView | null;
  /** Timer for everyone is on offer: in focus it owns a strip above the frame. */
  timer: boolean;
  /** The status bar has something to say, over the stage. */
  bar: boolean;
  /** Captions are on, under the stage. */
  caption: boolean;
  /** The organizer's stage shows every room. */
  held: boolean;
  /** What's on your stage. */
  on: readonly ThingId[];
  over: boolean;
  people: StageParticipant[];
  /** Who's in your part of the call while rooms are open. */
  unit: readonly string[] | null;
  waiting: StageWaiter[];
  tiles: readonly { id: ThingId }[];
  spotlight: string | null;
  view: CallView;
  /** Two on your stage with no room for both take turns: the one you brought to the front. */
  front: ThingId | null;
}) {
  const callArea = useCallArea();
  const size = callArea.size;
  const dock = useRef<HTMLElement>(null);
  const bounds = useFocusBounds(callArea.ref, dock, size);
  const reduce = useReducedMotion();
  const shownThings = over ? [] : on;
  /*
   * Beside what's open the people stand at the window's right edge: a column, or made smaller a rail (panels.ts). They come from
   * the call's whole width, so your side opening or closing never moves or resizes them.
   */
  const sideW = sideWidth(width);
  /** Your side is a sheet over the call on a phone, and in a window too short for it between the bars (a phone on its side). */
  const sideSheet = phone || (size.h > 0 && size.h < SIDE_MIN_HEIGHT);
  /** Your side stands beside the stage, if there's room: never as a sheet over the call, nor in focus. */
  const sideWanted = side !== null && !sideSheet && !focus;
  const edge = peopleEdge(size.w, { frames: shownThings.length, phone, focus, rooms: held, small: view.panels.people === 'hidden', side: sideWanted ? sideW + GAP : 0 });
  const edgeRoom = edge ? edge.w + GAP : 0;
  /*
   * Your side opens between what's open and the people, and what's open makes room for it. Where that would leave the stage
   * too narrow, it sits over the stage instead, left of the people, rather than squeeze it. While it's over what's on your
   * stage, choosing something there (or the call showing you something there) puts it away.
   */
  const sideOver = !sideSheet && size.w - edgeRoom - (sideW + GAP) < STAGE_BESIDE_SIDE;
  const sideRoom = sideWanted && !sideOver ? sideW + GAP : 0;
  const sideCovers = side !== null && (sideSheet || (sideOver && !focus));
  const mainW = Math.max(0, size.w - sideRoom - edgeRoom);
  /* What your side and the people take at the window's right edge, for toasts to keep to the stage left of them (call.css). */
  useToastsKeepLeft(sideW, edgeRoom);
  /* What your side over the stage leaves clear, at its left: someone asking to join is answered there, never under your side. */
  const clearW = sideOver && side !== null && !focus ? Math.max(0, mainW - (sideW + GAP)) : mainW;
  const top = bar ? 46 : 0;
  const bottom = caption ? (mainW < 700 ? 150 : 124) : 0;
  const focusedRoom = focus ? focusRoom(size, bounds) : null;
  // The shared timer owns a strip above the focused frame, clear of its title and controls.
  const focusToolbarHeight = focus && timer ? 52 : 0;
  const focusBox = focusedRoom ? { ...focusedRoom, y: focusedRoom.y + focusToolbarHeight, h: Math.max(0, focusedRoom.h - focusToolbarHeight) } : null;
  const placed = placeMain({ w: mainW, h: size.h }, { frames: shownThings.length, phone, focus: focusBox, rooms: held, top, bottom, edge });
  /** The organizer's rooms are in sight: on the whole stage, or beside what's open, rather than under it. */
  const roomsShown = placed.rooms !== null;
  /** The seam left of the people at the window's edge (PeopleSeam.tsx): what ⇧P does, to click or drag. Not while your side covers the stage. */
  const seam = held || sideCovers ? null : placed.seam;
  /* While rooms are open, you see the people in your own room (or the main room), and the organizer overseeing them sees every room. */
  const onStage = unit && !roomsShown ? people.filter((p) => unit.includes(p.id)) : people;
  const frontId = placed.turns ? (front && shownThings.includes(front) ? front : shownThings[0] ?? null) : null;
  const boxOf = (id: ThingId): Box | null => {
    const i = shownThings.indexOf(id);
    if (i < 0) return null;
    if (placed.turns) return id === frontId ? placed.frames[0] ?? null : null;
    return placed.frames[i] ?? null;
  };
  const staged = useStagePlan({
    people: onStage, waiting, tiles: tiles.map((t) => t.id), spotlight, view, hold: placed.frames.length > 0,
    narrow: phone || (placed.frames.length === 0 && mainW > 0 && mainW < 760)
  });
  // The stage's speaker is never you: it says who to make room for. The end of the transcript says who's talking.
  const talking = onStage.find((p) => p.id === staged.speaker) ?? onStage.find((p) => p.isMe && p.speaking);
  // Who has a place however little room there is, counting talking as the speaker does (speakers.ts): if every word did, the few places would keep changing hands.
  const loudKey = placed.frames.length ? onStage.filter((p) => p.hand || p.id === staged.speaker).map((p) => p.id).join(' ') : '';
  const placedKey = JSON.stringify([placed.people, placed.mode, placed.frames.length, placed.rooms]);
  const frame = useMemo((): StageFrame => ({
    box: placed.rooms ?? { x: 0, y: 0, w: mainW, h: size.h }, top, bottom,
    panels: placed.frames.length && !roomsShown ? { people: placed.people, mode: placed.mode, loud: new Set(loudKey.split(' ')), small: phone } : null
  }), [mainW, size.h, top, bottom, placedKey, loudKey, phone]);
  return {
    ref: callArea.ref, size, dock, reduce, shownThings, sideW, sideSheet, sideOver, sideCovers, edgeRoom, mainW, clearW, placed, roomsShown, seam, onStage, frontId, boxOf, staged, talking, frame,
    /** The people beside what's open are a rail of arches. */
    peopleSmall: view.panels.people === 'hidden',
    /** The workspace is on your stage and in sight: what's clear starts at its left, so its list has the bottom left of it. */
    wsInSight: boxOf('ws') !== null
  };
}

/** Two on your stage with no room for both take turns, and this says which is showing. Where your side covers them, choosing one puts it away. */
export function TakingTurns({ things, front, covered, shares, onPick }: { things: readonly ThingId[]; front: ThingId | null; covered: boolean; shares: readonly StageShare[]; onPick: (id: ThingId) => void }) {
  const nameOf = (id: ThingId) => (id === 'ws' ? 'Workspace' : id === 'board' || id === 'saved' ? 'Board' : shares.find((x) => screenOf(x.id) === id)?.name ?? 'Shared screen');
  return (
    <div className="ic-swap" role="group" aria-label="What’s showing">
      {things.map((id) => <button key={id} type="button" aria-pressed={!covered && front === id} onClick={() => onPick(id)}>{nameOf(id)}</button>)}
    </div>
  );
}
