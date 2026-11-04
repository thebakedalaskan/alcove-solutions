/*
 * Your own notes beside a note, and what you've added from them to the shared notes. Only you read the card. Adding
 * something opens where the entry is: exactly the words that go, where they land and who reads them, and nothing is sent
 * until you say so. The words are yours to cut down first; whatever's left in the box is what goes.
 */
import { MAX_ADDITION_TEXT, errorCode, errorMessage, type Note, type NoteAddition, type PersonalEntry, type PersonalPoint, type SourceMoment } from '@alcove/api';
import { Avatar, Button, Card, Dots, EmptyState, Faces, Icon, IconButton, Scope, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LineMarks } from '~/features/notes/lines';
import { peopleLine } from '~/features/notes/meta';
import { MomentLink, Section, type ScreenRefShown } from '~/features/notes/parts';
import type { ScreenMarks } from '~/features/notes/screens';
import { sameEmail, spokenName } from '~/lib/people';
import { q, qk, useAddToShared, useOwnNotes, useTakeBack } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';
import { OwnComposer, OwnEntries, Quote } from './parts';

const WHERE = 'Added by people';
const say = (reach: 'later' | 'none') => (reach === 'later' ? 'It opens once the notes are written.' : 'Nothing was captured then.');

/** Where a moment is in a note: a link to it, or the breakout room's name (a room's talk isn't in the recording), and what was on screen. */
function NoteMoment({ noteId, m, shown }: { noteId: string; m: SourceMoment; shown: ScreenRefShown }) {
  return (
    <>
      {m.room ? <span className="own-room"><Icon name="door" size={12} />{m.room.name}</span> : m.line ? <MomentLink noteId={noteId} at={m.at} /> : null}
      {m.screen && shown({ id: m.screen.id, sure: true })}
    </>
  );
}

/** What adding an entry would do, read fresh when it's opened, and adding it. */
function Preview({ note, entry, me, shown, onClose }: { note: Note; entry: PersonalEntry; me: string | undefined; shown: ScreenRefShown; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const add = useAddToShared(note.id);
  const preview = useQuery(q.addition(note.id, entry.id));
  const p = preview.data;
  const [text, setText] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (p) setText((t) => t ?? p.text); }, [p]);
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
      onSuccess: () => { toast('It’s in the shared notes. Your own stays yours.', { icon: 'check' }); onClose(); },
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
          {p.moments.some((m) => m.room || m.line || m.screen) && <div className="own-m">{p.moments.map((m) => <NoteMoment key={`${m.at}-${m.screen?.id ?? ''}`} noteId={note.id} m={m} shown={shown} />)}</div>}
          <span className="hint">Only what’s in this box goes. Nothing else from your notes, and no questions you asked.</span>
          <dl>
            <dt>Goes to</dt><dd>{WHERE}, in {p.destination.title}</dd>
            <dt>Who reads it</dt><dd><Faces people={p.audience} size={20} max={4} /><span>{peopleLine(p.audience, me)}, and anyone they share the notes with</span></dd>
          </dl>
          <div className="btns">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" loading={add.isPending} disabled={!words.trim() && !p.moments.length} onClick={send}>Add for {p.audience.length === 1 ? 'you' : `${p.audience.length} people`}</Button>
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
    else own.add.mutate({ kind: 'bookmark', label: '', point }, { onSuccess: () => toast('Bookmarked. Only you can see it.', { icon: 'bookmark' }), onError: failed });
  };
  const lineMark = (id: string) => bookmarks.find((b) => b.moment?.line?.id === id);
  const screenMark = (id: string) => bookmarks.find((b) => b.moment?.screen?.id === id && !b.moment.line);
  const lines: LineMarks = { has: (id) => !!lineMark(id), toggle: (l) => toggle(lineMark(l.id), { kind: 'line', lineId: l.id }) };
  const screens: ScreenMarks = { has: (id) => !!screenMark(id), toggle: (id) => toggle(screenMark(id), { kind: 'screen', frameId: id }) };
  return { entries, own, lines, screens };
}

