/*
 * The call's own page once it's over for you (docs/superpowers/specs/2026-11-11-after-the-call-design.md): you ended it, it
 * ended without you (whoever hosts ended it, or Alcove did: this tab can't tell which, so the page names nobody), you left it,
 * or you hosted and left it with someone. It stays on the call's night, says what happened, and offers the next step: the notes
 * once it has ended, Rejoin while it goes on, or Home. All it says of the call is taken as you leave (`Left`): once you're out,
 * the call tells this tab nothing more. What it follows after that is the note being written (followNotes.ts) and the note once
 * it is, and, while the call goes on without you, the call's card, read at the card's own pace, which turns the page when it
 * ends. It never moves on by itself; signing out in another tab takes it to the welcome page, as it takes the frame.
 */
import { clock, minutesLabel, notesAreOn, type CallSession, type CallState, type Note, type NoteProgress, type Person } from '@alcove/api';
import { Button, CallOver, type CallOverNotes } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { organizerFirst } from '~/features/call/rooms/Hosting';
import { useSignedOutElsewhere } from '~/features/shell/signedOutElsewhere';
import { arriveFromCall, useNow } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, listNames, sameEmail } from '~/lib/people';
import { q, trustLine } from '~/lib/queries';
import { useFollowNotes } from './followNotes';
import { useRejoin, useRejoinKey, type RejoinAs, type RejoinMedia } from './rejoin';

const olog = log.child({ component: 'call-over' });

/** How the call came to be over for you. */
export type LeftHow =
  /** You ended it for everyone: how long it ran and its note, as the server ended it. */
  | { kind: 'ended'; elapsed: number; noteId: string | null }
  /** It ended, and not by you: whoever hosts ended it, or Alcove did (its room went). Which, this tab can't tell. */
  | { kind: 'ended-by' }
  /** You left it, and it goes on. */
  | { kind: 'left' }
  /** You hosted, and left it with someone: by their first name. */
  | { kind: 'handed'; to: string };

/** The call as you left it, all the page knows of it. */
export interface Left {
  code: string;
  title: string;
  how: LeftHow;
  you: Person;
  /** Who was in the call besides you as you left it: after leaving there's no live view of who's there. */
  others: Person[];
  /** How long it had run as you left it, in seconds, and when that was: a call that goes on counts on from here. */
  elapsed: number;
  at: number;
  /** The note it writes, or null when notes were never on. */
  noteId: string | null;
  /** How notes were as you left: on, paused, or off (with a note, turned off after being on). */
  notesAsLeft: 'on' | 'paused' | 'off';
  modelPrivate: boolean;
  /** You organized it; the organizer's first name, whoever you are. */
  organizer: boolean;
  organizerFirst: string;
  /** You came in as a guest: no notes for you. */
  guest: boolean;
  /** You get the notes, and who does as far as you can tell, as the page says it ("Priya, Kofi, Maya and you get them."). */
  getsNotes: boolean;
  getting: { who: string; faces: Person[] };
  /** Your microphone and camera as you left: Rejoin brings them back as they were. */
  media: RejoinMedia;
  /** What joining again needs. */
  rejoin: RejoinAs;
}

/**
 * The page's snapshot of a call, as you leave it. `last` is the call as the server last said it while you were in it (a call
 * that has ended says nothing of who was there): how long it had run and its note come from it, but for your own end, which
 * carries the server's. `invited` is who's invited, which only the organizer can read.
 */
export function leftOf(o: { last: CallState; how: LeftHow; media: RejoinMedia; invited: readonly Person[] | null }): Left {
  const { last, how } = o;
  const you = last.participants.find((p) => p.isMe)?.person ?? { id: 'you', name: 'You', email: '' };
  // Someone back on a new connection is one person: the latest of their seat.
  const seats = new Map<string, Person>();
  for (const p of last.participants) if (!p.isMe) seats.set(p.seat, p.person);
  const others = [...seats.values()];
  const guest = last.role === 'guest';
  const named = last.isOrganizer && o.invited ? o.invited.filter((g) => !sameEmail(g, you)) : null;
  const everyone = last.participants.flatMap((p) => (p.isOrganizer || p.person.email ? [p.person] : [])).filter((p, k, all) => all.findIndex((x) => x.id === p.id) === k);
  const first = organizerFirst(last);
  const ran = how.kind === 'ended' ? how : { elapsed: last.elapsed, noteId: last.notes.noteId };
  const mode = last.capture.mode;
  return {
    code: last.code, title: last.title, how, you, others, elapsed: ran.elapsed, at: Date.now(), noteId: ran.noteId,
    notesAsLeft: notesAreOn(mode) ? 'on' : mode === 'paused' ? 'paused' : 'off', modelPrivate: last.capture.modelPrivate,
    organizer: last.isOrganizer, organizerFirst: first, guest, getsNotes: !guest && ran.noteId !== null,
    getting: named
      ? { who: named.length ? `${named.map(callName).join(', ')} and you get them.` : 'You get them.', faces: [...named, you] }
      : { who: 'Everyone invited gets them, you included.', faces: everyone },
    media: o.media,
    rejoin: { code: last.code, guestName: guest && !you.email ? you.name : null, host: last.host.standIn ? 'the host' : first }
  };
}

