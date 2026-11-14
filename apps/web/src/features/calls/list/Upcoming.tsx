/*
 * A call ahead, at /calls/upcoming/<meeting ID>: the page a call has before it happens, on the same evening as one that has.
 * Under its title, one line: when and how long, who's invited, its series. On the left the stage, always night, with
 * everyone invited in arches and how each has answered (its organizer sees everyone's; anyone else, their own), and
 * "Join shows here five minutes before it starts" until Join does; under it, the link with Copy link. On the right, the
 * agenda: what's brought to the call, each opening where it lives, and Add an agenda, New board and Upload, each made in
 * the call's workspace before the call (`calls.ready`) and opened there, for everyone invited; then whether the call
 * writes notes, and who can open them. Its organizer has Change (the scheduler) and, in More, what the list's menu
 * offers (cancelling it among them); someone invited answers Yes, Maybe or No, and More proposes another time.
 */
import { errorCode, errorMessage, type CallDocument, type ChangeScope, type DocumentPreview, type Meeting, type NotesChoices, type NotesSetting, type Person, type Rsvp } from '@alcove/api';
import {
  Avatar, Button, CallAnswered, CallReply, Evening, Faces, FileCard, GhostArch, Icon, NotesSwitches, ScopeBar, buttonClass, cn, useToast
} from '@alcove/ui';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { shownUrl, useCopyLink } from '~/features/call/session/links';
import { pictureOf } from '~/features/workspace/document/picture';
import { useOneColumn } from '~/features/notes/Call';
import { CallHead, GonePage } from '~/features/notes/Head';
import { MOST_ARCHES, archSize } from '~/features/notes/player/Stage';
import { stemOf, uploadInto } from '~/features/workspace/uploads/uploads';
import { useMyModelUnencrypted } from '~/features/notes/models';
import { useNow } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { workspaceQueries } from '~/features/workspace/queries';
import { callQueries, useAnswerCall, usePendingRsvp, useReadyCall, useUpdateCall } from './queries';
import { daysFromToday, hm, shortDay, weekday } from '~/lib/time';
import { called } from '../flow/Documents';
import { useFloodToCall } from '../flow/parts';
import { useOpenScheduling } from '../scheduling/search';
import { pickerName, repeatLineHere, waitingLine } from '../scheduling/words';
import { ANSWERED, lengthOf, type Ahead } from './ahead';
import { AheadMenu } from './Menus';

const ulog = log.child({ component: 'call-ahead' });

/** How long before a call starts Join shows on its page, as it does on Home. */
const JOIN_AHEAD_MS = 5 * 60_000;

/** How each person invited has answered, as their arch says it; nothing said yet, they're only invited. */
const STATE: Record<Rsvp, string> = { yes: 'Accepted', maybe: 'Maybe', no: 'Can’t come' };


/** "Today at 10:00", "Tomorrow at 10:00", "Thursday at 10:00", or further off, "Tue 24 Nov at 10:00". */
function dayAt(at: Date, now: Date): string {
  const n = daysFromToday(at, now);
  const day = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? weekday(at) : shortDay(at);
  return `${day} at ${hm(at)}`;
}

/** "Ines, Aiko and you" */
const andList = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** Someone on the stage before the call: who, what their arch says under their name, and dimmed while they haven't answered. */
interface Invited { key: string; person: Person; name: string; state: string | undefined; dim: boolean }

/**
 * Who's on the stage: everyone else first (the organizer leading, for someone invited), then you. Its organizer sees how each
 * answered; someone invited sees only their own, as the API tells it.
 */
