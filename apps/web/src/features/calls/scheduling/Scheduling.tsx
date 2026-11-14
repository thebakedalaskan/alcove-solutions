/*
 * Scheduling a call, on the Calls page and not in a window: one sheet, the week on the left and the call's editor on the
 * right, with a hairline between (on a phone, the editor alone). The editor, top to bottom: the kicker and ×, the name, Who,
 * When (one time, or the times a guest picks from), Details (notes, muted, an agenda), and the foot: what will happen and the
 * one button. A new call opens on the soonest free half hour and follows who's invited and the calendars until a time or a
 * length is set; pressing or dragging on the week moves it. The same editor moves a call (Change the time), asks to move one
 * you're invited to (Propose another time), and starts from a call that happened (Meet again). It closes once it's done; the
 * call is marked on the page, and a toast says what happened, with Undo.
 */
import { MAX_GUESTS, type ChangeScope, type Document, type Meeting, type MeetingInput, type Patch, type Person } from '@alcove/api';
import {
  Button, Dots, EmptyState, Icon, SchedAsk, SchedChoice, SchedField, SchedFoot, SchedGroup, SchedLine, SchedName, SchedOffer, SchedPanel, SchedQuiet, SchedRow,
  SchedSwitch, SchedTitle, Segmented, Select, Unencrypted, useToast
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCopyLink } from '~/features/call/session/links';
import { NoNotesLeftDoor } from '~/features/plans/notesDoors';
import { freshCalls, movedCalls } from './fresh';
import { useMyModelUnencrypted } from '~/features/notes/models';
import { toastFailure } from '~/lib/failed';
import { useNow } from '~/lib/live';
import { log } from '~/lib/log';
import { byEmail, callName, listNames, sameEmail } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { callQueries, useCancelCall, useProposeTime, useScheduleCall, useUpdateCall } from '~/features/calls/list/queries';
import { noteQueries } from '~/features/notes/queries';
import { teamQueries } from '~/features/team/queries';
import { workspaceQueries } from '~/features/workspace/queries';
import { calendarConnectUrl, calendarQueries } from './queries';
import { hm, timeZone } from '~/lib/time';
import { Bring } from './Bring';
import { BIG_CALL, FIRST_LENGTH, NOT_REPEATING, guestsOf, newDraft, repeatInput, titleFor, type Draft, type Guests, type Repeating } from '../flow/draft';
import { Failed } from '../flow/parts';
import { aheadOf, busyFor, pageOf, pageRange, readUntil, useBusy } from './availability';
import { FixedToken, PeopleField } from './PeopleField';
import { clockIn } from './places';
import { useScheduleWith, type ScheduleSearch } from './search';
import { LONGEST_CALL, SHORTEST_CALL, expandRepeat, lengthAt, localDay, localWeekday, nextFree, nextHalfHour, offerTimes, outsideWork, soonestFree } from './times';
import { DayRow, LengthRow, RepeatRow, TimeRow, type WhenMenu } from './when';
import { WeekSheet, type WeekCall } from './WeekSheet';
import {
  askedLine, busyLine, callCount, cancelNote, cancelledLine, dayWord, endHm, footLine, freeLine, lengthLabel, nextFreeLabel, restoredLine, timeLine, unseenLine, whenWords, type Telling
} from './words';

const slog = log.child({ component: 'scheduling' });

/** The fewest times a guest can be offered. */
const FEWEST_OFFERED = 2;
const MINUTE = 60_000;
const minutesOf = (m: Meeting) => Math.max(5, Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000));

/** What the scheduler is doing: making a call, moving one of yours, or asking to move one you're invited to. */
type Job = { kind: 'new' } | { kind: 'move'; meeting: Meeting } | { kind: 'propose'; meeting: Meeting };
/** Where it starts from: who, when, what it's called and what it brings. */
interface Start { job: Job; people: Person[]; title: string; at: Date | null; minutes: number | undefined; bring: readonly string[] }

/**
 * When the call is: one time (`at`, null while it follows the soonest free half hour), or letting a guest pick, the times
 * offered, each keeping the time it was given, in the order they came, and the one the week moves. One length for all,
 * the length it's meant to have: a time whose end would pass midnight stops there, and gets it back when moved earlier.
 */
interface When { at: Date | null; minutes: number; offers: { at: Date; on: boolean }[] | null; active: number }

/** What the editor has open: one thing at a time. */
type Menu = WhenMenu | 'place' | 'agenda';

