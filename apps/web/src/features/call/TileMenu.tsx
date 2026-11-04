/*
 * A tile's ⋯ menu: everything you can do to your view with the mouse, with the key that does it from a focused tile.
 * Every choice changes only your view, except the organizer's spotlight, which says Everyone.
 */
import type { Person, SelfView } from '@alcove/api';
import { Avatar, Icon, Kbd, Popover, Scope, cn, type IconName } from '@alcove/ui';
import type { ReactNode } from 'react';

/** What a person's menu offers. A choice left out isn't offered on this tile. */
export interface PersonMenu {
  pinned?: { on: boolean; toggle: () => void } | undefined;
  spotlight?: { on: boolean; toggle: () => void } | undefined;
  earlier?: (() => void) | null | undefined;
  later?: (() => void) | null | undefined;
  size?: { big: boolean; toggle: () => void } | undefined;
  /** Your own tile: where you see yourself. */
  self?: { where: SelfView; set: (w: SelfView) => void } | undefined;
}

const SELF: { where: SelfView; icon: IconName; label: string }[] = [
  { where: 'grid', icon: 'grid', label: 'In the grid' },
  { where: 'corner', icon: 'pip', label: 'In a corner' },
  { where: 'hidden', icon: 'eyeOff', label: 'Hidden' }
];

function Item({ icon, label, kb, keys, onPick, disabled = false, end }: {
  icon: IconName; label: string; kb?: string | undefined; keys?: string | undefined; onPick: () => void; disabled?: boolean; end?: ReactNode;
}) {
  return (
    <button type="button" className="mi" disabled={disabled} aria-keyshortcuts={keys} onClick={onPick}>
      <Icon name={icon} size={17} /><span className="t">{label}</span>{end}{kb && <Kbd>{kb}</Kbd>}
    </button>
  );
}

export function TileMenu({ who, me, open, onOpenChange, organizer, menu }: {
  who: Person; me: boolean; open: boolean; onOpenChange: (o: boolean) => void; organizer: boolean; menu: PersonMenu;
}) {
  const name = `${who.name}${me ? ' (you)' : ''}`;
  const pick = (f: () => void) => () => { onOpenChange(false); f(); };
  const { pinned, spotlight, earlier, later, size, self } = menu;
  const moves = earlier !== undefined || later !== undefined;
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${name}`} className="ic-menu ic-tmenu"
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${name}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={who} size={22} /><b>{name}</b></div>
      <p className="scope">Only your view changes</p>
      {pinned && <Item icon={pinned.on ? 'pinOff' : 'pin'} label={pinned.on ? 'Unpin for me' : 'Pin for me'} kb="P" keys="P" onPick={pick(pinned.toggle)} />}
      {moves && (
        <>
          <Item icon="left" label="Move earlier" kb="⇧←" keys="Shift+ArrowLeft" disabled={!earlier} onPick={pick(() => earlier?.())} />
          <Item icon="right" label="Move later" kb="⇧→" keys="Shift+ArrowRight" disabled={!later} onPick={pick(() => later?.())} />
        </>
      )}
      {size && <Item icon={size.big ? 'shrink' : 'grow'} label={size.big ? 'Make smaller' : 'Make bigger'} kb={size.big ? '−' : '+'} keys={size.big ? '-' : '+'} onPick={pick(size.toggle)} />}
      {self && (
        <div className="ic-mgrp" role="group" aria-label="See yourself">
          <div className="ac-eyebrow">See yourself</div>
          {SELF.map((s) => (
            <button key={s.where} type="button" className="mi" role="menuitemradio" aria-checked={self.where === s.where} onClick={pick(() => self.set(s.where))}>
              <Icon name={s.icon} size={17} /><span className="t">{s.label}</span><Icon name="check" size={16} className="tick" />
            </button>
          ))}
          {self.where === 'hidden' && <p className="hint">Everyone else still sees you.</p>}
        </div>
      )}
      {(organizer && spotlight) ? (
        <>
          <div className="ic-msep" />
          <Item icon="spotlight" label={spotlight.on ? 'Stop spotlight' : 'Spotlight for everyone'} onPick={pick(spotlight.toggle)} end={<Scope everyone>Everyone</Scope>} />
          <p className="hint">Only the organizer can spotlight. You’re the organizer.</p>
        </>
      ) : !me && <p className="hint">Only the organizer can spotlight.</p>}
    </Popover>
  );
}

/** A shared screen's menu: see it big, or as a tile among the people. */
export function ShareMenu({ label, open, onOpenChange, big, onToggle }: { label: string; open: boolean; onOpenChange: (o: boolean) => void; big: boolean; onToggle: () => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${label}`} className="ic-menu ic-tmenu"
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${label}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Icon name="screen" size={18} /><b>{label}</b></div>
      <p className="scope">Only your view changes</p>
      <Item icon={big ? 'shrink' : 'grow'} label={big ? 'Show as a tile' : 'Show it big'} kb="P" keys="P" onPick={() => { onOpenChange(false); onToggle(); }} />
    </Popover>
  );
}