/* ---------- what it says ---------- */

/** The page's title: it has ended, or you left it. */
const titleOf = (left: Left, over: boolean): string => (over ? `${left.title} has ended` : `You left ${left.title}`);
/** Who's hosting a call you left with them, and until when. */
const hostingUntil = (left: Left, to: string): string => `${to} is hosting until ${left.organizer ? 'you’re' : `${left.organizerFirst} is`} back`;
/**
 * The one line under the title. While it goes on: who hosts it now you've left it with them, or who's still in it. Once it has
 * ended: how long it ran and who was in it, however it ended; a guest is told who can share the notes instead.
 */
function metaOf(left: Left, over: boolean, turned: boolean): string {
  if (!over) {
    if (left.how.kind === 'handed') return hostingUntil(left, left.how.to);
    return left.others.length ? `${listNames(left.others)} ${left.others.length > 1 ? 'are' : 'is'} still in it` : 'It goes on without you.';
  }
  if (left.guest && left.noteId !== null) return `${left.organizerFirst} can share the notes with you.`;
  if (turned) return 'It ended after you left.';
  const ran = minutesLabel(left.elapsed);
  return left.others.length ? `${ran} with ${listNames(left.others)}` : ran;
}
/** Leaving on the way somewhere else (a call that rang, say), the page doesn't show: what happened is said in a toast instead. */
export function onTheWay(left: Left): string {
  switch (left.how.kind) {
    case 'left': return 'You left the call';
    case 'handed': return `You left the call. ${hostingUntil(left, left.how.to)}.`;
    case 'ended':
    case 'ended-by': return `${left.title} has ended.`;
  }
}

/** What the notes are doing while they're written: the step on its way, as the note's own page says it. */
const stepOf = (p: NoteProgress | null): string =>
  p?.steps.find((s) => !s.done)?.label ?? p?.steps.at(-1)?.label ?? 'Writing the summary, decisions and follow-ups';
/** What the written notes decided, the call's and every room's, but for anything someone said wasn't decided. */
const decidedIn = (n: Note): number => [...n.decisions, ...n.rooms.flatMap((r) => r.decisions)].filter((d) => d.state !== 'rejected').length;
/** Their follow-ups, taken or only suggested so far, the call's and every room's; a suggested change to one isn't another. */
const followUpsIn = (n: Note): number =>
  [...n.actions, ...n.suggestions, ...n.rooms.flatMap((r) => [...r.actions, ...r.suggestions])].filter((a) => a.review !== 'dismissed' && a.changeOf === null).length;

/**
 * The page, on its own night, from the moment the call is over for you. `entering`: it arrives as the call eases back under it,
 * and says when it has (`onEntered`). `back`: Rejoin brought the call back (`onBack` handed it up), and the page fades over it as
 * it comes up, and says when it has gone (`onGone`).
 */
