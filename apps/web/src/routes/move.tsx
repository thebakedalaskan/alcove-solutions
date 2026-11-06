import { errorCode, errorMessage, errorRequestId, type CallMoveIn, type DemoProvider, type MoveProblem } from '@alcove/api';
import { Avatar, Button, Chip, Dots, Icon, Logo, Notice, useRaisedToasts, useToast } from '@alcove/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LocalMedia } from '~/features/call/media/media';
import { carried } from '~/features/move/MoveSheet';
import { thisDevice } from '~/features/move/device';
import { keepClaim, takeClaim, takeCode } from '~/features/move/stash';
import { WaysIn, type Auth, type Busy } from '~/features/welcome/WaysIn';
import { api } from '~/lib/api';
import { sessions, useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { useGoogleSignIn, useSignIn } from '~/lib/queries';

/*
 * The new device's side of moving a call here (docs: Calls and recordings › Moving to another device). The code
 * comes in the link's fragment, which no server sees, and leaves the address bar at once. Nothing here turns on a
 * microphone or camera: the call does that, once the other device has let go of its own, the way they were there.
 */
export const Route = createFileRoute('/move')({ component: MovePage });

const mlog = log.child({ component: 'move' });
const UI = { duration: 0.28, ease: [0.22, 0.8, 0.24, 1] } as const;
const ROLE = { host: 'Organizer', invited: 'Invited', guest: 'Guest' } as const;

/** Calls are end-to-end encrypted in the browser, so a browser that can't do that can't take part. */
async function canJoin(): Promise<boolean> {
  if (!window.isSecureContext || typeof navigator.mediaDevices?.getUserMedia !== 'function') return false;
  const { isE2EESupported } = await import('livekit-client');
  return isE2EESupported();
}

type Opening = { at: 'checking' } | { at: 'unsupported' } | { at: 'no-code' } | { at: 'opening' } | { at: 'gone'; problem: MoveProblem } | { at: 'unreachable'; problem: MoveProblem } | { at: 'open'; move: CallMoveIn };
const problemOf = (e: unknown): MoveProblem => ({ message: errorMessage(e), requestId: errorRequestId(e) ?? null });

function MovePage() {
  const [code] = useState(takeCode);
  const [claim] = useState(() => (code ? null : takeClaim()));
  const [opening, setOpening] = useState<Opening>({ at: 'checking' });
  useRaisedToasts();
  const open = async () => {
    setOpening({ at: 'opening' });
    try {
      // A code is used here once; a claim kept while this tab signed in picks the move up where it was.
      const move = code ? await api.calls.openMove(code) : claim ? await api.calls.resumeMove(claim) : null;
      setOpening(move ? { at: 'open', move } : { at: 'no-code' });
    } catch (e) {
      mlog.info('move couldn’t be opened', { code: errorCode(e), requestId: errorRequestId(e) ?? null });
      setOpening(errorCode(e) === 'network' ? { at: 'unreachable', problem: problemOf(e) } : { at: 'gone', problem: problemOf(e) });
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Checked before the code is used, so a browser that can't take the call leaves the code for one that can.
    void canJoin().then((ok) => { if (!ok) setOpening({ at: 'unsupported' }); else if (!code && !claim) setOpening({ at: 'no-code' }); else void open(); }, () => setOpening({ at: 'unsupported' }));
  });
  const move = opening.at === 'open' ? opening.move : null;
  useEffect(() => () => move?.close(), [move]);

  return (
    <div className="stage ac-stage">
      <div className="stg">
        <header className="stg-top"><div /><div className="stg-mid"><Logo /></div><div className="stg-right" /></header>
        <main className="mv-page">
          {move ? <Moving move={move} /> : (
            <div className="mv-card is-plain" aria-live="polite">
              {opening.at === 'checking' || opening.at === 'opening' ? <div className="mv-wait" role="status"><Dots />Opening the move</div>
                : opening.at === 'unsupported' ? <Plain icon="x" title="This browser can’t join encrypted calls" body="Open the link in a current Safari, Chrome, Edge or Firefox. The code still works there." />
                  : opening.at === 'no-code' ? <Plain icon="link" title="There’s no move here" body="On the device you’re in the call on, choose More, then Move to another device, and scan the code with this one." />
                    : opening.at === 'unreachable' ? <Plain icon="wifiOff" title="Can’t reach Alcove" body="Check this device’s connection. The code still works for a couple of minutes." problem={opening.problem} action={<Button variant="primary" icon="repeat" onClick={() => void open()}>Try again</Button>} />
                      : opening.at === 'gone' ? <Plain icon="clock" title="This code has run out or was already used" body="Make a new one on the device you’re in the call on: More, then Move to another device." problem={opening.problem} /> : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Plain({ icon, title, body, problem, action }: { icon: 'x' | 'link' | 'wifiOff' | 'clock'; title: string; body: string; problem?: MoveProblem | undefined; action?: ReactNode }) {
  return (
    <div className="mv-plain">
      <span className="mv-ic is-quiet"><Icon name={icon} size={24} /></span>
      <h1>{title}</h1>
      <p>{body}</p>
      {problem?.requestId && <p className="ac-mono mv-ref">Reference {problem.requestId}</p>}
      {action}
    </div>
  );
}

/** The move, once this device holds it: who they'll be, how their microphone and camera were, then in. */
function Moving({ move }: { move: CallMoveIn }) {
  const s = useLive(move);
  const m = s.move;
  const navigate = useNavigate();
  const toast = useToast();
  const reduce = useReducedMotion();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const [busy, setBusy] = useState<Busy>(null);
  const [asking, setAsking] = useState(false);

  /* In: the call is this device's now. Its microphone and camera come on in the call, as they were on the other device. */
  const session = s.session;
  useEffect(() => {
    if (!session) return;
    // Nothing opens here: what was off on the other device is off, and the call starts the rest, as it was there.
    const media = new LocalMedia();
    if (!m.media.mic) void media.setMic(false);
    if (!m.media.cam) void media.setCam(false);
    sessions.media = media;
    const where = session.getSnapshot().code;
    sessions.call = { code: where, session };
    void navigate({ to: '/call/$code', params: { code: where }, replace: true });
  }, [session, m.media.mic, m.media.cam, navigate]);

  const ready = async () => {
    setAsking(true);
    try { await move.ready(thisDevice()); } catch (e) { mlog.info('not ready to move here', { code: errorCode(e) }); } finally { setAsking(false); }
  };
  /* The organizer and invited people move only to a device signed in to their account: signing in here doesn't leave the move. */
  const auth: Auth = {
    busy, leaving: false,
    google: () => {
      keepClaim(move.claim);
      setBusy('google');
      void googleSignIn.start('/move').then(async (r) => {
        if (r === 'redirecting') return;
        takeClaim();
        if (r && 'session' in r) await move.refresh();
        setBusy(null);
      }).catch((e: unknown) => { takeClaim(); toast(errorMessage(e), { icon: 'x' }); setBusy(null); });
    },
    cancelGoogle: googleSignIn.cancel,
    go: async (provider: DemoProvider, email?: string) => {
      setBusy(provider);
      try { await signIn.mutateAsync({ provider, email: provider === 'sso' ? email?.trim() : undefined }); await move.refresh(); }
      catch (e) { toast(errorMessage(e), { icon: 'x' }); }
      finally { setBusy(null); }
    }
  };

  const needsAccount = m.account === 'needed' || m.account === 'other';
  const step = s.stage === 'moved' || s.stage === 'released' ? 'in' : s.stage;
  return (
    <motion.div className="mv-card" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : UI}>
      <span className="ac-eyebrow">Moving from your other device</span>
      <h1>{m.title}</h1>
      <div className="pj-time">Hosted by {m.organizerName}</div>
      <div className="mv-you">
        <Avatar person={{ name: m.you.name }} size={40} />
        <div><b>{m.you.name}</b><span>{ROLE[m.you.role]}</span></div>
      </div>
      <div className="mv-media" aria-label={carried(m.media)}>
        <Chip tone={m.media.mic ? 'neutral' : 'outline'} icon={m.media.mic ? 'mic' : 'micOff'}>Microphone {m.media.mic ? 'on' : 'off'}</Chip>
        <Chip tone={m.media.cam ? 'neutral' : 'outline'} icon={m.media.cam ? 'video' : 'videoOff'}>Camera {m.media.cam ? 'on' : 'off'}</Chip>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={needsAccount && step === 'claimed' ? 'account' : step} className="mv-step" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : UI}>
          {step === 'claimed' && needsAccount ? (
            <>
              <p>{m.account === 'other' ? `This device is signed in to someone else. Sign in as ${m.you.name} to move here.` : `Sign in as ${m.you.name} on this device to move here.`}</p>
              <div className="dark"><WaysIn auth={auth} layout="stack" /></div>
            </>
          ) : step === 'claimed' ? (
            <>
              <p>Your other device lets go of its microphone and camera first. Then they come on here, as they were there.</p>
              <Button variant="primary" size="lg" className="mv-go" loading={asking} onClick={() => void ready()}>Move here</Button>
              <Button variant="quiet" onClick={() => void move.cancel()}>Not now</Button>
            </>
          ) : step === 'ready' ? (
            <p className="mv-wait" role="status"><Dots />{m.account === 'ok' ? 'Waiting for your other device to let go' : 'Confirm on your other device'}</p>
          ) : step === 'in' ? (
            <p className="mv-wait" role="status"><Dots />Coming in</p>
          ) : step === 'cancelled' ? (
            <p className="mv-said"><Icon name="check" size={16} />Your other device kept the call. Nothing changed there.</p>
          ) : (
            <p className="mv-said"><Icon name="clock" size={16} />This move ran out. Make a new code on your other device: More, then Move to another device.</p>
          )}
        </motion.div>
      </AnimatePresence>
      {s.problem && s.stage !== 'expired' && (
        <Notice tone="caution" icon="x" className="mv-problem dark">
          <b>{s.problem.message}</b>
          {s.problem.requestId && <span className="ac-mono mv-ref"> Reference {s.problem.requestId}</span>}
        </Notice>
      )}
      {s.stage === 'expired' && s.problem?.requestId && <p className="ac-mono mv-ref">Reference {s.problem.requestId}</p>}
    </motion.div>
  );
}
