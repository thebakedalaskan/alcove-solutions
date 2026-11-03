/*
 * Notes as the call goes: what's been decided, who's doing what, and where the conversation is,
 * read from the live transcript in confidential compute (CallSession.catchUp over the whole call).
 * They're refreshed when new lines have arrived, at most every half a minute, and only while
 * someone is looking. The notes everyone gets are written when the call ends.
 */
import { errorMessage, type CallSession, type CatchUp } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';

const nlog = log.child({ component: 'live-notes' });
const EVERY_MS = 30_000;

export interface LiveNotes { notes: CatchUp | null; writing: boolean; error: string | null }

export function useLiveNotes(session: CallSession, lines: number, on: boolean, watching: boolean): LiveNotes {
  const [notes, setNotes] = useState<CatchUp | null>(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useRef({ lines: 0, at: 0, busy: false });
  const [wake, setWake] = useState(0);

  useEffect(() => {
    if (!on || !watching || !lines) return;
    const r = read.current;
    if (r.busy || lines <= r.lines) return;
    const wait = r.at + EVERY_MS - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setWake((n) => n + 1), wait);
      return () => clearTimeout(t);
    }
    r.busy = true;
    setWriting(true);
    const upTo = lines;
    session.catchUp(undefined).then((c) => {
      setNotes(c); setError(null);
      read.current = { lines: upTo, at: Date.now(), busy: false };
    }, (e: unknown) => {
      nlog.warn('live notes not refreshed', { err: e, lines: upTo });
      setError(errorMessage(e));
      read.current = { ...read.current, at: Date.now(), busy: false };
    }).finally(() => { setWriting(false); setWake((n) => n + 1); });
    return undefined;
  }, [session, lines, on, watching, wake]);

  return { notes, writing, error };
}
