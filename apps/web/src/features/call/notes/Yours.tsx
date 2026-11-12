/*
 * Your own notes in a call: Yours, a tab of Notes; Note to self and the bookmark at the foot of every tab but Ask; "mark
 * this" from anywhere in the call; and the bookmark on each line of the transcript, which takes it back on a second press
 * as it does on the note. They're your account's, on the call's note, so nothing here is for someone with only the link.
 * Nothing goes into the call or to anyone's screen: they're read from the server while Notes, the transcript or Yours
 * show, and each change answers with all of them. What's typed in Note to self is kept above your side (a Draft), so
 * moving around it neither loses the words nor carries them anywhere else, and typing renders only the foot.
 */
import { errorCode, errorMessage, type CallAnswer, type CallSession, type CallState, type PersonalEntry, type PersonalNotes, type TranscriptLine, type TranscriptMoment } from '@alcove/api';
import { EmptyState, Icon, IconButton, useToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LineMarks } from '~/features/notes/lines';
import { OwnComposer, OwnEntries } from '~/features/personal/parts';
import { log } from '~/lib/log';
import { useDraft, type Draft } from '../layout/side';
import { Moments, callTimes } from './CatchUp';

const plog = log.child({ component: 'own-notes' });
/** How long what was said can take to be transcribed, at the most: a mark older than this has what it's going to have. */
const MARK_FILLS_MS = 60_000;

/** Your own notes as this screen has them. `enabled`: you have an account in this call, so you can keep them at all. */
export interface OwnInCall {
  enabled: boolean;
  /** What's kept, once it's been read. */
  entries: PersonalEntry[] | null;
  busy: boolean;
  /** Keeps what was typed in Yours, and says so with a way there; `kept` clears the box once it's in. */
  write(text: string, kept: () => void): void;
  /** Mark this moment: what was just said, each time it's pressed. */
  mark(): void;
  /** The transcript's lines you bookmarked, and bookmarking one or taking its bookmark back. */
  lines: LineMarks;
  edit(entryId: string, text: string): Promise<void>;
  remove(entryId: string): Promise<void>;
  /** Which of your questions this screen has kept, by the question's place in the Ask view. */
  kept: ReadonlySet<number>;
  keep(asked: number, question: string, answer: CallAnswer): Promise<void>;
}

/** A line's own bookmark: not a moment marked as it was said, which opens at the same line. */
const markOf = (lineId: string) => (e: PersonalEntry) => e.kind === 'bookmark' && e.target === 'line' && e.moment?.line?.id === lineId;
/** Before notes have been on there's nothing to keep your own notes with. */
const NO_NOTE = 'Your own notes go with the call’s, and notes haven’t been on in this call.';

/**
 * `showing`: Notes, Yours or the transcript (with its bookmarks) is on screen. `line`: the newest line
 * of the transcript, which can fill in a moment you marked. `place`: the part of the call you're in, which decides what
 * your bookmarks may open: they're read again when it changes.
 */
