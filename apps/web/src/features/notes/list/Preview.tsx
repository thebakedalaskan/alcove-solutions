/*
 * The picked note, beside the list on a wide screen: whether it's ready, pin, Share, More and Open notes; when it was and
 * who has it; what was found in it; then the summary, decisions and follow-ups, which can be settled here.
 */
import { errorCode, errorMessage, firstName, isBy, mayChangeAction, mayDecide, type ActionItem, type Decision, type DecisionPatch, type Note, type NoteDecision, type NoteReader, type NoteSummary, type Person } from '@alcove/api';
import { Avatar, Button, Check, Chip, Dots, Faces, GoneArch, Icon, IconButton, NotesSign, Notice, Popover, SealedBadge, Unencrypted, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EvidenceFlags, useNoteReader } from '~/features/notes/entries';
import { marked } from '~/features/notes/highlight';
import { noteAsText, peopleLine, readerRole, roleLine } from '~/features/notes/meta';
import { decisionLine, notDecided } from '~/features/notes/parts';
import { PinNote, ShareNote } from '~/features/notes/share';
import { weeklyLabel } from '~/features/series/cards';
import { sameEmail, spokenName } from '~/lib/people';
import { isUnencrypted, unencryptedLine } from '~/lib/aiModels';
import { q, useAiModels, useDeleteNote, usePendingActions, useUpdateAction, useUpdateDecision } from '~/lib/queries';
import { daysFromToday, hm, hoursAndMinutes, noteDay, shortDay } from '~/lib/time';
import { capital, plural } from '~/lib/words';
import { MomentChip, byTime, howOf, noSummary, othersIn, type Said } from './parts';

/* At most this many beside the list; the note has the rest. */
const DECISIONS = 3;
const FOLLOW_UPS = 4;
const MOMENTS = 4;
/* A long list of who has the notes stops here until it's opened. */
const FIRST_PEOPLE = 8;

const minutes = (seconds: number) => hoursAndMinutes(Math.max(1, Math.round(seconds / 60)));

/** When the notes were last checked as written in confidential compute: the time today, else the day. */
function sealedLine(n: Note): string {
  const proof = n.inference.find((e) => e.task === 'notes') ?? n.inference[0];
  if (!proof) return 'Confidential compute';
  const d = new Date(proof.verifiedAt);
  return `Confidential compute, verified ${daysFromToday(d) === 0 ? hm(d) : shortDay(d)}`;
}

/** A note's state, as a chip: ready, still being written, or still recording. */
function Status({ s, again }: { s: NoteSummary; again: boolean }) {
  if (s.status === 'recording') return <NotesSign className="nt-st is-rec">Still recording</NotesSign>;
  if (s.status === 'pending' || again) return <Chip className="nt-st is-now"><Dots />{again ? 'Being written again' : 'Being written'}</Chip>;
  return <Chip className="nt-st" icon="check">Ready</Chip>;
}

