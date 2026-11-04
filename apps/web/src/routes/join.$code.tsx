import { errorMessage, type CallCard, type CallSession, type Meeting, type Person } from '@alcove/api';
import { Avatar, CallDock, CaptureSummary, DockButton, Faces, Icon, Logo, NotesSign, Spinner, buttonClass, cn, useRaisedToasts, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCopyLink } from '~/features/call/links';
import { PrejoinDevices } from '~/features/call/DevicePickers';
import { Video, useLevels } from '~/features/call/Video';
import { useDevices } from '~/features/call/devices';
import { LocalMedia, type MediaSnapshot } from '~/features/call/media';
import { lastPass, rememberPass } from '~/features/call/pass';
import { api } from '~/lib/api';
import { sessions, useClosingWithPage, useLive } from '~/lib/live';
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
    <div className="stage ac-stage">
      <div className="stg">
        <Top />
        <div className="pj">
          <PrejoinMain media={media} m={m} levels={levels} devices={devices} me={me} />
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

/** The self-view, its two switches and the device pickers. */
function PrejoinMain({ media, m, levels, devices, me }: { media: LocalMedia; m: MediaSnapshot; levels: number[]; devices: ReturnType<typeof useDevices>; me: Person }) {
  return (
    <div className="pj-main">
    <div className={cn('feed', !m.mic && 'muted')}>
      {m.cam && m.camera ? <Video stream={m.camera} /> : <div className="feed-off"><Avatar person={me} size={120} /><span>Your camera is off</span></div>}
      <span className="lvl" aria-hidden="true">{levels.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
      <CallDock className="ctrls" label="Microphone and camera">
        <DockButton icon={m.mic ? 'mic' : 'micOff'} off={!m.mic} alert={!!m.access.mic.problem} label={m.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => void media.setMic(!m.mic)} />
        <DockButton icon={m.cam ? 'video' : 'videoOff'} off={!m.cam} alert={!!m.access.cam.problem} label={m.cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => void media.setCam(!m.cam)} />
      </CallDock>
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
  /* Asked to join: the call opens once the organizer's browser lets this one into the call's encrypted group. */
  const [asked, setAsked] = useState<CallSession | null>(null);
  const entered = useRef(false);
  useRaisedToasts();
  const ready = card.hostHere && !card.locked && (me !== undefined || name.trim().length > 0);
  const enter = useCallback((s: CallSession) => {
    entered.current = true;
    sessions.call = { code, session: s };
    void navigate({ to: '/call/$code', params: { code }, replace: true });
  }, [code, navigate]);
  // Leaving the page while still asking takes the request back: for another screen here, or closing the tab.
  useEffect(() => () => { if (asked && !entered.current) void asked.leave().catch(() => undefined); }, [asked]);
  useClosingWithPage(asked);
  const join = async () => {
    setJoining(true);
    try {
      const previous = lastPass(code);
      const s = await api.calls.join(code, { mic: m.mic, cam: m.cam, ...(me ? {} : { name: name.trim() }), ...(previous ? { previous } : {}) });
      rememberPass(code, s.ticket.pass);
      if (s.crypto.getSnapshot().status === 'in' && s.getSnapshot().participants.some((p) => p.isMe)) enter(s);
      else setAsked(s);
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
      setJoining(false);
    }
  };
  return (
    <div className="stage ac-stage">
      <div className="stg">
        <Top />
        <div className="pj">
          <PrejoinMain media={media} m={m} levels={levels} devices={devices} me={me ?? { id: 'you', name: name.trim() || 'You', email: '' }} />
          <div className="pj-side">
            <h1>{card.title}</h1>
            <div className="pj-time ac-mono">Hosted by {card.organizerName}</div>
            {!card.hostHere ? <p>Waiting for the host to start the call.</p> : card.locked ? <p>The host has locked this call.</p> : null}
            {/* What the call captures, before and while asking to join: refreshed with the card. */}
            <CaptureSummary notes={card.notes} capture={card.capture} />
            {asked ? <Asking session={asked} organizerName={card.organizerName} onIn={enter} /> : (
              <>
                {!me && <input className="ac-input" value={name} maxLength={60} autoComplete="name" placeholder="Your name" aria-label="Your name" onChange={(e) => setName(e.target.value)} />}
                <button type="button" className={cn(buttonClass({ variant: 'primary', size: 'lg' }), 'join')} disabled={joining || !ready} onClick={() => void join()}>{joining ? <Spinner /> : 'Join now'}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** After asking to join: waiting for the organizer, then into the call; or told plainly that they said no. */
function Asking({ session, organizerName, onIn }: { session: CallSession; organizerName: string; onIn: (s: CallSession) => void }) {
  const c = useLive(session.crypto);
  // In once this browser is in the call's group and the call (who's here) has come with it.
  const named = useLive(session).participants.some((p) => p.isMe);
  useEffect(() => { if (c.status === 'in' && named) onIn(session); }, [c.status, named, onIn, session]);
  if (c.status === 'denied') return <p className="pj-ask">{organizerName} didn’t let you in.</p>;
  if (c.status === 'failed') return <p className="pj-ask">Alcove couldn’t set up this call’s encryption. Reload the page and try again.</p>;
  return (
    <p className="pj-ask" aria-live="polite"><Spinner />{c.status === 'waiting' ? `Asked to join. Waiting for ${organizerName} to let you in.` : 'Joining…'}</p>
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
            <b>There’s no call with that code</b>
            <p>Check the link and try again.</p>
            <Link to="/home" className={buttonClass()}>Go home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
