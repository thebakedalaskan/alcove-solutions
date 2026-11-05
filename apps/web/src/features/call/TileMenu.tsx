/*
 * A tile's ⋯ menu: everything you can do to your view with the mouse, with the key that does it from a focused tile.
 * Every choice changes only your view, except the organizer's spotlight, which says Everyone.
 */
import type { Person, SelfView } from '@alcove/api';
import { Avatar, Icon, Kbd, Popover, Scope, cn, type IconName } from '@alcove/ui';
import type { ReactNode } from 'react';
import { callName } from '~/lib/people';
import { LOOK_KEYS } from './shareLook';
import { VolumeControl } from './VolumeControl';

/** What a person's menu offers. A choice left out isn't offered on this tile. */
export interface PersonMenu {
  pinned?: { on: boolean; toggle: () => void } | undefined;
  spotlight?: { on: boolean; toggle: () => void } | undefined;
  earlier?: (() => void) | null | undefined;
  later?: (() => void) | null | undefined;
  size?: { big: boolean; toggle: () => void } | undefined;
  /** Your own tile: where you see yourself. */
  self?: { where: SelfView; set: (w: SelfView) => void } | undefined;
  /** Someone else's tile: how loud they are for you (your playback only), where the browser can set it. */
  volume?: { level: number; set: (level: number) => void; toggle: () => void } | undefined;
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
  const { pinned, spotlight, earlier, later, size, self, volume } = menu;
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
      {volume && <><div className="ic-msep" /><VolumeControl name={callName(who)} level={volume.level} onChange={volume.set} onToggle={volume.toggle} /></>}
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

/** Looking closer at a share you see big: zoom, freeze and earlier pictures, each with the key that does it on the focused share. */
export interface ShareLookMenu {
  zoomed: boolean;
  /** As far in as it goes. */
  max: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  whole: () => void;
  /** A picture is held still (frozen, or an earlier one). */
  held: boolean;
  canEarlier: boolean;
  freeze: () => void;
  live: () => void;
  earlier: () => void;
  later: () => void;
  /** One short line on earlier pictures: what's kept and where, or why nothing is. */
  note: string;
}
/** The share in its own window: open now or not, and why it can't be where it can't. */
export interface ShareWindowMenu { open: boolean; toggle: (() => void) | null; why: string | null }

/**
 * A shared screen's menu: see it big or as a tile, look closer, open it in its own window, and mute its sound, for you;
 * and point at it, which everyone sees.
 */
export function ShareMenu({ presenter, label, open, onOpenChange, big, onToggle, sound, look, own, point, onMove }: {
  presenter: Person; label: string; open: boolean; onOpenChange: (o: boolean) => void; big: boolean; onToggle: () => void;
  sound: { muted: boolean; toggle: () => void } | null;
  /** Picks it up to move it with the arrow keys, as a panel of its own. */
  onMove?: (() => void) | undefined;
  /** Shown big: zoom, freeze, earlier pictures. */
  look?: ShareLookMenu | undefined;
  /** Its own window, for someone else's share. */
  own?: ShareWindowMenu | undefined;
  /**
   * Pointing at it: whether you are, whether you can now (it's big and live here), and what keeps you from it, if
   * anything (the organizer turned pointing off, its presenter doesn't let others point, or you're looking at a picture
   * held still).
   */
  point: { on: boolean; can: boolean; closed: 'call' | 'presenter' | null; held: boolean; toggle: () => void } | null;
}) {
  const pick = (f: () => void) => () => { onOpenChange(false); f(); };
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${label}`} className="ic-menu ic-tmenu"
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${label}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={presenter} size={22} /><b>{label}</b></div>
      <p className="scope">Only your view changes</p>
      {!own?.open && <Item icon={big ? 'shrink' : 'grow'} label={big ? 'Show as a tile' : 'Show it big'} kb="P" keys="P" onPick={pick(onToggle)} />}
      {onMove && <Item icon="grip" label="Move it" kb="G" keys="G" onPick={pick(onMove)} />}
      {look && (
        <>
          <Item icon="zoomIn" label="Zoom in" kb={LOOK_KEYS.zoomIn.shown} keys={LOOK_KEYS.zoomIn.aria} disabled={look.max} onPick={pick(look.zoomIn)} />
          {look.zoomed && <Item icon="zoomOut" label="Zoom out" kb={LOOK_KEYS.zoomOut.shown} keys={LOOK_KEYS.zoomOut.aria} onPick={pick(look.zoomOut)} />}
          {look.zoomed && <Item icon="whole" label="See the whole picture" kb={LOOK_KEYS.whole.shown} keys={LOOK_KEYS.whole.aria} onPick={pick(look.whole)} />}
          <Item icon={look.held ? 'play' : 'pause'} label={look.held ? 'Back to live' : 'Freeze the picture'} kb={LOOK_KEYS.freeze.shown} keys={LOOK_KEYS.freeze.aria} onPick={pick(look.held ? look.live : look.freeze)} />
          <Item icon="stepBack" label="Earlier picture" kb={LOOK_KEYS.earlier.shown} keys={LOOK_KEYS.earlier.aria} disabled={!look.canEarlier} onPick={pick(look.earlier)} />
          {look.held && <Item icon="stepForward" label="Later picture" kb={LOOK_KEYS.later.shown} keys={LOOK_KEYS.later.aria} onPick={pick(look.later)} />}
        </>
      )}
      {own && <Item icon={own.open ? 'popIn' : 'pip'} label={own.open ? 'Bring it back here' : 'Open in its own window'} disabled={!own.toggle} onPick={pick(() => own.toggle?.())} />}
      {sound && <Item icon={sound.muted ? 'speaker' : 'speakerOff'} label={sound.muted ? 'Play its sound' : 'Mute its sound for me'} onPick={pick(sound.toggle)} />}
      {look?.zoomed && <p className="hint">The arrow keys move around the picture while it’s zoomed in.</p>}
      {look && <p className="hint">{look.note}</p>}
      {own?.why && <p className="hint">{own.why}</p>}
      {point && (
        <>
          <div className="ic-msep" />
          {point.closed === 'call' ? <p className="hint">The organizer turned off pointing at shared screens.</p>
            : point.closed === 'presenter' ? <p className="hint">{callName(presenter)} isn’t letting others point at their screen.</p>
              : point.can || point.on ? <Item icon="pointer" label={point.on ? 'Stop pointing' : 'Point and mark'} kb="L" keys="L" onPick={pick(point.toggle)} end={<Scope everyone>Everyone</Scope>} />
                : <p className="hint">{point.held ? 'Back to live to point at it: pointers and marks are about the picture now.' : 'Show it big to point at it.'}</p>}
        </>
      )}
    </Popover>
  );
}
