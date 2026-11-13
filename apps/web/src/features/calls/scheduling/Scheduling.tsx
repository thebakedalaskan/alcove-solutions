/*
 * Scheduling a call, on the Calls page and not in a window: the scheduler takes the rail's place and the sheet becomes the
 * week. Top to bottom: back to Calls, the name to type over, Who, When (three times that work, the time as it will read,
 * how long, how it repeats) and Details (notes, and what the call brings), then a line on who will hear and the one button.
 * The same scheduler moves a call (Change the time), asks to move one you're invited to (Propose another time), and starts
 * from a call that happened (Meet again). It closes once it's done; the call is marked on the page, and a toast says what
 * happened, with Undo. On a phone it's one column, its foot pinned above the tabs.
 */
import { errorMessage, type ChangeScope, type Document, type Meeting, type MeetingInput, type Patch, type Person } from '@alcove/api';
import { Button, Dots, EmptyState, Icon, Segmented, Select, Switch, SwitchLine, TimeCardWaiting, Unencrypted, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCopyLink } from '~/features/call/session/links';
import { NoNotesLeftDoor } from '~/features/plans/notesDoors';
import { freshCalls, movedCalls } from '~/features/shell/context';
import { useMyModelUnencrypted } from '~/lib/aiModels';
import { log } from '~/lib/log';
import { byEmail, callName, listNames, sameEmail } from '~/lib/people';
import { calendarConnectUrl, q, useCancelCall, useProposeTime, useScheduleCall, useUpdateCall } from '~/lib/queries';
import { hm, timeZone } from '~/lib/time';
import { Bring } from './Bring';
import { BIG_CALL, NOT_REPEATING, guestsOf, newDraft, repeatInput, titleFor, type Draft, type Guests, type Repeating } from '../flow/draft';
import { Failed } from '../flow/parts';
import { useTimes } from './availability';
import { FixedToken, PeopleField } from './PeopleField';
import { PLACES, clockIn, placeLine } from './places';
import { useScheduleWith, type ScheduleSearch } from './search';
import { expandRepeat, localDay, localWeekday } from './times';
import { Lengths, RepeatChoice, StartEnd, TimeCards, type CardTime } from './when';
import { WeekSheet } from './WeekSheet';
import { callCount, cancelNote, cancelledLine, dayWord, freeLine, restoredLine, shortTime, timeLine, whenLine } from './words';

const slog = log.child({ component: 'scheduling' });

/** The most times a guest can be offered, which is how many cards there are to tick; and the fewest. */
const MOST_OFFERED = 3;
const FEWEST_OFFERED = 2;
const minutesOf = (m: Meeting) => Math.max(5, Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000));
const soonestFirst = (a: Date, b: Date) => a.getTime() - b.getTime();

/** What the scheduler is doing: making a call, moving one of yours, or asking to move one you're invited to. */
type Job = { kind: 'new' } | { kind: 'move'; meeting: Meeting } | { kind: 'propose'; meeting: Meeting };
/** Where it starts from: who, when, what it's called and what it brings. */
interface Start { job: Job; people: Person[]; title: string; at: Date | null; minutes: number | undefined; bring: readonly string[] }

/**
 * Scheduling, for the Calls page to show in place of its rail and sheet while its address says `schedule`. `onClose` takes
 * it away again: ← Calls, or once the call is scheduled or moved.
 */
export function Scheduling({ search, onClose }: { search: ScheduleSearch; onClose: () => void }) {
  const people = useScheduleWith();
  const slot = search.slot ? new Date(search.slot) : null;
  const at = slot && slot.getTime() > Date.now() ? slot : null;
  if (search.schedule === 'move') return <ForCall id={search.meeting} onClose={onClose} />;
  if (search.schedule === 'again') return <AfterCall id={search.note} at={at} onClose={onClose} />;
  return <ForPeople emails={people} at={at} minutes={search.minutes} bring={search.bring ?? []} onClose={onClose} />;
}

