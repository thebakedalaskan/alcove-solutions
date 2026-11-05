/*
 * What a document knows about the call it's open in: From the call in `/`, and its `live` blocks. A block fills in as the
 * notes do, for everyone, and nobody types it: the notes reach every browser in the call, and any that can edit writes what
 * the block should say. Writing what's already there writes nothing, so what's left is keeping a dozen browsers from all
 * writing at once. They take turns by a place in the call everyone can work out: the first with the document open writes,
 * and by the time the next one's turn comes the block says it already. Each browser only writes when its own notes change,
 * never because the block did, so one that's a moment behind can't undo one that's ahead.
 */
import type { CallSession, Person } from '@alcove/api';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Doc } from 'yjs';
import type { Ws } from '../context';
import type { EditorCall, EditorHandle } from '../editor/types';
import { asInDocuments, liveLinesOf, notesOnHere, recentLines, writesLiveBlocks } from './lines';

/** How long each browser waits behind the one before it: longer than an update takes to get round. */
const TURN_MS = 600;
/** However many are in the call, nobody's block waits longer than this many turns. */
const MOST_TURNS = 12;
/** A document's blocks are looked over this long after a change, not on every keystroke. */
const LOOK_MS = 400;

const nothing = () => () => undefined;

/** This browser's place among everyone in the call. */
function turnOf(session: CallSession): number {
  const ids = session.getSnapshot().participants.map((p) => p.id).sort();
  return Math.min(Math.max(0, ids.indexOf(session.ticket.identity)), MOST_TURNS);
}

/** What a document's `Editor` takes from the call, and the work of keeping its `live` blocks filled in. `call` is undefined outside a call. */
export function useEditorCall(ws: Ws, editor: EditorHandle | null, doc: Doc, readOnly: boolean): { call: EditorCall | undefined; people: readonly Person[] } {
  const live = ws.call?.live;
  const session = live?.session;
  const closed = ws.call?.closed ?? false;
  const notes = useSyncExternalStore(session?.subscribe ?? nothing, () => (session ? notesOnHere(session.getSnapshot()) : false));
  /* What this browser would write, as words: it's how a change to the notes is told from every other change to the call. */
  const lines = useSyncExternalStore(session?.subscribe ?? nothing, () => {
    const s = session?.getSnapshot();
    return s && writesLiveBlocks(s) ? JSON.stringify(liveLinesOf(s)) : '';
  });
  /* Faces on quotes and live lines: whoever said them may be in the call and not in the workspace. */
  const here = useSyncExternalStore(session?.subscribe ?? nothing, () => session?.getSnapshot().participants.map((p) => p.person.id).join(' ') ?? '');
  const people = useMemo(() => (session?.getSnapshot().participants ?? []).map((p) => asInDocuments(p.person)), [session, here]);
  const held = useRef(editor);
  held.current = editor;

  /* Whether there's a live block here, looked for a moment after the document changes. */
  const [holdsLive, setHoldsLive] = useState(false);
  useEffect(() => {
    if (!editor || !session) return;
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const look = () => { waiting = null; setHoldsLive(editor.hasLive()); };
    const changed = () => { waiting ??= setTimeout(look, LOOK_MS); };
    look();
    doc.on('update', changed);
    return () => { doc.off('update', changed); if (waiting) clearTimeout(waiting); };
  }, [editor, doc, session]);

  /* A block in a document is one more thing showing the notes, which is what keeps them being written. */
  useEffect(() => (holdsLive && notes && !closed ? session?.watchNotes() : undefined), [holdsLive, notes, closed, session]);

  useEffect(() => {
    if (!editor || !session || readOnly || !holdsLive || !lines) return;
    const write = () => {
      const s = session.getSnapshot();
      if (!writesLiveBlocks(s)) return;
      const { decided, followUps } = liveLinesOf(s);
      if (decided.length) editor.setLiveLines('decided', decided);
      if (followUps.length) editor.setLiveLines('followups', followUps);
    };
    const wait = setTimeout(write, turnOf(session) * TURN_MS);
    return () => clearTimeout(wait);
  }, [editor, session, readOnly, holdsLive, lines]);

  const call = useMemo((): EditorCall | undefined => {
    if (!session) return undefined;
    return {
      id: session.getSnapshot().callId, notes,
      recent: () => recentLines(session.getSnapshot()),
      /* Whoever adds a block sees it fill at once, if they're someone who can write it: it isn't anyone else's turn yet. */
      onLive: (what) => {
        const s = session.getSnapshot();
        if (!writesLiveBlocks(s)) return;
        const { decided, followUps } = liveLinesOf(s);
        const now = what === 'decided' ? decided : followUps;
        if (now.length) held.current?.setLiveLines(what, now);
      }
    };
  }, [session, notes]);
  return { call, people };
}
