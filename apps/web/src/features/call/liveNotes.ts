/*
 * Notes as the call goes: what's been decided, who's doing what, and where the conversation is,
 * read from the live transcript in confidential compute (CallSession.catchUp over the whole call).
 * They're refreshed when a new line has arrived, at most every half a minute, and only while
 * someone is looking. The notes everyone gets are written when the call ends.
 */
import { errorMessage, type CallSession, type CatchUp } from '@alcove/api';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';

const nlog = log.child({ component: 'live-notes' });
const EVERY_MS = 30_000;

export interface LiveNotes { notes: CatchUp | null; writing: boolean; error: string | null }

/**
 * `newest` is the newest live transcript line's ID: a new one means there's more to read. (The live transcript
 * carries only the newest lines, so how many there are stops changing in a long call.)
 */
export function useLiveNotes(session: CallSession, newest: string | undefined, on: boolean, watching: boolean): LiveNotes {
  const [notes, setNotes] = useState<CatchUp | null>(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useRef<{ newest: string | undefined; at: number; busy: boolean }>({ newest: undefined, at: 0, busy: false });
  const [wake, setWake] = useState(0);

  useEffect(() => {
    if (!on || !watching || !newest) return;
    const r = read.current;
    if (r.busy || newest === r.newest) return;
    const wait = r.at + EVERY_MS - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setWake((n) => n + 1), wait);
      return () => clearTimeout(t);
    }
    r.busy = true;
    setWriting(true);
    const upTo = newest;
    session.catchUp({ kind: 'all' }).then((c) => {
      setNotes(c); setError(null);
      read.current = { newest: upTo, at: Date.now(), busy: false };
    }, (e: unknown) => {
      nlog.warn('live notes not refreshed', { err: e });
      setError(errorMessage(e));
      read.current = { ...read.current, at: Date.now(), busy: false };
    }).finally(() => { setWriting(false); setWake((n) => n + 1); });
    return undefined;
  }, [session, newest, on, watching, wake]);

  return { notes, writing, error };
}
