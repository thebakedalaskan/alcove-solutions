import { errorCode, firstName, notesAreOn, type CallCard, type CallSession, type CaptureState, type Meeting, type Person } from '@alcove/api';
import { Avatar, Button, CallDock, DockButton, EASE, Faces, Icon, Logo, Notice, Spinner, buttonClass, cn, useRaisedToasts } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCopyLink } from '~/features/call/links';
import { PrejoinDevices } from '~/features/call/DevicePickers';
import { Video, useLevels } from '~/features/call/Video';
import { useDevices } from '~/features/call/devices';
import { LocalMedia, type MediaSnapshot } from '~/features/call/media';
import { lastPass, rememberPass } from '~/features/call/pass';
import { GuestName, GuestTradeOff, SignInHere, SignedInAs } from '~/features/join/JoinAs';
import { JoinProblem, JoinRefused } from '~/features/join/JoinProblem';
import { PrejoinCapture, type NotesAudience } from '~/features/join/PrejoinCapture';
import { useAuth } from '~/features/welcome/WaysIn';
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
  // Read alongside the session, and again while it waits, so joining opens once the organizer is there, and capture or a
  // lock show as they change. The organizer's own page reads it once, for what the call captures if it's on already.
  const card = useQuery({ ...q.card(code), ...(meeting.data ? { refetchInterval: false } : {}) });
  // The camera starts as soon as there's a call to join, while the rest of the page loads; the call's media code comes down meanwhile too.
  const joinable = Boolean(meeting.data) || (card.data !== undefined && !card.data.ended);
  const media = usePrejoinMedia(joinable);
  useEffect(() => { if (joinable) void import('~/features/call/livekit'); }, [joinable]);
  const signedIn = me !== undefined;
  const shell = (body: ReactNode) => <div className="stage ac-stage"><div className="stg"><Top home={signedIn} />{body}</div></div>;

  if (session.isPending || (me && meeting.isPending)) return shell(null);
  if (meeting.data) return shell(<Prejoin meeting={meeting.data} capture={card.data?.capture ?? null} me={me ?? meeting.data.organizer} media={media} />);
  const lost = card.error && errorCode(card.error) === 'not-found';
  if (lost || (!card.data && card.isError)) {
    return shell(lost
      ? <JoinProblem icon="link" title="There’s no call with that code" error={card.error} action={signedIn && <Link to="/home" className={buttonClass()}>Go home</Link>}>Check the link and try again.</JoinProblem>
      : <JoinProblem icon="wifiOff" title="Can’t open this call right now" error={card.error} action={<Button onClick={() => void card.refetch()}>Try again</Button>}>{card.error?.message ?? 'Try again in a moment.'}</JoinProblem>);
  }
  if (!card.data) return shell(null);
  if (card.data.ended) {
    // Still read now and then: if the organizer starts it again, this page becomes its pre-join.
    return shell(<JoinProblem icon="door" title={`${card.data.title} has ended`} action={signedIn && <Link to="/home" className={buttonClass()}>Go home</Link>}>If {firstName(card.data.organizerName)} starts it again, you can join from here.</JoinProblem>);
  }
  return shell(<GuestPrejoin card={card.data} code={code} me={me} media={media} />);
}

/** The stage's top bar: back to Home for someone with an account; a guest has only the call. */
function Top({ home }: { home: boolean }) {
  return <header className="stg-top">{home ? <Link to="/home" className="stg-back"><Icon name="left" size={17} />Home</Link> : <span />}<div className="stg-mid"><Logo /></div><div className="stg-right" /></header>;
}

const shape = (l: number, i: number) => 18 + Math.min(1, l * (0.75 + Math.random() * 0.5)) * (i === 2 ? 82 : 62);

/**
 * The camera, microphone and device pickers before joining: the same for the organizer and everyone else. They start
 * once there's a call to join (`go`), and stop if it goes (it ended, or the link leads nowhere): the camera is only ever
 * on where it can be seen.
 */