export function useOwnInCall(session: CallSession, o: { role: CallState['role']; noteId: string | null; showing: boolean; line: string | undefined; place: string | null; onOpen: () => void }): OwnInCall {
  const toast = useToast();
  const [notes, setNotes] = useState<PersonalNotes | null>(null);
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
  const opens = { label: 'Open', onClick: () => open.current() };
  const write = (text: string, kept: () => void) => {
    setBusy(true);
    session.personal.add({ kind: 'note', text }).then((n) => {
      setNotes(n);
      kept();
      toast('Kept in your own notes.', { icon: 'pen', action: opens });
    }, failed).finally(() => setBusy(false));
  };
  const mark = () => {
    if (!o.noteId) { toast(NO_NOTE, { icon: 'bookmark' }); return; }
    session.personal.add({ kind: 'bookmark', label: '', point: null }).then((n) => {
      setNotes(n);
      toast('Marked in your own notes.', { icon: 'bookmark', action: opens });
    }, failed);
  };
  /** Lines whose bookmark is on its way on or off: another press waits for it. */
  const turning = useRef(new Set<string>());
  /**
   * A line's bookmark, on or off, from your own notes as they are (read first if they haven't been yet). Said only when it
   * changed something: one already there, or already gone, from another tab, is just read again.
   */
  const toggleLine = (line: TranscriptLine) => {
    if (!o.noteId) { toast(NO_NOTE, { icon: 'bookmark' }); return; }
    if (turning.current.has(line.id)) return;
    turning.current.add(line.id);
    const done = () => { turning.current.delete(line.id); };
    const go = (had: PersonalNotes): Promise<void> => {
      const found = had.entries.find(markOf(line.id));
      if (found) {
        return session.personal.remove(found.id).then((n) => {
          setNotes(n);
          toast('Bookmark removed from your own notes.', { icon: 'bookmark' });
        }, (e: unknown) => { if (errorCode(e) === 'not-found') read(); else failed(e); });
      }
      return session.personal.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId: line.id } }).then((n) => {
        setNotes(n);
        const made = n.entries.find(markOf(line.id));
        if (made && !had.entries.some((e) => e.id === made.id)) toast('Bookmarked in your own notes.', { icon: 'bookmark', action: opens });
      }, failed);
    };
    (notes ? go(notes) : session.personal.get().then((n) => { setNotes(n); return go(n); }, failed)).finally(done);
  };
  const marked: LineMarks = { has: (id) => notes?.entries.some(markOf(id)) ?? false, toggle: toggleLine };
  return {
    enabled, entries: notes?.entries ?? null, busy, write, mark, lines: marked, kept,
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
 * Yours, a tab of Notes: what you wrote, marked and kept, for you alone, oldest first. Before notes have been on there's
 * nothing to keep them with, and it says so.
 */
export function YoursView({ own, state, me, onOpen }: { own: OwnInCall; state: CallState; me: string | undefined; onOpen: (e: TranscriptMoment) => void }) {
  const times = callTimes(state.startedAt);
  return (
    <section className="nn-body nn-own" aria-label="Yours, only you">
      {state.notes.noteId === null ? (
        <EmptyState title="Your own notes start when notes do">They stay beside the call’s notes, so there’s nothing to keep them with yet.</EmptyState>
      ) : own.entries && own.entries.length > 0 ? (
        <OwnEntries entries={own.entries} me={me} actions={own} away={away} moment={(m) => (
          <>
            {m.line && <Moments evidence={[{ kind: 'transcript', lineId: m.line.id, said: m.at }]} times={times} onOpen={onOpen} />}
            {m.room && <span className="own-room"><Icon name="door" size={12} />{m.room.name}</span>}
          </>
        )} />
      ) : own.entries && (
        <EmptyState title="Only you see what’s here">Write a note to yourself, press the bookmark or B to mark a moment, or keep an answer from Ask. Find them beside the call’s notes afterwards.</EmptyState>
      )}
    </section>
  );
}

/**
 * The foot of Notes on every tab but Ask: Note to self, which keeps what you type in Yours, and the bookmark beside it, which
 * marks what was just said there (B does the same from anywhere in the call).
 */
export function OwnFoot({ own, draft }: { own: OwnInCall; draft: Draft }) {
  const [text, setText] = useDraft(draft);
  return (
    <div className="nn-foot">
      <OwnComposer value={text} onChange={setText} onSend={(t) => own.write(t, () => setText(''))} busy={own.busy} said placeholder="Note to self" icon="pen"
        hint={<span className="nn-lock"><Icon name="lock" size={12} />Only you</span>} />
      <IconButton icon="bookmark" className="nn-mark" label="Mark this moment, only you" title="Mark this moment · B" aria-keyshortcuts="B" onClick={() => own.mark()} />
    </div>
  );
}