function invitedOn(m: Meeting, me: string | undefined): Invited[] {
  const isMe = (p: Person) => !!me && sameEmail(p, { email: me });
  const answerOf = (p: Person) => m.answers?.find((a) => sameEmail(p, a))?.answer ?? null;
  const others: Invited[] = [];
  let mine: Invited | undefined;
  const add = (p: Person, state: string | undefined, dim: boolean) => {
    if (isMe(p)) mine = { key: p.email.toLowerCase(), person: p, name: 'You', state, dim: false };
    else if (!others.some((o) => sameEmail(o.person, p))) others.push({ key: p.email.toLowerCase(), person: p, name: callName(p), state, dim });
  };
  add(m.organizer, 'Organizer', false);
  for (const g of m.guests) {
    // Answers the API didn't say aren't guessed at: nobody's dimmed for them.
    if (m.isOrganizer && m.answers) { const a = answerOf(g); add(g, a ? STATE[a] : 'Invited', a === null && !m.offer); }
    else add(g, isMe(g) ? (m.rsvp ? STATE[m.rsvp] : 'Invited') : m.isOrganizer ? 'Invited' : undefined, false);
  }
  return mine ? [...others, mine] : others;
}

/** The call as a row of the list has it, for the list's own menu. */
const asAhead = (m: Meeting): Ahead => ({ kind: 'call', id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, call: m });

/**
 * A call ahead's page, by its meeting's ID. A call cancelled while it's open (from More, here) goes back to Calls, where the
 * toast that says so has Undo; one that was never there, or isn't open to you, says so in its place.
 */
export function CallAhead({ meetingId }: { meetingId: string }) {
  const navigate = useNavigate();
  const seen = useRef(false);
  const meeting = useQuery({ ...callQueries.meeting(meetingId), throwOnError: (e) => !seen.current || errorCode(e) !== 'not-found' });
  const m = meeting.data;
  useEffect(() => { if (m) seen.current = true; }, [m]);
  const gone = meeting.isError && errorCode(meeting.error) === 'not-found';
  useEffect(() => { if (gone) void navigate({ to: '/calls', replace: true }); }, [gone, navigate]);
  return m && !gone ? <AheadView key={m.id} m={m} /> : null;
}

/** A call ahead that isn't here, or couldn't be read: why, and the way back. */
export function AheadMissing({ error }: { error: unknown }) {
  const notFound = errorCode(error) === 'not-found';
  return <GonePage title={notFound ? 'This call isn’t here' : 'Couldn’t open this call'} lead={notFound ? 'It was cancelled, or it isn’t one you were invited to.' : errorMessage(error)} />;
}

function AheadView({ m }: { m: Meeting }) {
  const me = useQuery(accountQueries.session()).data?.user;
  const now = useNow(15_000);
  const page = useRef<HTMLDivElement>(null);
  const one = useOneColumn(page);
  const schedule = useOpenScheduling();
  const at = new Date(m.startsAt);
  const offered = m.offer?.times;
  const changeable = m.isOrganizer && m.status === 'scheduled' && !offered;
  const people = invitedOn(m, me?.email);
  const others = people.filter((p) => p.name !== 'You');
  const unseen = Math.max(0, m.guestCount + 1 - people.length);
  const who = others.length ? andList([...others.map((p) => p.name), ...(unseen ? [`${unseen} more`] : []), ...(people.length > others.length ? ['you'] : [])]) : 'Just you';
  const when = offered ? `${offered.length} times offered` : m.status === 'live' ? `Happening now · ${lengthOf(m)}` : `${dayAt(at, new Date(now))} · ${lengthOf(m)}`;
  const series = m.seriesId ? (m.repeat ? repeatLineHere(m.repeat, at) : 'In a series') : undefined;
  return (
    <Evening ref={page} moment="note" className={cn('cd is-ahead', one && 'is-one')} data-view="ahead">
      <CallHead title={m.title} acts={(
        <>
          {changeable && <Button size="sm" icon="cal" onClick={() => schedule({ schedule: 'move', meeting: m.id })}>Change</Button>}
          <AheadMenu a={asAhead(m)} now={new Date(now)} />
        </>
      )}>
        <span className="when">{when}</span>
        <span className="who">{people.length > 0 && <Faces people={people.map((p) => p.person)} size={22} max={5} />}<span>{who}</span></span>
        {m.seriesId && series && (
          <Link to="/calls" search={{ series: m.seriesId }} className="cd-ser" title="Every call in this series">
            <Icon name="repeat" size={15} /><span>{series}</span><Icon name="chevron" size={13} className="chev" />
          </Link>
        )}
      </CallHead>
      <div className="cd-cols" style={{ '--d': 1 }}>
        <div className="cd-left">
          <Lobby m={m} people={people} more={unseen} now={now} />
          <JoinLink m={m} />
        </div>
        <aside className="cd-right" aria-label="Before the call">
          <div className="cd-pane is-soon">
            {!m.isOrganizer && m.status === 'scheduled' && <YourAnswer m={m} />}
            <Agenda m={m} first={m.isOrganizer || m.status !== 'scheduled'} quiet={joinable(m, now)} />
            <NotesOn m={m} others={others.map((p) => p.person)} unseen={unseen} />
          </div>
        </aside>
      </div>
    </Evening>
  );
}

