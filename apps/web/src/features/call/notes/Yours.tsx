/*
 * Your own notes in a call: Yours, at the foot of the Notes tab, and "mark this" from anywhere in the call. They're your
 * account's, on the call's note, so nothing here is for someone with only the link. Nothing goes into the call or to anyone's
 * screen: they're read from the server while the notes show, and each change answers with all of them. The draft lives here,
 * so moving around your side neither loses it nor carries it anywhere else.
 */
import { errorMessage, type CallAnswer, type CallSession, type CallState, type PersonalEntry, type PersonalNotes, type TranscriptMoment } from '@alcove/api';
import { Icon, useToast } from '@alcove/ui';
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
 * `showing`: the notes are showing, with Yours at their foot. `line`: the newest line of the transcript, which can fill in a moment you marked.
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
      toast('Marked in your own notes.', { icon: 'bookmark', action: { label: 'Open', onClick: () => open.current() } });
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

/**
 * Yours, at the foot of the notes: what you wrote, marked and kept, for you alone, and a line to write more. `shown` counts the
 * times something asked to see it (the toast after marking a moment), and brings it into view each time.
 */
export function Yours({ own, state, me, shown, onOpen }: { own: OwnInCall; state: CallState; me: string | undefined; shown: number; onOpen: (e: TranscriptMoment) => void }) {
  const times = callTimes(state.startedAt);
  const noNote = state.notes.noteId === null;
  const part = useRef<HTMLElement>(null);
  // Only the notes' own scroll moves: the call around it never scrolls.
  useEffect(() => {
    const el = part.current;
    const box = el?.closest('.ic-scroll');
    if (shown > 0 && el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12;
  }, [shown]);
  return (
    <section ref={part} className="ic-own" aria-label="Yours, only you">
      <div className="ic-sh"><span className="ac-eyebrow">Yours</span><span className="only"><Icon name="lock" size={13} />Only you</span></div>
      {noNote ? <p className="ic-quiet">Your own notes stay beside the call’s, so they start when notes do.</p>
        : own.entries && own.entries.length > 0 ? (
          <OwnEntries entries={own.entries} me={me} actions={own} away={away} moment={(m) => (
            <>
              {m.line && <Moments evidence={[{ kind: 'transcript', lineId: m.line.id, said: m.at }]} times={times} onOpen={onOpen} />}
              {m.room && <span className="own-room"><Icon name="door" size={12} />{m.room.name}</span>}
            </>
          )} />
        ) : own.entries && <p className="ic-quiet">Write something for yourself, mark a moment, or keep an answer. Find them beside the call’s notes afterwards. Other participants can’t open them.</p>}
      {!noNote && <OwnComposer value={own.draft} onChange={own.setDraft} onSend={own.write} busy={own.busy} said />}
    </section>
  );
}