export function Preview({ s, me, terms, said, onDropped }: { s: NoteSummary; me: string | undefined; terms: string[]; said: Said; onDropped: () => void }) {
  const h = useId();
  const qc = useQueryClient();
  /* A note that went meanwhile (deleted, or taken out of yours) isn't asked for again; the list is, so its row goes. */
  const found = useQuery({ ...q.note(s.id), retry: (n, e) => errorCode(e) !== 'not-found' && n < 2 });
  const note = found.data;
  const gone = found.isError && errorCode(found.error) === 'not-found';
  useEffect(() => { if (gone) void qc.invalidateQueries({ queryKey: ['notes', 'list'] }); }, [gone, qc]);
  /* While More asks its question, its button is the view's filled one. */
  const [asking, setAsking] = useState(false);
  const how = s.received ? howOf(s, me) : undefined;
  // A team's note is read and asked about, nothing more.
  const teamNote = s.received?.role === 'team';
  return (
    <aside className="nt-pv" aria-labelledby={h}>
      <div className="nt-pv-top">
        <Status s={s} again={!!note?.writingAgain} />
        <div className="nt-acts" data-asking={asking || undefined}>
          <PinNote noteId={s.id} />
          {teamNote ? null : note ? <ShareNote note={note} size="sm" align="center" className="nt-sharep" /> : <Button size="sm" icon="share" disabled><span className="share-t">Share</span></Button>}
          {!teamNote && <More s={s} note={note} onAsking={setAsking} onDropped={onDropped} />}
          <Link to="/notes/$noteId" params={{ noteId: s.id }} className={cn(buttonClass({ variant: 'primary', size: 'sm' }), 'nt-open')}>Open notes<Icon name="right" size={14} /></Link>
        </div>
      </div>
      <div className="nt-pv-in">
        <div className="nt-pv-h">
          <h2 id={h} className="nt-pv-t">{s.title}</h2>
          {how && <span className="nt-how"><Icon name={how.icon} size={13} /><span className="ac-clamp-1">{how.text}</span></span>}
        </div>
        <div className="nt-pv-m">
          <span>{noteDay(s.startedAt)} at {hm(s.startedAt)}, {minutes(s.duration)}</span>
          {note?.seriesId && <InSeries id={note.seriesId} />}
          <WhoHas s={s} note={note} me={me} />
        </div>
        <Moments s={s} me={me} terms={terms} said={said} />
        {note ? <Written note={note} me={me} short={said.lines.some((l) => l.text)} locked={teamNote} />
          : found.isError ? (
            <div className="nt-pv-gone">
              <GoneArch />
              <b>{gone ? 'These notes aren’t here any more' : 'Couldn’t open these notes'}</b>
              <p>{gone ? 'They were deleted, or taken out of your notes.' : errorMessage(found.error)}</p>
            </div>
          ) : s.excerpt ? <p className="nt-pv-s">{s.excerpt}</p> : null}
      </div>
    </aside>
  );
}

/** The series a note's call is in: "Every Tuesday" when it's as regular as that. */
function InSeries({ id }: { id: string }) {
  const s = useQuery(q.series(id)).data;
  return <span>{(s && weeklyLabel(s)) ?? 'In a series'}</span>;
}

/** Who has the notes, you first; pressed, each of them and how they got them. Only you have your own until you share them. */
function WhoHas({ s, note, me }: { s: NoteSummary; note: Note | undefined; me: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const others = othersIn(s.people, me);
  if (!others.length) return <span className="nt-only"><Icon name="lock" size={14} />Only you</span>;
  const faces: Person[] = [...s.people.filter((p) => !others.includes(p)), ...others].slice(0, 4);
  const line = <><Faces people={faces} size={22} /><span className="ac-clamp-1">{peopleLine(s.people, me)}</span></>;
  if (!note) return <span className="nt-whob">{line}</span>;
  const list = note.recipients;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setAll(false); }} align="start" label="Who has these notes" className={cn('nt-pop nt-whop', all && 'is-all')}
      anchor={<button type="button" className="nt-whob" title="Who has these notes">{line}</button>}>
      <h3 className="nt-pop-h">Who has these notes</h3>
      <div className="nt-pop-list">
        {(all ? list : list.slice(0, FIRST_PEOPLE)).map((r) => {
          const role = roleLine(r, me);
          return (
            <div key={r.person.email} className="nt-pop-row">
              <Avatar person={r.person} size={24} />
              <span className="nt-pop-b"><b className="ac-clamp-1">{me && sameEmail(r.person, { email: me }) ? 'You' : r.person.name}</b><small className="ac-clamp-1" title={role}>{role}</small></span>
            </div>
          );
        })}
      </div>
      {list.length > FIRST_PEOPLE && !all && <div className="nt-pop-f"><button type="button" className="nt-act" onClick={() => setAll(true)}>Show all {list.length}</button></div>}
    </Popover>
  );
}

