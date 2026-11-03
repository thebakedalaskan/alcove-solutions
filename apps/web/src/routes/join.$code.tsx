import { errorMessage, type CallCard, type Meeting, type Person } from '@alcove/api';
import { Avatar, Faces, Icon, Logo, Spinner, cn, useRaisedToasts, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCopyLink } from '~/features/call/links';
import { PrejoinDevices } from '~/features/call/DevicePickers';
import { Video, useLevels } from '~/features/call/Video';
import { useDevices } from '~/features/call/devices';
import { LocalMedia, type MediaSnapshot } from '~/features/call/media';
import { api } from '~/lib/api';
import { sessions, useLive } from '~/lib/live';
import { listNames } from '~/lib/people';
import { q } from '~/lib/queries';
import { daysFromToday, hm, minutesUntil, shortDay } from '~/lib/time';

/* Before the call: the only place your camera shows outside a call. Anyone with the link comes here; the organizer by their account. */
export const Route = createFileRoute('/join/$code')({ component: Join });

function Join() {
  const { code } = Route.useParams();
  const session = useQuery(q.session());
  const me = session.data?.user;
  const meeting = useQuery({ ...q.byCode(code), enabled: Boolean(me) });
  // Refreshed, so someone waiting is let in once the organizer is there (or the call is unlocked).
  const card = useQuery({ ...q.card(code), refetchInterval: 5_000 });
  if (session.isPending || (me && meeting.isPending)) return null;
  if (meeting.data) return <Prejoin meeting={meeting.data} me={me ?? meeting.data.organizer} />;
  if (card.isError) return <NotYours />;
  if (!card.data) return null;
  return <GuestPrejoin card={card.data} code={code} me={me} />;
}

function Top() {
  return <header className="stg-top"><Link to="/home" className="stg-back"><Icon name="left" size={17} />Home</Link><div className="stg-mid"><Logo /></div><div className="stg-right" /></header>;
}

const shape = (l: number, i: number) => 18 + Math.min(1, l * (0.75 + Math.random() * 0.5)) * (i === 2 ? 82 : 62);

/** The camera, microphone and device pickers before joining: the same for the organizer and everyone else. */
function usePrejoinMedia() {
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const levels = useLevels(media, 5, m.mic && !!m.camera, shape);
  // Named once the browser has been allowed the devices, so read again when they start.
  const devices = useDevices(m.camera);
  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start({ mic: true, cam: true });
    // Leaving without joining lets go of the camera and microphone.
    return () => { if (!sessions.call) { media.stop(); sessions.media = null; } };
  }, [media]);
  return { media, m, levels, devices };
}

