/*
 * The call's top bar: the title and clock, the notes sign everyone sees (which opens what's captured), then
 * your own view control, a private catch-up, the confidential-compute shield and who is here (with how many
 * are asking to join, for the organizer).
 */
import { clock, type Person } from '@alcove/api';
import { Dots, Faces, Icon, Popover, Tooltip, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { q } from '~/lib/queries';
import { hm } from '~/lib/time';

const UI = { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] } as const;

export function TopBar({ title, elapsed, sign, view, custom, people, asking, reconnecting, peopleOpen, onReset, onCatchUp, onPeople }: {
  title: string; elapsed: number;
  /** The notes sign: what the call captures, the same for everyone. */
  sign: ReactNode;
  /** Your view's controls (ViewMenu). */
  view: ReactNode;
  custom: boolean; people: Person[];
  /** People asking to join (the organizer's to let in). */
  asking: number;
  /** The call's media connection dropped and is coming back. */
  reconnecting: boolean;
  peopleOpen: boolean;
  onReset: () => void; onCatchUp: () => void; onPeople: () => void;
}) {
  const label = asking ? `People in this call. ${asking} asking to join` : 'People in this call';
  return (
    <header className="ic-top">
      <span className="ttl">{title}</span>
      <span className="ac-time clock">{clock(elapsed)}</span>
      {reconnecting && <span className="ic-recon" role="status"><Dots />Reconnecting</span>}
      <span className="vr v1" />
      <div className="nz">{sign}</div>
      <div className="end">
        {view}
        <AnimatePresence initial={false}>
          {custom && (
            <motion.span key="reset" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={UI}>
              <Tooltip label="Back to Auto: nobody pinned, the call’s order and sizes" side="bottom">
                <button type="button" className="ac-btn is-quiet is-sm ic-reset" onClick={onReset}><Icon name="reset" size={15} /><span className="rtxt">Reset my view</span></button>
              </Tooltip>
            </motion.span>
          )}
        </AnimatePresence>
        <span className="vr" />
        <Tooltip label="A private recap of the last few minutes" side="bottom">
          <button type="button" className="ac-btn is-secondary is-sm ic-catch" onClick={onCatchUp}><Icon name="history" size={16} /><span className="catchtxt">Catch up</span></button>
        </Tooltip>
        <Shield />
        <Tooltip label={asking ? `${asking} asking to join` : 'People in this call'} side="bottom">
          <button type="button" className={cn('ic-faces', peopleOpen && 'is-on')} aria-label={label} onClick={onPeople}>
            <Faces people={people} size={26} max={6} /><span>{people.length}</span>
            {asking > 0 && <span className="badge" aria-hidden="true">{asking}</span>}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

/** The shield: hover or focus says what confidential compute covers here; a click keeps it open. */
function Shield() {
  const checked = useQuery(q.trust());
  const trust = checked.data;
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => { if (later.current) clearTimeout(later.current); setOpen(true); };
  const hide = () => { if (later.current) clearTimeout(later.current); later.current = setTimeout(() => { if (!pinned.current) setOpen(false); }, 160); };
  const verified = trust?.tee === 'dstack' && trust.bound;
  return (
    <Popover open={open} onOpenChange={(o) => { pinned.current = o; setOpen(o); }} side="bottom" align="end" label="Confidential compute" className="ic-seal" takeFocus={false}
      anchor={(
        <button type="button" className={cn('ic-sicon', open && 'is-on')} aria-label={verified ? 'Confidential compute, verified' : 'Confidential compute'}
          onPointerEnter={(e) => { if (e.pointerType !== 'touch') show(); }} onPointerLeave={hide} onFocus={show} onBlur={hide}>
          <Icon name="sealed" size={19} />
        </button>
      )}>
      <div onPointerEnter={show} onPointerLeave={hide}>
        <div className="hd"><Icon name="sealed" size={17} />{verified ? 'Confidential compute · verified' : trust?.tee === 'dstack' ? 'Confidential compute · not verified' : 'Confidential compute'}</div>
        <div className="rows">
          <div><span>Hardware checked</span>{verified && trust ? <b className="ac-time">{hm(new Date(trust.at))}</b> : <b>{trust ? 'Not on this server' : checked.isError ? 'Couldn’t check' : 'Checking…'}</b>}</div>
          <div><span>Sealed</span>Audio, transcript, notes</div>
        </div>
        <div className="last">{verified ? 'Alcove can’t read this call.' : 'Everything stays sealed. This server isn’t running in confidential compute, so its hardware can’t be checked.'}</div>
      </div>
    </Popover>
  );
}
