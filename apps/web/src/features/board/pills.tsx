/*
 * The one pill at the top of a board. Everything the whole board shares goes in it, and only one shows at a time, the most
 * pressing first: how the board stands when that needs saying (Reconnecting, Couldn't save), a vote under way, a vote's results, the rooms closing, following someone, the timer, then the room you're in. Each pill is built by
 * whatever it's about; this alone decides which shows, and says which kind that is to whatever needs to know, so whoever adds a
 * kind adds it here and nowhere else.
 */
import { BoardPill } from '@alcove/ui';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { BoardPerson } from './BoardSurface';
import type { Standing } from './standing';

/** What can be in the pill, the most pressing first. */
export const PILL_ORDER = ['standing', 'voting', 'results', 'closing', 'following', 'timer', 'room'] as const;
export type PillKind = (typeof PILL_ORDER)[number];
/** The pills there are now, by kind. Only the first in `PILL_ORDER` shows. */
export type Pills = Partial<Record<PillKind, ReactNode>>;
/** What the call puts in the board's pill itself: how the board stands, and the rooms' time. The board's own run and following are the board's. */
export type CallPills = Pick<Pills, 'standing' | 'closing' | 'room'>;

/** How the board stands, while that needs saying: Reconnecting, or Couldn't save with Try again (`standingOf`). */
export function StandingPill({ pill }: { pill: NonNullable<Standing['pill']> }) {
  return <BoardPill icon={pill.icon} title={pill.title} text={pill.text} action={pill.action?.label} onAction={pill.action?.run} />;
}

/** Following someone: whose view this is, with the way back to your own. */
export function FollowingPill({ person, onStop }: { person: BoardPerson; onStop: () => void }) {
  return <BoardPill icon="eye" title={`Following ${person.name}`} action="Stop" onAction={onStop} />;
}

/** Time left in the rooms, as the rooms show it: 4:12. */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** The rooms as the board shows them: the room you're in (null in the main room), how many there are, whether they share the main board, and seconds left. */
export interface RoomsNow { name: string | null; rooms: number; shared: boolean; left: number }
/**
 * The rooms' time on a board, in its one pill, in the canvas's words: the room you're in and how long it has left, and in the
 * main room, on the one board every room shares, how many rooms are on it. On that shared board a room's pill says everyone
 * can see it, since it isn't private. In the last minute it's amber, and a room's own board says it comes back with you; in
 * the last ten seconds, that rooms close, counting down. The time changes on screen only: a screen reader is told twice, at
 * ten seconds and as they close, never each second. Nothing for the main room's own board while rooms have boards of their own.
 */
export function roomPills(now: RoomsNow | null): CallPills {
  if (!now) return {};
  const title = now.name ?? (now.shared ? `${now.rooms} ${now.rooms === 1 ? 'room' : 'rooms'} on this board` : null);
  if (title === null) return {};
  const left = Math.ceil(Math.max(0, now.left));
  const soon = left <= 60;
  const text = left <= 0 ? 'Rooms are closing' : left <= 10 ? `Rooms close in ${left} ${left === 1 ? 'second' : 'seconds'}`
    : now.name !== null && now.shared ? 'Everyone can see this board'
    : soon && now.name !== null ? 'This board comes back with you' : undefined;
  const said = left > 10 ? '' : left <= 0 ? 'Rooms are closing.' : 'Rooms close in 10 seconds.';
  const pill = <BoardPill icon="door" title={title} text={text} time={mmss(left)} soon={soon} said={said} />;
  return soon ? { closing: pill } : { room: pill };
}

/**
 * Whichever pill matters most now, or nothing. `onShown` hears which kind that is as it changes, and null once none shows,
 * before anything round it is laid out: so a board frames itself clear of a pill from the first, and the call keeps the rooms
 * line over it unless the pill is the one saying the rooms.
 */
export function BoardPills({ pills, onShown }: { pills: Pills; onShown?: ((kind: PillKind | null) => void) | undefined }) {
  const kind = PILL_ORDER.find((k) => pills[k] !== undefined && pills[k] !== null && pills[k] !== false) ?? null;
  const told = useRef(onShown);
  told.current = onShown;
  useLayoutEffect(() => { told.current?.(kind); }, [kind]);
  useLayoutEffect(() => () => told.current?.(null), []);
  return kind ? pills[kind] : null;
}