/** A new call, with whoever was picked before it opened: known by name and face once the people you know are read. */
function ForPeople({ emails, at, minutes, bring, onClose }: { emails: string[]; at: Date | null; minutes: number | undefined; bring: readonly string[]; onClose: () => void }) {
  const team = useQuery(q.team());
  const known = useQuery({ ...q.people(''), enabled: emails.length > 0 });
  if (emails.length && (team.isPending || known.isPending)) return <Waiting onClose={onClose} />;
  const who = (email: string): Person => team.data?.members.find((m) => sameEmail(m.person, { email }))?.person
    ?? known.data?.find((s) => sameEmail(s.person, { email }))?.person ?? byEmail(email);
  return <Scheduler start={{ job: { kind: 'new' }, people: emails.map(who), title: '', at, minutes, bring }} onClose={onClose} />;
}

/** Moving a call, or asking to: it's read first, to know whose it is and where it is now. */
function ForCall({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const meeting = useQuery({ ...q.meeting(id ?? ''), enabled: !!id });
  if (!id || meeting.isError) return <Missing what="That call isn’t there any more" onClose={onClose} />;
  if (!meeting.data) return <Waiting onClose={onClose} />;
  const m = meeting.data;
  if (m.status !== 'scheduled' || m.offer) return <Missing what={m.offer ? 'A time is still being picked for this call' : 'This call has started, so it can’t move now'} onClose={onClose} />;
  /* Asking to move someone else's call, the times that matter most are its organizer's. */
  return <Scheduler key={m.id} start={{ job: m.isOrganizer ? { kind: 'move', meeting: m } : { kind: 'propose', meeting: m }, people: m.isOrganizer ? m.guests : [m.organizer, ...m.guests], title: m.title, at: null, minutes: minutesOf(m), bring: [] }} onClose={onClose} />;
}

/** Meeting again after a call: the same people and name. */
function AfterCall({ id, at, onClose }: { id: string | undefined; at: Date | null; onClose: () => void }) {
  const note = useQuery({ ...q.note(id ?? ''), enabled: !!id });
  const me = useQuery(q.session()).data?.user.email;
  if (!id || note.isError) return <Missing what="Those notes aren’t there any more" onClose={onClose} />;
  if (!note.data) return <Waiting onClose={onClose} />;
  const n = note.data;
  return <Scheduler key={n.id} start={{ job: { kind: 'new' }, people: n.people.filter((p) => !me || !sameEmail(p, { email: me })), title: n.title, at, minutes: undefined, bring: [] }} onClose={onClose} />;
}

/** The scheduler's two halves while what it starts from is read. */
function Waiting({ onClose }: { onClose: () => void }) {
  return (
    <div className="sc">
      <aside className="sc-comp" aria-busy="true" aria-label="Scheduling">
        <div className="sc-scroll"><Back onClose={onClose} /><p className="sc-wait"><Dots /></p></div>
      </aside>
      <section className="sc-sheet" aria-hidden="true" />
    </div>
  );
}

/** What it was to start from has gone. */
function Missing({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <div className="sc">
      <aside className="sc-comp" aria-label="Scheduling">
        <div className="sc-scroll">
          <Back onClose={onClose} />
          <EmptyState title={what}>Go back to Calls to see what’s coming up.</EmptyState>
        </div>
      </aside>
      <section className="sc-sheet" aria-hidden="true" />
    </div>
  );
}

const Back = ({ onClose }: { onClose: () => void }) => (
  <button type="button" className="sc-back" onClick={onClose}><Icon name="left" size={16} />Calls</button>
);

/** Who hears about a call as it's scheduled: Google's invitations, a demo calendar's, or nobody without one. */
type Telling = 'google' | 'sample' | 'nobody';

function Scheduler({ start, onClose }: { start: Start; onClose: () => void }) {
  const { job } = start;
  const moving = job.kind !== 'new';
  const meeting = job.kind === 'new' ? undefined : job.meeting;
  const session = useQuery(q.session()).data;
  const prefs = useQuery(q.prefs()).data;
  const team = useQuery(q.team()).data;
  // Connecting in another tab keeps this draft: it's read again when the page comes back to it.
  const calendar = useQuery({ ...q.calendar(), refetchOnWindowFocus: (query) => (query.state.data?.needsAccess ? 'always' : false) }).data;
  const library = useQuery({ ...q.documents(), enabled: start.bring.length > 0 }).data;
  const unencrypted = useMyModelUnencrypted();
  const me = session?.user.email;
  const [draft, setDraft] = useState<Draft>(() => ({
    ...newDraft(prefs, { people: start.people }), at: start.at, minutes: start.minutes ?? 45, title: start.title, titled: !!start.title,
    ...(meeting ? { notes: meeting.notes, choices: meeting.choices } : {})
  }));
  const change = (d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d }));
  /* Letting a guest pick: on unless it's been turned off; which of the times are ticked (all of them, until one's unticked). */
  const [letPick, setLetPick] = useState<boolean | null>(null);
  const [unticked, setUnticked] = useState<number[]>([]);
  /* Where an outside guest is, as you've said: only for showing their times. */
  const [zone, setZone] = useState<string | null>(null);
  const [scope, setScope] = useState<ChangeScope>('this');
  const [keeping, setKeeping] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const copy = useCopyLink();
  const schedule = useScheduleCall();
  const update = useUpdateCall();
  const propose = useProposeTime();
  const cancel = useCancelCall();

  /* What it brings, from the address: named once the library is read. */
  const brought = useRef(false);
  useEffect(() => {
    if (brought.current || !library || !start.bring.length) return;
    brought.current = true;
    const all = library.workspaces.flatMap((w) => w.documents);
    setDraft((x) => ({ ...x, documents: all.filter((d) => start.bring.includes(d.id)) }));
  }, [library, start.bring]);

  const guests = useMemo(() => guestsOf(draft.tokens, me), [draft.tokens, me]);
  const emails = useMemo(() => guests.map((g) => g.email), [guests]);
  /* Moving, one more to choose from, since where it is now isn't one of them. */
  const times = useTimes(emails, draft.minutes, meeting, moving ? MOST_OFFERED + 1 : MOST_OFFERED);
  const current = meeting ? new Date(meeting.startsAt) : null;
  const telling: Telling = calendar?.source === 'sample' ? 'sample' : calendar?.source === 'google' && !calendar.needsAccess && prefs?.addToCalendar !== false ? 'google' : 'nobody';
  const noCalendar = !calendar || calendar.source === 'none' || calendar.needsAccess;
  const inCompany = (p: Person) => !!team?.members.some((m) => sameEmail(m.person, p));
  const [only] = guests;
  /* Someone whose calendar can't be read can pick a time themselves, when they're the only one invited. */
  const offerable = job.kind === 'new' && !times.loading && guests.length === 1 && times.unreadable.length === 1 && times.slots.length >= FEWEST_OFFERED;
  const offering = offerable && letPick !== false;
  const outside = only && times.unreadable.some((e) => sameEmail({ email: e }, only)) && !inCompany(only) ? only : undefined;
  const place = PLACES.find((p) => p.zone === zone);

  /*
   * The times on the cards: the best, soonest first, a time picked from the week or typed in place of the last of them.
   * Moving, never where it is now; and first, the times people invited have asked for.
   */
  const asked = (meeting?.isOrganizer ? meeting.proposals ?? [] : []).map((p) => ({ at: new Date(p.startsAt), who: meeting?.guests.find((g) => sameEmail(g, p)) }))
    .filter((p) => p.at.getTime() > Date.now());
  const askedOf = (at: Date) => asked.find((p) => p.at.getTime() === at.getTime());
  const best = [...asked.map((p) => times.slot(p.at)), ...times.slots.filter((s) => (!current || s.at.getTime() !== current.getTime()) && !askedOf(s.at))].slice(0, MOST_OFFERED);
  /* With nobody in yet, nothing's picked until a time is: the week is where to start. */
  const chosen = offering ? null : draft.at ?? (guests.length || moving ? best[0]?.at ?? null : null);
  const known = (at: Date) => best.some((s) => s.at.getTime() === at.getTime());
  const slots = (chosen && !known(chosen) ? [...best.slice(0, MOST_OFFERED - 1), times.slot(chosen)] : best.slice(0, MOST_OFFERED)).sort((a, b) => soonestFirst(a.at, b.at));
  const offered = offering ? best.slice(0, MOST_OFFERED).map((s) => s.at).filter((t) => !unticked.includes(t.getTime())).sort(soonestFirst) : null;
  const cards: CardTime[] = slots.map((s) => {
    const by = askedOf(s.at);
    return { at: s.at, note: by ? `${by.who ? callName(by.who) : 'Someone'} asked` : freeLine(s) || undefined, guest: offering && place && outside ? `${clockIn(place.zone, s.at)} for ${callName(outside)}` : undefined };
  });
  const pickCard = (at: Date) => {
    if (!offering) { change({ at }); return; }
    const off = unticked.includes(at.getTime());
    if (!off && (offered?.length ?? 0) <= FEWEST_OFFERED) return;
    setUnticked((u) => (off ? u.filter((t) => t !== at.getTime()) : [...u, at.getTime()]));
  };

  const zoneHere = meeting?.repeat?.timeZone ?? timeZone();
  const series = !!meeting?.repeat;
  const [repeatMove, setRepeatMove] = useState<Repeating>(() => (meeting?.repeat ? repeatingOf(meeting, zoneHere) : NOT_REPEATING));
  const repeats = job.kind === 'new' && !offering ? draft.repeat : job.kind === 'move' && series && scope === 'following' ? repeatMove : NOT_REPEATING;
  const repeat = chosen ? repeatInput(repeats, chosen, zoneHere) : null;
  const named = draft.titled ? draft.title : guests.length ? titleFor(draft.tokens, guests) : '';
  const big = guests.length > BIG_CALL;
  const muted = big && (draft.joinMuted ?? true);
  const names = listNames(guests);
  const to = meeting && !meeting.isOrganizer ? callName(meeting.organizer) : undefined;

  /* Who's told, and how: what the foot says beside the button. */
  const foot = (() => {
    if (job.kind === 'propose') return `${to ?? 'The organizer'} sees it, and can move the call there.`;
    if (job.kind === 'move') return !meeting?.guestCount ? 'Nobody else is invited.' : meeting.calendarUrl || telling === 'sample' ? `${meeting.calendarUrl ? 'Google Calendar tells' : 'Your calendar tells'} ${listNames(meeting.guests)}.` : 'Nobody’s told until you send them the link.';
    if (offering) return telling === 'google' ? `Holds them on your calendar until ${only ? callName(only) : 'your guest'} picks. The others clear then.` : `You get a link to send to ${only ? callName(only) : 'your guest'}.`;
    if (!guests.length) return chosen ? 'Nobody’s invited: you get a link to share.' : 'Add who it’s with, or skip that and share a link.';
    if (telling === 'google') return `Google Calendar invites ${names}.`;
    if (telling === 'sample') return `${names} ${guests.length === 1 ? 'gets' : 'get'} an invitation.`;
    return 'Without a calendar, nobody is told. Share the link yourself.';
  })();
  const ready = job.kind === 'new' ? (offering ? (offered?.length ?? 0) >= FEWEST_OFFERED : !!chosen && (guests.length > 0 || !!draft.at)) : !!chosen && chosen.getTime() !== current?.getTime();
  const when = chosen ? shortTime(chosen, times.now).replace(/^Tomorrow/, 'tomorrow').replace(/^Today/, 'today') : '';
  const goLabel = job.kind === 'propose' ? (chosen ? `Ask to move it to ${when}` : 'Ask to move it')
    : job.kind === 'move' ? (chosen ? `Move to ${when}` : 'Move')
      : offering ? `Send ${only ? callName(only) : 'your guest'} the times`
        : repeat ? `Schedule ${callCount(repeat.occurrences.length)}` : 'Schedule';

  /* The name is ready to type over once there's someone to name it after; until then, who it's with comes first. */
  useEffect(() => {
    if (!moving && start.people.length && matchMedia('(hover: hover)').matches) { title.current?.focus({ preventScroll: true }); title.current?.select(); }
  }, [moving, start.people.length]);

  const said = (at: Date) => `${dayWord(at, times.now).replace(/^Tomorrow/, 'tomorrow').replace(/^Today/, 'today')} at ${hm(at)}`;
  /* The toast that says a call was scheduled: what happened, who heard, and Undo while there's one to give. */
  const scheduled = async (m: Meeting) => {
    freshCalls.add(m.id);
    const code = m.seriesCode ?? m.code;
    const copied = () => navigator.clipboard?.writeText(`${location.origin}/join/${code}`).then(() => true, () => false) ?? Promise.resolve(false);
    const offerLink = { label: 'Copy link', onClick: () => copy(code) };
    const undo = { label: 'Undo', onClick: () => cancel.mutate({ id: m.id, code: m.code, scope: m.repeat ? 'following' : undefined }, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) }) };
    if (m.offer) {
      const who = only ? callName(only) : 'your guest';
      if (await copied()) toast(`Link copied for ${who}. The call waits until they pick a time.`, { icon: 'link', ms: 7000 });
      else toast(`Send ${who} the link to pick a time.`, { icon: 'link', ms: 9000, action: offerLink });
      return;
    }
    const at = `Scheduled for ${said(new Date(m.startsAt))}.`;
    if (!guests.length) {
      if (await copied()) toast(`${at} Link copied.`, { icon: 'cal', ms: 6000, action: undo });
      else toast(at, { icon: 'cal', ms: 9000, action: offerLink });
      return;
    }
    if (m.calendarUrl) { toast(`${at} Google Calendar invites ${names}.`, { icon: 'cal', ms: 6000, action: undo }); return; }
    if (telling === 'sample') { toast(`${at} ${names} ${guests.length === 1 ? 'gets' : 'get'} an invitation.`, { icon: 'cal', ms: 6000, action: undo }); return; }
    toast(`${at} Nobody’s been told yet.`, { icon: 'cal', ms: 9000, action: offerLink });
  };

  const go = async () => {
    if (sending || !ready) return;
    setSending(true);
    setFailed(null);
    try {
      if (job.kind === 'propose' && chosen) {
        await propose.mutateAsync({ id: job.meeting.id, startsAt: chosen.toISOString() });
        onClose();
        toast(`${to ?? 'The organizer'} sees your proposed time and can move the call to it.`, { icon: 'cal', ms: 6000 });
        return;
      }
      if (job.kind === 'move' && chosen) {
        const m = job.meeting;
        const minutes = draft.minutes;
        const was = { startsAt: m.startsAt, durationMinutes: minutesOf(m) };
        /* The call's old day stops counting: it's the new one that repeats, beside any others picked. */
        const reRepeat = series && scope === 'following' ? repeatInput({ ...repeatMove, days: repeatMove.days.filter((d) => d !== localWeekday(new Date(m.startsAt), zoneHere)) }, chosen, zoneHere) : null;
        const input: Patch<MeetingInput> = { startsAt: chosen.toISOString(), ...(minutes !== was.durationMinutes ? { durationMinutes: minutes } : {}), ...(reRepeat ? { repeat: reRepeat } : {}) };
        const applied = series ? scope : undefined;
        const next = await update.mutateAsync({ id: m.id, input, scope: applied });
        movedCalls.add(next.id);
        onClose();
        const told = m.guestCount && (next.calendarUrl || telling === 'sample') ? ` ${next.calendarUrl ? 'Google Calendar tells' : 'Your calendar tells'} ${listNames(m.guests)}.` : '';
        const back = scope === 'this' ? { label: 'Undo', onClick: () => { void update.mutateAsync({ id: m.id, input: was, scope: applied }).then(() => movedCalls.add(m.id), (e: unknown) => toast(`Couldn’t undo that. ${errorMessage(e)}`, { icon: 'x', ms: 6000 })); } } : undefined;
        toast(`Moved to ${said(chosen)}.${told}`, { icon: 'cal', ms: 6000, action: back });
        return;
      }
      const at = offered?.[0] ?? chosen;
      if (!at) return;
      const input: MeetingInput = {
        title: named.trim() || titleFor(draft.tokens, guests), startsAt: at.toISOString(), durationMinutes: draft.minutes, guests: emails, notes: draft.notes,
        ...(draft.notes === 'on' ? { choices: draft.choices } : {}), ...(big ? { joinMuted: muted } : {}),
        ...(draft.documents.length ? { documents: draft.documents.map((d) => d.id) } : {}), ...(draft.home ? { workspaceId: draft.home.id } : {}),
        ...(repeat ? { repeat } : {}), ...(offered ? { offer: offered.map((t) => t.toISOString()) } : {})
      };
      const m = await schedule.mutateAsync(input);
      onClose();
      void scheduled(m);
    } catch (e) {
      slog.info('scheduling didn’t go through', { kind: job.kind, err: e });
      setFailed(e);
    } finally {
      setSending(false);
    }
  };

  const cancelCall = async () => {
    if (job.kind !== 'move') return;
    const m = job.meeting;
    const applied = m.repeat ? scope : undefined;
    setFailed(null);
    try {
      await cancel.mutateAsync({ id: m.id, code: m.code, scope: applied });
      onClose();
      /* One call comes back as it was, with a new link; a call in a series can't rejoin it. */
      const again = !m.repeat ? { label: 'Undo', onClick: () => {
        void schedule.mutateAsync({ title: m.title, startsAt: m.startsAt, durationMinutes: minutesOf(m), guests: m.guests.map((g) => g.email), notes: m.notes, choices: m.choices, joinMuted: m.joinMuted, documents: m.documents.flatMap((d) => (d.name === null ? [] : [d.id])) })
          .then((next) => toast(restoredLine(next), { icon: 'cal', ms: 9000, action: { label: 'Copy link', onClick: () => copy(next.code) } }), (e: unknown) => toast(`Couldn’t schedule the call again. ${errorMessage(e)}`, { icon: 'x', ms: 6000 }));
      } } : undefined;
      toast(cancelledLine(m, applied === 'following'), { icon: 'trash', ms: 6000, action: again });
    } catch (e) {
      setFailed(e);
    }
  };

  /* What the week's ghost and key call people: their first names. */
  const weekGuests = useMemo(() => guests.map((g) => ({ email: g.email, name: callName(g) })), [guests]);
  const answers = new Map((meeting?.answers ?? []).map((a) => [a.email.toLowerCase(), a.answer]));
  const stateOf = (p: Person) => {
    const a = answers.get(p.email.toLowerCase());
    return a === 'yes' ? 'Going' : a === 'no' ? 'Not going' : a === 'maybe' ? 'Maybe' : 'No answer yet';
  };
  const showWhen = moving || guests.length > 0 || !!draft.at;
  const label = job.kind === 'move' ? `Move ${job.meeting.title}` : job.kind === 'propose' ? `Propose another time for ${job.meeting.title}` : 'Schedule a call';

  return (
    <div className="sc">
      <aside className="sc-comp" aria-label={label}>
        <div className="sc-scroll">
          <Back onClose={onClose} />
          {meeting ? (
            <>
              <h2 className="sc-title is-fixed">{job.kind === 'propose' ? `Another time for ${meeting.title}` : `Move ${meeting.title}`}</h2>
              <p className="sc-from"><span>Was</span><s>{timeLine(new Date(meeting.startsAt), minutesOf(meeting))}</s></p>
            </>
          ) : (
            <input ref={title} className="sc-title" type="text" value={named} placeholder="Name this call" aria-label="The call’s name" autoComplete="off" enterKeyHint="done"
              onChange={(e) => change({ title: e.target.value, titled: true })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void go(); } }} />
          )}

          <section className="sc-sec" aria-label="Who">
            <h3>Who</h3>
            {meeting ? (
              <div className="cf-field sc-field is-fixed">
                {(meeting.isOrganizer ? meeting.guests : [meeting.organizer, ...meeting.guests.filter((g) => !me || !sameEmail(g, { email: me }))]).map((p) => (
                  <FixedToken key={p.email} person={p} state={meeting.isOrganizer ? stateOf(p) : sameEmail(p, meeting.organizer) ? 'Organizer' : 'Invited'} />
                ))}
                {!meeting.guests.length && <span className="sc-none">Nobody else is invited</span>}
              </div>
            ) : (
              <PeopleField value={draft} onChange={(g: Guests) => change(g)} me={me} places={outside && place ? new Map([[outside.email.toLowerCase(), placeLine(place, chosen ?? times.now)]]) : undefined} />
            )}
            {!moving && outside && (
              <div className="sc-hint">
                <Icon name="cal" size={15} />
                <span>{team ? `${callName(outside)} is outside ${team.name.split(' ')[0] ?? team.name}, so their calendar can’t be read.` : `You can’t see ${callName(outside)}’s calendar.`}</span>
                <Select className="sc-zone" label={`Where ${callName(outside)} is`} value={zone ?? 'here'} align="end"
                  options={[{ value: 'here', label: 'Where are they?' }, ...PLACES.map((p) => ({ value: p.zone, label: p.name }))]} onChange={(v) => setZone(v === 'here' ? null : v)} />
              </div>
            )}
          </section>

          {showWhen && (
            <section className="sc-sec" aria-label="When">
              <h3>When</h3>
              {job.kind === 'move' && series && (
                <Segmented className="sc-scope" value={scope} onChange={setScope} label="Which calls" options={[{ value: 'this', label: 'This call' }, { value: 'following', label: 'This and later calls' }]} />
              )}
              {noCalendar && !times.loading ? (
                <div className="sc-nocal">
                  <span>Without a calendar these are open working hours. Connect it to see when people are free.</span>
                  <a className={buttonClass({ variant: 'secondary', size: 'sm' })} href={calendarConnectUrl()} target="_blank" rel="noopener noreferrer">Connect Google Calendar</a>
                </div>
              ) : (
                <p className="sc-free">{times.loading ? 'Reading calendars…' : offering && only
                  ? `Free on your calendar. Tick the ones ${callName(only)} can pick from; they see them in their own time.`
                  : !best.length ? 'Nothing is free in the next two weeks. Pick a time on the week.'
                    : whenLine({ guests, slots: times.slots, source: times.source, failed: times.failed, unknown: times.unknown })}</p>
              )}
              {times.loading ? <div className="cf-times sc-cards" aria-busy="true">{[0, 1, 2].map((i) => <TimeCardWaiting key={i} />)}</div>
                : cards.length > 0 && <TimeCards times={cards} now={times.now} picked={chosen} ticks={offered ? (at) => !unticked.includes(at.getTime()) : undefined} onPick={pickCard} />}
              {!offering && chosen && (
                <>
                  <StartEnd at={chosen} minutes={draft.minutes} now={times.now} onChange={(c) => change({ at: c.at, minutes: c.minutes })} />
                  <Lengths minutes={draft.minutes} onChange={(minutes) => change({ minutes, at: chosen })} />
                </>
              )}
              {job.kind === 'new' && !offering && chosen && <RepeatChoice repeat={draft.repeat} at={chosen} onChange={(r) => change({ repeat: r })} />}
              {job.kind === 'move' && series && scope === 'following' && chosen && <RepeatChoice repeat={repeatMove} at={chosen} zone={zoneHere} keep onChange={setRepeatMove} />}
              {offerable && only && (
                <div className="sc-row is-switch">
                  <Icon name="people" size={17} />
                  <span className="min-w-0"><b>Let {callName(only)} pick</b><small>They choose one of the times you tick, from a link.</small></span>
                  <Switch checked={offering} label={`Let ${callName(only)} pick`} onChange={(on) => { setLetPick(on); setUnticked([]); }} />
                </div>
              )}
            </section>
          )}

          {job.kind === 'new' && (guests.length > 0 || !!draft.at) && (
            <section className="sc-sec" aria-label="Details">
              <h3>Details</h3>
              <div className="sc-row is-switch">
                <Icon name="notes" size={17} className={cn(draft.notes === 'on' && 'is-rec')} />
                <span className="min-w-0"><b>Notes</b><small>{draft.notes === 'on' ? 'Everyone invited gets them' : 'Nothing is recorded'}</small></span>
                <Switch checked={draft.notes === 'on'} label="Notes" onChange={(on) => change({ notes: on ? 'on' : 'off' })} />
              </div>
              {draft.notes === 'on' && (
                <>
                  {/* None of your notes left when it starts: until when, and the way to more (a time offered: its first). */}
                  <NoNotesLeftDoor at={chosen ?? offered?.[0]} />
                  <button type="button" className="sc-more" aria-expanded={keeping} onClick={() => setKeeping((k) => !k)}>What the notes keep<Icon name="chevron" size={14} /></button>
                  {keeping && (
                    <div className="sc-keep">
                      <SwitchLine title="Keep the transcript" sub={draft.choices.keepTranscript ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
                        control={<Switch checked={draft.choices.keepTranscript} label="Keep the transcript" onChange={(keepTranscript) => change({ choices: { ...draft.choices, keepTranscript } })} />} />
                      <SwitchLine title="Keep the recording" sub={draft.choices.keepRecording ? 'Play back any moment from the notes' : 'Deleted when the call ends'}
                        control={<Switch checked={draft.choices.keepRecording} label="Keep the recording" onChange={(keepRecording) => change({ choices: { ...draft.choices, keepRecording } })} />} />
                      <SwitchLine title="Read shared screens" sub="Whoever shares is asked whether it goes in the notes"
                        control={<Switch checked={draft.choices.allowScreens} label="Read shared screens" onChange={(allowScreens) => change({ choices: { ...draft.choices, allowScreens } })} />} />
                      <Home draft={draft} change={change} />
                      {unencrypted
                        ? <p className="sc-sealed"><Icon name="shieldOff" size={14} />Written by an AI model outside a secure enclave. <Unencrypted compact /></p>
                        : <p className="sc-sealed"><Icon name="sealed" size={14} />Written by an AI model in confidential compute.</p>}
                    </div>
                  )}
                </>
              )}
              {big && (
                <div className="sc-row is-switch">
                  <Icon name="megaphone" size={17} />
                  <span className="min-w-0"><b>Everyone joins muted</b><small>Microphones and cameras off, for a call this big</small></span>
                  <Switch checked={muted} label="Everyone joins muted" onChange={(joinMuted) => change({ joinMuted })} />
                </div>
              )}
              <Bring picked={draft.documents} onChange={(documents: Document[]) => change({ documents })} />
            </section>
          )}
        </div>

        {failed !== null && <Failed error={failed} />}
        <footer className={cn('sc-foot', asking && 'is-asking')}>
          {job.kind === 'move' && (asking ? (
            <div className="sc-ask" role="group" aria-label="Cancel this call">
              <span>Cancel {job.meeting.repeat && scope === 'following' ? 'this and later calls' : 'this call'}? {cancelNote(job.meeting, scope === 'following')}</span>
              <span className="sc-ask-a">
                <Button variant="quiet" size="sm" onClick={() => setAsking(false)}>Keep it</Button>
                <Button size="sm" loading={cancel.isPending} onClick={() => void cancelCall()}>Cancel the call</Button>
              </span>
            </div>
          ) : <Button variant="quiet" size="sm" icon="trash" className="sc-cancel" onClick={() => setAsking(true)}>Cancel this call</Button>)}
          <p>{foot}</p>
          <Button variant="primary" disabled={!ready} loading={sending} onClick={() => void go()}>{goLabel}</Button>
        </footer>
      </aside>

      <WeekSheet guests={weekGuests} chosen={chosen} minutes={draft.minutes} title={named || 'New call'} suggested={guests.length || moving ? best.slice(0, MOST_OFFERED).map((s) => s.at) : []} offered={offered}
        picker={only ? callName(only) : undefined} was={meeting ? { at: new Date(meeting.startsAt), minutes: minutesOf(meeting) } : undefined} except={meeting} noCalendar={noCalendar}
        onPick={(at) => { if (offering) setLetPick(false); change({ at }); }}
        onRange={(at, minutes) => { if (offering) setLetPick(false); change({ at, minutes: Math.max(15, minutes) }); }}
        onMinutes={(minutes) => change({ at: chosen, minutes })} />
    </div>
  );
}

