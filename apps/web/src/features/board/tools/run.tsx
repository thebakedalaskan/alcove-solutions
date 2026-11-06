/*
 * Running the session: the bar's Timer and Vote, what they put in the pill at the top of the board, and a vote's dots and
 * counts on the stickies. They're the call's, not the board's, so the call hands them in (`BoardRun`), the same for everyone
 * in that part of it, and says what pressing does. Nobody's browser is told a count before a vote ends, so until then all a
 * vote draws here is this person's own dots.
 */
import { errorMessage } from '@alcove/api';
import { contains, type BoardView, type Box, type FrameObject } from '@alcove/board';
import { BoardPill, BoardPop } from '@alcove/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Pills } from '../pills';
import { CLEAR, useBoardState, type Board } from '../useBoard';

/** How long a timer runs, in minutes, and how many votes each a vote gives: the canvas's three of each. */
export const TIMER_MINUTES = [3, 5, 10] as const;
export const VOTES_EACH = [3, 5, 10] as const;
export type TimerMinutes = (typeof TIMER_MINUTES)[number];
export type VotesEach = (typeof VOTES_EACH)[number];

/** The call's timer on this board. */
export interface RunTimer {
  /** When it runs out, on this browser's clock (ms since the epoch). */
  endsAt: number;
  /** How long it was set for. */
  minutes: number;
  /** What it's for, beside the time. */
  text: string;
  /** This person can stop it, and start it over while it runs. */
  canStop: boolean;
}
/** The call's vote on this board, as this person is told it: their own votes, and every count once it's ended. */
export interface RunVote {
  /** Votes can be cast. False once it's ended, with the counts, until it's cleared. */
  on: boolean;
  /** The frame it's on, or null for every sticky on the board. */
  frame: string | null;
  per: number;
  mine: readonly string[];
  results: Readonly<Record<string, number>>;
  voters: number;
  /** This person can end it, and clear it after. */
  canEnd: boolean;
}
/** What the call runs on a board, and what pressing does. Each resolves once the call has it, and a refusal says why. */
export interface BoardRun {
  timer: RunTimer | null;
  vote: RunVote | null;
  startTimer(minutes: TimerMinutes): Promise<void>;
  stopTimer(): Promise<void>;
  startVote(frame: string | null, per: VotesEach): Promise<void>;
  castVote(sticky: string): Promise<void>;
  takeBackVote(sticky: string): Promise<void>;
  endVote(): Promise<void>;
  clearVote(): Promise<void>;
}

/* ---------- what a vote is on, and what it puts on the stickies ---------- */

/** Whether a vote on `frame` takes this: a sticky inside it however deep, or with no frame any sticky. The server decides the same. */
export function inVote(view: BoardView, frame: string | null, id: string): boolean {
  const o = view.byId.get(id);
  if (o?.k !== 'note') return false;
  if (frame === null) return true;
  let at = o.f;
  for (let left = view.frames.length; at !== frame && at !== '' && left > 0; left -= 1) at = view.byId.get(at)?.f ?? '';
  return at === frame;
}

/** Whether `a` comes before `b` reading a board: row by row, a row being boxes that overlap by at least half the shorter one's height, and left to right along each. */
const reading = (a: Box, b: Box): number => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y);

/**
 * The stickies a vote on `frame` takes, in the order Tab goes through them: frame by frame, as the board's outermost frames are
 * read, then any in no frame, and each frame's row by row.
 */
export function voteOrder(view: BoardView, frame: string | null): readonly string[] {
  const outermost = (f: string): string => {
    let at = f;
    for (let left = view.frames.length; left > 0; left -= 1) {
      const up = view.byId.get(at)?.f ?? '';
      if (!up) break;
      at = up;
    }
    return at;
  };
  const groups = new Map<string, (Box & { id: string })[]>();
  for (const o of view.objects) {
    if (o.k !== 'note' || !inVote(view, frame, o.id)) continue;
    const by = o.f ? outermost(o.f) : '';
    const held = groups.get(by);
    if (held) held.push(o);
    else groups.set(by, [o]);
  }
  const frames = view.frames.filter((f) => groups.has(f.id)).sort(reading);
  return [...frames.map((f) => f.id), ''].flatMap((g) => [...(groups.get(g) ?? [])].sort(reading).map((o) => o.id));
}