/** Your own notes, beside the shared ones. */
export function OwnNotesCard({ note, me, entries, own, shown }: {
  note: Note; me: string | undefined; entries: PersonalEntry[] | undefined; own: ReturnType<typeof useOwnNotes>; shown: ScreenRefShown;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const write = (text: string) => own.add.mutate({ kind: 'note', text }, { onSuccess: () => setDraft(''), onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  const ready = note.status === 'ready';
  const picked = entries?.find((e) => e.id === adding);
  /** Back where the keyboard was: the preview took it into its box. */
  const back = useRef<HTMLElement | null>(null);
  const open = (e: PersonalEntry) => { back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAdding(e.id); };
  const close = () => { setAdding(null); back.current?.focus(); };
  return (
    <Card title="Your notes" aside={<Scope>Only you</Scope>} className="own-card">
      {entries && entries.length > 0 ? (
        <OwnEntries entries={entries} me={me} moment={(m) => <NoteMoment noteId={note.id} m={m} shown={shown} />} away={say} picked={adding}
          actions={{ edit: (entryId, text) => own.edit.mutateAsync({ entryId, text }), remove: (entryId) => own.remove.mutateAsync(entryId) }}
          share={(e) => (ready && !e.shared ? <IconButton icon="share" label="Add to the shared notes" size={15} onClick={() => open(e)} /> : null)} />
      ) : entries && <EmptyState title="Nothing here yet" className="own-empty">Write something, bookmark a line, or keep an answer. Nobody else can read it, the organizer included.</EmptyState>}
      {/* In the composer's place, outside the list that scrolls: all of it shows, the people and the button too. */}
      {picked ? <Preview key={picked.id} note={note} entry={picked} me={me} shown={shown} onClose={close} />
        : <OwnComposer value={draft} onChange={setDraft} onSend={write} busy={own.add.isPending} />}
    </Card>
  );
}

/** One thing someone added to the shared notes. */
function AdditionRow({ a, noteId, mine, me, shown, onTakeBack }: { a: NoteAddition; noteId: string; mine: boolean; me: string | undefined; shown: ScreenRefShown; onTakeBack: () => void }) {
  const d = new Date(a.at);
  const yours = !!me && sameEmail(a.by, { email: me });
  return (
    <div className="add-row">
      <Avatar person={a.by} size={30} />
      <div className="add-b">
        <div className="add-h"><b>{yours ? 'You' : spokenName({ name: a.by.name, person: a.by }, me)}</b><span className="ac-time">{shortDay(d)}, {hm(d)}</span></div>
        {a.text && <p>{a.text}</p>}
        {a.moments.map((m) => <Quote key={`q-${m.at}-${m.line?.id ?? ''}`} m={m} me={me} />)}
        {a.moments.length > 0 && <div className="add-m">{a.moments.map((m) => <NoteMoment key={`${m.at}-${m.line?.id ?? m.screen?.id ?? ''}`} noteId={noteId} m={m} shown={shown} />)}</div>}
      </div>
      {a.removable && <button type="button" className="lk quiet" onClick={onTakeBack}>{yours ? 'Take back' : mine ? 'Remove' : 'Take back'}</button>}
    </div>
  );
}

/** What people added to the shared notes from their own, for everyone with the notes. */
export function Additions({ note, me, shown, mine, className, style }: { note: Note; me: string | undefined; shown: ScreenRefShown; mine: boolean; className?: string | undefined; style?: CSSProperties | undefined }) {
  const toast = useToast();
  const take = useTakeBack(note.id);
  if (!note.additions.length) return null;
  return (
    <Section title={WHERE} count={note.additions.length} className={className} style={style}>
      <div className="add-list">
        {note.additions.map((a) => (
          <AdditionRow key={a.id} a={a} noteId={note.id} mine={mine} me={me} shown={shown}
            onTakeBack={() => take.mutate(a.id, { onSuccess: () => toast('It’s out of the shared notes, for everyone.', { icon: 'check' }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) })} />
        ))}
      </div>
    </Section>
  );
}