function usePrejoinMedia(go: boolean) {
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const levels = useLevels(media, 5, m.mic && !!m.camera, shape);
  // Named once the browser has been allowed the devices, so read again when they start.
  const devices = useDevices(m.camera);
  useEffect(() => {
    sessions.media = media;
    // Leaving without joining lets go of the camera and microphone.
    return () => { if (!sessions.call) { media.stop(); sessions.media = null; } };
  }, [media]);
  useEffect(() => {
    if (go && !media.started) void media.start({ mic: true, cam: true });
    else if (!go && media.started && !sessions.call) media.stop();
  }, [go, media]);
  return { media, m, levels, devices };
}
type Prejoining = ReturnType<typeof usePrejoinMedia>;

function Prejoin({ meeting, capture, me, media: { media, m, levels, devices } }: { meeting: Meeting; capture: CaptureState | null; me: Person; media: Prejoining }) {
  const navigate = useNavigate();
  const copy = useCopyLink();
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  useRaisedToasts();

  const join = async () => {
    setJoining(true);
    setProblem(null);
    try {
      const s = await api.calls.join(meeting.code, { mic: m.mic, cam: m.cam });
      sessions.call = { code: meeting.code, session: s };
      await navigate({ to: '/call/$code', params: { code: meeting.code }, replace: true });
    } catch (e) {
      setProblem(e);
      setJoining(false);
    }
  };

  const guests = meeting.guests;
  const now = meeting.status === 'live' || Math.abs(minutesUntil(meeting.startsAt)) <= 2;
  const day = daysFromToday(new Date(meeting.startsAt)) === 0 ? '' : `${shortDay(new Date(meeting.startsAt))} · `;
  return (
    <div className="pj">
      <PrejoinMain media={media} m={m} levels={levels} devices={devices} me={me} />
      <div className="pj-side">
        <h1>{meeting.title}</h1>
        <div className="pj-time ac-time">{now ? 'Starting now' : `${day}${hm(meeting.startsAt)} – ${hm(meeting.endsAt)}`}</div>
        <div className="presence">
          {guests.length ? <><Faces people={guests} size={28} /><span>{listNames(guests)} {guests.length > 1 ? 'are' : 'is'} invited</span></>
            : <span className="nobody"><Icon name="link" size={16} />Just you on this call so far.</span>}
        </div>
        <PrejoinCapture notes={meeting.notes} capture={capture} audience={{ kind: 'organizer', guests }} organizerName={me.name} />
        <button type="button" className={cn(buttonClass({ variant: 'primary', size: 'lg' }), 'join')} disabled={joining} onClick={() => void join()}>{joining ? <Spinner /> : 'Join now'}</button>
        {problem !== null && <JoinRefused error={problem} />}
        <div className="pj-sub"><button type="button" onClick={() => copy(meeting.code)}><Icon name="link" size={15} />Copy link</button></div>
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

const swap = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } } as const;

/**
 * Everyone but the organizer: invited people join with their account; anyone else asks, signed in (the organizer sees
 * who, and letting them in adds them to the invite when the notes may go to their account) or as a guest with a name.
 * Everyone waits until the organizer is there.
 */