const NOTHING: ReadonlySet<string> = new Set();
const NO_COUNTS: Readonly<Record<string, number>> = {};
/** What a vote puts on the stickies: your own dots while it's on; once it's ended, everyone's counts, the most voted staying bright and the rest stepping back. */
export interface VoteMarks { dots: ReadonlySet<string>; counts: Readonly<Record<string, number>>; top: ReadonlySet<string>; muted: ReadonlySet<string> }
/** How many of the most voted stay bright. Ties at the last place stay too, so nobody's sticky dims beside one with as many votes. */
const TOP = 3;
export function voteMarks(view: BoardView, vote: RunVote | null, mine: ReadonlySet<string>): VoteMarks | null {
  if (!vote) return null;
  if (vote.on) return { dots: mine, counts: NO_COUNTS, top: NOTHING, muted: NOTHING };
  const count = (id: string): number => vote.results[id] ?? 0;
  const taken = view.objects.flatMap((o) => (inVote(view, vote.frame, o.id) ? [o.id] : []));
  const voted = taken.filter((id) => count(id) > 0).sort((a, b) => count(b) - count(a));
  const last = voted[Math.min(TOP, voted.length) - 1];
  const top = new Set(last === undefined ? [] : voted.filter((id) => count(id) >= count(last)));
  // With nobody voting, nothing steps back.
  const muted = new Set(top.size ? taken.filter((id) => !top.has(id)) : []);
  return { dots: NOTHING, counts: vote.results, top, muted };
}

/* ---------- your votes, as you press them ---------- */

/** Your votes as you see them: the call's, with what you've just pressed that the call hasn't answered yet, and what that leaves. */
export interface Ballot { mine: ReadonlySet<string>; left: number }
interface Pending { cast: boolean; n: number }
const NO_PENDING: ReadonlyMap<string, Pending> = new Map();

/**
 * Your ballot while a vote is on, and what a press on a sticky does: a dot at once, then the call's answer. Your presses go to
 * the call one after another, so a vote and its taking back arrive in the order you made them. A press with no votes left does
 * nothing, as in the canvas. `editable`: this person can edit the board, which voting needs.
 */
export function useBallot(board: Board, run: BoardRun | undefined, editable: boolean): Ballot {
  const vote = run?.vote ?? null;
  const [pending, setPending] = useState<ReadonlyMap<string, Pending>>(NO_PENDING);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sent = useRef(0);
  const ballot = useMemo((): Ballot => {
    const mine = new Set(vote?.on ? vote.mine : []);
    for (const [id, p] of pending) {
      if (p.cast) mine.add(id);
      else mine.delete(id);
    }
    return { mine, left: vote?.on ? Math.max(0, vote.per - mine.size) : 0 };
  }, [vote, pending]);

  useLayoutEffect(() => {
    if (!run || !vote?.on || !editable) {
      board.ballot = null;
      return undefined;
    }
    const { frame } = vote;
    const settled = (id: string, n: number) => setPending((was) => {
      if (was.get(id)?.n !== n) return was;
      const next = new Map(was);
      next.delete(id);
      return next;
    });
    board.ballot = {
      takes: (id) => inVote(board.getSnapshot().view, frame, id),
      order: () => voteOrder(board.getSnapshot().view, frame),
      press: (id) => {
        const cast = !ballot.mine.has(id);
        if (cast && ballot.left <= 0) return;
        const n = ++sent.current;
        setPending((was) => new Map(was).set(id, { cast, n }));
        const send = () => (cast ? run.castVote(id) : run.takeBackVote(id));
        const going = queue.current.then(send, send);
        queue.current = going.catch(() => undefined);
        going.catch((e: unknown) => board.tell(errorMessage(e))).finally(() => settled(id, n));
      }
    };
    return () => { board.ballot = null; };
  }, [board, run, vote, ballot, editable]);
  return ballot;
}

/* ---------- the pill ---------- */

/** The last minute of a timer turns the pill amber, as a room's does in its last minute. */
const SOON_S = 60;
/** The time as the pill shows it: 4:59. */
const minutesAndSeconds = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const votesLeft = (left: number, per: number): string => `${left} of ${per} votes left`;
const voted = (n: number): string => (n === 0 ? 'Nobody voted' : n === 1 ? '1 person voted' : `${n} people voted`);