/** Whether Join is offered: the call's going, or starts within five minutes, and has a time. */
const joinable = (m: Meeting, now: number) => !m.offer && (m.status === 'live' || (m.status === 'scheduled' && Date.parse(m.startsAt) - now <= JOIN_AHEAD_MS));

/**
 * The stage before the call: everyone invited, in arches, with how each answered, and at its foot what happens next: Join
 * shows five minutes before it starts, Pick a time for a guest offered times, or that it's over, with its notes.
 */
function Lobby({ m, people, more, now }: { m: Meeting; people: Invited[]; more: number; now: number }) {
  const toast = useToast();
  const { go, flood } = useFloodToCall();
  const count = people.length + more;
  const size = archSize(count);
  const shown = people.slice(0, count > MOST_ARCHES ? MOST_ARCHES - 1 : MOST_ARCHES);
  const left = count - shown.length;
  const join = joinable(m, now);
  const foot = m.status === 'ended' ? (
    <p className="cd-wait">This call has ended.{m.noteId && <> <Link to="/calls/$noteId" params={{ noteId: m.noteId }} className="cd-wait-a">Open its notes</Link></>}</p>
  ) : m.offer ? (m.isOrganizer ? <p className="cd-wait">{waitingLine(m)}. Join shows here once there’s a time.</p> : (
    <div className="cd-join"><Link to="/join/$code" params={{ code: m.code }} className={buttonClass({ variant: 'primary' })}><Icon name="calClock" size={18} />Pick a time</Link></div>
  )) : join ? (
    <div className="cd-join">
      <Button variant="primary" icon="video" onClick={(e) => { go(e.currentTarget, () => Promise.resolve(m.code)).catch((err: unknown) => toast(errorMessage(err), { icon: 'x' })); }}>Join</Button>
    </div>
  ) : <p className="cd-wait">Join shows here five minutes before it starts.</p>;
  return (
    <div className="cd-stage is-lobby" role="group" aria-label="Who’s invited">
      <div className="cd-arches" style={{ '--arch': `${size}px` }}>
        {shown.map((p) => (
          <span key={p.key} className={cn('cd-arch', p.dim && 'is-dim')}>
            <span className="ring"><Avatar person={p.person} size={size} /></span>
            <b className="ac-clamp-1">{p.name}</b>
            {p.state && <small>{p.state}</small>}
          </span>
        ))}
        {left > 0 && <span className="cd-arch is-more"><span className="ring"><GhostArch size={size} more={left} /></span><b>{left} more</b></span>}
      </div>
      {foot}
      {flood}
    </div>
  );
}

/** The call's link with Copy link: for a call offering times, the link its guest picks one at. */
function JoinLink({ m }: { m: Meeting }) {
  const copy = useCopyLink();
  const code = m.offer ? m.code : m.seriesCode ?? m.code;
  if (m.status === 'ended') return null;
  return (
    <div className="cd-joinlink">
      <Icon name="link" size={16} />
      <span>{shownUrl(code)}</span>
      <Button size="sm" icon="copy" onClick={() => copy(code)}>{m.offer && m.isOrganizer ? `Copy the link for ${pickerName(m)}` : 'Copy link'}</Button>
    </div>
  );
}

