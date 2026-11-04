/*
 * Your own notes in a call: the panel's Yours view and "mark this" from anywhere in the call. They're your account's, on
 * the call's note, so nothing here is for someone with only the link. Nothing goes into the call or to anyone's screen:
 * they're read from the server when the view opens, and each change answers with all of them. The draft lives here, so
 * moving around the panel neither loses it nor carries it anywhere else.
 */
import { errorMessage, type CallAnswer, type CallSession, type CallState, type PersonalEntry, type PersonalNotes, type TranscriptMoment } from '@alcove/api';
import { Button, EmptyState, Icon, Scope, useToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OwnComposer, OwnEntries } from '~/features/personal/parts';
import { log } from '~/lib/log';
import { Moments, callTimes } from './CatchUp';

const plog = log.child({ component: 'own-notes' });
/** How long what was said can take to be transcribed, at the most: a mark older than this has what it's going to have. */
const MARK_FILLS_MS = 60_000;

/** Your own notes as this screen has them. `enabled`: you have an account in this call, so you can keep them at all. */
export interface OwnInCall {
  enabled: boolean;
  /** What's kept, once it's been read. */
  entries: PersonalEntry[] | null;
  draft: string;
  setDraft(text: string): void;
  busy: boolean;
  write(text: string): void;
  /** Bookmarks now, or one line of what's been said. */
  mark(lineId?: string | undefined): void;
  edit(entryId: string, text: string): Promise<void>;
  remove(entryId: string): Promise<void>;
  /** Which of your questions this screen has kept, by the question's place in the Ask view. */
  kept: ReadonlySet<number>;
  keep(asked: number, question: string, answer: CallAnswer): Promise<void>;
}

/**
 * `showing`: the Yours view is open. `line`: the newest line of the transcript, which can fill in a moment you marked.
 * `place`: the part of the call you're in, which decides what your bookmarks may open: they're read again when it changes.
 */
export function useOwnInCall(session: CallSession, o: { role: CallState['role']; noteId: string | null; showing: boolean; line: string | undefined; place: string | null; onOpen: () => void }): OwnInCall {
  const toast = useToast();
  const [notes, setNotes] = useState<PersonalNotes | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  const enabled = o.role !== 'guest';
  const failed = useCallback((e: unknown) => { plog.warn('own notes not changed', { err: e }); toast(errorMessage(e), { icon: 'x' }); }, [toast]);
  const read = useCallback(() => {
    session.personal.get().then(setNotes, (e: unknown) => plog.info('own notes not read', { err: e }));
  }, [session]);

  useEffect(() => { if (enabled && o.noteId && o.showing) read(); }, [enabled, o.noteId, o.showing, o.place, read]);
  // A moment marked just now shows what was said once that's been transcribed: read again when a new line comes. Only a
  // recent one: a mark with nothing near it, as while notes are paused, never fills in, and each read opens the transcript.
  const lines = useRef(o.line);
  useEffect(() => {
    if (lines.current === o.line) return;
    lines.current = o.line;
    const fresh = notes?.entries.some((e) => e.kind === 'bookmark' && !e.moment && e.reach === 'none' && Date.now() - Date.parse(e.at) < MARK_FILLS_MS);
    if (o.showing && fresh) read();
  }, [o.line, o.showing, notes, read]);

  const open = useRef(o.onOpen);
  open.current = o.onOpen;
  const write = (text: string) => {
    setBusy(true);
    session.personal.add({ kind: 'note', text }).then((n) => { setNotes(n); setDraft(''); }, failed).finally(() => setBusy(false));
  };
  const mark = (lineId?: string | undefined) => {
    if (!o.noteId) { toast('Your own notes go with the call’s, and notes haven’t been on in this call.', { icon: 'bookmark' }); return; }
    session.personal.add({ kind: 'bookmark', label: '', point: lineId ? { kind: 'line', lineId } : null }).then((n) => {
      setNotes(n);
      toast('Marked. Only you can see it.', { icon: 'bookmark', action: { label: 'Open', onClick: () => open.current() } });
    }, failed);
  };
  return {
    enabled, entries: notes?.entries ?? null, draft, setDraft, busy, write, mark, kept,
    edit: async (entryId, text) => { setNotes(await session.personal.edit(entryId, text)); },
    remove: async (entryId) => { setNotes(await session.personal.remove(entryId)); },
    keep: async (asked, question, a) => {
      setNotes(await session.personal.add({ kind: 'answer', question, answer: a.text, points: a.evidence.map((e) => ({ kind: 'line', lineId: e.lineId })) }));
      setKept((k) => new Set([...k, asked]));
    }
  };
}

/** What says a bookmark doesn't open from here, in a call. */
const away = (reach: 'later' | 'none') => (reach === 'later' ? 'Said somewhere you aren’t now. It opens when you’re back there, and in the notes after the call.' : 'Nothing’s transcribed at that moment.');

export function YoursView({ own, state, me, onOpen }: { own: OwnInCall; state: CallState; me: string | undefined; onOpen: (e: TranscriptMoment) => void }) {
  const times = callTimes(state.startedAt);
  const noNote = state.notes.noteId === null;
  return (
    <>
      <div className="own-head">
        <span className="t">Your notes</span>
        <Scope>Only you</Scope>
        <Button size="sm" variant="secondary" icon="bookmark" disabled={noNote} onClick={() => own.mark()}>Mark this</Button>
      </div>
      <div className="ic-scroll ic-pad">
        {noNote ? (
          <EmptyState title="Notes aren’t on" className="ic-empty">Your own notes stay beside the call’s, so they start when notes do.</EmptyState>
        ) : own.entries && own.entries.length > 0 ? (
          <OwnEntries entries={own.entries} me={me} actions={own} away={away} moment={(m) => (
            <>
              {m.line && <Moments evidence={[{ kind: 'transcript', lineId: m.line.id, said: m.at }]} times={times} onOpen={onOpen} />}
              {m.room && <span className="own-room"><Icon name="door" size={12} />{m.room.name}</span>}
            </>
          )} />
        ) : own.entries && (
          <EmptyState title="Nothing here yet" className="ic-empty">Write something for yourself, mark a moment, or keep an answer. After the call they’re beside its notes, and nobody else can read them.</EmptyState>
        )}
      </div>
      {!noNote && <div className="ic-foot"><OwnComposer value={own.draft} onChange={own.setDraft} onSend={own.write} busy={own.busy} /></div>}
    </>
  );
}
