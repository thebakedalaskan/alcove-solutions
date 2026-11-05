import { errorCode, firstName, notesAreOn, type CallCard, type CallSession, type Person } from '@alcove/api';
import { Button, EASE, Icon, Logo, Notice, Spinner, buttonClass, cn, useRaisedToasts } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { lastPass, rememberPass } from '~/features/call/pass';
import { Lobby } from '~/features/calls/Lobby';
import { PickTime, PickTimeWaiting } from '~/features/calls/PickTime';
import { GuestName, GuestTradeOff, SignInHere, SignedInAs } from '~/features/join/JoinAs';
import { JoinProblem, JoinRefused } from '~/features/join/JoinProblem';
import { PrejoinCapture, type NotesAudience } from '~/features/join/PrejoinCapture';
import { JoinMuted, PrejoinMain, usePrejoinMedia, type Prejoining } from '~/features/join/PrejoinMedia';
import { useAuth } from '~/features/welcome/WaysIn';
import { api } from '~/lib/api';
import { sessions, useClosingWithPage, useLive } from '~/lib/live';
import { q, trustLine } from '~/lib/queries';

/* Before the call: the only place your camera shows outside a call. Anyone with the link comes here; the organizer by their account. */
export const Route = createFileRoute('/join/$code')({ component: Join });

function Join() {
  const { code } = Route.useParams();
  return <JoinPage key={code} code={code} />;
}

/** One link. Going from one link to another, as joining a ring from a pick page does, starts over: nothing carries across. */
function JoinPage({ code }: { code: string }) {
  const session = useQuery(q.session());
  const me = session.data?.user;
  const meeting = useQuery({ ...q.byCode(code), enabled: Boolean(me) });
  // Your own call: the lobby. Anyone else, a call they're invited to included, sees what its link says.
  const yours = meeting.data?.isOrganizer ? meeting.data : null;
  const team = useQuery({ ...q.team(), enabled: Boolean(yours) });
  // Read alongside the session, and again while it waits, so joining opens once the organizer is there, and capture or a
  // lock show as they change. The organizer's own page reads it once, for what the call captures if it's on already.
  // Arriving always reads it, whatever's cached: the call may have gone since.
  const card = useQuery({ ...q.card(code), refetchOnMount: 'always', ...(yours ? { refetchInterval: false } : {}) });
  // The call has gone: what's cached of it counts for nothing, so no lobby and no camera stay on behind the page that says so.
  const lost = card.error !== null && errorCode(card.error) === 'not-found';
  const mine = lost ? null : yours;
  /*
   * A link that offers times is no call to join yet, so nothing starts a camera. Once it has shown someone its times the
   * page stays that way, even when the offer goes: a camera never starts behind someone who only came to pick. Opening
   * the link again goes to the call.
   */
  const offers = mine ? Boolean(mine.offer) : Boolean(card.data?.offer);
  const [picking, setPicking] = useState(false);
  if (offers && !picking) setPicking(true);
  // The camera starts as soon as there's a call to join, while the rest of the page loads; the call's media code comes down meanwhile too.
  const joinable = !lost && !offers && !picking && (Boolean(mine) || (card.data !== undefined && !card.data.ended));
  const media = usePrejoinMedia(joinable, mine?.joinMuted ?? card.data?.joinMuted ?? false);
  useEffect(() => { if (joinable) void import('~/features/call/livekit'); }, [joinable]);
  const signedIn = me !== undefined;
  const shell = (body: ReactNode) => <div className="stage ac-stage"><div className="stg"><Top home={signedIn} />{body}</div></div>;

  // Until a link says what it is, someone without an account sees nothing: it may be a page for picking a time, which isn't on the stage.
  if (session.isPending || (!me && card.isPending)) return null;
  if (me && meeting.isPending) return shell(null);
  if (mine?.offer) return <PickTimeWaiting meeting={mine} />;
  if (mine && me) return team.isPending ? shell(null) : shell(<Lobby meeting={mine} me={me} capture={card.data?.capture ?? null} team={team.data ?? null} standIn={card.data?.standIn?.name ?? null} media={media} />);
  if (lost || (!card.data && card.isError)) {
    return shell(lost
      ? <JoinProblem icon="link" title="There’s no call with that code" error={card.error} action={signedIn && <Link to="/home" className={buttonClass()}>Go home</Link>}>Check the link and try again.</JoinProblem>
      : <JoinProblem icon="wifiOff" title="Can’t open this call right now" error={card.error} action={<Button onClick={() => void card.refetch()}>Try again</Button>}>{card.error?.message ?? 'Try again in a moment.'}</JoinProblem>);
  }
  if (!card.data) return shell(null);
  if (picking) return <PickTime card={card.data} code={code} />;
  if (card.data.ended) {
    // Still read now and then: if the organizer starts it again, this page becomes its pre-join.
    return shell(<JoinProblem icon="door" title={`${card.data.title} has ended`} action={signedIn && <Link to="/home" className={buttonClass()}>Go home</Link>}>If {firstName(card.data.organizerName)} starts it again, you can join from here.</JoinProblem>);
  }
  return shell(<GuestPrejoin card={card.data} code={code} me={me} media={media} />);
}