/**
 * Scheduling, for the Calls page to show in place of its rail and sheet while its address says `schedule`. `onClose` takes
 * it away again: ×, Cancel, or once the call is scheduled or moved.
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
  const team = useQuery(teamQueries.team());
  const known = useQuery({ ...teamQueries.people(''), enabled: emails.length > 0 });
  if (emails.length && (team.isPending || known.isPending)) return <Waiting kicker="New call" onClose={onClose} />;
  const who = (email: string): Person => team.data?.members.find((m) => sameEmail(m.person, { email }))?.person
    ?? known.data?.find((s) => sameEmail(s.person, { email }))?.person ?? byEmail(email);
  return <Scheduler start={{ job: { kind: 'new' }, people: emails.map(who), title: '', at, minutes, bring }} onClose={onClose} />;
}

/** Moving a call, or asking to: it's read first, to know whose it is and where it is now. It opens where the call is. */
function ForCall({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const meeting = useQuery({ ...callQueries.meeting(id ?? ''), enabled: !!id });
  if (!id || meeting.isError) return <Missing kicker="Move a call" what="That call isn’t there any more" onClose={onClose} />;
  if (!meeting.data) return <Waiting kicker="Move a call" onClose={onClose} />;
  const m = meeting.data;
  const kicker = m.isOrganizer ? 'Move a call' : 'Ask to move a call';
  if (m.status !== 'scheduled' || m.offer) return <Missing kicker={kicker} what={m.offer ? 'A time is still being picked for this call' : 'This call has started, so it can’t move now'} onClose={onClose} />;
  /* Asking to move someone else's call, the times that matter most are its organizer's. */
  return (
    <Scheduler key={m.id} onClose={onClose} start={{
      job: m.isOrganizer ? { kind: 'move', meeting: m } : { kind: 'propose', meeting: m }, people: m.isOrganizer ? m.guests : [m.organizer, ...m.guests],
      title: m.title, at: new Date(m.startsAt), minutes: minutesOf(m), bring: []
    }} />
  );
}

/** Meeting again after a call: the same people and name. */
function AfterCall({ id, at, onClose }: { id: string | undefined; at: Date | null; onClose: () => void }) {
  const note = useQuery({ ...noteQueries.note(id ?? ''), enabled: !!id });
  const me = useQuery(accountQueries.session()).data?.user.email;
  if (!id || note.isError) return <Missing kicker="New call" what="Those notes aren’t there any more" onClose={onClose} />;
  if (!note.data) return <Waiting kicker="New call" onClose={onClose} />;
  const n = note.data;
  return <Scheduler key={n.id} start={{ job: { kind: 'new' }, people: n.people.filter((p) => !me || !sameEmail(p, { email: me })), title: n.title, at, minutes: undefined, bring: [] }} onClose={onClose} />;
}

/** The sheet, with the editor where it will be: while what it starts from is read, or once it's gone. */
function Bare({ kicker, busy = false, onClose, children }: { kicker: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sc-sheet" style={{ '--d': 1 }}>
      <div className="sc-blank" aria-hidden="true" />
      <SchedPanel kicker={kicker} label="Scheduling" busy={busy} onClose={onClose}>{children}</SchedPanel>
    </div>
  );
}
const Waiting = ({ kicker, onClose }: { kicker: string; onClose: () => void }) => <Bare kicker={kicker} busy onClose={onClose}><p className="sc-wait"><Dots /></p></Bare>;
/** What it was to start from has gone. */
const Missing = ({ kicker, what, onClose }: { kicker: string; what: string; onClose: () => void }) => (
  <Bare kicker={kicker} onClose={onClose}><EmptyState title={what}>Go back to Calls to see what’s coming up.</EmptyState></Bare>
);

function Scheduler({ start, onClose }: { start: Start; onClose: () => void }) {
  const { job } = start;
  const moving = job.kind !== 'new';
  const meeting = job.kind === 'new' ? undefined : job.meeting;
  const session = useQuery(accountQueries.session()).data;
  const prefs = useQuery(accountQueries.prefs()).data;
  const team = useQuery(teamQueries.team()).data;
  // Connecting in another tab keeps this draft: it's read again when the page comes back to it.
  const calendar = useQuery({ ...calendarQueries.calendar(), refetchOnWindowFocus: (query) => (query.state.data?.needsAccess ? 'always' : false) }).data;
  const library = useQuery({ ...workspaceQueries.documents(), enabled: start.bring.length > 0 }).data;
  const unencrypted = useMyModelUnencrypted();
  const me = session?.user.email;
  const [draft, setDraft] = useState<Draft>(() => ({
    ...newDraft(prefs, { people: start.people }), title: start.title, titled: !!start.title,
    ...(meeting ? { notes: meeting.notes, choices: meeting.choices } : {})
  }));
  const change = (d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d }));
  const [when, setWhen] = useState<When>(() => ({ at: start.at, minutes: start.minutes ?? FIRST_LENGTH, offers: null, active: 0 }));
  const [menu, setMenu] = useState<Menu | null>(null);
  /* What closes closes only itself: pressing one thing while another is open opens it, whichever hears the press first. */
  const shut = (which: Menu) => setMenu((m) => (m === which ? null : m));
  /* A time that had gone when the button was pressed, and where the call went instead. */
  const [late, setLate] = useState<Date | null>(null);
  const startField = useRef<HTMLInputElement>(null);
  /* Where an outside guest is, as you've said: only for showing their times. */
  const [place, setPlace] = useState<{ email: string; zone: string } | null>(null);
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
  /* Now, as the week has it: the soonest time, the times gone and the past all follow the clock. */
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  /* Who's busy is read from today for as far as the soonest time is looked for, and a time put further on, a page of the week at a time. */
  const ahead = useMemo(() => aheadOf(new Date(today)), [today]);
  const aheadEnd = Date.parse(ahead.to);
  const farPages = [when.at, ...(when.offers ?? []).map((o) => o.at)]
    .flatMap((t) => (t && t.getTime() >= aheadEnd ? [pageOf(t, new Date(today))] : [])).filter((p, i, all) => all.indexOf(p) === i).sort((a, b) => a - b).join(',');
  const ranges = useMemo(() => [ahead, ...(farPages ? farPages.split(',').map((p) => pageRange(Number(p), new Date(today))) : [])], [ahead, farPages, today]);
  const times = useBusy(emails, meeting, ranges);
  const readable = useMemo(() => times.readable.map((p) => p.busy), [times.readable]);
  const telling: Telling = calendar?.source === 'sample' ? 'sample' : calendar?.source === 'google' && !calendar.needsAccess && prefs?.addToCalendar !== false ? 'google' : 'nobody';
  const noCalendar = !!calendar && (calendar.source === 'none' || calendar.needsAccess);
  const inCompany = (p: Person) => !!team?.members.some((m) => sameEmail(m.person, p));
  const [only] = guests;
  const unseen = times.loading ? [] : guests.filter((g) => times.unreadable.some((e) => sameEmail({ email: e }, g)));
  /* One guest whose calendar can't be read can pick a time themselves, from the times you offer. */
  const offerable = job.kind === 'new' && !times.loading && guests.length === 1 && unseen.length === 1;
  /* Someone from outside says where they are on their token, once you've said. */
  const outside = only && guests.length === 1 && unseen.length === 1 && !inCompany(only) ? only : undefined;
  const zone = outside && place && sameEmail(place, outside) ? place.zone : null;

  /* The one time: where it was put, or until then the soonest free half hour for you and everyone whose calendar can be read. */
  const soonest = useMemo(() => soonestFree({ now, minutes: when.minutes, you: times.you, people: readable, until: aheadEnd }), [now, when.minutes, times.you, readable, aheadEnd]);
  const touched = when.at !== null;
  const chosen = when.at ?? soonest;
  const offers = offerable ? when.offers : null;
  const active = offers ? Math.max(0, Math.min(when.active, offers.length - 1)) : 0;
  /* What the week moves: the one time, or the active one of those offered. */
  const current = offers?.[active]?.at ?? chosen;
  const length = lengthAt(chosen, when.minutes);
  const ticked = offers?.filter((o) => o.on).length ?? 0;

  /* Who's busy at the one time: something of yours (by name when it has one), and whoever else's calendar says so. */
  const taken = busyFor(times, chosen.getTime(), chosen.getTime() + length * MINUTE);
  const yours = taken.yours;
  const youBusy = taken.busy;
  const theyBusy = guests.filter((g) => taken.people.some((email) => sameEmail({ email }, g)));
  const clashing = youBusy || theyBusy.length > 0;
  const next = clashing ? nextFree({ from: chosen, now, minutes: when.minutes, you: times.you, people: readable, until: readUntil(ranges, chosen.getTime()) }) : null;

  /* Letting a guest pick, one length for every time offered: as long as each ticked one has room for before midnight. */
  const offerLength = offers ? Math.min(when.minutes, ...offers.filter((o) => o.on).map((o) => lengthAt(o.at, when.minutes))) : length;
  const lengthOf = (at: Date) => Math.min(offerLength, lengthAt(at, when.minutes));
  const stopped = offers ? offers.findIndex((o) => o.on && lengthAt(o.at, when.minutes) < when.minutes) : -1;
  /** What of yours an offered time clashes with, by name when it has one. */
  const markOf = (at: Date) => { const b = busyFor(times, at.getTime(), at.getTime() + lengthOf(at) * MINUTE); return b.yours ?? (b.busy ? 'Busy' : undefined); };

  /* Moving: the times people invited have asked for, still to come. */
  const asked = (meeting?.isOrganizer ? meeting.proposals ?? [] : []).map((p) => ({ at: new Date(p.startsAt), who: meeting?.guests.find((g) => sameEmail(g, p)) }))
    .filter((p) => p.at.getTime() > Date.now());

  /* ---------- changing when ---------- */
  /**
   * The active time starts at `at`, keeping its length. Letting a guest pick, a start another time offered has already is
   * refused: the guest would be offered it twice.
   */
  const moveTo = (at: Date): boolean => {
    if (offers?.some((o, i) => i !== active && o.at.getTime() === at.getTime())) return false;
    setWhen((w) => (offers && w.offers ? { ...w, offers: w.offers.map((o, i) => (i === active ? { ...o, at } : o)) } : { ...w, at }));
    return true;
  };
  /** A length set, from 5 minutes to 10 hours, as the server allows: asking to move someone's call asks for a start, so it keeps the length it has. */
  const setLength = (minutes: number) => {
    if (job.kind === 'propose') return;
    const kept = Math.max(SHORTEST_CALL, Math.min(LONGEST_CALL, Math.round(minutes)));
    setWhen((w) => ({ ...w, minutes: kept, at: offers ? w.at : w.at ?? chosen }));
  };
  const setRange = (at: Date, minutes: number) => {
    if (moveTo(at)) setLength(minutes);
  };
  /** Moved there from a line under the time (Next free, Move it there): the line goes, so the keyboard goes to the start. */
  const moveFromLine = (at: Date) => {
    startField.current?.focus({ preventScroll: true });
    moveTo(at);
  };
  /** A day picked keeps the clock time; where that's gone, the next half hour at least 10 minutes off. */
  const pickDay = (day: Date) => {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), current.getHours(), current.getMinutes());
    moveTo(at.getTime() > Date.now() ? at : nextHalfHour(new Date()));
  };
  /** Letting a guest pick: on with three times (the one you had, then the same time on the next two days you're free); off, the active one stays. */
  const letPick = (on: boolean) => setWhen((w) => (on
    ? { ...w, at: chosen, offers: offerTimes({ at: chosen, now, minutes: w.minutes, you: times.you }).map((at) => ({ at, on: true })), active: 0 }
    : { ...w, at: current, offers: null, active: 0 }));
  /** Who's invited changed: picking goes off the same way, keeping the active time. */
  const who = (g: Guests) => {
    change(g);
    if (offers) setWhen((w) => ({ ...w, at: current, offers: null, active: 0 }));
  };

  const zoneHere = meeting?.repeat?.timeZone ?? timeZone();
  const series = !!meeting?.repeat;
  const [repeatMove, setRepeatMove] = useState<Repeating>(() => (meeting?.repeat ? repeatingOf(meeting, zoneHere) : NOT_REPEATING));
  const repeats = job.kind === 'new' && !offers ? draft.repeat : job.kind === 'move' && series && scope === 'following' ? repeatMove : NOT_REPEATING;
  const repeat = repeatInput(repeats, chosen, zoneHere);
  const named = meeting ? meeting.title : draft.titled ? draft.title : guests.length ? titleFor(draft.tokens, guests) : '';
  const big = guests.length > BIG_CALL;
  const muted = big && (draft.joinMuted ?? true);
  const names = listNames(guests);
  const organizer = meeting && !meeting.isOrganizer ? meeting.organizer : undefined;
  const to = organizer ? callName(organizer) : undefined;

  /*
   * Moving or asking, the button waits until the time has changed (and, moving, the length). The length it's meant to have
   * counts, not where midnight stops it: a call kept from before that runs past midnight opens as it is, and only moving it
   * stops it there.
   */
  const startMoved = !!meeting && chosen.getTime() !== Date.parse(meeting.startsAt);
  const changed = startMoved || (job.kind === 'move' && when.minutes !== minutesOf(job.meeting));
  const ready = job.kind === 'new' ? guests.length <= MAX_GUESTS && (offers ? ticked >= FEWEST_OFFERED : true) : changed;
  const whenSaid = whenWords(chosen, now);
  const goLabel = job.kind === 'propose' ? (startMoved ? `Ask to move it to ${whenSaid}` : 'Ask to move it')
    : job.kind === 'move' ? (changed ? `Move to ${whenSaid}` : 'Move')
      : offers ? `Send ${only ? callName(only) : 'your guest'} the times`
        : repeat ? `Schedule ${callCount(repeat.occurrences.length)}` : 'Schedule';
  const line = job.kind === 'propose' ? footLine({ kind: 'propose', organizer })
    : job.kind === 'move' ? footLine({ kind: 'move', meeting: job.meeting, telling })
      : offers ? footLine({ kind: 'offer', guest: only, telling }) : footLine({ kind: 'new', guests, telling });

  /* The name is ready to type over once there's someone to name it after; until then, who it's with comes first. */
  useEffect(() => {
    if (!moving && start.people.length && matchMedia('(hover: hover)').matches) { title.current?.focus({ preventScroll: true }); title.current?.select(); }
  }, [moving, start.people.length]);

  const said = (at: Date) => `${dayWord(at, now).replace(/^Tomorrow/, 'tomorrow').replace(/^Today/, 'today')} at ${hm(at)}`;
  /* The toast that says a call was scheduled: what happened, who heard, and Undo while there's one to give. */
  const scheduled = async (m: Meeting) => {
    freshCalls.add(m.id);
    const code = m.seriesCode ?? m.code;
    const copied = () => navigator.clipboard?.writeText(`${location.origin}/join/${code}`).then(() => true, () => false) ?? Promise.resolve(false);
    const offerLink = { label: 'Copy link', onClick: () => copy(code) };
    const undo = { label: 'Undo', onClick: () => cancel.mutate({ id: m.id, code: m.code, scope: m.repeat ? 'following' : undefined }, { onError: (e) => toastFailure(toast, e) }) };
    if (m.offer) {
      const name = only ? callName(only) : 'your guest';
      if (await copied()) toast(`Link copied for ${name}. The call waits until they pick a time.`, { icon: 'link', ms: 7000 });
      else toast(`Send ${name} the link to pick a time.`, { icon: 'link', ms: 9000, action: offerLink });
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
    /* A time that has gone while the scheduler was open is never sent: the call goes to the next half hour, and says so. */
    if (!offers && (job.kind === 'new' || startMoved) && chosen.getTime() <= Date.now()) {
      const later = nextHalfHour(new Date());
      moveTo(later);
      setLate(later);
      return;
    }
    setSending(true);
    setFailed(null);
    try {
      if (job.kind === 'propose') {
        await propose.mutateAsync({ id: job.meeting.id, startsAt: chosen.toISOString() });
        onClose();
        toast(`${to ?? 'The organizer'} sees your proposed time and can move the call to it.`, { icon: 'cal', ms: 6000 });
        return;
      }
      if (job.kind === 'move') {
        const m = job.meeting;
        const was = { startsAt: m.startsAt, durationMinutes: minutesOf(m) };
        /* The call's old day stops counting: it's the new one that repeats, beside any others picked. */
        const reRepeat = series && scope === 'following' ? repeatInput({ ...repeatMove, days: repeatMove.days.filter((d) => d !== localWeekday(new Date(m.startsAt), zoneHere)) }, chosen, zoneHere) : null;
        const input: Patch<MeetingInput> = { startsAt: chosen.toISOString(), ...(length !== was.durationMinutes ? { durationMinutes: length } : {}), ...(reRepeat ? { repeat: reRepeat } : {}) };
        const applied = series ? scope : undefined;
        const moved = await update.mutateAsync({ id: m.id, input, scope: applied });
        movedCalls.add(moved.id);
        onClose();
        const told = m.guestCount && (moved.calendarUrl || telling === 'sample') ? ` ${moved.calendarUrl ? 'Google Calendar tells' : 'Your calendar tells'} ${listNames(m.guests)}.` : '';
        const back = scope === 'this' ? { label: 'Undo', onClick: () => { void update.mutateAsync({ id: m.id, input: was, scope: applied }).then(() => movedCalls.add(m.id), (e: unknown) => toastFailure(toast, e, 'Couldn’t undo that.')); } } : undefined;
        toast(`Moved to ${said(chosen)}.${told}`, { icon: 'cal', ms: 6000, action: back });
        return;
      }
      /* Letting a guest pick, the call waits at the soonest of the times offered, and offers them all. */
      const offered = offers ? offers.filter((o) => o.on).map((o) => o.at).sort((a, b) => a.getTime() - b.getTime()) : null;
      const at = offered?.[0] ?? chosen;
      const input: MeetingInput = {
        title: named.trim() || titleFor(draft.tokens, guests), startsAt: at.toISOString(), durationMinutes: offered ? offerLength : length, guests: emails, notes: draft.notes,
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
          .then((n) => toast(restoredLine(n), { icon: 'cal', ms: 9000, action: { label: 'Copy link', onClick: () => copy(n.code) } }), (e: unknown) => toastFailure(toast, e, 'Couldn’t schedule the call again.'));
      } } : undefined;
      toast(cancelledLine(m, applied === 'following'), { icon: 'trash', ms: 6000, action: again });
    } catch (e) {
      setFailed(e);
    }
  };

  /* What the week's ghost and bands call people: their first names. */
  const weekGuests = useMemo(() => guests.map((g) => ({ email: g.email, name: callName(g) })), [guests]);
  const weekCalls: WeekCall[] = offers
    ? offers.map((o, i) => ({ at: o.at, minutes: lengthOf(o.at), n: i + 1, active: i === active, off: !o.on, clash: markOf(o.at) !== undefined }))
    : [{ at: chosen, minutes: length, active: true, clash: clashing }];
  const answers = new Map((meeting?.answers ?? []).map((a) => [a.email.toLowerCase(), a.answer]));
  const stateOf = (p: Person) => {
    const a = answers.get(p.email.toLowerCase());
    return a === 'yes' ? 'Going' : a === 'no' ? 'Not going' : a === 'maybe' ? 'Maybe' : 'No answer yet';
  };
  const label = job.kind === 'move' ? `Move ${job.meeting.title}` : job.kind === 'propose' ? `Propose another time for ${job.meeting.title}` : 'Schedule a call';
  const kicker = job.kind === 'move' ? 'Move a call' : job.kind === 'propose' ? 'Ask to move a call' : 'New call';
  const whenMenu: WhenMenu | null = menu === 'place' || menu === 'agenda' ? null : menu;
  const open = { menu: whenMenu, onMenu: (m: WhenMenu) => setMenu(m), onShut: (m: WhenMenu) => shut(m) };
  const guest = only ? callName(only) : '';

  const foot = (
    <SchedFoot line={line}
      notice={(failed !== null || asking) && (
        <>
          {failed !== null && <Failed error={failed} />}
          {asking && job.kind === 'move' && (
            <SchedAsk label="Cancel this call" actions={(
              <>
                <Button variant="quiet" size="sm" onClick={() => setAsking(false)}>Keep it</Button>
                <Button size="sm" loading={cancel.isPending} onClick={() => void cancelCall()}>Cancel the call</Button>
              </>
            )}>Cancel {job.meeting.repeat && scope === 'following' ? 'this and later calls' : 'this call'}? {cancelNote(job.meeting, scope === 'following')}</SchedAsk>
          )}
        </>
      )}
      lead={job.kind === 'move' && !asking ? <Button variant="quiet" size="sm" icon="trash" className="sc-cancel" onClick={() => setAsking(true)}>Cancel this call</Button> : undefined}>
      {/* Moving, Cancel this call is in the foot already, and × closes: a second Cancel would read as the same thing. */}
      {job.kind !== 'move' && <Button variant="quiet" onClick={onClose}>Cancel</Button>}
      <Button variant="primary" disabled={!ready} loading={sending} onClick={() => void go()}>{goLabel}</Button>
    </SchedFoot>
  );

  return (
    <div className="sc-sheet" style={{ '--d': 1 }}>
      <WeekSheet guests={weekGuests} title={named || 'New call'} calls={weekCalls}
        was={meeting && changed ? { at: new Date(meeting.startsAt), minutes: minutesOf(meeting) } : undefined} except={meeting}
        onMove={moveTo} onRange={setRange} onLength={job.kind === 'propose' ? undefined : setLength} onSelect={(i) => setWhen((w) => ({ ...w, active: i }))} />

      <SchedPanel kicker={kicker} label={label} onClose={onClose} foot={foot}>
        {meeting
          ? <SchedName title={meeting.title} was={changed ? timeLine(new Date(meeting.startsAt), minutesOf(meeting)) : undefined} />
          : <SchedTitle ref={title} value={named} placeholder="Add a title" label="The call’s name" onChange={(v) => change({ title: v, titled: true })} onEnter={() => void go()} />}

        <SchedGroup label="Who">
          {meeting ? (
            <SchedRow icon="people">
              <SchedField fixed>
                {(meeting.isOrganizer ? meeting.guests : [meeting.organizer, ...meeting.guests.filter((g) => !me || !sameEmail(g, { email: me }))]).map((p) => (
                  <FixedToken key={p.email} person={p} state={meeting.isOrganizer ? stateOf(p) : sameEmail(p, meeting.organizer) ? 'Organizer' : 'Invited'} />
                ))}
                {!meeting.guests.length && <span className="sc-none">Nobody else is invited</span>}
              </SchedField>
            </SchedRow>
          ) : (
            <PeopleField value={draft} onChange={who} me={me}
              where={outside ? { email: outside.email, zone, at: current, open: menu === 'place', onOpenChange: (o) => (o ? setMenu('place') : shut('place')), onPick: (z) => setPlace({ email: outside.email, zone: z }) } : undefined} />
          )}
          {offerable && only ? (
            <SchedRow>
              <SchedSwitch title={`Let ${guest} pick the time`} line={`You can’t see ${guest}’s calendar.`} checked={!!offers} onChange={letPick} />
            </SchedRow>
          ) : unseen.length > 0 && !noCalendar && !times.failed && <SchedLine tone="quiet">{unseenLine(unseen)}</SchedLine>}
        </SchedGroup>

        {offers ? (
          <SchedGroup label="When">
            <SchedRow icon="cal" top>
              <div className="sc-opts" role="group" aria-label="Times to offer">
                {offers.map((o, i) => {
                  const long = lengthOf(o.at);
                  const day = dayWord(o.at, now);
                  return (
                    <SchedOffer key={i} n={i + 1} day={day} time={`${hm(o.at)} – ${endHm(o.at, long)}`} said={`${day}, ${hm(o.at)} to ${endHm(o.at, long)}`}
                      side={zone ? `${clockIn(zone, o.at)} for ${guest}` : undefined}
                      clash={markOf(o.at)}
                      active={i === active} on={o.on} lock={o.on && ticked <= FEWEST_OFFERED}
                      onSelect={() => setWhen((w) => ({ ...w, active: i }))}
                      onTick={() => setWhen((w) => ({ ...w, offers: (w.offers ?? []).map((x, k) => (k === i ? { ...x, on: !x.on } : x)) }))} />
                  );
                })}
              </div>
            </SchedRow>
            <SchedLine tone="quiet" className="sc-tip">Press the week to move time {active + 1}.</SchedLine>
            {stopped >= 0 && <SchedLine tone="quiet">Time {stopped + 1} stops at midnight, so each is {lengthLabel(offerLength)}.</SchedLine>}
            {/* There's no week on a phone: the active time is set here. */}
            <div className="sc-phone">
              <DayRow at={current} now={now} {...open} onPick={pickDay} />
              <TimeRow at={current} minutes={when.minutes} now={now} {...open} onStart={moveTo} onEnd={setLength} />
            </div>
            <LengthRow minutes={when.minutes} {...open} onChange={(minutes) => setWhen((w) => ({ ...w, minutes }))} />
          </SchedGroup>
        ) : (
          <SchedGroup label="When">
            {job.kind === 'move' && series && (
              <SchedRow flush>
                <Segmented value={scope} onChange={setScope} label="Which calls" options={[{ value: 'this', label: 'This call' }, { value: 'following', label: 'This and later calls' }]} />
              </SchedRow>
            )}
            <DayRow at={chosen} now={now} {...open} onPick={pickDay} />
            <TimeRow at={chosen} minutes={when.minutes} now={now} {...open} startRef={startField} onStart={moveTo} onEnd={setLength} fixedEnd={job.kind === 'propose'} />
            {late && late.getTime() === chosen.getTime() && <SchedLine tone="caution">That time had passed, so the call moved to {hm(late)}.</SchedLine>}
            {times.loading && guests.length > 0 ? <SchedLine>Reading calendars…</SchedLine>
              : clashing ? (
                <SchedLine tone="caution" action={next ? { label: nextFreeLabel(next, chosen, now), onClick: () => moveFromLine(next) } : undefined}>
                  {busyLine({ yours, busy: youBusy, people: theyBusy })}
                </SchedLine>
              ) : times.readable.length > 0 && <SchedLine>{freeLine({ seen: guests.filter((g) => !times.unreadable.some((e) => sameEmail({ email: e }, g))), everyone: !times.unreadable.length, picked: touched, outside: outsideWork(chosen, when.minutes) })}</SchedLine>}
            {/* A read that failed is said where who's free would be: under the time. */}
            {times.failed && <SchedLine tone="quiet">Calendars can’t be read just now, so only your Alcove calls are known.</SchedLine>}
            {asked.map((p) => (
              <SchedLine key={p.at.getTime()} action={p.at.getTime() !== chosen.getTime() ? { label: 'Move it there', onClick: () => moveFromLine(p.at) } : undefined}>{askedLine(p.who, p.at, now)}</SchedLine>
            ))}
            {length < when.minutes && (job.kind === 'new' || changed) && <SchedLine tone="quiet">It stops at midnight: a call ends on the day it starts.</SchedLine>}
            {job.kind === 'new' && <RepeatRow repeat={draft.repeat} at={chosen} {...open} onChange={(r) => change({ repeat: r })} />}
            {job.kind === 'move' && series && scope === 'following' && <RepeatRow repeat={repeatMove} at={chosen} zone={zoneHere} keep {...open} onChange={setRepeatMove} />}
            {noCalendar && !times.failed && <SchedLine tone="quiet" action={{ label: 'Connect Google Calendar', href: calendarConnectUrl() }}>Only your Alcove calls are known without a calendar.</SchedLine>}
          </SchedGroup>
        )}

        {job.kind === 'new' && (
          <SchedGroup label="Details">
            <SchedRow icon="notes" rec={draft.notes === 'on'}>
              <SchedSwitch title="Notes" tip="Everyone invited gets the notes" checked={draft.notes === 'on'} onChange={(on) => change({ notes: on ? 'on' : 'off' })} />
            </SchedRow>
            {draft.notes === 'on' && (
              <>
                {/* None of your notes left when it starts: until when, and the way to more (a time offered: its first). */}
                <NoNotesLeftDoor at={offers?.[0]?.at ?? chosen} className="sc-door" />
                <SchedRow><SchedQuiet chevron aria-expanded={keeping} onClick={() => setKeeping((k) => !k)}>What the notes keep</SchedQuiet></SchedRow>
                {keeping && (
                  <div className="sc-keep">
                    <SchedRow>
                      <SchedSwitch title="Keep the transcript" line={draft.choices.keepTranscript ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
                        checked={draft.choices.keepTranscript} onChange={(keepTranscript) => change({ choices: { ...draft.choices, keepTranscript } })} />
                    </SchedRow>
                    <SchedRow>
                      <SchedSwitch title="Keep the recording" line={draft.choices.keepRecording ? 'Play back any moment from the notes' : 'Deleted when the call ends'}
                        checked={draft.choices.keepRecording} onChange={(keepRecording) => change({ choices: { ...draft.choices, keepRecording } })} />
                    </SchedRow>
                    <SchedRow>
                      <SchedSwitch title="Read shared screens" line="Whoever shares is asked whether it goes in the notes"
                        checked={draft.choices.allowScreens} onChange={(allowScreens) => change({ choices: { ...draft.choices, allowScreens } })} />
                    </SchedRow>
                    <Home draft={draft} change={change} />
                    {unencrypted
                      ? <SchedLine tone="quiet"><Icon name="shieldOff" size={14} />Written by an AI model outside a secure enclave. <Unencrypted compact /></SchedLine>
                      : <SchedLine tone="quiet"><Icon name="sealed" size={14} />Written by an AI model in confidential compute.</SchedLine>}
                  </div>
                )}
              </>
            )}
            {big && (
              <SchedRow icon="megaphone">
                <SchedSwitch title="Everyone joins muted" line="Microphones and cameras off, for a call this big" checked={muted} onChange={(joinMuted) => change({ joinMuted })} />
              </SchedRow>
            )}
            <Bring picked={draft.documents} open={menu === 'agenda'} onOpenChange={(o) => (o ? setMenu('agenda') : shut('agenda'))} onChange={(documents: Document[]) => change({ documents })} />
          </SchedGroup>
        )}
      </SchedPanel>
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

/**
 * Where the notes go: a new workspace made for the call, or one of yours you can make things in. One someone else pays for
 * opens only for its own people, its boards and files too, as the call can't add to their storage or spend their AI: said once,
 * under it, as Switch workspace says it in a call.
 */
function Home({ draft, change }: { draft: Draft; change: (d: Partial<Draft>) => void }) {
  const spaces = useQuery(workspaceQueries.workspaces()).data ?? [];
  const homes = spaces.flatMap((w) => (w.name !== null && (w.role === 'admin' || w.role === 'edit') ? [{ id: w.id, name: w.name, youPay: w.youPay }] : []));
  const theirs = homes.find((h) => h.id === draft.home?.id)?.youPay === false;
  return (
    <>
      <SchedRow>
        <SchedChoice title="Where they go" line={draft.home ? 'In a folder of their own' : 'Everyone invited is in it'}>
          <Select label="Where the notes go" value={draft.home?.id ?? 'new'} align="end"
            options={[{ value: 'new', label: 'A new workspace', icon: 'plus' }, ...homes.map((h) => ({ value: h.id, label: h.name, icon: 'folders' as const }))]}
            onChange={(id) => { const h = homes.find((x) => x.id === id); change({ home: id === 'new' || !h ? null : { id: h.id, name: h.name } }); }} />
        </SchedChoice>
      </SchedRow>
      {theirs && <SchedLine tone="quiet"><Icon name="people" size={14} />Its files don’t count against your storage, so its boards and files open only for its own people.</SchedLine>}
    </>
  );
}