export function CallOverPage({ left, entering, onEntered, back, onBack, onGone }: {
  left: Left; entering: boolean; onEntered: () => void; back: boolean; onBack: (s: CallSession) => void; onGone: () => void;
}) {
  const navigate = useNavigate();
  const trust = useQuery(q.trust()).data;
  // Home is somewhere to go for anyone signed in here: a guest by name has only the call.
  const account = useQuery(q.session()).data;
  // Signed out in another tab, this tab forgets what it read (the notes among it) and goes to the welcome page.
  useSignedOutElsewhere(account?.ownerId ?? null);
  useEffect(() => {
    olog.info('the call is over here', { how: left.how.kind, notes: left.noteId !== null, guest: left.guest });
  }, [left]);

  /*
   * A call you left goes on until its card says it has ended; then the page turns, once, and stays turned. Only what's read
   * from here on counts: a card kept from before could say a call that's since started again has ended. It's read at the
   * card's own pace (q.card), which backs off when reading fails, stops when there's no such call, and keeps readers apart.
   */
  const going = left.how.kind === 'left' || left.how.kind === 'handed';
  const [since] = useState(() => Date.now());
  const [turned, setTurned] = useState(false);
  const over = !going || turned;
  const card = useQuery({ ...q.card(left.code), enabled: going && !turned });
  const endedNow = going && card.data?.ended === true && card.dataUpdatedAt >= since;
  useEffect(() => {
    if (!endedNow) return;
    olog.info('the call ended after you left', { notes: left.noteId !== null });
    setTurned(true);
  }, [endedNow, left.noteId]);
  // While it goes on, how long it's been going, ticking.
  const now = useNow(over ? 60_000 : 1000);

  /*
   * The notes, once the call has ended, for whoever gets them: each step as it's done, then the first of what they say. While it
   * goes on, how they were as you left: on, paused or off (turned off after being on, so there's still what was written).
   */
  const noteId = left.noteId;
  const following = over && left.getsNotes && noteId !== null;
  const { progress, stuck } = useFollowNotes(noteId, following);
  const ready = progress?.ready === true;
  const note = useQuery({ ...q.note(noteId ?? ''), enabled: ready && noteId !== null });
  const written = note.data;
  const notes: CallOverNotes | undefined = !over ? (left.getsNotes ? { kind: 'going', mode: left.notesAsLeft } : undefined)
    : following ? (ready && written ? { kind: 'ready', summary: written.summary, decided: decidedIn(written), followUps: followUpsIn(written) }
      : ready && note.isError ? { kind: 'ready', summary: '', decided: 0, followUps: 0 }
        : stuck && !ready ? { kind: 'slow' }
          : { kind: 'writing', step: stepOf(progress), who: left.getting.who, faces: left.getting.faces })
      // A guest is told who can share the notes instead; a call that ended after you left may have had notes since.
      : left.guest || turned ? undefined : { kind: 'none' };

  /* Rejoin, while it goes on: the button as you were, J with the microphone and camera off. */
  const rejoin = useRejoin(left.rejoin, onBack);

  /*
   * ---------- where it goes: the page fades first, and once it has, the frame settles in where it lands ----------
   * A rejoin on its way is given up as it goes, and taken back at once, so it can't bring the call back under a page that's
   * leaving; one that has brought the call back already keeps it, and the page stays with the call.
   */
  const [away, setAway] = useState<'home' | 'notes' | null>(null);
  const go = (to: 'home' | 'notes') => {
    if (away || back || !rejoin.cancel()) return;
    setAway(to);
    olog.info('leaving the call’s page', { to });
  };
  const gone = () => {
    if (!away) { if (back) onGone(); return; }
    arriveFromCall();
    void (away === 'notes' && noteId ? navigate({ to: '/notes/$noteId', params: { noteId }, replace: true }) : navigate({ to: '/home', replace: true }));
  };
  useRejoinKey(!over && away === null && !back, rejoin.rejoin);

  const toNotes = following && (
    <Button key="notes" variant="primary" size="lg" icon="notesPen" disabled={away !== null || back} onClick={() => go('notes')}>{ready ? 'Read the notes' : 'Open the notes'}</Button>
  );
  const home = Boolean(account) && (
    <Button key="home" variant={!over || toNotes ? 'secondary' : 'primary'} size="lg" icon="home" disabled={away !== null || back} onClick={() => go('home')}>Go to Home</Button>
  );
  const actions = !over
    ? <>
      <Button key="rejoin" variant="primary" size="lg" icon="video" kb="J" loading={rejoin.busy} disabled={away !== null || back}
        onClick={() => rejoin.rejoin(left.media)}>{rejoin.busy ? 'Rejoining…' : 'Rejoin'}</Button>
      {home}
    </>
    : (toNotes || home) && <>{toNotes}{home}</>;

  return (
    <CallOver title={titleOf(left, over)} meta={metaOf(left, over, turned)} people={over && !left.guest ? [left.you, ...left.others] : left.others}
      clock={over ? undefined : clock(left.elapsed + Math.max(0, now - left.at) / 1000)} notes={notes} modelPrivate={left.modelPrivate} trust={trustLine(trust)}
      actions={actions || undefined} turn={over ? 'over' : 'going'} entering={entering} leaving={away !== null || back} onEntered={onEntered} onGone={gone} />
  );
}
