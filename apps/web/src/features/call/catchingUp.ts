/*
 * Catching up during a call, as this screen keeps it: what you've asked and what came back, what questions read
 * (the range), what you can catch up on (the window), the transcript moment you opened, and where the panel was
 * before you started, so Back to live returns to it. Your own view of the call (pins, layout, sizes) is never touched.
 * Nothing here is sent to anyone else or kept anywhere: it goes with the page.
 */
import { errorMessage, type CallSession, type CatchUpRange, type CatchUpWindow, type TranscriptMoment } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { timeZone } from '~/lib/time';
import { WHOLE_CALL, likelyMissed, type AskScope, type Asked, type Moment } from './CatchUp';
import type { PanelView } from './Panel';

const clog = log.child({ component: 'catch-up' });

/** "45 seconds", "1 minute", "12 minutes". */
const howLong = (s: number) => (s < 60 ? `${Math.round(s)} seconds` : `${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? '' : 's'}`);

export interface CatchingUp {
  asks: Asked[];
  range: CatchUpRange;
  window: CatchUpWindow | null;
  moment: Moment | null;
  /** You came to the panel to catch up, from the call: Back to live returns you to where you were. */
  catching: boolean;
  /** What questions read now: this call, or the earlier calls whose notes you have. */
  scope: AskScope;
  setScope(s: AskScope): void;
  setRange(r: CatchUpRange): void;
  refreshWindow(): void;
  /** Catches you up on `range`, or on what you most likely missed. */
  catchUp(range?: CatchUpRange | undefined): void;
  ask(question: string): void;
  /** Asks across earlier calls in the series, from `held`, the notes you have from them now. */
  askEarlier(question: string, held: string[]): void;
  /** Opens the transcript at a moment a catch-up or an answer pointed at. */
  open(e: TranscriptMoment): void;
  /** Back to the call as it is now: the moment closes and the panel goes back to how it was before you caught up. */
  backToLive(): void;
  /** You moved around the panel yourself: no moment, and no way back to offer. */
  settle(): void;
}

/** `room`: the breakout room you're in, if any, whose lines alone catching up reads there. */
export function useCatchingUp(session: CallSession, o: { panel: PanelView | null; setPanel: (v: PanelView | null) => void; narrow: boolean; everOn: boolean; room: string | null }): CatchingUp {
  const toast = useToast();
  const [asks, setAsks] = useState<Asked[]>([]);
  const [range, setRange] = useState<CatchUpRange>(WHOLE_CALL);
  const [win, setWin] = useState<CatchUpWindow | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [before, setBefore] = useState<PanelView | 'closed' | null>(null);
  const [scope, setScope] = useState<AskScope>('call');
  const id = useRef(0);

  const refreshWindow = useCallback(() => {
    session.catchUpWindow().then(setWin, (e: unknown) => clog.warn('catch-up window not read', { err: e }));
  }, [session]);
  useEffect(() => { refreshWindow(); }, [refreshWindow]);

  /** Remembers where the panel was, the first time you leave it to catch up. */
  const leaving = () => setBefore((b) => b ?? o.panel ?? 'closed');
  const failed = (what: string, n: number) => (e: unknown) => {
    clog.warn(`${what} failed`, { err: e });
    setAsks((a) => a.map((x) => (x.id === n ? { ...x, error: errorMessage(e) } : x)));
  };

  const run = (r: CatchUpRange) => {
    const n = ++id.current;
    setRange(r);
    setAsks((a) => [...a, { id: n, kind: 'catch-up', range: r, room: o.room, c: null, error: null }]);
    session.catchUp(r).then((c) => setAsks((a) => a.map((x) => (x.id === n && x.kind === 'catch-up' ? { ...x, c } : x))), failed('catch-up', n));
  };
  const catchUp = (r?: CatchUpRange | undefined) => {
    if (o.panel !== 'ask') leaving();
    setMoment(null);
    o.setPanel('ask');
    if (r) { run(r); return; }
    // What you most likely missed depends on now: learn the window again first.
    session.catchUpWindow().then((w) => { setWin(w); run(likelyMissed(w)); }, () => run(likelyMissed(win)));
  };
  const ask = (question: string) => {
    const n = ++id.current;
    const r = range;
    setAsks((a) => [...a, { id: n, kind: 'question', q: question, range: r, room: o.room, a: null, error: null }]);
    session.askSoFar(question, r).then((answer) => setAsks((a) => a.map((x) => (x.id === n && x.kind === 'question' ? { ...x, a: answer } : x))), failed('question during a call', n));
  };
  const askEarlier = (question: string, held: string[]) => {
    const n = ++id.current;
    setAsks((a) => [...a, { id: n, kind: 'earlier', q: question, held, parts: null, error: null }]);
    session.askEarlier(question, timeZone()).then((parts) => setAsks((a) => a.map((x) => (x.id === n && x.kind === 'earlier' ? { ...x, parts } : x))), failed('question about earlier calls', n));
  };
  const open = (e: TranscriptMoment) => {
    leaving();
    setMoment({ evidence: e, found: null, error: null });
    o.setPanel('transcript');
    // Opening it asks the server, which checks again what you may read.
    session.moment(e.lineId).then(
      (found) => setMoment((m) => (m?.evidence.lineId === e.lineId ? { ...m, found } : m)),
      (err: unknown) => { clog.warn('transcript moment not opened', { err }); setMoment((m) => (m?.evidence.lineId === e.lineId ? { ...m, error: errorMessage(err) } : m)); }
    );
  };
  const backToLive = () => {
    setMoment(null);
    const was = before;
    setBefore(null);
    // On a phone the panel covers the call; elsewhere it goes back to what it showed (the transcript following along
    // again, if that was it), unless it was the Ask view you were catching up in.
    o.setPanel(o.narrow || was === null || was === 'closed' || was === 'ask' ? null : was);
  };
  const settle = () => { setMoment(null); setBefore(null); };
  // However the panel moves on (Escape, its own buttons), a moment shows only in the transcript view, and a closed
  // panel has no way back to offer.
  useEffect(() => {
    if (o.panel !== 'transcript') setMoment(null);
    if (o.panel === null) setBefore(null);
  }, [o.panel]);

  /*
   * Coming back after time away, or joining late: offered once, as a toast, decided by the first window read when the
   * screen opens, and not at all when notes have never been on. Guests can't read what was said then.
   */
  const latest = useRef(catchUp);
  latest.current = catchUp;
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || !win) return;
    offered.current = true;
    if (!o.everOn || win.here !== null) return;
    if (win.away && win.now - win.away.to < 60 && win.away.to - win.away.from >= 20) {
      toast(`You were away for ${howLong(win.away.to - win.away.from)}`, { icon: 'history', ms: 12_000, action: { label: 'Catch up', onClick: () => latest.current({ kind: 'away' }) } });
    } else if (win.joined >= 120 && win.now - win.joined < 60) {
      toast(`The call started ${howLong(win.joined)} before you joined`, { icon: 'history', ms: 12_000, action: { label: 'Catch up', onClick: () => latest.current({ kind: 'before-joined' }) } });
    }
  }, [win, o.everOn, toast]);

  return { asks, range, window: win, moment, catching: before !== null, scope, setScope, setRange, refreshWindow, catchUp, ask, askEarlier, open, backToLive, settle };
}