/** Yes, Maybe or No, for someone invited; once answered, what they said, with Change. The organizer sees it at once. */
function YourAnswer({ m }: { m: Meeting }) {
  const answer = useAnswerCall();
  const saving = usePendingRsvp(m.id);
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  if (m.offer) return null;
  const say = (a: Rsvp) => {
    const before = m.rsvp;
    setChanging(false);
    answer.mutateAsync({ id: m.id, answer: a }).then(
      () => toast(`${ANSWERED[a]}. ${callName(m.organizer)} sees your answer.`, { icon: 'check', ms: 6000, action: before && before !== a ? { label: 'Undo', onClick: () => void answer.mutateAsync({ id: m.id, answer: before }).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })) } : undefined }),
      (e: unknown) => toast(`Couldn’t say you’re coming. ${errorMessage(e)}`, { icon: 'x' })
    );
  };
  const choices: { value: Rsvp; label: string }[] = [{ value: 'yes', label: 'Yes' }, { value: 'maybe', label: 'Maybe' }, { value: 'no', label: 'No' }];
  return (
    <section className="cd-grp is-first cd-answer" aria-label="Your answer">
      <h2 className="cd-gh">Are you coming?</h2>
      {m.rsvp && !changing
        ? <CallAnswered change={() => setChanging(true)} changeLabel={`Change your answer to ${m.title}`}>{ANSWERED[m.rsvp]}</CallAnswered>
        : (
          <CallReply label={`Are you going to ${m.title}?`}>
            {choices.map((c) => <Button key={c.value} size="sm" aria-pressed={m.rsvp === c.value} disabled={saving} onClick={() => say(c.value)}>{c.label}</Button>)}
          </CallReply>
        )}
    </section>
  );
}

/** Where a brought document is, for whoever can open it: the library has every one they can bring, by the ID a call keeps. */
function usePlaces(documents: readonly CallDocument[]): ReadonlyMap<string, { workspaceId: string; item: string }> {
  const library = useQuery({ ...workspaceQueries.documents(), enabled: documents.some((d) => d.name !== null) }).data;
  return useMemo(() => new Map((library?.workspaces ?? []).flatMap((w) => w.documents.map((d) => [d.id, { workspaceId: w.id, item: d.item }] as const))), [library]);
}

/** What the brought documents say at the top, as their cards in the Drive show it: asked of each workspace once. */
function usePreviews(documents: readonly CallDocument[], places: ReadonlyMap<string, { workspaceId: string; item: string }>): ReadonlyMap<string, DocumentPreview> {
  const asks = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const d of documents) {
      const at = d.kind === 'doc' ? places.get(d.id) : undefined;
      if (at) by.set(at.workspaceId, [...(by.get(at.workspaceId) ?? []), at.item]);
    }
    return [...by].map(([workspaceId, items]) => workspaceQueries.previews(workspaceId, [...items].sort()));
  }, [documents, places]);
  const found = useQueries({ queries: asks });
  return useMemo(() => new Map(found.flatMap((r) => r.data ?? []).map((p) => [p.id, p])), [found]);
}

/** A hidden file input, opened by `pick`: the files go to `onFiles`. */
function useFilePick(onFiles: (files: File[]) => void): { input: ReactElement; pick: () => void } {
  const at = useRef<HTMLInputElement>(null);
  const input = <input ref={at} type="file" multiple hidden tabIndex={-1} onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (files.length) onFiles(files); }} />;
  return { input, pick: () => at.current?.click() };
}

