/*
 * Following a call's notes as they're written, on the page a call leaves you on (CallOver.tsx): each step as it's done, from
 * `api.notes.progress`, until they're ready. A stream that stops before then, or notes that take longer than a minute and a
 * half, are `stuck`: they'll be in Calls when they're ready, and nobody needs to wait.
 */
import type { NoteProgress } from '@alcove/api';
import { useEffect, useState } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';

const flog = log.child({ component: 'follow-notes' });
/** How long the notes can take before they're said to be slow. */
const SLOW_MS = 90_000;

/** The note `noteId` being written, followed while `on`: the progress so far, and whether it's stuck. */
export function useFollowNotes(noteId: string | null, on: boolean): { progress: NoteProgress | null; stuck: boolean } {
  const [progress, setProgress] = useState<NoteProgress | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!on || !noteId) return undefined;
    let alive = true;
    let ready = false;
    const slow = setTimeout(() => { if (alive && !ready) setStuck(true); }, SLOW_MS);
    void (async () => {
      try {
        for await (const p of api.notes.progress(noteId)) {
          if (!alive) return;
          ready = p.ready;
          setProgress(p);
        }
        if (alive && !ready) setStuck(true);
      } catch (e) {
        flog.warn('note progress stopped', { err: e, noteId });
        if (alive && !ready) setStuck(true);
      }
    })();
    return () => { alive = false; clearTimeout(slow); };
  }, [on, noteId]);
  return { progress, stuck };
}
