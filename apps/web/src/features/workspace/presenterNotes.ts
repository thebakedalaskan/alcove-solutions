/*
 * Your own notes beside each frame of a board you present (docs: Data and storage › Presenter notes): kept under your account a
 * moment after you stop typing, and as you leave, and nowhere else. Someone in a call without an account has nowhere to keep
 * them, so they have none.
 */
import { errorMessage } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { q, useSavePresenterFrameNote } from '~/lib/queries';

const plog = log.child({ component: 'presenter-notes' });

/** How long notes wait after the last key before they're kept. */
const NOTES_WAIT = 600;

/**
 * Your notes beside each frame of a board, by frame, and how to change one. `notes` is null for someone without an account
 * (`mine` false). What's typed beside one frame is kept on its own, so moving on to the next frame mid-sentence keeps it.
 */
export function usePresenterFrameNotes({ workspaceId, boardId, pass, mine, failed }: {
  workspaceId: string; boardId: string; pass: string | undefined; mine: boolean; failed: (message: string) => void;
}): { notes: Readonly<Record<string, string>> | null; setNote: (frame: string, text: string) => void } {
  const saved = useQuery({ ...q.presenterFrameNotes(workspaceId, boardId, pass), enabled: mine });
  const save = useSavePresenterFrameNote(workspaceId, boardId, pass).mutate;
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const waiting = useRef(new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>());
  const failedNow = useRef(failed);
  failedNow.current = failed;
  const keep = useCallback((frame: string, text: string) => {
    save({ frame, text }, { onError: (e: unknown) => { plog.warn('frame notes weren’t kept', { documentId: boardId, err: e }); failedNow.current(errorMessage(e)); } });
  }, [save, boardId]);
  useEffect(() => () => {
    const all = [...waiting.current];
    waiting.current.clear();
    for (const [frame, w] of all) {
      clearTimeout(w.timer);
      keep(frame, w.text);
    }
  }, [keep]);
  const setNote = useCallback((frame: string, text: string) => {
    setDrafts((was) => ({ ...was, [frame]: text }));
    const was = waiting.current.get(frame);
    if (was) clearTimeout(was.timer);
    const timer = setTimeout(() => { waiting.current.delete(frame); keep(frame, text); }, NOTES_WAIT);
    waiting.current.set(frame, { text, timer });
  }, [keep]);
  const notes = useMemo(() => (mine ? { ...saved.data?.frames, ...drafts } : null), [mine, saved.data, drafts]);
  return { notes, setNote };
}