/** The stage's top bar: back to Home for someone with an account, and what the call runs on. A guest has only the call. */
function Top({ home }: { home: boolean }) {
  const trust = useQuery(q.trust()).data;
  return (
    <header className="stg-top">
      {home ? <Link to="/home" className="stg-back"><Icon name="left" size={17} />Home</Link> : <span />}
      <div className="stg-mid"><Logo /></div>
      <div className="stg-right"><span className="rg-trust"><Icon name="sealed" size={15} /><span>{trustLine(trust)}</span></span></div>
    </header>
  );
}

const swap = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } } as const;

/**
 * Everyone but the organizer: invited people join with their account; anyone else asks, signed in (the organizer sees
 * who, and letting them in adds them to the invite when the notes may go to their account) or as a guest with a name.
 * Everyone waits until the organizer is there.
 */
function GuestPrejoin({ card, code, me, media }: { card: CallCard; code: string; me: Person | undefined; media: Prejoining }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const auth = useAuth({ call: code });
  const [name, setName] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  /* Asked to join: the call opens once the host's browser lets this one into the call's encrypted group. */
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
      const { mic, cam } = media.m;
      const s = await api.calls.join(code, { mic, cam, ...(me ? {} : { name: name.trim() }), ...(previous ? { previous } : {}) });
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
      <PrejoinMain media={media} me={you} />
      <div className="pj-side">
        <h1>{card.title}</h1>
        <div className="pj-time ac-mono">Hosted by {card.organizerName}</div>
        <PrejoinCapture notes={card.notes} choices={card.choices} capture={card.capture} audience={audience} organizerName={card.organizerName} taker={card.standIn ? 'the host' : undefined} />
        {card.joinMuted && <JoinMuted />}
        {asked ? <Asking session={asked} host={card.standIn ? 'the host' : organizer} onIn={enter} onStop={stopAsking} /> : (
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
                {guest && <GuestTradeOff notesOn={notesOn} signedIn={me !== undefined} away={card.standIn ? organizer : undefined} onSignIn={() => setSigningIn(true)} />}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/**
 * After asking to join: waiting for whoever hosts (the organizer, or "the host" while someone stands in for them: nobody
 * waiting is told who), then into the call; or told plainly that they said no.
 */
function Asking({ session, host, onIn, onStop }: { session: CallSession; host: string; onIn: (s: CallSession) => void; onStop: () => void }) {
  const c = useLive(session.crypto);
  // In once this browser is in the call's group and the call (who's here) has come with it.
  const named = useLive(session).participants.some((p) => p.isMe);
  useEffect(() => { if (c.status === 'in' && named) onIn(session); }, [c.status, named, onIn, session]);
  if (c.status === 'denied') {
    return <div className="pj-step"><p className="pj-ask">{host.charAt(0).toUpperCase() + host.slice(1)} didn’t let you in.</p><button type="button" className="pj-link pj-back" onClick={onStop}><Icon name="left" size={15} />Back</button></div>;
  }
  if (c.status === 'failed') return <p className="pj-ask">Alcove couldn’t set up this call’s encryption. Reload the page and try again.</p>;
  return (
    <div className="pj-step">
      <p className="pj-ask" aria-live="polite"><Spinner />{c.status === 'waiting' ? `Asked to join. Waiting for ${host} to let you in.` : 'Joining…'}</p>
      {c.status === 'waiting' && <button type="button" className="pj-link pj-back" onClick={onStop}><Icon name="x" size={15} />Stop asking</button>}
    </div>
  );
}