/**
 * Whole seconds until `endsAt`. It's read from the clock as it draws, so a timer that starts long after this mounted shows its
 * own time from the first frame; the state only draws it again as each second goes.
 */
function useSecondsLeft(endsAt: number): number {
  const [, setSecond] = useState(0);
  useEffect(() => {
    let wait: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      const ms = endsAt - Date.now();
      setSecond(Math.ceil(ms / 1000));
      if (ms > 0) wait = setTimeout(tick, (ms % 1000 || 1000) + 5);
    };
    tick();
    return () => clearTimeout(wait);
  }, [endsAt]);
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

/** Does what the pill's button says. A refusal is said, and the sheet keeps the keys. */
function pressed(board: Board, act: () => Promise<void>): () => void {
  return () => {
    act().catch((e: unknown) => board.tell(errorMessage(e)));
    board.focusSheet();
  };
}

/** A vote that's on: your votes left, if you can vote, and End the vote for whoever can end it. */
function VotingPill({ board, run, vote, left, editable }: { board: Board; run: BoardRun; vote: RunVote; left: number; editable: boolean }) {
  return <BoardPill icon="vote" title="Voting" text={editable ? votesLeft(left, vote.per) : undefined}
    action={vote.canEnd ? 'End the vote' : undefined} onAction={pressed(board, () => run.endVote())} />;
}

/** A vote that's ended: how many voted, with the counts on the stickies, and Done for whoever can clear it. */
function ResultsPill({ board, run, vote }: { board: Board; run: BoardRun; vote: RunVote }) {
  return <BoardPill icon="vote" title="Results" text={voted(vote.voters)} action={vote.canEnd ? 'Done' : undefined} onAction={pressed(board, () => run.clearVote())} />;
}

/**
 * The timer: what it's for and the time left, amber in its last minute, then Time's up. Only this draws again as the seconds go.
 * The time changes on screen only: a screen reader is told with a minute left and as it runs out, never each second, and
 * `TimerSaid` tells it as the timer starts and stops, when this isn't there to.
 */
function TimerPill({ board, run, timer }: { board: Board; run: BoardRun; timer: RunTimer }) {
  const left = useSecondsLeft(timer.endsAt);
  const said = left <= 0 ? 'Time’s up.' : left <= SOON_S ? '1 minute left.' : '';
  return <BoardPill icon="timer" text={left > 0 ? timer.text : 'Time’s up'} time={minutesAndSeconds(left)} soon={left <= SOON_S} said={said}
    action={timer.canStop ? 'Stop' : undefined} onAction={pressed(board, () => run.stopTimer())} />;
}

/**
 * What a screen reader is told as the timer comes and goes, which its pill can't say, being there only while it is: that it
 * started, for how long and what for, each time one does, and that it stopped. This is there before either, under the sheet's
 * pill, so each is read out. Another board coming in says nothing.
 */
export function TimerSaid({ board, timer }: { board: Board; timer: RunTimer | null }) {
  const [heard, setHeard] = useState({ board, timer, said: '' });
  if (heard.board !== board || heard.timer?.endsAt !== timer?.endsAt) {
    const said = heard.board !== board ? '' : timer ? `Timer started: ${timer.minutes} ${timer.minutes === 1 ? 'minute' : 'minutes'}. ${timer.text}.` : 'Timer stopped.';
    // Words are read out as they change, so the same ones again, as another timer like the last starts, end in a space.
    setHeard({ board, timer, said: said !== '' && said === heard.said ? `${said}\u00a0` : said });
  }
  return <p className="sr-only" role="status">{heard.said}</p>;
}

/** What the call's run puts in the board's pill. */
export type RunPills = Pick<Pills, 'voting' | 'results' | 'timer'>;
/**
 * What the call's run puts in the board's pill: a vote that's on, a vote's results, the timer. Which of everything there is
 * shows is `pills.tsx`'s to say. `ballot` has the votes you've just pressed, so what's left says so at once.
 */
export function runPills(board: Board, run: BoardRun | undefined, ballot: Ballot, editable: boolean): RunPills {
  if (!run) return {};
  const { vote, timer } = run;
  return {
    voting: vote?.on ? <VotingPill board={board} run={run} vote={vote} left={ballot.left} editable={editable} /> : undefined,
    results: vote && !vote.on ? <ResultsPill board={board} run={run} vote={vote} /> : undefined,
    timer: timer ? <TimerPill board={board} run={run} timer={timer} /> : undefined
  };
}

