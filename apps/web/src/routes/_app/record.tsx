import type { NoteSummary } from '@alcove/api';
import { Card, Chip, EmptyState, Icon, NoteTile, SealedBadge, coverFor, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { NightRecorder } from '~/features/record/NightRecorder';
import { OnThisDevice } from '~/features/record/OnThisDevice';
import { uploads } from '~/features/record/uploads';
import { recordOfflineHere } from '~/lib/device';
import { useLive } from '~/lib/live';
import { q } from '~/lib/queries';
import { hoursAndMinutes, noteDay } from '~/lib/time';

/*
 * Record, in the side panel: the night recorder (a name, the microphone, Start recording), the recordings on this
 * device waiting to upload, then the recordings made before, and beside them how recording works. Before the first
 * recording, a card says where they'll show. It works offline: the recorder, and what's on this device.
 */
export const Route = createFileRoute('/_app/record')({ component: RecordPage });

/** How many earlier recordings show here, newest first; Notes has them all. */
const SHOWN = 4;

/** Whether recording carries on without a connection: the setting, or offline, what this browser remembers of it. */
const useRecordsOffline = () => useQuery(q.prefs()).data?.recordOffline ?? recordOfflineHere();

function RecordPage() {
  const room = useQuery(q.notes('room')).data;
  const kept = useLive(uploads).list;
  const offline = useRecordsOffline();
  /* Recordings you made: someone else's room notes, shared with you, weren't recorded here. */
  const mine = room?.filter((n) => !n.received);
  return (
    <>
      <div className="rec-head" style={{ '--d': 0 }}>
        <div>
          <h1>Record</h1>
          <p className="lede">For conversations in the room: an interview, a site visit, a meeting around a table. {offline ? 'It works without a connection.' : 'If the connection drops, recording pauses.'}</p>
        </div>
      </div>
      <div className="rec" style={{ '--d': 1 }}>
        <div className="rec-grid">
          <div className="rec-main">
            <NightRecorder />
            <OnThisDevice />
            {mine && (mine.length ? <RecordedBefore notes={mine} /> : !kept.length && <FirstRecording offline={offline} />)}
          </div>
          <div className="rec-side">
            <HowItWorks offline={offline} />
          </div>
        </div>
      </div>
    </>
  );
}

/** What a recording's tile says under its summary: still going, being written, or the follow-ups left in it. */
function endOf(n: NoteSummary): string | undefined {
  if (n.status === 'recording') return 'Recording';
  if (n.status === 'pending') return 'Being written';
  return n.openActions ? `${n.openActions} follow-up${n.openActions === 1 ? '' : 's'}` : undefined;
}
function excerptOf(n: NoteSummary): string {
  if (n.excerpt) return n.excerpt;
  if (n.status === 'ready') return 'Nothing was said while it recorded.';
  return n.status === 'pending' ? 'The summary, decisions and follow-ups show here once they’re written.' : 'Recording now.';
}

function RecordedBefore({ notes }: { notes: NoteSummary[] }) {
  const h = useId();
  return (
    <section className="rec-before" aria-labelledby={h}>
      <div className="rec-row-head"><h3 id={h}>Recorded before</h3><Link to="/notes">In Notes<Icon name="right" size={14} /></Link></div>
      <div className="rec-tiles">
        {notes.slice(0, SHOWN).map((n) => {
          const alone = n.people.length <= 1;
          return (
            <NoteTile key={n.id} cover={coverFor(n.id)} room title={n.title}
              meta={n.status === 'recording' ? noteDay(n.startedAt) : `${noteDay(n.startedAt)} · ${hoursAndMinutes(Math.max(1, Math.round(n.duration / 60)))}`}
              excerpt={excerptOf(n)} faces={alone ? undefined : n.people} who={alone ? <><Icon name="lock" size={14} />Only you</> : undefined}
              end={endOf(n)} link={<Link to="/notes/$noteId" params={{ noteId: n.id }} />} />
          );
        })}
      </div>
    </section>
  );
}

/** Before anything is recorded: where recordings will show, and what people record. */
function FirstRecording({ offline }: { offline: boolean }) {
  return (
    <Card title="Your recordings">
      <EmptyState className="rec-empty" title="Nothing recorded yet"
        action={<><Chip icon="people">Interviews</Chip><Chip icon="mapPin">Site visits</Chip><Chip icon="room">Meetings around a table</Chip></>}>
        Recordings you make here show up with their notes.{offline && ' Offline, they wait on this device until they can upload.'}
      </EmptyState>
    </Card>
  );
}

function Fact({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <li className="rec-fact">
      <span className="rec-ic"><Icon name={icon} size={18} /></span>
      <div><b>{title}</b><p>{children}</p></div>
    </li>
  );
}

function HowItWorks({ offline }: { offline: boolean }) {
  return (
    <Card title="How it works">
      <ul className="rec-facts">
        <Fact icon="lock" title="Encrypted on this device">Audio is encrypted as it’s recorded, in five-second pieces.</Fact>
        {offline
          ? <Fact icon="wifiOff" title="No connection needed">Offline, it saves here and uploads when you’re back. Notes follow.</Fact>
          : <Fact icon="wifi" title="Needs a connection">If it drops, recording pauses. Resume once you’re back online.</Fact>}
        <Fact icon="people" title="Yours until you share">Notes from the room go to nobody else unless you share them.</Fact>
      </ul>
      <div className="rec-foot"><SealedBadge inline title="Written in confidential compute. Alcove can’t read it." /></div>
    </Card>
  );
}
