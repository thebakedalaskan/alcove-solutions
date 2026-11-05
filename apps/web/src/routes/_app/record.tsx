import type { NoteSummary } from '@alcove/api';
import { Evening, Faces, Icon, RecPrint, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';
import { NightRecorder } from '~/features/record/NightRecorder';
import { canKeep } from '~/features/record/offline';
import { OnThisDevice } from '~/features/record/OnThisDevice';
import { uploads } from '~/features/record/uploads';
import { recordOfflineHere } from '~/lib/device';
import { useLive, useOnline } from '~/lib/live';
import { q } from '~/lib/queries';
import { hoursAndMinutes, pastDay } from '~/lib/time';

/*
 * Record, in the side panel: the night, in both themes, with the recorder for a sun. In the sky, the name, Start recording
 * and the microphone (NightRecorder); on the water, the recordings on this device waiting to upload and the ones made
 * before. It works offline: the recorder, and what's on this device.
 */
export const Route = createFileRoute('/_app/record')({
  // The page has to work without a connection, so what's recorded before only gets a moment before it opens.
  loader: async ({ context: { queryClient: qc } }) => {
    if (!navigator.onLine) return;
    await Promise.race([qc.ensureQueryData(q.notes('room')).catch(() => undefined), new Promise((r) => setTimeout(r, 800))]);
  },
  component: RecordPage
});

/** How many earlier recordings show here, newest first; Notes has them all. */
const SHOWN = 4;

/** Whether recording carries on without a connection: the setting, or offline, what this browser remembers of it; and whether this browser can keep anything. */
const useRecordsOffline = () => (useQuery(q.prefs()).data?.recordOffline ?? recordOfflineHere()) && canKeep();

function RecordPage() {
  const room = useQuery(q.notes('room')).data;
  const kept = useLive(uploads).list;
  const online = useOnline();
  const keeps = useRecordsOffline();
  /* Recordings you made: someone else's room notes, shared with you, weren't recorded here. */
  const mine = room?.filter((n) => !n.received).slice(0, SHOWN);
  const first = mine?.length === 0 && !kept.length;
  return (
    <Evening moment="record" className="rec dark" data-first={first ? true : undefined}>
      <header className="rec-head" style={{ '--d': 0 }}><h1>Record</h1></header>
      <NightRecorder keeps={keeps} />
      {first && <p className="rec-first" style={{ '--d': 2 }}>Interviews, site visits, meetings around a table: what you record shows up here, with its notes.</p>}
      {(kept.length > 0 || !!mine?.length) && (
        <div className={cn('rec-water', !(kept.length > 0 && mine?.length) && 'is-one')} style={{ '--d': 2 }}>
          <OnThisDevice />
          {!!mine?.length && <RecordedBefore notes={mine} />}
        </div>
      )}
      <p className="rec-foot" style={{ '--d': 3 }}>
        <Icon name="sealed" size={15} />
        <span>
          {keeps
            ? 'Encrypted as it’s recorded, and it works without a connection. Room notes go to nobody until you share them.'
            : 'Encrypted as it’s recorded. If the connection drops, recording pauses. Room notes go to nobody until you share them.'}
          {!keeps && online && <Link to="/settings" hash="recording" className="rec-link">Settings</Link>}
        </span>
      </p>
    </Evening>
  );
}

/** What a recording's row says under its name: the start of its summary, or how far it's got. */
function gistOf(n: NoteSummary): string {
  if (n.status === 'recording') return 'Recording now';
  if (n.status === 'pending') return 'Being written';
  return n.excerpt || 'Nothing was said while it recorded.';
}

/** "Today", "Mon" in the past week, else "27 Oct", and how long it ran while it isn't still going. */
function whenOf(n: NoteSummary): string {
  const day = pastDay(n.startedAt);
  const when = day.charAt(0).toUpperCase() + day.slice(1);
  return n.status === 'recording' ? when : `${when} · ${hoursAndMinutes(Math.max(1, Math.round(n.duration / 60)))}`;
}

function RecordedBefore({ notes }: { notes: NoteSummary[] }) {
  const h = useId();
  const online = useOnline();
  const toast = useToast();
  return (
    <section className="rec-list" aria-labelledby={h}>
      <div className="rec-h"><h2 id={h}>Recorded before</h2><Link to="/notes" className="rec-more-link">In Notes<Icon name="right" size={15} /></Link></div>
      <ul className="rec-before">
        {notes.map((n) => (
          <li key={n.id}>
            <Link to="/notes/$noteId" params={{ noteId: n.id }} className={cn('rec-n', n.status === 'pending' && 'is-writing')}
              onClick={(e) => { if (online) return; e.preventDefault(); toast('Notes open when you’re back online.', { icon: 'wifiOff' }); }}>
              <RecPrint id={n.id} />
              <span className="rec-t"><b className="ac-clamp-1">{n.title}</b><small className="ac-clamp-1">{gistOf(n)}</small></span>
              <span className="rec-f">
                {n.openActions > 0 && <span className="rec-todo" title={`${n.openActions} ${n.openActions === 1 ? 'follow-up' : 'follow-ups'} still open`}><Icon name="userCheck" size={13} />{n.openActions}</span>}
              </span>
              <span className="rec-w">
                <span>{whenOf(n)}</span>
                {n.people.length > 1
                  ? <small><Faces people={n.people} size={18} max={3} /></small>
                  : <small><Icon name="lock" size={13} />Only you</small>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
