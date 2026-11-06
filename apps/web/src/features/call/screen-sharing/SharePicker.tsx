/*
 * Choosing what to share: a tab, a window or a whole screen. Alcove only says which kind; the
 * browser's own picker then shows the real tabs, windows and screens to choose from, so nothing here
 * pretends to know what's open on someone's computer. When a try didn't start, it opens again and says
 * why and what to do. Sharing while others share adds yours beside theirs; nobody's share is replaced.
 */
import type { Person } from '@alcove/api';
import { Button, Icon, IconButton, Modal, Notice, Switch, type IconName } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { listNames } from '~/lib/people';
import type { ShareChoice, ShareSurface } from '../media/media';
import { SHARE_PROBLEMS, canShareTabSound, type ShareProblem } from './share';
import { HISTORY } from './shareLook';

const KINDS: { surface: ShareSurface; label: string; icon: IconName; title: string; body: string; go: string; audio: string | null }[] = [
  { surface: 'browser', label: 'Tab', icon: 'globe', title: 'One browser tab', body: 'Good for a page, a doc or a design. You can switch tabs while you share.', go: 'Choose a tab', audio: 'Share tab audio' },
  { surface: 'window', label: 'Window', icon: 'window', title: 'One app window', body: 'Only that window is shown, even when others are on top of it.', go: 'Choose a window', audio: null },
  { surface: 'monitor', label: 'Screen', icon: 'monitor', title: 'Your whole screen', body: 'Everything on that screen, notifications included.', go: 'Choose a screen', audio: 'Share computer sound, where your browser allows it' }
];
const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

/**
 * `read`: shared screens are read for the notes now (`on`), or will be once notes resume (`paused`), so the presenter
 * is told before they choose.
 */
export function SharePicker({ open, onOpenChange, sharing, others, trouble, read, onShare }: {
  open: boolean; onOpenChange: (o: boolean) => void; sharing: boolean;
  /** Everyone else sharing now: yours goes beside theirs. */
  others: Person[];
  /** Why the last try didn't start. A computer that won't let the browser capture a window or screen still lets it share a tab, so Tab is offered then. */
  trouble: Exclude<ShareProblem, 'cancelled' | 'unsupported'> | null;
  read?: 'on' | 'paused' | undefined;
  onShare: (c: ShareChoice) => void;
}) {
  const [surface, setSurface] = useState<ShareSurface>('browser');
  const [audio, setAudio] = useState(true);
  const [troubleWas, setTroubleWas] = useState(trouble);
  if (trouble !== troubleWas) { setTroubleWas(trouble); if (trouble === 'system') setSurface('browser'); }
  const reduce = useReducedMotion();
  const kind = KINDS.find((k) => k.surface === surface) ?? KINDS[0];
  if (!kind) return null;
  // Sound is offered only where this browser can share it (Chrome and Edge); Firefox and Safari share none.
  const sound = kind.audio && canShareTabSound() ? kind.audio : null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} label="Choose what to share" className="ic-share">
      <div className="pk-h"><h2 className="ac-title">{trouble ? 'Sharing didn’t start' : sharing ? 'Share something else' : 'Choose what to share'}</h2><IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} /></div>
      {trouble && <Notice tone="caution" icon="stopShare" className="pk-trouble">{SHARE_PROBLEMS[trouble]}</Notice>}
      <div className="ac-tabs" role="tablist" aria-label="What to share">
        {KINDS.map((k) => <button key={k.surface} type="button" role="tab" className="ac-tab" aria-selected={k.surface === surface} onClick={() => setSurface(k.surface)}>{k.label}</button>)}
      </div>
      <div className="pk-body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={kind.surface} className="pk-kind" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={reduce ? { duration: 0 } : UI}>
            <span className="pk-ic"><Icon name={kind.icon} size={28} /></span>
            <div>
              <b>{kind.title}</b><p>{kind.body}</p><p className="sub">Your browser asks which one next, and shows what it will share.</p>
              <p className="sub">Everyone here can zoom in and look back at its last {HISTORY.pictures} pictures, each on their own screen, until you stop.</p>
              {others.length > 0 && !sharing && <p className="sub">{listNames(others)} {others.length === 1 ? 'keeps' : 'keep'} sharing too. Everyone picks which to see big.</p>}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="pk-f">
        {sound && <div className="ic-srow"><span>{sound}</span><Switch checked={audio} label={sound} onChange={setAudio} /></div>}
        <span className="pk-note">{read === 'on' ? 'Everyone in the call sees what you share, and it’s read for the notes.' : read === 'paused' ? 'Everyone in the call sees what you share. Notes are paused; once they resume, it’s read for them.' : 'Everyone in the call sees what you share.'}</span>
        <Button variant="quiet" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" icon="screen" onClick={() => onShare({ surface: kind.surface, audio: !!sound && audio })}>{kind.go}</Button>
      </div>
    </Modal>
  );
}
