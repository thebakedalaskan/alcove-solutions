/*
 * Your view, from one button in the top bar: four ways to lay the call out, how you see people, whether the workspace
 * shows its list, then Auto, Speaker or Grid, two ready-made layouts for the people, where you see yourself, and Reset my
 * view once there's anything to reset. Everything in it says the same thing: only your screen changes.
 */
import type { CallPeopleMode, CallViewMode, SelfView } from '@alcove/api';
import { Icon, Kbd, Popover, Segmented, Switch, cn, type IconName } from '@alcove/ui';
import { useState } from 'react';
import type { PanelPreset } from './panels';
import { PRESETS, type Preset } from './view';

const VIEWS: { mode: CallViewMode; label: string }[] = [{ mode: 'auto', label: 'Auto' }, { mode: 'speaker', label: 'Speaker' }, { mode: 'grid', label: 'Grid' }];
const PRESET_ICON: Record<Preset, IconName> = { equal: 'people', presenter: 'presenter' };
/** How each layout looks, drawn small: screen, document and people. */
const LAYOUTS: { id: PanelPreset; label: string; cls: string; order: ('s' | 'd' | 'p')[] }[] = [
  { id: 'beside', label: 'Side by side', cls: 't1', order: ['s', 'd', 'p'] },
  { id: 'stacked', label: 'Stacked', cls: 't2', order: ['s', 'd', 'p'] },
  { id: 'screen', label: 'Screen first', cls: 't3', order: ['s', 'p', 'd'] },
  { id: 'doc', label: 'Document first', cls: 't4', order: ['d', 's', 'p'] }
];

export function ViewMenu({ mode, preset, self, custom, layout, people, list, roomy, phone, onMode, onPreset, onSelf, onReset, onLayout, onPeople, onList }: {
  mode: CallViewMode; preset: Preset | null; self: SelfView;
  /** There's something for Reset my view to do. */
  custom: boolean;
  /** The layout you're in, if you've moved nothing since. */
  layout: PanelPreset | null;
  people: CallPeopleMode;
  /** Whether the workspace shows its list, or null with no workspace open. */
  list: boolean | null;
  /** There's something beside the people to make room for: otherwise they stay on the stage for now. */
  roomy: boolean;
  /** One thing at a time: there's nothing to lay out. */
  phone: boolean;
  onMode: (m: CallViewMode) => void; onPreset: (p: Preset) => void; onSelf: (s: SelfView) => void; onReset: () => void;
  onLayout: (l: PanelPreset) => void; onPeople: (m: CallPeopleMode) => void; onList: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (f: () => void) => () => { setOpen(false); f(); };
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" label="Your view" className="ic-menu ic-vmenu"
      anchor={(
        <button type="button" className={cn('ic-viewbtn', open && 'is-on')} aria-label="Your view" title="Your view. Only your screen changes" aria-haspopup="menu">
          <Icon name="viewAuto" size={16} /><span className="vt">View</span><Icon name="down" size={13} />
        </button>
      )}>
      <div className="ic-vhd"><b>Your view</b><span>Only your screen changes</span></div>
      {!phone && (
        <>
          <div className="ic-lays">
            {LAYOUTS.map((l) => (
              <button key={l.id} type="button" className="ic-lay" aria-pressed={layout === l.id} onClick={pick(() => onLayout(l.id))}>
                <span className={cn('th', l.cls)} aria-hidden="true">{l.order.map((k) => <i key={k} className={k} />)}</span><small>{l.label}</small>
              </button>
            ))}
          </div>
          <div className="ic-vrow">
            <span>People</span>
            <Segmented value={people} onChange={onPeople} label="People" options={[{ value: 'tiles', label: 'Tiles' }, { value: 'arches', label: 'Arches' }, { value: 'hidden', label: 'Hidden' }]} />
          </div>
          {!roomy && <p className="hint">Layouts and how you see people apply once something is shared.</p>}
          {list !== null && <div className="ic-vrow"><span>Document list</span><Switch checked={list} label="Show the document list" onChange={onList} /></div>}
          <div className="ic-msep" />
        </>
      )}
      <div className="ic-vrow">
        <span>Stage</span>
        <Segmented value={mode} onChange={onMode} label="Stage" options={VIEWS.map((v) => ({ value: v.mode, label: v.label }))} />
      </div>
      <div className="ic-vstack">
        <span>See yourself</span>
        <Segmented value={self} onChange={onSelf} label="See yourself" options={[
          { value: 'grid', label: 'In the grid' }, { value: 'corner', label: 'In a corner' }, { value: 'hidden', label: 'Hidden' }
        ]} />
        {self === 'hidden' && <p className="hint">Everyone else still sees you.</p>}
      </div>
      <div className="ic-msep" />
      {PRESETS.map((p) => (
        <button key={p.id} type="button" className="mi is-two" role="menuitemradio" aria-checked={preset === p.id} onClick={pick(() => onPreset(p.id))}>
          <Icon name={PRESET_ICON[p.id]} size={17} /><span className="t">{p.label}<span className="sub">{p.detail}</span></span><Icon name="check" size={16} className="tick" />
        </button>
      ))}
      {custom && (
        <>
          <div className="ic-msep" />
          <button type="button" className="mi" onClick={pick(onReset)}>
            <Icon name="reset" size={17} /><span className="t">Reset my view<span className="sub">Back to the call’s layout</span></span>
          </button>
        </>
      )}
      <p className="hint ic-keys"><Icon name="keyboard" size={15} /><span>{!phone && <><Kbd>⇧P</Kbd> hides people. </>}On a tile: <Kbd>P</Kbd> pin, <Kbd>⇧←</Kbd> <Kbd>⇧→</Kbd> move, <Kbd>+</Kbd> <Kbd>−</Kbd> size, <Kbd>↵</Kbd> more. <Kbd>Esc</Kbd> unpins everyone.</span></p>
    </Popover>
  );
}