/**
 * The agenda: what's brought to the call, each opening where it lives (someone who can't open one sees whose it is), then
 * Add an agenda, New board and Upload while the call is ahead. Each makes its thing in the call's workspace, settling one
 * for the call when it has none, brings it to the call and opens it, files uploading into it as it does. `quiet`: Join is
 * the page's one filled button now. `first`: nothing comes above it.
 */
function Agenda({ m, first, quiet }: { m: Meeting; first: boolean; quiet: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  const ready = useReadyCall();
  const [making, setMaking] = useState<'agenda' | 'board' | 'file' | null>(null);
  const places = usePlaces(m.documents);
  const previews = usePreviews(m.documents, places);
  const open = (workspaceId: string, documentId: string) => void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId, documentId }, search: { from: 'calls' } });
  /* The library can be a moment behind what was just brought: it's read again before saying a document can't be found. */
  const openBrought = async (d: CallDocument) => {
    const at = places.get(d.id) ?? (await qc.fetchQuery(workspaceQueries.documents()).then((l) => l.workspaces.flatMap((w) => w.documents.flatMap((x) => (x.id === d.id ? [{ workspaceId: w.id, item: x.item }] : []))).at(0), () => undefined));
    if (at) open(at.workspaceId, at.item);
    else toast('That one can’t be opened from here. It opens in the call.', { icon: 'x' });
  };
  const make = (what: 'agenda' | 'board' | 'file', files: readonly File[] = []) => {
    if (making) return;
    const one = files.length === 1 ? files[0] : undefined;
    const name = what === 'file' && one ? stemOf(one.name).replace(/\s+/g, ' ').trim().slice(0, 200) : undefined;
    setMaking(what);
    ready.mutate({ id: m.id, make: what, name }, {
      onSuccess: (home) => {
        open(home.workspaceId, home.itemId);
        if (what === 'file') {
          uploadInto({ workspaceId: home.workspaceId, documentId: home.itemId, owner, pass: undefined }, files, name ?? null).catch((e: unknown) => {
            ulog.warn('files for a call ahead weren’t uploaded', { meetingId: m.id, workspaceId: home.workspaceId, documentId: home.itemId, count: files.length, err: e });
            toast(errorMessage(e), { icon: 'x' });
          });
        }
      },
      onError: (e) => {
        ulog.info('a call ahead wasn’t made ready', { meetingId: m.id, make: what, code: errorCode(e) });
        toast(errorMessage(e), { icon: 'x' });
      },
      onSettled: () => setMaking(null)
    });
  };
  const files = useFilePick((picked) => make('file', picked));
  const ahead = m.status === 'scheduled';
  const ways = ahead && (
    <div className={cn('cd-ways', m.documents.length > 0 && 'is-more')}>
      <Button variant={m.documents.length || quiet ? 'secondary' : 'primary'} icon="fileText" loading={making === 'agenda'} disabled={making !== null} onClick={() => make('agenda')}>Add an agenda</Button>
      <Button variant={m.documents.length ? 'quiet' : 'secondary'} icon="presentation" loading={making === 'board'} disabled={making !== null} onClick={() => make('board')}>New board</Button>
      <Button variant="quiet" icon="upload" loading={making === 'file'} disabled={making !== null} onClick={files.pick}>Upload</Button>
      {files.input}
    </div>
  );
  const readable = m.documents.filter((d) => d.name !== null);
  const closed = m.documents.filter((d) => d.name === null);
  return (
    <section className={cn('cd-grp', first && 'is-first')} aria-label="Agenda">
      <h2 className="cd-gh">Agenda</h2>
      {m.documents.length === 0 ? (
        <div className="cd-ready">
          <p>{ahead ? 'Nothing for this call yet. An agenda, a board or a file added here opens for everyone invited, before the call and in it.' : 'Nothing was brought to this call.'}</p>
          {ways}
        </div>
      ) : (
        <>
          {readable.length > 0 && (
            <div className="cd-cards">
              {readable.map((d) => {
                const at = places.get(d.id);
                const pic = d.kind === 'board' ? { kind: 'board' as const, icon: undefined, thumb: undefined } : pictureOf({ kind: 'doc' }, at ? previews.get(at.item) : undefined);
                return <FileCard key={d.id} kind={pic.kind} icon={pic.icon} thumb={pic.thumb} name={called(d)} by={d.by ? `${d.by}’s` : undefined} onOpen={() => void openBrought(d)} />;
              })}
            </div>
          )}
          {closed.map((d) => (
            <p key={d.id} className="cd-closed"><Icon name={d.kind === 'board' ? 'presentation' : 'fileText'} size={15} /><span><b>{called(d)}</b> You can’t open this one.{d.by ? ` Ask ${d.by} for it.` : ''}</span></p>
          ))}
          {ways}
        </>
      )}
    </section>
  );
}

