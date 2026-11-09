import type { Person } from '@alcove/api';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { CallDock, DockButton, DockLeave } from './call';
import { EmptyState } from './empty';
import { Icon } from './icon';
import { Avatar } from './people';

export type FloatingAttention = 'hands' | 'questions' | 'waiting' | 'chat';
export interface FloatingDevice { on: boolean; pending: boolean; problem: string | null }
export interface FloatingCallProps {
  title: string;
  /** Shared countdown; opening it returns to the full call details. */
  timer?: ReactNode;
  /** A muted live picture, or null for the person's arch. No media is acquired by this component. */
  picture: ReactNode;
  person: Person | null;
  label: string;
  connection: 'connecting' | 'connected' | 'reconnecting' | 'ended';
  mic: FloatingDevice;
  cam: FloatingDevice;
  hand: boolean;
  handPending?: boolean | undefined;
  busy: boolean;
  attention: { hands: number; questions: number; waiting: number; chat: number };
  error?: string | null | undefined;
  soundBlocked?: boolean | undefined;
  onSound?: (() => void) | undefined;
  onMic: () => void;
  onCam: () => void;
  onHand: () => void;
  onLeave: () => void;
  onReturn: () => void;
  onAttention: (kind: FloatingAttention) => void;
  /** The call's existing departure question, in place of its picture and controls. */
  children?: ReactNode;
}

const ATTENTION = [
  { kind: 'hands', icon: 'hand', word: 'Hands' },
  { kind: 'questions', icon: 'ask', word: 'Q&A' },
  { kind: 'waiting', icon: 'addUser', word: 'Asking to join' },
  { kind: 'chat', icon: 'chat', word: 'Chat' }
] as const;

/** The call kept in view: presentation only, with the same actions and muted media as its full view. */
export function FloatingCall({ title, timer, picture, person, label, connection, mic, cam, hand, handPending = false, busy, attention, error, soundBlocked = false, onSound, onMic, onCam, onHand, onLeave, onReturn, onAttention, children }: FloatingCallProps) {
  const inactive = busy || connection === 'ended';
  const micLabel = mic.pending ? 'Changing microphone…' : mic.problem ? `${mic.problem}. Try the microphone again` : mic.on ? 'Mute microphone' : 'Unmute microphone';
  const camLabel = cam.pending ? 'Changing camera…' : cam.problem ? `${cam.problem}. Try the camera again` : cam.on ? 'Turn off camera' : 'Turn on camera';
  const status = connection === 'reconnecting' ? 'Reconnecting…' : connection === 'connecting' ? 'Connecting…' : connection === 'ended' ? 'Call disconnected' : null;
  return (
    <section className="stage ac-floating" aria-label="Floating call">
      <header className="ac-floating-head">
        <Icon name="sealed" size={15} /><b className="ac-clamp-1">{title}</b>
        <button type="button" onClick={onReturn} aria-label="Return to call" title="Return to call"><Icon name="popIn" size={17} /><span>Return</span></button>
      </header>
      {children ? <div className="ac-floating-question">{children}</div> : (
        <>
          <div className={cn('ac-floating-picture', !picture && 'is-arch')}>
            {picture || (person ? <Avatar person={person} size={88} /> : <EmptyState title="You’re in the call">The next speaker appears here.</EmptyState>)}
            <span className="ac-floating-label ac-clamp-1">{label}</span>
            {status && <span className="ac-floating-connection" role="status"><Icon name="wifi" size={15} />{status}</span>}
          </div>
          {timer && <div className="ac-floating-timer">{timer}</div>}
          <div className="ac-floating-attention" aria-label="Call attention">
            {ATTENTION.map(({ kind, icon, word }) => attention[kind] > 0 && (
              <button key={kind} type="button" onClick={() => onAttention(kind)} title={`Open ${word.toLowerCase()} in the call`}>
                <Icon name={icon} size={14} /><span>{word}</span><b>{attention[kind]}</b>
              </button>
            ))}
          </div>
          <footer className="ac-floating-foot">
            <CallDock label="Floating call controls">
              <DockButton icon={mic.on ? 'mic' : 'micOff'} label={micLabel} off={!mic.on} alert={!!mic.problem} disabled={inactive || mic.pending} aria-busy={mic.pending} onClick={onMic} />
              <DockButton icon={cam.on ? 'video' : 'videoOff'} label={camLabel} off={!cam.on} alert={!!cam.problem} disabled={inactive || cam.pending} aria-busy={cam.pending} onClick={onCam} />
              <DockButton icon="hand" label={handPending ? 'Changing raised hand…' : hand ? 'Lower your hand' : 'Raise your hand'} on={hand} disabled={inactive || handPending} aria-busy={handPending} onClick={onHand} />
              <DockLeave disabled={inactive} onClick={onLeave} data-floating-leave="">Leave</DockLeave>
            </CallDock>
          </footer>
        </>
      )}
      {(mic.problem || cam.problem || error || soundBlocked) && (
        <div className="ac-floating-feedback" aria-live="polite">
          {error && <p role="alert"><Icon name="alert" size={14} />{error}</p>}
          {!children && !error && [mic.problem, cam.problem].filter(Boolean).map((problem) => <p key={problem}>{problem}</p>)}
          {soundBlocked && <button type="button" onClick={onSound}><Icon name="speaker" size={15} />Play call sound</button>}
        </div>
      )}
    </section>
  );
}
