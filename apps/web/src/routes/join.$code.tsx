import { errorMessage, type Meeting, type Person } from '@alcove/api';
import { Avatar, CallDock, DockButton, Faces, Icon, Logo, NotesSign, Spinner, buttonClass, cn, useRaisedToasts, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCopyLink } from '~/features/call/links';
import { PrejoinDevices } from '~/features/call/DevicePickers';
import { Video, useLevels } from '~/features/call/Video';
import { useDevices } from '~/features/call/devices';
import { LocalMedia } from '~/features/call/media';
import { api } from '~/lib/api';
import { requireAccount } from '~/lib/guards';
import { sessions, useLive } from '~/lib/live';
import { listNames } from '~/lib/people';
import { q } from '~/lib/queries';
import { daysFromToday, hm, minutesUntil, shortDay } from '~/lib/time';

/* Before the call: the only place your camera shows outside a call. */
export const Route = createFileRoute('/join/$code')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.byCode(params.code)),
  component: Join
});

function Join() {
  const { code } = Route.useParams();
  const meeting = useQuery(q.byCode(code)).data;
  const me = useQuery(q.session()).data?.user;
  if (!me) return null;
  if (!meeting) return <NotYours />;
  return <Prejoin meeting={meeting} me={me} />;
}

function Top() {
  return <header className="stg-top"><Link to="/home" className="stg-back"><Icon name="left" size={17} />Home</Link><div className="stg-mid"><Logo /></div><div className="stg-right" /></header>;
}

const shape = (l: number, i: number) => 18 + Math.min(1, l * (0.75 + Math.random() * 0.5)) * (i === 2 ? 82 : 62);

function Prejoin({ meeting, me }: { meeting: Meeting; me: Person }) {
  const navigate = useNavigate();
  const toast = useToast();
  const copy = useCopyLink();
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const [joining, setJoining] = useState(false);
  const levels = useLevels(media, 5, m.mic && !!m.camera, shape);
  // Named once the browser has been allowed the devices, so read again when they start.
  const devices = useDevices(m.camera);
  useRaisedToasts();

  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start({ mic: true, cam: true });
    // Leaving without joining lets go of the camera and microphone.
    return () => { if (!sessions.call) { media.stop(); sessions.media = null; } };
  }, [media]);

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
    <div className="stage ac-stage">
      <div className="stg">
        <Top />
        <div className="pj">
          <div className="pj-main">
          <div className={cn('feed', !m.mic && 'muted')}>
            {m.cam && m.camera ? <Video stream={m.camera} /> : <div className="feed-off"><Avatar person={me} size={120} /><span>Your camera is off</span></div>}
            {m.error && <p className="media-error">{m.error}</p>}
            <span className="lvl" aria-hidden="true">{levels.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
            <CallDock className="ctrls" label="Microphone and camera">
              <DockButton icon={m.mic ? 'mic' : 'micOff'} off={!m.mic} label={m.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => media.setMic(!m.mic)} />
              <DockButton icon={m.cam ? 'video' : 'videoOff'} off={!m.cam} label={m.cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => void media.setCam(!m.cam)} />
            </CallDock>
          </div>
          <PrejoinDevices media={media} m={m} devices={devices} />
          </div>
          <div className="pj-side">
            <h1>{meeting.title}</h1>
            <div className="pj-time ac-time">{now ? 'Starting now' : `${day}${hm(meeting.startsAt)} – ${hm(meeting.endsAt)}`}</div>
            <div className="presence">
              {guests.length ? <><Faces people={guests} size={28} /><span>{listNames(guests)} {guests.length > 1 ? 'are' : 'is'} invited</span></>
                : <span className="nobody"><Icon name="link" size={16} />Just you on this call so far.</span>}
            </div>
            <div className="pj-notes">
              {on ? <NotesSign stage>Notes are on</NotesSign> : <span className="off"><Icon name="x" size={14} />No notes for this call</span>}
              <p>{on ? `${guests.length ? `You and ${listNames(guests)} get them afterwards.` : 'You get them afterwards.'} Alcove can’t read them.` : 'Nothing is recorded. You can turn notes on during the call.'}</p>
            </div>
            <button type="button" className={cn(buttonClass({ variant: 'primary', size: 'lg' }), 'join')} disabled={joining} onClick={() => void join()}>{joining ? <Spinner /> : 'Join now'}</button>
            <div className="pj-sub"><button type="button" onClick={() => copy(meeting.code)}><Icon name="link" size={15} />Copy link</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotYours() {
  return (
    <div className="stage ac-stage">
      <div className="stg">
        <Top />
        <div className="grid flex-1 place-items-center p-6">
          <div className="wait-in">
            <Icon name="link" size={22} />
            <b>This call isn’t on your calendar</b>
            <p>Only the person who set it up can join it from their account.</p>
            <Link to="/home" className={buttonClass()}>Go home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