function GuestPrejoin({ card, code, me, media: { media, m, levels, devices } }: { card: CallCard; code: string; me: Person | undefined; media: Prejoining }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const auth = useAuth({ call: code });
  const [name, setName] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  /* Asked to join: the call opens once the organizer's browser lets this one into the call's encrypted group. */
  const [asked, setAsked] = useState<CallSession | null>(null);
  const entered = useRef(false);
  useRaisedToasts();
  const organizer = firstName(card.organizerName);
  const ready = card.hostHere && !card.locked && (me !== undefined || name.trim().length > 0);
  const audience: NotesAudience = { kind: card.you === 'invited' ? 'invited' : card.you === 'asks' ? 'asks' : 'guest' };
  // Signed out, or signed in with an account this call's notes can't go to: the trade-off, and the ways in that get them.
  const guest = card.you === 'guest';
  const notesOn = card.capture ? notesAreOn(card.capture.mode) || card.capture.mode === 'paused' : card.notes === 'on';
  const enter = useCallback((s: CallSession) => {
    entered.current = true;
    sessions.call = { code, session: s };
    void navigate({ to: '/call/$code', params: { code }, replace: true });
  }, [code, navigate]);
  // Leaving the page while still asking takes the request back: for another screen here, or closing the tab.
  useEffect(() => () => { if (asked && !entered.current) void asked.leave().catch(() => undefined); }, [asked]);
  useClosingWithPage(asked);
  const join = async () => {
    if (!ready || joining) return;
    setJoining(true);
    setProblem(null);
    try {
      const previous = lastPass(code);
      const s = await api.calls.join(code, { mic: m.mic, cam: m.cam, ...(me ? {} : { name: name.trim() }), ...(previous ? { previous } : {}) });
      rememberPass(code, s.ticket.pass);
      if (s.crypto.getSnapshot().status === 'in' && s.getSnapshot().participants.some((p) => p.isMe)) enter(s);
      else setAsked(s);
    } catch (e) {
      setProblem(e);
      setJoining(false);
    }
  };
  /* Asking no more, or turned away: the page is as it was, and letting go of the session takes any request back. */
  const stopAsking = () => { setAsked(null); setJoining(false); };
  const t = reduce ? { duration: 0 } : { duration: 0.32, ease: EASE.out };
  const you: Person = me ?? { id: 'you', name: name.trim() || 'You', email: '' };
  return (
    <div className="pj">
      <PrejoinMain media={media} m={m} levels={levels} devices={devices} me={you} />
      <div className="pj-side">
        <h1>{card.title}</h1>
        <div className="pj-time ac-mono">Hosted by {card.organizerName}</div>
        <PrejoinCapture notes={card.notes} capture={card.capture} audience={audience} organizerName={card.organizerName} />
        {asked ? <Asking session={asked} organizer={organizer} onIn={enter} onStop={stopAsking} /> : (
          <AnimatePresence mode="wait" initial={false}>
            {signingIn && guest ? (
              <motion.div key="sign-in" className="pj-step" {...swap} transition={t}>
                <SignInHere auth={auth} only={card.signInForNotes} organizer={organizer} onBack={() => setSigningIn(false)} />
              </motion.div>
            ) : (
              <motion.div key="join" className="pj-step" {...swap} transition={t}>
                {!card.hostHere ? <p className="pj-ask" aria-live="polite"><Spinner />Waiting for {organizer} to start the call.</p>
                  : card.locked ? <Notice tone="caution" icon="lock">{organizer} locked this call, so nobody new can join.</Notice> : null}
                {me ? <SignedInAs me={me} /> : <GuestName value={name} onChange={setName} onEnter={() => void join()} />}
                <button type="button" className={cn(buttonClass({ variant: 'primary', size: 'lg' }), 'join')} disabled={joining || !ready} onClick={() => void join()}>
                  {joining ? <Spinner /> : card.you === 'invited' ? 'Join now' : 'Ask to join'}
                </button>
                {problem !== null && <JoinRefused error={problem} />}
                {guest && <GuestTradeOff notesOn={notesOn} signedIn={me !== undefined} onSignIn={() => setSigningIn(true)} />}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/** After asking to join: waiting for the organizer, then into the call; or told plainly that they said no. */
function Asking({ session, organizer, onIn, onStop }: { session: CallSession; organizer: string; onIn: (s: CallSession) => void; onStop: () => void }) {
  const c = useLive(session.crypto);
  // In once this browser is in the call's group and the call (who's here) has come with it.
  const named = useLive(session).participants.some((p) => p.isMe);
  useEffect(() => { if (c.status === 'in' && named) onIn(session); }, [c.status, named, onIn, session]);
  if (c.status === 'denied') {
    return <div className="pj-step"><p className="pj-ask">{organizer} didn’t let you in.</p><button type="button" className="pj-link pj-back" onClick={onStop}><Icon name="left" size={15} />Back</button></div>;
  }
  if (c.status === 'failed') return <p className="pj-ask">Alcove couldn’t set up this call’s encryption. Reload the page and try again.</p>;
  return (
    <div className="pj-step">
      <p className="pj-ask" aria-live="polite"><Spinner />{c.status === 'waiting' ? `Asked to join. Waiting for ${organizer} to let you in.` : 'Joining…'}</p>
      {c.status === 'waiting' && <button type="button" className="pj-link pj-back" onClick={onStop}><Icon name="x" size={15} />Stop asking</button>}
    </div>
  );
}