/* ---------- the bar's menus ---------- */

/** Where the bar's menus open: under its right end. */
const AT = { right: 14, top: 60 } as const;

/**
 * The frame this person is looking at: the one in the middle of what the sheet shows, so with the whole board in view it's the
 * middle frame, as in the canvas. With nothing there, the one that fills most of the sheet. With frames nested, the outer one,
 * which holds the inner's stickies too: a frame comes before whatever it holds.
 */
function lookingAt(board: Board): FrameObject | null {
  const seen = board.camera.visible();
  const { frames } = board.getSnapshot().view;
  const middle = frames.find((f) => contains(f, seen.x + seen.w / 2, seen.y + seen.h / 2));
  if (middle) return middle;
  let best: FrameObject | null = null, most = 0;
  for (const f of frames) {
    const w = Math.min(f.x + f.w, seen.x + seen.w) - Math.max(f.x, seen.x), h = Math.min(f.y + f.h, seen.y + seen.h) - Math.max(f.y, seen.y);
    const area = w > 0 && h > 0 ? w * h : 0;
    if (area > most) {
      best = f;
      most = area;
    }
  }
  return best;
}

/** A menu that takes focus as it opens, on what's picked in it, and hands it back to the sheet if it goes with focus inside it. */
function useFocusedMenu(board: Board) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const picked = ref.current?.querySelector('[aria-pressed="true"]');
    if (picked instanceof HTMLElement) picked.focus({ preventScroll: true });
    return () => {
      queueMicrotask(() => {
        if (document.activeElement === null || document.activeElement === document.body) board.focusSheet();
      });
    };
  }, [board]);
  return ref;
}

/** Starts something from a menu: the menu closes, the sheet keeps the keys, and a refusal is said. */
function starting(board: Board, start: () => Promise<void>): () => void {
  return () => {
    board.set({ runMenu: null });
    board.focusSheet();
    start().catch((e: unknown) => board.tell(errorMessage(e)));
  };
}

/** Three lengths and Start. No form. */
function TimerMenu({ board, run }: { board: Board; run: BoardRun }) {
  const [minutes, setMinutes] = useState<TimerMinutes>(5);
  const ref = useFocusedMenu(board);
  return (
    <BoardPop ref={ref} {...AT} title="Timer" sub="Everyone sees it count down. It chimes softly at the end."
      options={TIMER_MINUTES.map((m) => ({ id: `${m}`, label: `${m} min`, on: m === minutes, onPick: () => setMinutes(m) }))}
      action={{ label: 'Start', onPick: starting(board, () => run.startTimer(minutes)) }} />
  );
}

/** It votes on the frame you're looking at, and the board glides to it. With no frame in view, it's on every sticky. */
function VoteMenu({ board, run }: { board: Board; run: BoardRun }) {
  const [frame] = useState(() => lookingAt(board));
  const [per, setPer] = useState<VotesEach>(3);
  const ref = useFocusedMenu(board);
  // Clear of the bar and the pill, as the canvas frames what a vote is on.
  useEffect(() => {
    if (!frame) return;
    board.takeCamera();
    board.glideTo(board.camera.fitting(frame, CLEAR));
  }, [board, frame]);
  const name = frame?.title.trim() ?? '';
  return (
    <BoardPop ref={ref} {...AT} title={frame ? (name ? `Vote on ${name}` : 'Vote on this frame') : 'Vote on these stickies'}
      sub={`Everyone gets ${per} votes. Nobody sees the count until you end it.`}
      options={VOTES_EACH.map((n) => ({ id: `${n}`, label: `${n} votes`, on: n === per, onPick: () => setPer(n) }))}
      action={{ label: 'Start the vote', onPick: starting(board, () => run.startVote(frame?.id ?? null, per)) }} />
  );
}

/** The bar's Timer and Vote menus, while one is open and the view is this person's own. */
export function RunMenus({ board, run }: { board: Board; run: BoardRun }) {
  const menu = useBoardState(board, (s) => s.runMenu);
  const following = useBoardState(board, (s) => s.following !== null);
  if (!menu || following) return null;
  return menu === 'timer' ? <TimerMenu board={board} run={run} /> : <VoteMenu board={board} run={run} />;
}