/** "the summary, the transcript and the audio" */
const asList = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`);
/** What goes with these notes, past their words. */
function whatGoes(note: Note | undefined): string[] {
  return [
    ...(note?.transcript?.length ? ['the transcript'] : []),
    ...(note?.rooms.length ? [note.rooms.length === 1 ? 'the breakout room’s section' : 'the breakout rooms’ sections'] : []),
    ...(note?.audio.length && note.kept.recording ? ['the audio'] : []),
    ...(note?.screens.length ? ['the shared screens'] : [])
  ];
}

/** Copy as text, and deleting your own notes or removing someone else's. It asks once, in place. */
function More({ s, note, onAsking, onDropped }: { s: NoteSummary; note: Note | undefined; onAsking: (on: boolean) => void; onDropped: () => void }) {
  const toast = useToast();
  const del = useDeleteNote();
  const cancel = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const mine = !s.received;
  const inCall = s.kind === 'call' && s.status === 'recording';
  useEffect(() => { onAsking(sure); if (sure) cancel.current?.focus(); }, [sure, onAsking]);
  const change = (o: boolean) => { setOpen(o); if (!o) setSure(false); };
  const copy = () => {
    change(false);
    if (note) void navigator.clipboard?.writeText(noteAsText(note)).then(() => toast('Copied as text'));
  };
  const drop = async () => {
    try {
      await del.mutateAsync(s.id);
      change(false);
      onDropped();
      toast(mine ? `${s.title} is deleted for everyone: ${asList(['the notes', ...whatGoes(note)])}.` : `${s.title} is out of your notes. Everyone else keeps it.`, { icon: 'trash' });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    }
  };
  return (
    <Popover open={open} onOpenChange={change} align="center" label="More" className="nt-pop nt-morep" tip="More"
      anchor={<IconButton icon="more" label="More" title={undefined} />}>
      {sure ? (
        <div className="nt-sure" role="alertdialog" aria-label={mine ? 'Delete these notes' : 'Remove these notes'}>
          <b>{mine ? 'Delete these notes for everyone?' : 'Remove these notes from yours?'}</b>
          <p>{mine ? `${capital(asList(['the summary', ...whatGoes(note), 'anyone’s own notes on them']))} go for good.` : 'Everyone else keeps them. Your own notes on them go for good, and anything you added to the shared notes stays there.'}</p>
          <div className="nt-sure-a">
            <Button ref={cancel} variant="quiet" size="sm" onClick={() => change(false)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={del.isPending} onClick={() => void drop()}>{mine ? 'Delete' : 'Remove'}</Button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="nt-pop-row" disabled={!note || s.status !== 'ready'} onClick={copy}>
            <span className="nt-pop-ic"><Icon name="copy" size={18} /></span>
            <span className="nt-pop-b"><b>Copy as text</b>{s.status !== 'ready' && <small>Once the notes are written.</small>}</span>
          </button>
          <button type="button" className="nt-pop-row" disabled={inCall} onClick={() => setSure(true)}>
            <span className="nt-pop-ic"><Icon name="trash" size={18} /></span>
            <span className="nt-pop-b"><b>{mine ? 'Delete notes' : 'Remove from your notes'}</b><small>{!mine ? 'Everyone else keeps them.' : inCall ? 'Once the call ends.' : 'For everyone. Can’t be undone.'}</small></span>
          </button>
        </>
      )}
    </Popover>
  );
}

/** What was found in the note, above its summary: each line, who said it, and the moment it was said. */
function Moments({ s, me, terms, said }: { s: NoteSummary; me: string | undefined; terms: string[]; said: Said }) {
  const lines = byTime(said.lines.filter((l) => l.text).slice(0, MOMENTS));
  if (!lines.length) return null;
  return (
    <section className="nt-sec" aria-label="What was said">
      <h3 className="nt-sh">{plural(Math.max(said.count, lines.length), 'moment')}</h3>
      {lines.map((l) => (
        <div key={l.id} className="nt-said">
          <p className="nt-said-t">{l.speaker && <b>{spokenName(l.speaker, me)}</b>}{marked(l.text, terms)}</p>
          <MomentChip noteId={s.id} noteTitle={s.title} at={l.at} room={l.room} />
        </div>
      ))}
    </section>
  );
}

/** A note as far as it's written: where it's got to until then, otherwise its summary, decisions and follow-ups. */
function Written({ note, me, short, locked }: { note: Note; me: string | undefined; short: boolean; locked: boolean }) {
  const toast = useToast();
  const decide = useUpdateDecision();
  const act = useUpdateAction();
  const models = useAiModels();
  const pending = usePendingActions();
  const reader = useNoteReader()(readerRole(note.received));
  /* What you said here wasn't decided stays in place, saying so, with Undo, until you pick another note. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  // Each press keeps its own answer (mutateAsync), so a quick second press, or picking another note, never loses the first one's error.
  const change = async (d: Decision, patch: DecisionPatch) => {
    setTouched((t) => new Set(t).add(d.id));
    try { await decide.mutateAsync({ noteId: note.id, decisionId: d.id, patch }); } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  const tick = async (a: ActionItem, done: boolean) => {
    try { await act.mutateAsync({ noteId: note.id, actionId: a.id, patch: { done } }); } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  const more = (n: number, what: string) => n > 0 && <Link to="/notes/$noteId" params={{ noteId: note.id }} className="nt-more">{n} more {what} in the notes<Icon name="right" size={14} /></Link>;

  if (note.status !== 'ready') {
    const kept = note.kept.recording ? 'The audio is saved and encrypted.' : 'The call has ended.';
    const open = isUnencrypted(models.data, note.model);
    const where = open ? 'by an unencrypted AI model' : 'in confidential compute';
    const writing = `The notes are being written ${where}${note.kind === 'room' ? '' : ', and everyone invited gets them'}.`;
    return <p className="nt-pv-wait"><Icon name="lock" size={16} /><span>{note.status === 'recording' ? `Still recording. The notes are written ${where} once it stops.` : `${kept} ${writing}`}</span></p>;
  }
  if (!note.summary.trim()) {
    return note.transcript?.length
      ? <Notice tone="caution" icon="pen" className="nt-pv-notice"><b>The summary couldn’t be written.</b> The transcript and the audio are kept, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.</Notice>
      : <p className="nt-pv-s nt-quiet">{noSummary(note)}</p>;
  }
  const decided = note.decisions.filter((d) => d.state !== 'rejected' || touched.has(d.id));
  return (
    <>
      <p className={cn('nt-pv-s', short && 'ac-clamp-2')}>{note.summary}</p>
      {decided.length > 0 && (
        <section className="nt-sec" aria-label="Decisions">
          {decided.slice(0, DECISIONS).map((d) => <DecisionRow key={d.id} d={d} note={note} me={me} reader={reader} busy={decide.isPending} locked={locked} onChange={(x, patch) => void change(x, patch)} />)}
          {more(decided.length - DECISIONS, decided.length - DECISIONS === 1 ? 'decision' : 'decisions')}
        </section>
      )}
      {note.actions.length > 0 && (
        <section className="nt-sec" aria-label="Follow-ups">
          {note.actions.slice(0, FOLLOW_UPS).map((a) => <FollowUp key={a.id} a={a} note={note} me={me} reader={reader} locked={locked} syncing={pending.has(`${note.id}:${a.id}`)} onTick={(x, done) => void tick(x, done)} />)}
          {more(note.actions.length - FOLLOW_UPS, note.actions.length - FOLLOW_UPS === 1 ? 'follow-up' : 'follow-ups')}
        </section>
      )}
      {note.unencrypted.length > 0
        ? <p className="nt-pv-f flex flex-wrap items-center gap-2 text-caution"><span>{unencryptedLine(note.unencrypted, models.data)}</span><Unencrypted compact /></p>
        : <SealedBadge inline title={sealedLine(note)} className="nt-pv-f" />}
    </>
  );
}

/** A decision, settled where it sits: what's waiting offers Confirm, and what's settled says by whom, with Undo for whoever may. */
function DecisionRow({ d, note, me, reader, busy, locked, onChange }: { d: NoteDecision; note: Note; me: string | undefined; reader: NoteReader; busy: boolean; locked: boolean; onChange: (d: Decision, patch: DecisionPatch) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const was = useRef(d.state);
  /* Answering takes away the button you pressed: focus moves to what took its place, not the page. */
  useEffect(() => {
    if (was.current === d.state) return;
    was.current = d.state;
    const at = document.activeElement;
    if (at === document.body || (at && row.current?.contains(at))) (row.current?.querySelector('button') ?? row.current)?.focus({ preventScroll: true });
  }, [d.state]);
  /* Confirmed, and someone says it wasn't decided: the organizer's to settle. */
  const settling = !locked && d.state === 'confirmed' && reader.role === 'organizer' && d.disputes.length > 0;
  const yes = !locked && (settling || (d.state === 'proposed' && mayDecide(d, 'confirmed', reader)));
  const no = !locked && (d.state === 'proposed' || settling) ? notDecided(d, reader) : undefined;
  const mine = d.disputes.some((x) => isBy(x.by, reader));
  const undo = !locked && (d.state === 'confirmed' || d.state === 'rejected') && !settling && mayDecide(d, 'proposed', reader);
  let under: ReactNode;
  if (!mine && (yes || no)) {
    under = (
      <div className="nt-d-a">
        {yes && <button type="button" className="hm-yes" disabled={busy} onClick={() => onChange(d, { state: 'confirmed', seen: { text: d.text } })}>{settling ? 'Keep it confirmed' : 'Confirm'}</button>}
        {no && <button type="button" className="nt-act" disabled={busy} onClick={() => onChange(d, no)}>It wasn’t decided</button>}
      </div>
    );
  } else {
    under = (
      <p className="nt-d-s">
        <span>{mine ? 'You said this wasn’t decided' : decisionLine(d, me)}</span>
        {mine && !locked && <button type="button" className="nt-act" disabled={busy} onClick={() => onChange(d, { dispute: false })}>Take that back</button>}
        {undo && <button type="button" className="nt-act" disabled={busy} onClick={() => onChange(d, { state: 'proposed' })}>Undo</button>}
      </p>
    );
  }
  return (
    <div ref={row} tabIndex={-1} className={cn('nt-d', d.state !== 'proposed' && 'is-settled')}>
      <span className="hm-tile-i"><Icon name="badgeCheck" size={16} /></span>
      <div className="nt-d-b">
        <p className="nt-d-t">{d.text}</p>
        {d.disputes.length > 0 && !mine && <div className="nt-d-f"><EvidenceFlags evidence={{ ...d.evidence, flags: [] }} disputes={d.disputes} me={me} /></div>}
        {under}
      </div>
      {d.at !== undefined ? <MomentChip noteId={note.id} noteTitle={note.title} at={d.at} /> : <span />}
    </div>
  );
}

/** A follow-up, ticked off where it sits, with when it's due or, when it's someone else's, whose it is. */
function FollowUp({ a, note, me, reader, locked, syncing, onTick }: { a: ActionItem; note: Note; me: string | undefined; reader: NoteReader; locked: boolean; syncing: boolean; onTick: (a: ActionItem, done: boolean) => void }) {
  const theirs = a.owner && spokenName(a.owner, me) !== 'You' ? firstName(a.owner.name) : undefined;
  const whose = theirs ? `${theirs}${a.takenOn ? '' : '?'}` : a.due ?? '';
  return (
    <div aria-busy={syncing} className={cn('nt-f', a.done && 'is-done')}>
      <Check checked={a.done} disabled={locked || !mayChangeAction(a, reader)} onChange={(on) => onTick(a, on)} label={`Mark done: ${a.text}`} />
      <span className="nt-f-t ac-clamp-1" title={a.text}>{a.text}</span>
      {a.at !== undefined ? <MomentChip noteId={note.id} noteTitle={note.title} at={a.at} /> : <span />}
      <span className="nt-f-d ac-clamp-1" role={syncing ? 'status' : undefined} title={theirs ? `${a.takenOn ? 'Took it on' : 'Suggested. Hasn’t taken it on yet'}${a.due ? `, ${a.due}` : ''}` : a.due}>{syncing ? 'Saving…' : whose}</span>
    </div>
  );
}
