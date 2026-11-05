/*
 * Notes: every note you have, newest first and grouped by day. Search them, show only calls, recordings in the room
 * or notes shared with you, or only the ones you have with one person (`#with=<address>`). On a wide screen the note
 * picked in the list shows beside it, with what it decided and what's still to do; narrower, a note opens on its own
 * page. Before the first notes, the page shows what they'll look like.
 */
import { EmailParamSchema, errorCode, errorMessage, type ActionItem, type Decision, type Note, type NoteKind, type NoteSummary, type Person } from '@alcove/api';
import {
  ArchThumb, Avatar, Button, Check, Chip, EmptyArch, EmptyState, Faces, GhostArch, GoneArch, Icon, IconButton, Notice, NotesSign, Popover, SealedBadge, Segmented, Spinner,
  buttonClass, cn, coverFor, useToast, type IconName
} from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { NoteCard } from '~/features/notes/NoteCard';
import { highlight } from '~/features/notes/highlight';
import { peopleLine, receivedLine } from '~/features/notes/meta';
import { MomentLink, decisionLine } from '~/features/notes/parts';
import { PinNote, ShareNote } from '~/features/notes/share';
import { useCallFlow } from '~/features/shell/context';
import { byEmail, callName, fold, sameEmail, spokenName } from '~/lib/people';
import { q, useUpdateAction, useUpdateDecision } from '~/lib/queries';
import { daysFromToday, hm, hoursAndMinutes, noteDay, noteGroup, shortDay } from '~/lib/time';
import { capital, plural } from '~/lib/words';

export const Route = createFileRoute('/_app/notes/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(q.notes()),
  component: Notes
});

/** What the list shows: everything, calls, recordings in the room, or notes someone shared with you. */
type Show = 'all' | NoteKind | 'shared';
const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'call', label: 'Calls' }, { value: 'room', label: 'In the room' }, { value: 'shared', label: 'Shared with you' }
];

/**
 * The person after `#with=` in the address (the hash never leaves the browser, so their address never reaches a
 * server's logs), when it's an email address; anything else means no one. The address arrives as
 * encodeURIComponent wrote it, and the router leaves `%40` as it is.
 */