function Prejoin({ meeting, me }: { meeting: Meeting; me: Person }) {
  const navigate = useNavigate();
  const toast = useToast();
  const copy = useCopyLink();
  const { media, m, levels, devices } = usePrejoinMedia();
  const [joining, setJoining] = useState(false);
  useRaisedToasts();

  const join = async () => {
    setJoining(true);
    try {
      const s = await api.calls.join(meeting.code, { mic: m.mic, cam: m.cam });
      sessions.call = { code: meeting.code, session: s };
      await navigate({ to: '/call/$code', params: { code: meeting.code }, replace: true });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
      setJoining(false);
    }
  };

  const guests = meeting.guests;
  const on = meeting.notes === 'on';
  const now = meeting.status === 'live' || Math.abs(minutesUntil(meeting.startsAt)) <= 2;
  const day = daysFromToday(new Date(meeting.startsAt)) === 0 ? '' : `${shortDay(new Date(meeting.startsAt))} · `;
  return (
    <div className="stage">
      <div className="stg">
        <Top />
        <div className="pj">
          <PrejoinMain media={media} m={m} levels={levels} devices={devices} me={me} />
          <div className="pj-side">
            <h1>{meeting.title}</h1>
            <div className="pj-time mono">{now ? 'Starting now' : `${day}${hm(meeting.startsAt)} – ${hm(meeting.endsAt)}`}</div>
            <div className="presence">
              {guests.length ? <><Faces people={guests} size={28} /><span>{listNames(guests)} {guests.length > 1 ? 'are' : 'is'} invited</span></>
                : <span className="nobody"><Icon name="link" size={16} />Just you on this call so far.</span>}
            </div>
            <div className={cn('pj-notes', on && 'on')}>
              <span className="ic">{on ? <span className="rec-dot" /> : <Icon name="x" size={16} />}</span>
              <div>
                <b>{on ? 'Notes are on' : 'No notes for this call'}</b>
                <p>{on ? `${guests.length ? `You and ${listNames(guests)} get them afterwards.` : 'You get them afterwards.'} Alcove can’t read them.` : 'Nothing is recorded. You can turn notes on during the call.'}</p>
              </div>
            </div>
            <button type="button" className="join" disabled={joining} onClick={() => void join()}>{joining ? <Spinner /> : 'Join now'}</button>
            <div className="pj-sub"><button type="button" onClick={() => copy(meeting.code)}><Icon name="link" size={15} />Copy link</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The self-view, its two switches and the device pickers. */
function PrejoinMain({ media, m, levels, devices, me }: { media: LocalMedia; m: MediaSnapshot; levels: number[]; devices: ReturnType<typeof useDevices>; me: Person }) {
  return (
    <div className="pj-main">
    <div className={cn('feed', !m.mic && 'muted')}>
      {m.cam && m.camera ? <Video stream={m.camera} /> : <div className="feed-off"><Avatar person={me} size={120} /><span>Your camera is off</span></div>}
      {m.error && <p className="media-error">{m.error}</p>}
      <span className="lvl" aria-hidden="true">{levels.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
      <div className="ctrls">
        <button type="button" className={cn('rb', !m.mic && 'off')} aria-pressed={m.mic} aria-label={m.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => media.setMic(!m.mic)}><Icon name={m.mic ? 'mic' : 'micOff'} size={21} /></button>
        <button type="button" className={cn('rb', !m.cam && 'off')} aria-pressed={m.cam} aria-label={m.cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => void media.setCam(!m.cam)}><Icon name={m.cam ? 'video' : 'videoOff'} size={21} /></button>
      </div>
    </div>
    <PrejoinDevices media={media} m={m} devices={devices} />
    </div>
  );
}

/** Guests and invited people: they wait until the organizer is there, and guests without an account give a name. */
function GuestPrejoin({ card, code, me }: { card: CallCard; code: string; me: Person | undefined }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { media, m, levels, devices } = usePrejoinMedia();
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  useRaisedToasts();
  const ready = card.hostHere && !card.locked && (me !== undefined || name.trim().length > 0);
  const join = async () => {
    setJoining(true);
    try {
      const s = await api.calls.join(code, { mic: m.mic, cam: m.cam, ...(me ? {} : { name: name.trim() }) });
      sessions.call = { code, session: s };
      await navigate({ to: '/call/$code', params: { code }, replace: true });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
      setJoining(false);
    }
  };
  return (
    <div className="stage">
      <div className="stg">
        <Top />
        <div className="pj">
          <PrejoinMain media={media} m={m} levels={levels} devices={devices} me={me ?? { id: 'you', name: name.trim() || 'You', email: '' }} />
          <div className="pj-side">
            <h1>{card.title}</h1>
            <div className="pj-time mono">Hosted by {card.organizerName}</div>
            {!card.hostHere ? <p>Waiting for the host to start the call.</p> : card.locked ? <p>The host has locked this call.</p> : null}
            {!me && <input className="field" value={name} maxLength={60} autoComplete="name" placeholder="Your name" aria-label="Your name" onChange={(e) => setName(e.target.value)} />}
            <button type="button" className="join" disabled={joining || !ready} onClick={() => void join()}>{joining ? <Spinner /> : 'Join now'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotYours() {
  return (
    <div className="stage">
      <div className="stg">
        <Top />
        <div className="grid flex-1 place-items-center p-6">
          <div className="wait-in">
            <Icon name="link" size={22} />
            <b>There’s no call with that code</b>
            <p>Check the link and try again.</p>
            <Link to="/home" className="btn btn-secondary">Go home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
