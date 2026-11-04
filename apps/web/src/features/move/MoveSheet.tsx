/*
 * Moving to another device, from the device the call is on: one dialog whose content changes in place. First a code
 * for the new device (a QR code and the same link to copy), then which device opened it, then letting go here. The
 * call screen does the letting go (onMove): this device stops its microphone and camera and leaves the room before
 * the new one is let in.
 */
import { MOVE_CODE_SECONDS, type CallMoveOut, type MoveMedia, type MoveOutState } from '@alcove/api';
import { Button, Dots, Icon, IconButton, Modal, QrCode, Tooltip, useToast } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLive } from '~/lib/live';
import { deviceLabel, deviceName, moveLink, shortLink, thisDevice } from './device';

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;
const NONE: MoveOutState = { stage: 'starting', code: null, expiresAt: null, device: null, sameAccount: false, problem: null };
const IDLE = { getSnapshot: () => NONE, subscribe: () => () => undefined };

/** "1:42": how long the code has left, from the clock each second. */
function useLeft(until: number | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => { if (until === null) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [until]);
  if (until === null) return null;
  const s = Math.min(MOVE_CODE_SECONDS, Math.max(0, Math.round((until - Date.now()) / 1000)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What carries over, said plainly: nothing that's off here turns on there. */
export function carried(m: MoveMedia): string {
  if (m.mic && m.cam) return 'Your microphone and camera stay on.';
  if (m.mic) return 'Your microphone stays on and your camera stays off.';
  if (m.cam) return 'Your camera stays on and your microphone stays off.';
  return 'Your microphone and camera stay off.';
}

export function MoveSheet({ open, onOpenChange, move, media, account, sharing, onStopSharing, onMove, onAgain }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** The move while it's on; null while the first code is on its way. */
  move: CallMoveOut | null;
  /** Microphone and camera here, now. */
  media: MoveMedia;
  /** The organizer and invited people move only to a device signed in to the same account. */
  account: boolean;
  /** This screen is being shared: the code stays hidden, so nobody watching can use it. */
  sharing: boolean;
  onStopSharing: () => void;
  /** Lets go here and moves: the call screen turns off the microphone and camera, leaves the room, then confirms. */
  onMove: () => void;
  /** A new code, after the last one ran out or was called off. */
  onAgain: () => void;
}) {
  const s = useLive(move ?? IDLE);
  const reduce = useReducedMotion();
  const toast = useToast();
  const left = useLeft(s.stage === 'open' ? s.expiresAt : null);
  const code = s.code;
  const copy = () => {
    if (!code) return;
    void navigator.clipboard?.writeText(moveLink(code)).catch(() => undefined);
    toast('Link copied. It works once, on one device.', { icon: 'link' });
  };
  const name = s.device ? deviceName(s.device) : 'the other device';
  const [fromPhone] = useState(() => thisDevice().kind !== 'computer');
  const busy = s.stage === 'moving' || (s.stage === 'ready' && s.sameAccount);

  let body: ReactNode;
  if (s.stage === 'starting') body = <div className="mv-wait" role="status"><Dots />Making a code</div>;
  else if (s.stage === 'open' && code) {
    body = (
      <div className="mv-code">
        {sharing ? (
          <div className="mv-hidden">
            <Icon name="eyeOff" size={22} />
            <p>Stop sharing your screen first, so nobody watching can use this code.</p>
            <Button size="sm" icon="stopShare" onClick={onStopSharing}>Stop sharing</Button>
          </div>
        ) : <QrCode value={moveLink(code)} label="A code for the other device’s camera" />}
        <div className="mv-how">
          <p>{fromPhone ? 'Open the link on the other device, or scan this with its camera.' : 'Scan this with your phone’s camera, or open the link on the other device.'}</p>
          {account && <p>Sign in there with this account.</p>}
          <div className="mv-link">
            <span className="ac-mono" aria-label="Link for the other device">{sharing ? shortLink('•••••••••••••••••••••') : shortLink(code)}</span>
            <Tooltip label="Copy link"><IconButton icon="copy" label="Copy link" disabled={sharing} onClick={copy} /></Tooltip>
          </div>
          <p className="mv-carry">{carried(media)}</p>
          {left && <span className="mv-left ac-mono">Works once · {left}</span>}
        </div>
      </div>
    );
  } else if (s.stage === 'claimed') {
    body = (
      <div className="mv-there">
        <span className="mv-ic"><Icon name="phone" size={26} /></span>
        <div><b>Opened on the other device</b><p>Tap Move here on it.{account ? ' It has to be signed in with this account.' : ''}</p></div>
      </div>
    );
  } else if (s.stage === 'ready' && s.device && !s.sameAccount) {
    body = (
      <div className="mv-there">
        <span className="mv-ic"><Icon name={s.device.kind === 'computer' ? 'monitor' : 'phone'} size={26} /></span>
        <div><b>{deviceLabel(s.device)} is ready to take your place</b><p>Your microphone and camera turn off here first, then come on there as they are now.</p></div>
      </div>
    );
  } else if (busy) body = <div className="mv-wait" role="status"><Dots />{s.stage === 'moving' ? 'Turning off your microphone and camera here' : `Moving to your ${name}`}</div>;
  else if (s.stage === 'expired' || s.stage === 'cancelled') {
    body = (
      <div className="mv-there">
        <span className="mv-ic is-quiet"><Icon name="clock" size={24} /></span>
        <div><b>{s.stage === 'expired' ? 'That code ran out' : 'The other device called it off'}</b><p>You’re still in the call here. Make a new code to try again.</p></div>
      </div>
    );
  } else if (s.stage === 'failed') {
    body = (
      <div className="mv-there is-problem">
        <span className="mv-ic is-caution"><Icon name="x" size={24} /></span>
        <div><b>{s.problem?.message ?? 'That didn’t work.'}</b>{s.problem?.requestId && <p className="ac-mono mv-ref">Reference {s.problem.requestId}</p>}</div>
      </div>
    );
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }} label="Move to another device" className="ic-move">
      <div className="pk-h"><h2 className="ac-title">Move to another device</h2>{!busy && <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} />}</div>
      <div className="mv-body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={s.stage === 'ready' && s.sameAccount ? 'moving' : s.stage} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : UI}>
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="pk-f">
        {s.stage === 'open' && <span className="pk-note mv-wait-note" role="status"><Dots />Waiting for the other device</span>}
        {s.stage === 'claimed' && <span className="pk-note mv-wait-note" role="status"><Dots />Waiting for Move here</span>}
        {(s.stage === 'starting' || s.stage === 'moving' || busy) && <span className="pk-note" />}
        {s.stage === 'ready' && !s.sameAccount ? (
          <>
            <span className="pk-note">Not yours? Your place stays here.</span>
            <Button variant="quiet" onClick={() => onOpenChange(false)}>Not my device</Button>
            <Button variant="primary" icon={s.device?.kind === 'computer' ? 'monitor' : 'phone'} onClick={onMove} autoFocus>Move to {name}</Button>
          </>
        ) : s.stage === 'expired' || s.stage === 'cancelled' || s.stage === 'failed' ? (
          <>
            <span className="pk-note" />
            <Button variant="quiet" onClick={() => onOpenChange(false)}>Stay here</Button>
            <Button variant="primary" icon="repeat" onClick={onAgain}>Make a new code</Button>
          </>
        ) : !busy && <Button variant="quiet" onClick={() => onOpenChange(false)}>Cancel</Button>}
      </div>
    </Modal>
  );
}