/** A series' repeat, as the choice that changes it holds it: what it does, and how many calls it has from this one. */
function repeatingOf(m: Meeting, zone: string): Repeating {
  const r = m.repeat;
  if (!r) return NOT_REPEATING;
  const at = new Date(m.startsAt);
  const calls = expandRepeat(r.rule, at, r.until, zone).length;
  const kind = r.rule.every === 'month' ? 'month' : r.rule.weeks === 2 ? 'two-weeks' : r.rule.days.length === 1 && r.rule.days[0] === localWeekday(at, zone) ? 'week' : 'days';
  return { kind, days: r.rule.every === 'week' ? r.rule.days : [], calls: localDay(at, zone) <= r.until ? calls : null };
}

/** Where the notes go: a new workspace made for the call, or one of yours you can make things in. */
function Home({ draft, change }: { draft: Draft; change: (d: Partial<Draft>) => void }) {
  const spaces = useQuery(q.workspaces()).data ?? [];
  const homes = spaces.flatMap((w) => (w.name !== null && (w.role === 'admin' || w.role === 'edit') ? [{ id: w.id, name: w.name }] : []));
  return (
    <SwitchLine title="Where they go" sub={draft.home ? 'In a folder of their own' : 'Everyone invited is in it'} control={
      <Select label="Where the notes go" value={draft.home?.id ?? 'new'} align="end"
        options={[{ value: 'new', label: 'A new workspace', icon: 'plus' }, ...homes.map((h) => ({ value: h.id, label: h.name, icon: 'folders' as const }))]}
        onChange={(id) => change({ home: id === 'new' ? null : homes.find((h) => h.id === id) ?? null })} />
    } />
  );
}
