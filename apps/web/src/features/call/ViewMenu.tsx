/*
 * Your view, in the top bar: Auto, Speaker and Grid one press away on wider screens, and a menu with all of it (the
 * modes, two ready-made layouts, where you see yourself, Reset) that a phone reaches through one button.
 */
import type { CallViewMode, SelfView } from '@alcove/api';
import { Icon, Kbd, Popover, Segmented, Tooltip, cn, type IconName } from '@alcove/ui';
import { useState } from 'react';
import { PRESETS, type Preset } from './view';

const VIEWS: { mode: CallViewMode; icon: IconName; label: string; detail: string; tip: string }[] = [
  { mode: 'auto', icon: 'viewAuto', label: 'Auto', detail: 'Alcove picks', tip: 'Auto: Alcove picks the layout · changes your view only' },
  { mode: 'speaker', icon: 'viewSpeaker', label: 'Speaker', detail: 'Whoever’s talking, big', tip: 'Speaker and sidebar · changes your view only' },
  { mode: 'grid', icon: 'grid', label: 'Grid', detail: 'Everyone the same size', tip: 'Grid · changes your view only' }
];
const PRESET_ICON: Record<Preset, IconName> = { equal: 'people', presenter: 'presenter' };

export function ViewMenu({ mode, preset, self, custom, onMode, onPreset, onSelf, onReset }: {
  mode: CallViewMode; preset: Preset | null; self: SelfView; custom: boolean;
  onMode: (m: CallViewMode) => void; onPreset: (p: Preset) => void; onSelf: (s: SelfView) => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (f: () => void) => () => { setOpen(false); f(); };
  const current = VIEWS.find((v) => v.mode === mode) ?? VIEWS[0];
  return (
    <div className="ic-vc" role="group" aria-label="Your view. Only your view changes">
      {VIEWS.map((v) => (
        <Tooltip key={v.mode} label={v.tip} side="bottom">
          <button type="button" className="vbtn is-mode" aria-label={`${v.label} layout`} aria-pressed={mode === v.mode} onClick={() => onMode(v.mode)}><Icon name={v.icon} size={16} /></button>
        </Tooltip>
      ))}
      <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" label="Your view" className="ic-menu ic-vmenu"
        anchor={(
          <button type="button" className={cn('vbtn is-more', open && 'is-on')} aria-label="Your view: layouts, where you see yourself, reset" aria-haspopup="menu">
            <span className="wide"><Icon name="down" size={16} /></span>
            <span className="narrow">{current && <Icon name={current.icon} size={17} />}</span>
          </button>
        )}>
        <div className="ac-eyebrow">Layout</div>
        {VIEWS.map((v) => (
          <button key={v.mode} type="button" className="mi" role="menuitemradio" aria-checked={mode === v.mode} onClick={pick(() => onMode(v.mode))}>
            <Icon name={v.icon} size={17} /><span className="t">{v.label}<span className="sub">{v.detail}</span></span><Icon name="check" size={16} className="tick" />
          </button>
        ))}
        <div className="ac-eyebrow">Ready-made</div>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="mi is-two" role="menuitemradio" aria-checked={preset === p.id} onClick={pick(() => onPreset(p.id))}>
            <Icon name={PRESET_ICON[p.id]} size={17} /><span className="t">{p.label}<span className="sub">{p.detail}</span></span><Icon name="check" size={16} className="tick" />
          </button>
        ))}
        <div className="ac-eyebrow">See yourself</div>
        <div className="ic-vself">
          <Segmented value={self} onChange={onSelf} label="See yourself" options={[
            { value: 'grid', label: 'In the grid' }, { value: 'corner', label: 'In a corner' }, { value: 'hidden', label: 'Hidden' }
          ]} />
          {self === 'hidden' && <p className="hint">Everyone else still sees you.</p>}
        </div>
        <div className="ic-msep" />
        <button type="button" className="mi" disabled={!custom} onClick={pick(onReset)}>
          <Icon name="reset" size={17} /><span className="t">Reset my view<span className="sub">Auto, nobody pinned, the call’s order and sizes</span></span>
        </button>
        <p className="hint ic-keys"><Icon name="keyboard" size={15} /><span>On a tile: <Kbd>P</Kbd> pin, <Kbd>⇧←</Kbd> <Kbd>⇧→</Kbd> move, <Kbd>+</Kbd> <Kbd>−</Kbd> size, <Kbd>↵</Kbd> more. <Kbd>Esc</Kbd> unpins everyone.</span></p>
      </Popover>
    </div>
  );
}
