/*
 * A call in the list. Ahead: who's on it, then only what matters (an invitation to answer, a request to move it, how others
 * answered, that it won't write notes), its time and length, and its menu. Past: who had it, how it came to you, what it
 * was about or the line a search found, only what waits on you from it, and when.
 */
import { errorMessage, termsIn, type Inbox, type Meeting, type NoteFound, type NoteSaid, type Rsvp } from '@alcove/api';
import { Button, CallAnswered, CallChip, CallReply, CallRow, Dots, MomentChip, useToast } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { shortTime } from '~/features/calls/scheduling/words';
import { marked, nearMatch } from '~/features/notes/highlight';
import { inNote } from '~/features/notes/parts';
import { peopleOn } from '~/features/home/day';
import { freshCalls, movedCalls } from '~/features/shell/context';
import { byEmail, callName, spokenName } from '~/lib/people';
import { useAnswerCall, useAnswerProposal, usePendingRsvp, useUpdateCall } from '~/lib/queries';
import { callLength, hm, noteDay, position } from '~/lib/time';
import { plural } from '~/lib/words';
import { ANSWERED, lengthOf, offeredLine, othersAnswered, seriesTag, timeOf, waitsForTime, whoWithYou, type Ahead } from './ahead';
import { AheadMenu, PastMenu } from './Menus';
import { pastWhen, waitingIn } from './past';
import { byTime, howOf, noSummary, othersIn, type Said } from './said';

/** Moments a row links to. */
const MOMENTS = 3;

/** A call ahead: an Alcove call, one you're invited to, one waiting for a guest to pick, or a meeting on your calendar. */
export function AheadRow({ a, me, now }: { a: Ahead; me: string | undefined; now: number }) {
  // A call scheduled or moved a moment ago is lit, once, and says so.
  const [fresh] = useState(() => freshCalls.delete(a.id));
  const [moved] = useState(() => movedCalls.delete(a.id));
  const at = new Date(now);
  if (a.kind === 'event') {
    const e = a.event;
    return (
      <CallRow who={{ arch: 'cal' }} title={a.title} muted soon open={(p) => <a {...p} href={e.calendarUrl} target="_blank" rel="noopener noreferrer" />}
        tag={{ icon: 'cal', text: e.join ? `From your calendar · ${e.join.label}` : 'From your calendar' }} line={whoWithYou(a, me)}
        when={{ at: timeOf(a, now), length: lengthOf(a) }} menu={<AheadMenu a={a} now={at} />} />
    );
  }
  return <CallAhead a={a} m={a.call} me={me} now={now} fresh={fresh} moved={moved} />;
}

function CallAhead({ a, m, me, now, fresh, moved }: { a: Ahead; m: Meeting; me: string | undefined; now: number; fresh: boolean; moved: boolean }) {
  const at = new Date(now);
  const waiting = waitsForTime(a);
  const others = peopleOn(a, me);
  const tag = seriesTag(a);
  const asked = m.isOrganizer ? m.proposals?.[0] : undefined;
  const mine = !m.isOrganizer ? m.proposals?.[0] : undefined;
  const invited = !m.isOrganizer && !m.offer && m.status === 'scheduled';
  const askedBy = asked && (m.guests.find((g) => g.email.toLowerCase() === asked.email.toLowerCase()) ?? byEmail(asked.email));
  const askedAt = asked && new Date(asked.startsAt);
  const sameDay = askedAt && askedAt.toDateString() === new Date(m.startsAt).toDateString();
  const note = askedBy && askedAt ? { text: `${callName(askedBy)} asks to move it to ${sameDay ? hm(askedAt) : shortTime(askedAt, at)}`, tone: 'rose' as const }
    : invited && m.rsvp === null ? { text: `${callName(m.organizer)} invited you`, tone: 'rose' as const }
      : m.status === 'live' ? { text: 'Happening now', tone: 'sun' as const }
        : fresh ? { text: 'Just scheduled', tone: 'sun' as const } : moved ? { text: 'Moved', tone: 'sun' as const } : undefined;
  const quiet = waiting ? offeredLine(m, at) : mine ? `You asked for ${shortTime(new Date(mine.startsAt), at)}` : othersAnswered(m);
  return (
    <CallRow who={waiting ? { arch: 'clock' } : others.length ? { faces: others } : { arch: 'video', solid: true }} title={m.title} soon={!waiting} fresh={fresh || moved}
      open={(p) => <Link to="/calls/upcoming/$meetingId" params={{ meetingId: m.id }} {...p} />}
      tag={tag ? { icon: 'repeat', text: tag } : undefined} line={whoWithYou(a, me)} quiet={quiet} note={note} notesOff={m.notes === 'off'}
      reply={asked && askedBy ? <MoveAsked m={m} email={asked.email} name={callName(askedBy)} to={asked.startsAt} now={at} /> : invited ? <Answer m={m} /> : undefined}
      when={{ at: waiting ? '' : timeOf(a, now), length: lengthOf(a) }} menu={<AheadMenu a={a} now={at} />} />
  );
}

/** "You're going to Design crit. Kofi sees your answer." */
const answeredLine = (answer: Rsvp, m: Meeting) => `${ANSWERED[answer]} to ${m.title}. ${callName(m.organizer)} sees your answer.`;