function withOf(hash: string): string | undefined {
  const raw = /^with=(.+)$/.exec(hash)?.[1];
  const email = EmailParamSchema.safeParse(raw?.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  return email.success ? email.data : undefined;
}

/** The preview sits beside the list from 1241px; narrower, the list is alone and a note opens on its own page. */
const WIDE = '(min-width: 1241px)';
const onWide = (changed: () => void) => {
  const m = matchMedia(WIDE);
  m.addEventListener('change', changed);
  return () => m.removeEventListener('change', changed);
};
const useWide = () => useSyncExternalStore(onWide, () => matchMedia(WIDE).matches, () => true);

const minutes = (seconds: number) => hoursAndMinutes(Math.max(1, Math.round(seconds / 60)));

function Notes() {
  const all = useQuery(q.notes()).data ?? [];
  const me = useQuery(q.session()).data?.user;
  return all.length ? <Library all={all} me={me?.email} /> : <FirstNotes me={me} />;
}

/** Someone you have notes with, and how many. */
interface Known { person: Person; count: number }
/** Everyone else in your notes, the people you have most notes with first. */
function peopleIn(notes: NoteSummary[], me: string | undefined): Known[] {
  const found = new Map<string, Known>();
  for (const n of notes) {
    for (const p of n.people) {
      if (me && sameEmail(p, { email: me })) continue;
      const key = p.email.toLowerCase();
      const k = found.get(key);
      // Someone known only by their address in one note may have a name in another.
      if (k) found.set(key, { person: k.person.name === k.person.email ? p : k.person, count: k.count + 1 });
      else found.set(key, { person: p, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name));
}

function Library({ all, me }: { all: NoteSummary[]; me: string | undefined }) {
  const navigate = useNavigate();
  const wide = useWide();
  const box = useRef<HTMLElement>(null);
  const [text, setText] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const term = useDeferredValue(text.trim());
  const who = withOf(useRouterState({ select: (s) => s.location.hash }));
  const found = useQuery(q.notes(show === 'call' || show === 'room' ? show : undefined, term || undefined)).data ?? [];
  const inbox = useQuery(q.inbox()).data;
  const pinned = useQuery(q.prefs()).data?.pinned ?? [];
  const known = peopleIn(all, me);
  const inNotes = who ? known.find((k) => sameEmail(k.person, { email: who }))?.person : undefined;
  const team = useQuery({ ...q.team(), enabled: !!who && !inNotes }).data;
  const person = who ? inNotes ?? team?.members.find((m) => sameEmail(m.person, { email: who }))?.person ?? byEmail(who) : undefined;

  const list = found.filter((n) => (show !== 'shared' || n.received?.role === 'shared') && (!who || n.people.some((p) => sameEmail(p, { email: who }))));
  const current = list.find((n) => n.id === picked) ?? list[0];
  const groups = [...new Set(list.map((n) => noteGroup(n.startedAt)))];
  const toConfirm = (id: string) => inbox?.decisions.filter((d) => d.noteId === id).length ?? 0;
  const narrowed = !!term || show !== 'all' || !!who;

  const withSomeone = (email: string | undefined) => void navigate({ to: '/notes', hash: email ? `with=${encodeURIComponent(email)}` : '', hashScrollIntoView: false, resetScroll: false });
  /* Taking the person off moves focus to "With anyone", where the chip that had it was. */
  const withButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => { if (!who && refocus.current) { refocus.current = false; withButton.current?.focus(); } }, [who]);
  const anyone = () => { refocus.current = true; withSomeone(undefined); };
  /* On a wide screen a click picks a note for the preview; a double click, Enter, or a click with a modifier opens it, as a link does. */
  const pick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!wide || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.detail !== 1) return;
    e.preventDefault();
    setPicked(id);
  };
  /* The list is one stop for Tab: arrows, Home and End move through it, and the preview follows. */
  const move = (e: KeyboardEvent<HTMLAnchorElement>, id: string) => {
    if (!wide) return;
    const ids = list.map((n) => n.id);
    const i = ids.indexOf(id);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = ids[Math.max(0, Math.min(ids.length - 1, to))];
    if (!next) return;
    setPicked(next);
    box.current?.querySelector<HTMLElement>(`[data-note="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <>
      <div className="head" style={{ '--d': 0 }}>
        <div>
          <h1>Notes</h1>
          <p className="lede">{all.length === 1 ? '1 note, written in confidential compute. Alcove can’t read it.' : `${all.length} notes, each written in confidential compute. Alcove can’t read any of them.`}</p>
        </div>
        <Link to="/record" className={buttonClass({ variant: 'secondary' })}><Icon name="recordDot" size={18} />Record in the room</Link>
      </div>
      <div className="lib-tools" style={{ '--d': 1 }}>
        <label className="lib-search"><Icon name="search" size={17} /><input className="ac-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search titles, summaries and transcripts" autoComplete="off" aria-label="Search notes" /></label>
        <Segmented<Show> value={show} onChange={setShow} label="Show" options={SHOW} />
        <WithSomeone known={known} person={person} button={withButton} onPick={(email) => (email ? withSomeone(email) : anyone())} />
      </div>
      <p className="sr-only" role="status">{narrowed ? plural(list.length, 'note') : ''}</p>
      {list.length ? (
        <div className="notes-split" style={{ '--d': 2 }}>
          <section ref={box} className="ac-card lib" aria-label={person ? `Notes with ${person.name}` : 'Notes'}>
            {groups.map((g) => (
              <div key={g} className="lib-grp">
                <h2 className="grp">{g}</h2>
                {list.filter((n) => noteGroup(n.startedAt) === g).map((n) => (
                  <Row key={n.id} n={n} term={term} toConfirm={toConfirm(n.id)} pinned={pinned.includes(n.id)} on={wide && n.id === current?.id} wide={wide}
                    onPick={pick} onMove={move} />
                ))}
              </div>
            ))}
          </section>
          {wide && current && <Preview key={current.id} s={current} me={me} />}
        </div>
      ) : (
        <section className="ac-card lib lib-none" style={{ '--d': 2 }}>
          <Nothing term={term} show={show} person={person} onClear={() => setText('')} onAll={() => { setShow('all'); anyone(); }} onAnyone={anyone} />
        </section>
      )}
    </>
  );
}

/** Under a note's title: whose it is, where, and what's left to do, or that only you have it. */
function byLine(n: NoteSummary, toConfirm: number): string {
  const organizer = n.people[0];
  const bits: string[] = [];
  if (n.received) bits.push(`From ${organizer ? callName(organizer) : callName(n.received.by)}’s ${n.kind === 'room' ? 'recording' : 'call'}`);
  else if (n.kind === 'room') bits.push('In the room');
  if (n.status === 'recording') bits.push('Recording');
  else if (n.status === 'pending') bits.push('Being written');
  else {
    if (n.openActions) bits.push(`${plural(n.openActions, 'follow-up')} open`);
    if (toConfirm) bits.push(`${toConfirm} to confirm`);
  }
  if (!n.received && n.people.length <= 1) bits.push('only you');
  return capital(bits.join(' · ') || (n.totalActions ? 'Follow-ups done' : 'No follow-ups'));
}

/** What a note says before its summary exists, or when nothing was said. */
const noSummary = (n: { kind: NoteKind; status: NoteSummary['status'] }) =>
  n.status === 'recording' ? 'Recording now.'
    : n.status === 'pending' ? 'The summary, decisions and follow-ups show here once they’re written.'
      : n.kind === 'room' ? 'Nothing was said while recording.' : 'Nothing was said while notes were on.';

function Row({ n, term, toConfirm, pinned, on, wide, onPick, onMove }: {
  n: NoteSummary; term: string; toConfirm: number; pinned: boolean; on: boolean; wide: boolean;
  onPick: (e: MouseEvent<HTMLAnchorElement>, id: string) => void; onMove: (e: KeyboardEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const shared = n.received?.role === 'shared';
  const recent = daysFromToday(new Date(n.startedAt)) >= -1;
  return (
    <Link to="/notes/$noteId" params={{ noteId: n.id }} data-note={n.id} className={cn('lrow', on && 'on')} aria-current={on ? 'true' : undefined}
      tabIndex={wide ? (on ? 0 : -1) : undefined} onClick={(e) => onPick(e, n.id)} onKeyDown={(e) => onMove(e, n.id)}>
      <ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} />
      <span className="body">
        <b className="ac-clamp-1">{highlight(n.title, term)}</b>
        <span className="sum ac-clamp-1">{n.excerpt ? highlight(n.excerpt, term) : noSummary(n)}</span>
        <span className="by">
          {n.people.length > 1 ? <Faces people={n.people} size={20} max={4} /> : <Icon name="lock" size={14} />}
          <span className="ac-clamp-1">{byLine(n, toConfirm)}</span>
        </span>
      </span>
      <span className="side">
        <span className="dt">{pinned && <><Icon name="pin" size={13} className="pin" /><span className="sr-only">Pinned. </span></>}{recent ? hm(n.startedAt) : shortDay(new Date(n.startedAt))}</span>
        {shared && <Chip tone="sun">Shared with you</Chip>}
      </span>
    </Link>
  );
}

/** A note's state, as a chip: ready, still being written, or still recording. */
function StatusChip({ status }: { status: NoteSummary['status'] }) {
  if (status === 'recording') return <NotesSign>Recording</NotesSign>;
  if (status === 'pending') return <Chip><Spinner className="size-3" />Being written</Chip>;
  return <Chip tone="sun" icon="check">Ready</Chip>;
}

/** When the notes were last checked as written in confidential compute: the time today, else the day. */
function sealedLine(n: Note): string {
  const proof = n.inference.find((e) => e.task === 'notes') ?? n.inference[0];
  if (!proof) return 'Confidential compute';
  const d = new Date(proof.verifiedAt);
  return `Confidential compute · verified ${daysFromToday(d) === 0 ? hm(d) : shortDay(d)}`;
}

/* At most this many decisions and follow-ups beside the list; the note has the rest. */
const DECISIONS = 3;
const FOLLOW_UPS = 4;

/** The picked note beside the list: its state, pin, Share and Open notes; when, who; the summary, decisions and follow-ups. */
function Preview({ s, me }: { s: NoteSummary; me: string | undefined }) {
  const h = useId();
  const qc = useQueryClient();
  /* A note that went meanwhile (deleted, or taken out of yours) isn't asked for again; the list is, so its row goes. */
  const found = useQuery({ ...q.note(s.id), retry: (n, e) => errorCode(e) !== 'not-found' && n < 2 });
  const note = found.data;
  const gone = found.isError && errorCode(found.error) === 'not-found';
  useEffect(() => { if (gone) void qc.invalidateQueries({ queryKey: ['notes', 'list'] }); }, [gone, qc]);
  return (
    <section className="ac-card pv" aria-labelledby={h}>
      <div className="pv-top">
        <StatusChip status={s.status} />
        <div className="pv-acts">
          <PinNote noteId={s.id} />
          {note ? <ShareNote note={note} size="sm" /> : <Button variant="secondary" size="sm" icon="share" disabled>Share</Button>}
          <Link to="/notes/$noteId" params={{ noteId: s.id }} className={buttonClass({ variant: 'primary', size: 'sm' })}>Open notes<Icon name="right" size={16} /></Link>
        </div>
      </div>
      <h2 id={h} className="ac-clamp-2">{s.title}</h2>
      <div className="doc-meta">
        <span className="ac-mono">{noteDay(s.startedAt)} · {hm(s.startedAt)} · {minutes(s.duration)}</span>
        <span className="who"><Faces people={s.people} size={24} max={4} /><span className="ac-clamp-1">{peopleLine(s.people, me)}</span></span>
        {s.received && <span className="from"><Icon name={s.received.role === 'shared' ? 'share' : 'video'} size={14} />{receivedLine(s.received)}</span>}
      </div>
      {note ? <PreviewBody note={note} me={me} />
        : found.isError ? (
          <div className="pv-gone">
            <GoneArch />
            <b>{gone ? 'These notes aren’t here any more' : 'Couldn’t open these notes'}</b>
            <p>{gone ? 'They were deleted, or taken out of your notes.' : errorMessage(found.error)}</p>
          </div>
        ) : <div className="pv-wait"><Spinner /></div>}
    </section>
  );
}

function PreviewBody({ note, me }: { note: Note; me: string | undefined }) {
  const toast = useToast();
  const decide = useUpdateDecision();
  const act = useUpdateAction();
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const confirm = (d: Decision) => decide.mutate({ noteId: note.id, decisionId: d.id, patch: { state: 'confirmed' } }, { onError: failed });
  const tick = (a: ActionItem, done: boolean) => act.mutate({ noteId: note.id, actionId: a.id, patch: { done } }, {
    onSuccess: () => { if (done) toast('Marked done', { ms: 2200 }); }, onError: failed
  });
  const everyone = note.kind === 'room' ? 'They show here when they’re ready.' : 'Everyone invited gets them when they’re ready.';
  const decided = note.decisions.filter((d) => d.state !== 'rejected');
  const unconfirmed = decided.filter((d) => d.state === 'proposed').length;
  const open = note.actions.filter((a) => !a.done).length;
  const more = (n: number, what: string) => n > 0 && <Link to="/notes/$noteId" params={{ noteId: note.id }} className="pv-more">{n} more {what} in the notes<Icon name="right" size={14} /></Link>;

  let body: ReactNode;
  if (note.status !== 'ready') {
    body = (
      <Notice tone="info" icon="lock" className="pv-sec">
        <b>{note.status === 'recording' ? 'The recording is still going.' : 'The audio is saved and encrypted.'}</b> Summary, decisions and follow-ups are {note.status === 'recording' ? 'written in confidential compute once it stops' : 'being written in confidential compute'}. {everyone}
      </Notice>
    );
  } else if (!note.summary.trim()) {
    body = note.transcript?.length
      ? <Notice tone="caution" icon="pen" className="pv-sec"><b>The summary couldn’t be written.</b> The transcript and the audio are kept, and you can still ask about the {note.kind === 'room' ? 'recording' : 'call'}.</Notice>
      : <p className="pv-sec pv-quiet">{noSummary(note)}</p>;
  } else {
    body = (
      <>
        <div className="pv-sec"><div className="ac-eyebrow">Summary</div><p className="summary">{note.summary}</p></div>
        {decided.length > 0 && (
          <div className="pv-sec">
            <div className="ac-eyebrow">Decided{unconfirmed ? ` · ${unconfirmed} to confirm` : ''}</div>
            {decided.slice(0, DECISIONS).map((d) => (
              <div key={d.id} className="pv-row">
                {d.state === 'confirmed' ? <span className="ac-tick"><Icon name="check" size={13} /></span> : <span className="ac-tick maybe" />}
                <span className="min-w-0">{d.text}
                  <small>{d.state === 'proposed' ? <>Proposed by the notes · <button type="button" className="lk" onClick={() => confirm(d)}>Confirm</button></> : decisionLine(d, me)}</small>
                </span>
                {d.at !== undefined ? <MomentLink noteId={note.id} at={d.at} /> : <span />}
              </div>
            ))}
            {more(decided.length - DECISIONS, decided.length - DECISIONS === 1 ? 'decision' : 'decisions')}
          </div>
        )}
        {note.actions.length > 0 && (
          <div className="pv-sec">
            <div className="ac-eyebrow">Follow-ups · {open} open</div>
            {note.actions.slice(0, FOLLOW_UPS).map((a) => (
              <div key={a.id} className={cn('pv-act', a.done && 'done')}>
                <Check checked={a.done} onChange={(on) => tick(a, on)} label={`Mark done: ${a.text}`} />
                <span className="t">{a.text}</span>
                {a.owner ? (
                  <span className={cn('ac-owner', !a.takenOn && 'maybe')} title={a.takenOn ? 'Took it on' : 'Suggested. Hasn’t taken it on yet'}>
                    <Avatar person={a.owner.person ?? { name: a.owner.name }} size={18} />{spokenName(a.owner, me)}{a.takenOn ? '' : '?'}
                  </span>
                ) : <span />}
                <span className="due-t ac-clamp-1">{a.due ?? ''}</span>
              </div>
            ))}
            {more(note.actions.length - FOLLOW_UPS, note.actions.length - FOLLOW_UPS === 1 ? 'follow-up' : 'follow-ups')}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {body}
      <div className="pv-foot">
        <SealedBadge inline title={sealedLine(note)} />
        <span className="have">{note.recipients.length === 1 ? 'Only you have these' : `${note.recipients.length} people have these`}</span>
      </div>
    </>
  );
}

/** The people filter: everyone you have notes with, to pick one; once someone is picked, a chip that takes them off. */
function WithSomeone({ known, person, button, onPick }: {
  known: Known[]; person: Person | undefined; button: RefObject<HTMLButtonElement | null>; onPick: (email: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const typed = fold(text.trim());
  const shown = known.filter((k) => !typed || fold(k.person.name).includes(typed) || k.person.email.toLowerCase().includes(typed)).slice(0, 40);
  const go = (email: string | undefined) => { setOpen(false); setText(''); onPick(email); };
  const anchor = person
    ? <button ref={button} type="button" className="lib-with-who" aria-label={`Notes with ${person.name}. Change who`}><Avatar person={person} size={20} /><span className="ac-clamp-1">With {callName(person)}</span></button>
    : <button ref={button} type="button" className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'lib-with')}>{known.length > 0 && <Faces people={known.slice(0, 3).map((k) => k.person)} size={20} />}With anyone<Icon name="down" size={14} /></button>;
  return (
    <span className={cn(person && 'lib-with-on')}>
      <Popover open={open} onOpenChange={setOpen} align="end" label="Show notes with someone" className="with-pop" anchor={anchor}>
        <label className="with-find"><Icon name="search" size={15} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find someone in your notes" aria-label="Find someone in your notes" autoComplete="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const first = shown[0]; if (first) go(first.person.email); } }} /></label>
        <div className="with-list">
          {person && <button type="button" className="with-row" onClick={() => go(undefined)}><span className="with-any"><Icon name="people" size={15} /></span><span className="min-w-0"><b>Anyone</b><small>All your notes</small></span></button>}
          {shown.map((k) => (
            <button key={k.person.email} type="button" className={cn('with-row', person && sameEmail(person, k.person) && 'sel')} onClick={() => go(k.person.email)}>
              <Avatar person={k.person} size={26} />
              <span className="min-w-0"><b className="ac-clamp-1">{k.person.name}</b><small>{plural(k.count, 'note')}</small></span>
            </button>
          ))}
          {!shown.length && <p className="with-none">{known.length ? 'Nobody by that name in your notes.' : 'Only you are in your notes so far.'}</p>}
        </div>
      </Popover>
      {person && <IconButton icon="x" size={14} label="Show notes with anyone" className="lib-with-x" onClick={() => onPick(undefined)} />}
    </span>
  );
}

/** What the list says when nothing in it is shown: for a search, a filter, or someone with no notes in common. */
function Nothing({ term, show, person, onClear, onAll, onAnyone }: {
  term: string; show: Show; person: Person | undefined; onClear: () => void; onAll: () => void; onAnyone: () => void;
}) {
  const flow = useCallFlow();
  const tile = (icon: IconName) => <span className="lib-tile"><Icon name={icon} size={22} /></span>;
  if (term) {
    return (
      <EmptyState art={tile('search')} title={`Nothing matches “${term}”`}
        action={<><Button variant="quiet" size="sm" onClick={onClear}>Clear search</Button>{(show !== 'all' || person) && <Button variant="quiet" size="sm" onClick={onAll}>Search all notes</Button>}</>}>
        Search looks through titles, summaries and transcripts of every note you have{show !== 'all' || person ? ', and only the ones shown here are searched now' : ''}.
      </EmptyState>
    );
  }
  if (person) {
    const name = callName(person);
    const title = show === 'shared' ? `${name} hasn’t shared any notes with you` : show === 'call' ? `No calls with ${name}`
      : show === 'room' ? `No recordings in the room with ${name}` : `No notes with ${name} yet`;
    return (
      <EmptyState art={<GhostPair person={person} />} title={title}
        action={<Button variant="secondary" size="sm" icon="people" onClick={onAnyone}>Show notes with anyone</Button>}>
        Notes from calls and recordings you both have show up here.
      </EmptyState>
    );
  }
  if (show === 'shared') {
    return <EmptyState title="Nothing shared with you yet">When someone shares their notes with you, they land here, marked with who sent them.</EmptyState>;
  }
  if (show === 'room') {
    return (
      <EmptyState title="Nothing recorded in the room yet" action={<Link to="/record" className={buttonClass({ size: 'sm' })}><Icon name="recordDot" size={16} />Record in the room</Link>}>
        Conversations you record in the room land here, with notes written the same way as a call’s.
      </EmptyState>
    );
  }
  return (
    <EmptyState title={show === 'call' ? 'No calls with notes yet' : 'No notes yet'} action={<Button size="sm" icon="video" onClick={() => flow.start()}>Start a call</Button>}>
      Calls with notes on land here as soon as they end. Everyone invited gets the notes.
    </EmptyState>
  );
}

/** Someone with no notes in common with you yet, in the arch beside an empty one. */
function GhostPair({ person }: { person: Person }) {
  return <span className="lib-ghosts" aria-hidden="true"><Avatar person={person} size={44} /><GhostArch size={44} /></span>;
}

/** Before the first notes: what they'll look like, and how to get them. */
function FirstNotes({ me }: { me: Person | undefined }) {
  const flow = useCallFlow();
  return (
    <>
      <div className="head" style={{ '--d': 0 }}><div><h1>Notes</h1><p className="lede">Calls with notes on, and recordings in the room, land here.</p></div></div>
      <section className="ac-card lib-first" style={{ '--d': 1 }} aria-label="No notes yet">
        <EmptyState className="big left" art={<EmptyArch size={96} />} title="No notes yet"
          action={<><Button variant="primary" icon="video" onClick={() => flow.start()}>Start a call</Button><Link to="/record" className={buttonClass({ variant: 'secondary' })}><Icon name="recordDot" size={18} />Record in the room</Link></>}>
          Your first notes appear here as soon as a call with notes on ends. Everyone invited gets them, and Alcove can’t read them.
        </EmptyState>
        <div className="lib-ex">
          <Link to="/notes/$noteId" params={{ noteId: 'example' }} className="lib-ex-note" aria-label="Open the example note"><NoteCard you={me} example /></Link>
          <p className="cap"><Icon name="notes" size={15} />This is what your notes will look like.</p>
        </div>
      </section>
      <div className="lib-facts" style={{ '--d': 2 }}>
        <Fact icon="pen" title="Notes are set when you schedule">Each call has notes or doesn’t. During a call, only the organizer can turn them on.</Fact>
        <Fact icon="mail" title="Everyone invited gets them">Even people who couldn’t make it. You can share them with anyone afterwards.</Fact>
        <Fact icon="sealed" title="Alcove can’t read them">Summaries, transcripts and audio are written and kept in confidential compute.</Fact>
      </div>
    </>
  );
}

function Fact({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="lib-fact"><span className="lib-tile"><Icon name={icon} size={18} /></span><div><b>{title}</b><p>{children}</p></div></div>;
}
