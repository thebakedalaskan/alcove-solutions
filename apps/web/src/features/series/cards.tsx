/*
 * A series where people look after a call: beside a call's notes, the series it's in and its next call, or a
 * way to start one. Everything comes from the notes the reader has, put together when they look.
 */
import { firstName, minutesLabel, type Note, type Series, type SeriesNote } from '@alcove/api';
import { ArchThumb, Button, Card, Chip, Icon, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { q } from '~/lib/queries';
import { daysFromToday, hm, shortDay, weekday } from '~/lib/time';
import { NextOnCalendar, useScheduleNextCall } from './carried';

const calls = (n: number) => `${n} call${n === 1 ? '' : 's'}`;

const apart = (a: SeriesNote, b: SeriesNote) => daysFromToday(new Date(a.startedAt)) - daysFromToday(new Date(b.startedAt));
/** "Every Tuesday" when the series' last three calls you have were a week apart; otherwise nothing. */
export function weeklyLabel(s: Series): string | undefined {
  const [a, b, c] = s.notes;
  return a && b && c && apart(a, b) === 7 && apart(b, c) === 7 ? `Every ${weekday(new Date(a.startedAt))}` : undefined;
}

/** Beside a note's state: the series its call is in, "Every Tuesday" or "In a series". */
export function SeriesChip({ seriesId }: { seriesId: string }) {
  const s = useQuery(q.series(seriesId)).data;
  return <Chip tone="outline" icon="history">{(s && weeklyLabel(s)) ?? 'In a series'}</Chip>;
}

/** Beside a call's notes: the series it's in, or for the organizer, a way to meet again. Room recordings have neither. */
export function SeriesCard({ note }: { note: Note }) {
  if (note.kind !== 'call' || note.status === 'recording') return null;
  if (note.seriesId) return <InSeries seriesId={note.seriesId} noteId={note.id} />;
  return !note.received && note.meetingId ? <MeetAgain meetingId={note.meetingId} /> : null;
}

function MeetAgain({ meetingId }: { meetingId: string }) {
  const next = useScheduleNextCall();
  return (
    <Card title="Meet again">
      <p className="ser-p">Schedule the next call with the same people, a week on. What’s decided and still open here carries over to it.</p>
      <Button icon="repeat" className="ser-btn" loading={next.pending} onClick={() => next.run(meetingId)}>Schedule next week’s call</Button>
    </Card>
  );
}

/* The series' other calls shown beside a note; the series page has them all. */
const OTHER_CALLS = 3;

/** The series a note's call is in: its other calls, newest first, what's still open across them, and for the organizer the next call. */
function InSeries({ seriesId, noteId }: { seriesId: string; noteId: string }) {
  const s = useQuery(q.series(seriesId)).data;
  const notes = useQuery(q.notes()).data;
  const next = useScheduleNextCall();
  if (!s) return null;
  const others = s.notes.filter((n) => n.id !== noteId).slice(0, OTHER_CALLS);
  /* Under each call's day, the start of its summary, from the notes list. */
  const gist = (n: SeriesNote) => (n.status === 'ready' ? notes?.find((x) => x.id === n.id)?.excerpt || n.title : 'Notes being written');
  const latest = s.notes.find((n) => n.meetingId)?.meetingId;
  const questions = s.questions.length;
  const actions = s.actions.filter((a) => !a.done).length;
  const open = [questions ? `${questions} question${questions === 1 ? '' : 's'}` : '', actions ? `${actions} follow-up${actions === 1 ? '' : 's'}` : ''].filter(Boolean);
  const across = s.isOrganizer ? (s.notes.length === 1 ? 'from its first call' : `across its ${calls(s.notes.length)}`) : 'across the calls you have notes from';
  return (
    <Card title={weeklyLabel(s) ?? 'In a series'} aside={<Link to="/notes/series/$seriesId" params={{ seriesId }} aria-label={`All ${calls(s.notes.length + s.older)} in this series`}>All<Icon name="right" size={14} /></Link>}>
      {others.length > 0 && (
        <div className="ser-rows">
          {others.map((n) => (
            <Link key={n.id} to="/notes/$noteId" params={{ noteId: n.id }}>
              <ArchThumb cover={coverFor(n.id)} width={20} />
              <span className="min-w-0"><b>{new Date(n.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b><small className="ac-clamp-1">{gist(n)}</small></span>
              <span className="ac-mono">{minutesLabel(n.duration)}</span>
            </Link>
          ))}
        </div>
      )}
      <p className="ser-p">
        {s.isOrganizer ? '' : `From ${firstName(s.organizer.name)}’s calls. `}
        {open.length ? `${open.join(' and ')} ${questions + actions === 1 ? 'is' : 'are'} still open ${across}.` : `Nothing is left open ${across}.`}
      </p>
      {s.isOrganizer && (s.next
        ? <div className="ser-next"><Icon name="cal" size={15} /><span>Next call <b className="ac-mono">{shortDay(new Date(s.next.startsAt))}, {hm(s.next.startsAt)}</b></span></div>
        : s.recurring
          ? <NextOnCalendar><div className="ser-next"><Icon name="cal" size={15} /><span>The next one is on your Google Calendar.</span></div></NextOnCalendar>
          : latest && <Button icon="repeat" className="ser-btn" loading={next.pending} onClick={() => next.run(latest)}>Schedule next week’s call</Button>)}
    </Card>
  );
}
