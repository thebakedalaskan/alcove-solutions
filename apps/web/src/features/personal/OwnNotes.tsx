/*
 * Your own notes beside a note, and the shared notes beside them. Only you read the card. Adding something from it opens
 * where the entry is: exactly the words that go, where they land and who reads them, and nothing is sent until you say
 * so. The words are yours to cut down first; whatever's left in the box is what goes. The shared notes have a box of
 * their own once the notes are written, which says who reads what's written there before anything is typed.
 */
import { MAX_ADDITION_TEXT, errorCode, errorMessage, type Note, type NoteAddition, type Person, type PersonalEntry, type PersonalPoint, type SourceMoment } from '@alcove/api';
import { Avatar, Button, Dots, Faces, Icon, IconButton, Scope, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { LineMarks } from '~/features/notes/lines';
import { peopleLine } from '~/features/notes/meta';
import { Moment, MomentLink, type ScreenRefShown } from '~/features/notes/parts';
import type { ScreenMarks } from '~/features/notes/screens';
import { listNames, sameEmail, spokenName } from '~/lib/people';
import { q, qk, useAddToShared, useOwnNotes, useTakeBack, useWriteShared } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';
import { OwnComposer, OwnEntries, Quote, Sure, rowsFor } from './parts';

const WHERE = 'Shared notes';
const say = (reach: 'later' | 'none') => (reach === 'later' ? 'It opens once the notes are written.' : 'Nothing was captured then.');

/** Where a moment is in a note: going there, or the breakout room's name (a room's talk isn't in the recording), and what was on screen. */
function NoteMoment({ noteId, m, shown, onSeek }: { noteId: string; m: SourceMoment; shown: ScreenRefShown; onSeek: ((s: number) => void) | undefined }) {
  return (
    <>
      {m.room ? <span className="own-room"><Icon name="door" size={12} />{m.room.name}</span> : m.line ? (onSeek ? <Moment at={m.at} onSeek={onSeek} /> : <MomentLink noteId={noteId} at={m.at} />) : null}
      {m.screen && shown({ id: m.screen.id, sure: true })}
    </>
  );
}

/** What adding an entry would do, read fresh when it's opened, and adding it. */
function Preview({ note, entry, me, shown, onSeek, onClose, onAdded }: { note: Note; entry: PersonalEntry; me: string | undefined; shown: ScreenRefShown; onSeek: ((s: number) => void) | undefined; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const add = useAddToShared(note.id);
  const preview = useQuery(q.addition(note.id, entry.id));
  const p = preview.data;
  const [text, setText] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Who it was going to when this opened, to say who got the notes since.
  const first = useRef<Person[] | null>(null);
  useEffect(() => { if (p) { setText((t) => t ?? p.text); first.current ??= p.audience; } }, [p]);
  const since = p?.audience.filter((x) => first.current && !first.current.some((y) => sameEmail(x, y))) ?? [];
  // All of it in view, with the keyboard in the box: the words, where they go and who reads them are read before anything's sent.
  const loaded = !!p;
  useEffect(() => {
    if (!loaded) return;
    box.current?.scrollIntoView({ block: 'nearest' });
    box.current?.querySelector('textarea')?.focus();
  }, [loaded]);
  const words = text ?? '';
  const send = () => {
    if (!p) return;
    add.mutate({ entryId: entry.id, body: { text: words.trim(), seal: p.seal } }, {
      onSuccess: () => { toast('It’s in the shared notes. Your own stays yours.', { icon: 'check' }); onAdded(); },
      onError: (e) => {
        toast(errorMessage(e), { icon: 'x' });
        // The people or the moments changed: show them as they are now, and let the person decide again.
        if (errorCode(e) === 'conflict') void qc.invalidateQueries({ queryKey: qk.addition(note.id, entry.id) });
      }
    });
  };
  return (
    <div ref={box} className="own-pv" role="group" aria-label="Add this to the shared notes" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <div className="h"><span>Add to the shared notes</span><Scope everyone>Everyone with the notes</Scope></div>
      {preview.error ? (
        <><p className="bad">{errorMessage(preview.error)}</p><div className="btns"><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></div></>
      ) : !p ? <span className="hint"><Dots /></span> : (
        <>
          <textarea value={words} maxLength={MAX_ADDITION_TEXT} rows={3} aria-label="What goes into the shared notes" placeholder={p.moments.length ? 'Say something about this moment, if you like' : undefined}
            onChange={(e) => setText(e.target.value)} />
          {p.moments.map((m) => <Quote key={`${m.at}-${m.line?.id ?? ''}`} m={m} me={me} />)}
          {p.moments.some((m) => m.room || m.line || m.screen) && <div className="own-m">{p.moments.map((m) => <NoteMoment key={`${m.at}-${m.screen?.id ?? ''}`} noteId={note.id} m={m} shown={shown} onSeek={onSeek} />)}</div>}
          <span className="hint">Only what’s in this box goes. Nothing else from your notes, and no questions you asked.</span>
          <dl>
            <dt>Goes to</dt><dd>{WHERE}, in {p.destination.title}</dd>
            <dt>Who reads it</dt><dd><Faces people={p.audience} size={20} max={4} /><span>{peopleLine(p.audience, me)}, and anyone they share the notes with</span></dd>
          </dl>
          {since.length > 0 && <p className="nd-since"><Faces people={since} size={20} max={3} /><span>{listNames(since)} got the notes since you opened this, so they read it too.</span></p>}
          <div className="btns">
            <Button variant="quiet" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="secondary" size="sm" loading={add.isPending} disabled={!words.trim() && !p.moments.length} onClick={send}>Add for {p.audience.length === 1 ? 'you' : `${p.audience.length} people`}</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Your own notes on a note, for the bookmark buttons around the page and the card beside it. */
export function useOwn(noteId: string) {
  const toast = useToast();
  const own = useOwnNotes(noteId);
  const entries = useQuery(q.personal(noteId)).data?.entries;
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const bookmarks = (entries ?? []).flatMap((e) => (e.kind === 'bookmark' ? [e] : []));
  const toggle = (found: { id: string } | undefined, point: PersonalPoint) => {
    if (found) own.remove.mutate(found.id, { onError: failed });
    else own.add.mutate({ kind: 'bookmark', label: '', point }, { onSuccess: () => toast('Bookmarked in your own notes.', { icon: 'bookmark' }), onError: failed });
  };
  const lineMark = (id: string) => bookmarks.find((b) => b.moment?.line?.id === id);
  const screenMark = (id: string) => bookmarks.find((b) => b.moment?.screen?.id === id && !b.moment.line);
  const lines: LineMarks = { has: (id) => !!lineMark(id), toggle: (l) => toggle(lineMark(l.id), { kind: 'line', lineId: l.id }) };
  const screens: ScreenMarks = { has: (id) => !!screenMark(id), toggle: (id) => toggle(screenMark(id), { kind: 'screen', frameId: id }) };
  return { entries, own, lines, screens };
}

/** Your own notes, beside the shared ones. */
export function OwnNotesCard({ note, me, entries, own, shown, onSeek }: {
  note: Note; me: string | undefined; entries: PersonalEntry[] | undefined; own: ReturnType<typeof useOwnNotes>; shown: ScreenRefShown; onSeek?: ((s: number) => void) | undefined;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const write = (text: string) => own.add.mutate({ kind: 'note', text }, { onSuccess: () => setDraft(''), onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  const ready = note.status === 'ready';
  const picked = entries?.find((e) => e.id === adding);
  /** Back where the keyboard was: the preview took it into its box. Once something's added, that button has gone, so it's the box you write in. */
  const back = useRef<HTMLElement | null>(null);
  const [added, setAdded] = useState(false);
  const open = (e: PersonalEntry) => { back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAdded(false); setAdding(e.id); };
  const close = () => { setAdding(null); back.current?.focus(); };
  return (
    <section className="hm-panel nd-own" aria-label="Your notes">
      <div className="hm-panel-h"><h2>Your notes</h2><span className="nd-only"><Icon name="lock" size={13} />Only you</span></div>
      {entries && entries.length > 0 ? (
        <OwnEntries entries={entries} me={me} moment={(m) => <NoteMoment noteId={note.id} m={m} shown={shown} onSeek={onSeek} />} away={say} picked={adding}
          actions={{ edit: (entryId, text) => own.edit.mutateAsync({ entryId, text }), remove: (entryId) => own.remove.mutateAsync(entryId) }}
          share={(e) => (ready && !e.shared ? <IconButton icon="share" label="Add to the shared notes" size={15} onClick={() => open(e)} /> : null)} />
      ) : entries && <p className="nd-own-e">Write something, bookmark a line, or keep an answer. Other participants, including the organizer, can’t open your own notes.</p>}
      {/* In the composer's place, outside the list that scrolls: all of it shows, the people and the button too. */}
      {picked ? <Preview key={picked.id} note={note} entry={picked} me={me} shown={shown} onSeek={onSeek} onClose={close} onAdded={() => { setAdded(true); setAdding(null); }} />
        : <OwnComposer value={draft} onChange={setDraft} onSend={write} busy={own.add.isPending} focus={added} said />}
    </section>
  );
}

/** One thing someone added to the shared notes. */
function AdditionRow({ a, noteId, mine, me, shown, onSeek, onTakeBack }: { a: NoteAddition; noteId: string; mine: boolean; me: string | undefined; shown: ScreenRefShown; onSeek: ((s: number) => void) | undefined; onTakeBack: () => void }) {
  const d = new Date(a.at);
  const yours = !!me && sameEmail(a.by, { email: me });
  const act = mine && !yours ? 'Remove' : 'Take back';
  const [sure, setSure] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  /** Back on the button it came from, which it took the place of. */
  const keep = () => { flushSync(() => setSure(false)); opener.current?.focus(); };
  return (
    <div className="nd-a">
      <Avatar person={a.by} size={26} />
      <div className="nd-a-b">
        <p className="nd-a-h"><b>{yours ? 'You' : spokenName({ name: a.by.name, person: a.by }, me)}</b><small>{shortDay(d)}, {hm(d)}</small></p>
        {a.text && <p className="nd-a-t">{a.text}</p>}
        {a.moments.map((m) => <Quote key={`q-${m.at}-${m.line?.id ?? ''}`} m={m} me={me} />)}
        {(a.moments.length > 0 || (a.removable && !sure)) && (
          <div className="nd-a-f">
            {a.moments.map((m) => <NoteMoment key={`${m.at}-${m.line?.id ?? m.screen?.id ?? ''}`} noteId={noteId} m={m} shown={shown} onSeek={onSeek} />)}
            {a.removable && !sure && <button ref={opener} type="button" className="nd-act" onClick={() => setSure(true)}>{act}</button>}
          </div>
        )}
        {sure && <Sure ask="Take this out of the shared notes, for everyone?" act={act} onYes={() => { setSure(false); onTakeBack(); }} onNo={keep} />}
      </div>
    </div>
  );
}

/**
 * Writing straight into the shared notes, for everyone with them. Who reads it is in the box before anything is typed,
 * read fresh, with the seal that holds posting to them: if anyone gets the notes before it's posted, it's refused, and
 * the box says who got them since. Enter posts it; Shift and Enter starts a new line. Once it's posted it can be taken
 * back, not changed.
 */
function SharedComposer({ note, me }: { note: Note; me: string | undefined }) {
  const toast = useToast();
  const qc = useQueryClient();
  const box = useQuery(q.sharedAudience(note.id));
  const write = useWriteShared(note.id);
  const [draft, setDraft] = useState('');
  const a = box.data;
  // Who it was going to when the box opened, to say who got the notes since.
  const first = useRef<Person[] | null>(null);
  useEffect(() => { if (a) first.current ??= a.audience; }, [a]);
  const since = a?.audience.filter((x) => first.current && !first.current.some((y) => sameEmail(x, y))) ?? [];
  const post = () => {
    const text = draft.trim();
    if (!a || !text || write.isPending) return;
    write.mutate({ text, seal: a.seal }, {
      onSuccess: () => {
        setDraft('');
        first.current = null;
        void qc.invalidateQueries({ queryKey: qk.sharedAudience(note.id) });
        toast('It’s in the shared notes, for everyone with them.', { icon: 'check' });
      },
      onError: (e) => {
        toast(errorMessage(e), { icon: 'x' });
        // Someone got the notes since: say who reads it now, and let the person post again.
        if (errorCode(e) === 'conflict') void qc.invalidateQueries({ queryKey: qk.sharedAudience(note.id) });
      }
    });
  };
  return (
    <form className="own-compose nd-shared-box" autoComplete="off" onSubmit={(e) => { e.preventDefault(); post(); }}>
      <span className="to">
        {a ? <><Faces people={a.audience} size={18} max={4} /><span>{peopleLine(a.audience, me)}, and anyone they share the notes with</span></>
          : box.error ? <span className="bad">{errorMessage(box.error)}</span> : <Dots />}
      </span>
      <textarea value={draft} rows={rowsFor(draft, 34, 5)} maxLength={MAX_ADDITION_TEXT} placeholder="Write for everyone with the notes" aria-label="Write in the shared notes"
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); post(); } }} />
      <button type="submit" className="ac-btn is-secondary" aria-label="Post it in the shared notes" title="Post it in the shared notes" disabled={!draft.trim() || !a || write.isPending}><Icon name="arrowUp" size={15} /></button>
      {since.length > 0 && <p className="nd-since"><Faces people={since} size={20} max={3} /><span>{listNames(since)} got the notes since you started, so they read it too.</span></p>}
    </form>
  );
}

/**
 * The shared notes, for everyone with the notes: what people wrote straight into them and what they added from their
 * own, with who and when, and once the notes are written, a box to write in. Nothing shows while they're still being
 * written, since who gets them isn't settled.
 */
export function SharedNotes({ note, me, shown, mine, onSeek }: { note: Note; me: string | undefined; shown: ScreenRefShown; mine: boolean; onSeek?: ((s: number) => void) | undefined }) {
  const toast = useToast();
  const take = useTakeBack(note.id);
  const ready = note.status === 'ready';
  if (!ready && !note.additions.length) return null;
  return (
    <section className="nd-b nd-shared" aria-label={WHERE}>
      <div className="nd-b-h"><h2>{WHERE}</h2><span className="nd-only"><Icon name="people" size={13} />Everyone with the notes</span></div>
      {note.additions.map((a) => (
        <AdditionRow key={a.id} a={a} noteId={note.id} mine={mine} me={me} shown={shown} onSeek={onSeek}
          onTakeBack={() => take.mutate(a.id, { onSuccess: () => toast('It’s out of the shared notes, for everyone.', { icon: 'check' }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) })} />
      ))}
      {ready && <SharedComposer note={note} me={me} />}
    </section>
  );
}