/** Yes, Maybe or No to a call you're invited to, as equal buttons; once answered, what you said, with Change. */
function Answer({ m }: { m: Meeting }) {
  const answer = useAnswerCall();
  const saving = usePendingRsvp(m.id);
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const say = (a: Rsvp) => {
    const before = m.rsvp;
    setChanging(false);
    answer.mutateAsync({ id: m.id, answer: a }).then(
      () => toast(answeredLine(a, m), { icon: 'check', ms: 6000, action: before && before !== a ? { label: 'Undo', onClick: () => void answer.mutateAsync({ id: m.id, answer: before }).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })) } : undefined }),
      (e: unknown) => toast(`Couldn’t say you’re coming. ${errorMessage(e)}`, { icon: 'x' })
    );
  };
  if (m.rsvp && !changing) return <CallAnswered change={() => setChanging(true)} changeLabel={`Change your answer to ${m.title}`}>{ANSWERED[m.rsvp]}</CallAnswered>;
  const choices: { value: Rsvp; label: string }[] = [{ value: 'yes', label: 'Yes' }, { value: 'maybe', label: 'Maybe' }, { value: 'no', label: 'No' }];
  return (
    <CallReply label={`Are you going to ${m.title}?`}>
      {choices.map((c) => <Button key={c.value} size="xs" aria-pressed={m.rsvp === c.value} disabled={saving} onClick={() => say(c.value)}>{c.label}</Button>)}
    </CallReply>
  );
}

/** Someone invited asks to move your call: Move it, which moves it there and tells everyone, or Keep its time. */
function MoveAsked({ m, email, name, to, now }: { m: Meeting; email: string; name: string; to: string; now: Date }) {
  const reply = useAnswerProposal();
  const update = useUpdateCall();
  const toast = useToast();
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const told = m.calendarUrl && m.guestCount ? ` Google Calendar tells ${m.guestCount === 1 ? name : 'everyone invited'}.` : '';
  const move = () => reply.mutate({ id: m.id, email, answer: 'move' }, {
    onSuccess: () => toast(`Moved to ${shortTime(new Date(to), now)}.${told}`, {
      icon: 'cal', ms: 6000, action: { label: 'Undo', onClick: () => update.mutate({ id: m.id, input: { startsAt: m.startsAt } }, { onError: failed }) }
    }),
    onError: failed
  });
  const keep = () => reply.mutate({ id: m.id, email, answer: 'keep' }, { onSuccess: () => toast(`${m.title} stays at ${hm(m.startsAt)}.`, { icon: 'check' }), onError: failed });
  return (
    <CallReply label={`${name} asks to move ${m.title}`}>
      <Button size="xs" disabled={reply.isPending} onClick={move}>Move it</Button>
      <Button size="xs" disabled={reply.isPending} onClick={keep}>Keep {hm(m.startsAt)}</Button>
    </CallReply>
  );
}

/** A moment a search found or an answer cites: it opens the call there. */
function Moment({ n, line }: { n: NoteFound; line: NoteSaid }) {
  const said = `Open ${n.title} at ${position(line.at)}${line.room ? `, in ${line.room.name}` : ''}`;
  return <MomentChip time={position(line.at)} label={said} link={(p) => <Link to="/calls/$noteId" params={{ noteId: n.id }} {...inNote(line.at, line.room)} {...p} />} />;
}

/**
 * A call that happened. `terms`: the words a search looked for, marked where they show. `said`: the lines it found, or that
 * an answer cites (`cited`), quoted when the summary doesn't say it. `series`: a row of a series, led by its date.
 */
export function PastRow({ n, me, now, inbox, pinned, terms = [], said, cited = false, series = false }: {
  n: NoteFound; me: string | undefined; now: number; inbox: Inbox | undefined; pinned: boolean;
  terms?: string[] | undefined; said?: Said | undefined; cited?: boolean | undefined; series?: boolean | undefined;
}) {
  const at = new Date(now);
  const others = othersIn(n.people, me);
  const how = series ? undefined : howOf(n, me);
  const quote = said?.lines.find((l) => l.text);
  // A summary that has the words says what the call was about; otherwise the line they were said in does.
  const quoted = quote && (cited || !termsIn(n.excerpt, terms));
  const moments = byTime((said?.lines ?? []).slice(0, MOMENTS));
  const looking = terms.length > 0 || cited;
  const waits = looking ? { decide: 0, follow: 0 } : waitingIn(inbox, n.id);
  const status = n.status === 'pending' ? <CallChip kind="writing"><Dots />Being written</CallChip> : n.status === 'recording' ? <CallChip kind="rec">Still recording</CallChip> : null;
  const chips = moments.length || status || waits.decide || waits.follow ? (
    <>
      {moments.map((l) => <Moment key={l.id} n={n} line={l} />)}
      {status}
      {waits.decide > 0 && <CallChip kind="decide">{waits.decide} to confirm</CallChip>}
      {waits.follow > 0 && <CallChip kind="follow">{plural(waits.follow, 'follow-up')}</CallChip>}
    </>
  ) : undefined;
  return (
    <CallRow who={others.length ? { faces: others } : { arch: n.kind === 'room' ? 'mic' : 'video' }}
      title={series ? `${noteDay(n.startedAt, at)}, ${hm(n.startedAt)}` : marked(n.title, terms)}
      open={(p) => <Link to="/calls/$noteId" params={{ noteId: n.id }} {...p} />} tag={how}
      gist={quoted ? undefined : n.excerpt ? marked(nearMatch(n.excerpt, terms), terms) : noSummary(n)}
      quote={quoted ? <>“{marked(nearMatch(quote.text, terms), terms)}”{quote.speaker && <small> {spokenName(quote.speaker, me)}</small>}</> : undefined}
      chips={chips} pinned={pinned}
      when={series ? { at: callLength(n.duration) } : { at: pastWhen(n.startedAt, at), length: callLength(n.duration) }}
      menu={<PastMenu n={n} me={me} />} />
  );
}
