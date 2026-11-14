/*
 * Following a call's notes as they're written, on the page a call leaves you on (CallOver.tsx): each step as it's done, from
 * `api.notes.progress`, until they're ready. The server ends a stream after two minutes, and one that ends before the notes
 * are ready is followed again. Notes that take longer than SLOW_MS, or progress that can't be followed, are `stuck`:
 * they'll be in Calls when they're ready, and nobody needs to wait.
 */
import type { CallSession, NoteProgress } from '@alcove/api';
import { useEffect, useState } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';

const flog = log.child({ component: 'follow-notes' });
/**
 * How long the notes can take before they're said to be slow: thinking first, each part's notes take up to 860 s (620 s,
 * then 240 s without thinking), and a call's breakout rooms are written before its own notes.
 */
const SLOW_MS = 15 * 60_000;

/** The note `noteId` being written, followed while `on`: the progress so far, and whether it's stuck. */
export function useFollowNotes(noteId: string | null, on: boolean): { progress: NoteProgress | null; stuck: boolean } {
  const [progress, setProgress] = useState<NoteProgress | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!on || !noteId) return undefined;
    let alive = true;
    let ready = false;
    let late = false;
    const slow = setTimeout(() => { late = true; if (alive && !ready) setStuck(true); }, SLOW_MS);
    void (async () => {
      try {
        while (alive && !ready && !late) {
          for await (const p of api.notes.progress(noteId)) {
            if (!alive) return;
            ready = p.ready;
            setProgress(p);
          }
        }
      } catch (e) {
        flog.warn('note progress stopped', { err: e, noteId });
        if (alive && !ready) setStuck(true);
      }
    })();
    return () => { alive = false; clearTimeout(slow); };
  }, [on, noteId]);
  return { progress, stuck };
}

/** Showing the notes is what keeps them up to date, for everyone in this part of the call: they're watched while they're shown here. */
export function useNotesWatched(session: CallSession, watching: boolean): void {
  useEffect(() => (watching ? session.watchNotes() : undefined), [session, watching]);
}
