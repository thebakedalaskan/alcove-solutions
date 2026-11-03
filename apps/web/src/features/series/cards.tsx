/*
 * A series where people look before and after a call: on Home, what carries over into the call
 * that's up next; beside a call's notes, the series it's in and its next call, or a way to start one.
 * Everything comes from the notes the reader has, put together when they look.
 */
import { firstName, type Note, type Series } from '@alcove/api';
import { Button, Card, EmptyState, Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { q } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';
import { CarriedActionRow, CarriedDecisionRow, CarriedQuestionRow, useScheduleNextCall } from './carried';

/** At most this many of each on Home; the series page has the rest. */
const SHOWN = 3;

const calls = (n: number) => `${n} call${n === 1 ? '' : 's'}`;

function SeriesLink({ seriesId, children }: { seriesId: string; children: ReactNode }) {
  return <Link to="/notes/series/$seriesId" params={{ seriesId }}>{children}</Link>;
}

function Group({ label, count, children }: { label: string; count?: string | number | undefined; children: ReactNode }) {
  return <div className="prep-g"><div className="ac-eyebrow">{label}{count ? <span>{count}</span> : null}</div>{children}</div>;
}

/** Why nothing carries over: no notes in the series yet, notes still being written, or nothing left to carry. */
function nothingYet(s: Series): { title: string; text: string } {
  if (!s.notes.length) return { title: 'Nothing from earlier calls yet', text: 'When a call in this series has notes, what it decided and left open shows here before the next one.' };
  if (!s.notes.some((n) => n.status === 'ready')) return { title: 'The notes are still being written', text: 'What the last call decided and left open shows here once they are.' };
  return { title: 'Nothing carries over', text: 'Earlier calls didn’t decide anything or leave anything open.' };
}

/** On Home, under the call that's up next: what earlier calls in its series decided and left open. */
export function PrepCard({ seriesId, me }: { seriesId: string; me: string | undefined }) {
  const s = useQuery(q.series(seriesId)).data;
  if (!s) return null;
  const from = new Map(s.notes.map((n) => [n.id, n]));
  // What people settled comes first: confirmed decisions and follow-ups someone took on. The rest is counted.
  const decided = s.decisions.filter((d) => d.state === 'confirmed');
  const unconfirmed = s.decisions.filter((d) => d.state === 'proposed').length;
  const taken = s.actions.filter((a) => !a.done && a.takenOn);
  const untaken = s.actions.filter((a) => !a.done && !a.takenOn).length;
  const doneSince = s.actions.filter((a) => a.done).length;
  const empty = !decided.length && !unconfirmed && !s.questions.length && !s.actions.length;
  const also = (bits: [number, string][]) => {
    const shown = bits.filter(([n]) => n > 0);
    return shown.length ? <div className="prep-more">{shown.map(([n, what]) => <SeriesLink key={what} seriesId={seriesId}>{n} {what}</SeriesLink>)}</div> : null;
  };
  return (
    <Card className="prep" title={s.notes.length === 1 ? 'From the last call' : 'From earlier calls'}
      aside={<SeriesLink seriesId={seriesId}>{s.notes.length ? calls(s.notes.length) : 'Series'}<Icon name="right" size={14} /></SeriesLink>}>
      {empty ? (
        <EmptyState className="prep-empty" title={nothingYet(s).title}>{nothingYet(s).text}</EmptyState>
      ) : (
        <div className="prep-groups">
          {(decided.length > 0 || unconfirmed > 0) && (
            <Group label="Decided" count={decided.length}>
              {decided.slice(0, SHOWN).map((d) => <CarriedDecisionRow key={d.id} d={d} note={from.get(d.noteId)} me={me} />)}
              {also([[decided.length - SHOWN, 'more decided'], [unconfirmed, 'nobody has confirmed yet']])}
            </Group>
          )}
          {s.questions.length > 0 && (
            <Group label="Still open" count={s.questions.length}>
              {s.questions.slice(0, SHOWN).map((x) => <CarriedQuestionRow key={x.id} x={x} note={from.get(x.noteId)} />)}
              {also([[s.questions.length - SHOWN, 'more still open']])}
            </Group>
          )}
          {s.actions.length > 0 && (
            <Group label="Follow-ups" count={taken.length ? `${taken.length} taken on` : undefined}>
              {taken.slice(0, SHOWN).map((a) => <CarriedActionRow key={a.id} a={a} note={from.get(a.noteId)} me={me} />)}
              {also([[taken.length - SHOWN, 'more taken on'], [untaken, 'not taken on yet'], [doneSince, 'done since the last call']])}
            </Group>
          )}
        </div>
      )}
    </Card>
  );
}

/** Beside a call's notes: the series it's in, or for the organizer, a way to meet again. Room recordings have neither. */
export function SeriesCard({ note }: { note: Note }) {
  if (note.kind !== 'call' || note.status === 'recording') return null;
  if (note.seriesId) return <InSeries seriesId={note.seriesId} />;
  return !note.from && note.meetingId ? <MeetAgain meetingId={note.meetingId} /> : null;
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

function InSeries({ seriesId }: { seriesId: string }) {
  const s = useQuery(q.series(seriesId)).data;
  const next = useScheduleNextCall();
  if (!s) return null;
  const latest = s.notes.find((n) => n.meetingId)?.meetingId;
  const questions = s.questions.length;
  const actions = s.actions.filter((a) => !a.done).length;
  const open = [questions ? `${questions} question${questions === 1 ? '' : 's'}` : '', actions ? `${actions} follow-up${actions === 1 ? '' : 's'}` : ''].filter(Boolean);
  const across = s.isOrganizer ? (s.notes.length === 1 ? 'from its first call' : `across its ${calls(s.notes.length)}`) : 'across the calls you have notes from';
  return (
    <Card title="Series" aside={<span className="ac-mono">{calls(s.notes.length)}</span>}>
      <p className="ser-p">
        {s.isOrganizer ? '' : `From ${firstName(s.organizer.name)}’s calls. `}
        {open.length ? `${open.join(' and ')} ${questions + actions === 1 ? 'is' : 'are'} still open ${across}.` : `Nothing is left open ${across}.`}
      </p>
      {s.isOrganizer && (s.next
        ? <div className="ser-next"><Icon name="cal" size={15} /><span>Next call <b className="ac-mono">{shortDay(new Date(s.next.startsAt))}, {hm(s.next.startsAt)}</b></span></div>
        : s.recurring
          ? <div className="ser-next"><Icon name="cal" size={15} /><span>The next one is on your Google Calendar.</span></div>
          : latest && <Button icon="repeat" className="ser-btn" loading={next.pending} onClick={() => next.run(latest)}>Schedule next week’s call</Button>)}
      <Link to="/notes/series/$seriesId" params={{ seriesId }} className="ser-go">What carries over<Icon name="right" size={14} /></Link>
    </Card>
  );
}
