/*
 * Your view, from View at the top right (and Your view in More on a phone): how the people are shown, how they sit beside
 * what's shared, where you see yourself, and Reset my view. Everything in it says the same thing: only your screen changes.
 */
import type { CallPeopleMode, CallViewMode, SelfView } from '@alcove/api';
import { Icon, Popover, Segmented, cn } from '@alcove/ui';
import { useRef, useState, type ReactNode } from 'react';

const MODES: { value: CallViewMode; label: string }[] = [{ value: 'auto', label: 'Auto' }, { value: 'speaker', label: 'Speaker' }, { value: 'grid', label: 'Grid' }];
const BESIDE: { value: CallPeopleMode; label: string }[] = [{ value: 'tiles', label: 'Tiles' }, { value: 'arches', label: 'Arches' }, { value: 'hidden', label: 'Hidden' }];
const SELF: { value: SelfView; label: string }[] = [{ value: 'grid', label: 'In the grid' }, { value: 'corner', label: 'In a corner' }, { value: 'hidden', label: 'Hidden' }];

export interface ViewChoicesProps {
  mode: CallViewMode; people: CallPeopleMode; self: SelfView;
  /** There's something for Reset my view to do. */
  custom: boolean;
  /** On a phone what's open fills the screen under a row of arches, so there's nothing to choose beside it. */
  phone: boolean;
  onMode: (m: CallViewMode) => void; onPeople: (m: CallPeopleMode) => void; onSelf: (s: SelfView) => void; onReset: () => void;
  /** The active call's floating-window choice and browser-local preference. */
  floating?: ((close: () => void) => ReactNode) | undefined;
  onDone?: (() => void) | undefined;
}

/** What View holds, wherever it opens. */
export function ViewChoices({ mode, people, self, custom, phone, onMode, onPeople, onSelf, onReset, floating, onDone }: ViewChoicesProps) {
  return (
    <div className="ic-vmenu">
      <div className="ic-vhd"><b>Your view</b><span>Only your screen changes.</span></div>
      <div className="ic-vstack"><span>The people</span><Segmented value={mode} onChange={onMode} label="The people" options={MODES} /></div>
      {!phone && <div className="ic-vstack"><span>Beside what’s shared</span><Segmented value={people} onChange={onPeople} label="Beside what’s shared" options={BESIDE} /></div>}
      <div className="ic-vstack"><span>See yourself</span><Segmented value={self} onChange={onSelf} label="See yourself" options={SELF} /></div>
      <div className="ic-msep" />
      <button type="button" className="mi" disabled={!custom} onClick={onReset}><Icon name="reset" size={17} /><span className="t">Reset my view</span></button>
      {floating && <><div className="ic-msep" />{floating(() => onDone?.())}</>}
    </div>
  );
}

/** View, at the top right: Your view, opening under it. */
export function ViewMenu(props: ViewChoicesProps) {
  const [open, setOpen] = useState(false);
  const floatingFocus = useRef(false);
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" label="Your view" className="ic-menu ic-viewpop"
      onCloseFocus={() => { const floating = floatingFocus.current; floatingFocus.current = false; return floating; }}
      anchor={(
        <button type="button" className={cn('ic-viewbtn', open && 'is-on')} aria-label="Your view">
          <Icon name="viewAuto" size={16} /><span className="vt">View</span><Icon name="down" size={13} />
        </button>
      )}
      tip="Your view · only your screen changes">
      <ViewChoices {...props} onReset={() => { setOpen(false); props.onReset(); }} onDone={() => { floatingFocus.current = true; setOpen(false); }} />
    </Popover>
  );
}