/** "The transcript and the recording are kept with them." */
function keptLine(c: NotesChoices): string {
  if (c.keepTranscript && c.keepRecording) return 'The transcript and the recording are kept with them.';
  if (c.keepTranscript) return 'The transcript is kept with them.';
  if (c.keepRecording) return 'The recording is kept with them.';
  return 'Only the notes are kept.';
}

/**
 * Whether the call writes notes, where they're written, what they keep and who can open them. Its organizer can change that
 * here, for this call or, in a series, this and later calls.
 */
function NotesOn({ m, others, unseen }: { m: Meeting; others: Person[]; unseen: number }) {
  const unencrypted = useMyModelUnencrypted();
  const update = useUpdateCall();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const [notes, setNotes] = useState<NotesSetting>(m.notes);
  const [choices, setChoices] = useState<NotesChoices>(m.choices);
  const [scope, setScope] = useState<ChangeScope>('this');
  const series = !!m.repeat || !!m.seriesId;
  const who = unseen ? 'the people invited' : andList([...others.map(callName), 'you']);
  const where = m.isOrganizer ? (unencrypted ? ' by an unencrypted AI model' : ' in confidential compute') : '';
  const line = m.notes === 'on'
    ? `On. They’re written after the call${where}, with what was decided and who does what. Only ${who} can open them. ${keptLine(m.choices)}`
    : 'Off. Nothing is recorded, and nobody gets notes.';
  const same = notes === m.notes && (['keepTranscript', 'keepRecording', 'allowScreens'] as const).every((k) => choices[k] === m.choices[k]);
  const save = () => {
    if (same) { setChanging(false); return; }
    update.mutate({ id: m.id, input: { ...(notes !== m.notes ? { notes } : {}), ...(notes === 'on' ? { choices } : {}) }, scope: series ? scope : undefined }, {
      onSuccess: () => { setChanging(false); toast('Saved.', { icon: 'check' }); },
      onError: (e) => toast(errorMessage(e), { icon: 'x' })
    });
  };
  const start = () => { setNotes(m.notes); setChoices(m.choices); setScope('this'); setChanging(true); };
  return (
    <section className="cd-grp" aria-label="Notes">
      <div className="cd-gh-row">
        <h2 className="cd-gh">Notes</h2>
        {m.isOrganizer && m.status === 'scheduled' && !changing && <button type="button" className="cd-link" onClick={start}>Change</button>}
      </div>
      {changing ? (
        <div className="cd-notes-change">
          <NotesSwitches modelPrivate={!unencrypted} notes={notes} choices={choices} onNotes={setNotes} onChoices={setChoices} />
          {series && <ScopeBar value={scope} onChange={setScope} />}
          <div className="cd-pop-f">
            <Button variant="quiet" size="sm" onClick={() => setChanging(false)}>Cancel</Button>
            <Button size="sm" loading={update.isPending} disabled={same} onClick={save}>Save</Button>
          </div>
        </div>
      ) : (
        <p className="cd-noteon"><Icon name={m.notes === 'on' ? 'sealed' : 'micOff'} size={16} /><span>{line}</span></p>
      )}
    </section>
  );
}

