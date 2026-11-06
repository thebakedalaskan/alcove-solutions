/*
 * A tile's ⋯ menu: everything you can do to your view with the mouse, with the key that does it from a focused tile.
 * Every choice changes only your view, except the organizer's spotlight, which says Everyone. Each row has an id: what a menu
 * offers can change while it's open (someone joins you on the board, a board opens), and for a moment after its rows move a
 * press does nothing, so it never lands on a row that moved under it.
 */
import type { Person, SelfView } from '@alcove/api';
import { Avatar, Icon, Kbd, Popover, Scope, VolumeControl, cn, useSettledPress, type IconName } from '@alcove/ui';
import type { ReactNode } from 'react';
import { callName } from '~/lib/people';
import { LOOK_KEYS } from '../screen-sharing/shareLook';

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
  /** Someone in the workspace with you: going where they go. An arch has no room for the button a tile has. */
  following?: { on: boolean; toggle: () => void } | undefined;
  /** Someone on the board with you: going once to where they're looking, or keeping with them until you stop. */
  board?: { goTo: () => void; follow: { on: boolean; toggle: () => void } } | undefined;
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
  const { pinned, spotlight, earlier, later, size, self, volume, following, board } = menu;
  const moves = earlier !== undefined || later !== undefined;
  const press = useSettledPress([
    ...(board ? ['go-to', 'follow-on-board'] : []), ...(following ? ['follow'] : []), ...(pinned ? ['pin'] : []), ...(moves ? ['earlier', 'later'] : []),
    ...(size ? ['size'] : []), ...(self ? [...SELF.map((s) => `self-${s.where}`), ...(self.where === 'hidden' ? ['self-hint'] : [])] : []),
    ...(volume ? ['volume'] : []), ...(organizer && spotlight ? ['spotlight'] : [])
  ].join('\n'), open);
  const pick = (f: () => void) => press(() => { onOpenChange(false); f(); });
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${name}`} className="ic-menu ic-tmenu"
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${name}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={who} size={22} /><b>{name}</b></div>
      <p className="scope">Only your view changes</p>
      {board && (
        <>
          <Item key="go-to" icon="locate" label={`Go to ${callName(who)}`} onPick={pick(board.goTo)} />
          <Item key="follow-on-board" icon="eye" label={board.follow.on ? `Stop following ${callName(who)}` : `Follow ${callName(who)}`} onPick={pick(board.follow.toggle)} />
          <div className="ic-msep" />
        </>
      )}
      {following && <Item key="follow" icon="navigate" label={following.on ? 'Stop following' : `Follow ${callName(who)}`} onPick={pick(following.toggle)} />}
      {pinned && <Item key="pin" icon={pinned.on ? 'pinOff' : 'pin'} label={pinned.on ? 'Unpin for me' : 'Pin for me'} kb="P" keys="P" onPick={pick(pinned.toggle)} />}
      {moves && (
        <>
          <Item key="earlier" icon="left" label="Move earlier" kb="⇧←" keys="Shift+ArrowLeft" disabled={!earlier} onPick={pick(() => earlier?.())} />
          <Item key="later" icon="right" label="Move later" kb="⇧→" keys="Shift+ArrowRight" disabled={!later} onPick={pick(() => later?.())} />
        </>
      )}
      {size && <Item key="size" icon={size.big ? 'shrink' : 'grow'} label={size.big ? 'Make smaller' : 'Make bigger'} kb={size.big ? '−' : '+'} keys={size.big ? '-' : '+'} onPick={pick(size.toggle)} />}
      {self && (
        <div className="ic-mgrp" role="group" aria-label="See yourself">
          <div className="ac-eyebrow">See yourself</div>
          {SELF.map((s) => (
            <button key={`self-${s.where}`} type="button" className="mi" role="menuitemradio" aria-checked={self.where === s.where} onClick={pick(() => self.set(s.where))}>
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
          <Item key="spotlight" icon="spotlight" label={spotlight.on ? 'Stop spotlight' : 'Spotlight for everyone'} onPick={pick(spotlight.toggle)} end={<Scope everyone>Everyone</Scope>} />
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
 * and point at it, which everyone sees. Beside the board, Make it big swaps them, as pressing the share does.
 */
export function ShareMenu({ presenter, label, open, onOpenChange, big, onToggle, onSwap, sound, look, own, point, onMove, onPut }: {
  presenter: Person; label: string; open: boolean; onOpenChange: (o: boolean) => void; big: boolean; onToggle: () => void;
  /** Beside the board: makes it big and the board a live tile over the faces, as pressing it or P does. */
  onSwap?: (() => void) | undefined;
  sound: { muted: boolean; toggle: () => void } | null;
  /** Picks it up to move it with the arrow keys, as a panel of its own. */
  onMove?: (() => void) | undefined;
  /** With a board open: puts a picture of what this browser shows of it on the board. */
  onPut?: (() => void) | undefined;
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
  const pointing = point !== null && point.closed === null && (point.can || point.on);
  const press = useSettledPress([
    ...(onSwap ? ['swap'] : []), ...(own?.open ? [] : ['size']), ...(onPut ? ['put'] : []), ...(onMove ? ['move'] : []),
    ...(look ? ['zoom-in', ...(look.zoomed ? ['zoom-out', 'whole'] : []), 'freeze', 'earlier', ...(look.held ? ['later'] : [])] : []),
    ...(own ? ['window'] : []), ...(sound ? ['sound'] : []), ...(look?.zoomed ? ['zoom-hint'] : []), ...(look ? ['look-hint'] : []), ...(own?.why ? ['window-hint'] : []),
    ...(pointing ? ['point'] : [])
  ].join('\n'), open);
  const pick = (f: () => void) => press(() => { onOpenChange(false); f(); });
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${label}`} className="ic-menu ic-tmenu"
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${label}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={presenter} size={22} /><b>{label}</b></div>
      <p className="scope">Only your view changes</p>
      {onSwap && <Item key="swap" icon="grow" label="Make it big" kb="P" keys="P" onPick={pick(onSwap)} />}
      {!own?.open && <Item key="size" icon={big ? 'shrink' : 'grow'} label={big ? 'Show as a tile' : 'Show it big'} kb={onSwap ? undefined : 'P'} keys={onSwap ? undefined : 'P'} onPick={pick(onToggle)} />}
      {onPut && <Item key="put" icon="image" label="Put on the board" onPick={pick(onPut)} />}
      {onMove && <Item key="move" icon="grip" label="Move it" kb="G" keys="G" onPick={pick(onMove)} />}
      {look && (
        <>
          <Item key="zoom-in" icon="zoomIn" label="Zoom in" kb={LOOK_KEYS.zoomIn.shown} keys={LOOK_KEYS.zoomIn.aria} disabled={look.max} onPick={pick(look.zoomIn)} />
          {look.zoomed && <Item key="zoom-out" icon="zoomOut" label="Zoom out" kb={LOOK_KEYS.zoomOut.shown} keys={LOOK_KEYS.zoomOut.aria} onPick={pick(look.zoomOut)} />}
          {look.zoomed && <Item key="whole" icon="whole" label="See the whole picture" kb={LOOK_KEYS.whole.shown} keys={LOOK_KEYS.whole.aria} onPick={pick(look.whole)} />}
          <Item key="freeze" icon={look.held ? 'play' : 'pause'} label={look.held ? 'Back to live' : 'Freeze the picture'} kb={LOOK_KEYS.freeze.shown} keys={LOOK_KEYS.freeze.aria} onPick={pick(look.held ? look.live : look.freeze)} />
          <Item key="earlier" icon="stepBack" label="Earlier picture" kb={LOOK_KEYS.earlier.shown} keys={LOOK_KEYS.earlier.aria} disabled={!look.canEarlier} onPick={pick(look.earlier)} />
          {look.held && <Item key="later" icon="stepForward" label="Later picture" kb={LOOK_KEYS.later.shown} keys={LOOK_KEYS.later.aria} onPick={pick(look.later)} />}
        </>
      )}
      {own && <Item key="window" icon={own.open ? 'popIn' : 'pip'} label={own.open ? 'Bring it back here' : 'Open in its own window'} disabled={!own.toggle} onPick={pick(() => own.toggle?.())} />}
      {sound && <Item key="sound" icon={sound.muted ? 'speaker' : 'speakerOff'} label={sound.muted ? 'Play its sound' : 'Mute its sound for me'} onPick={pick(sound.toggle)} />}
      {look?.zoomed && <p className="hint">The arrow keys move around the picture while it’s zoomed in.</p>}
      {look && <p className="hint">{look.note}</p>}
      {own?.why && <p className="hint">{own.why}</p>}
      {point && (
        <>
          <div className="ic-msep" />
          {point.closed === 'call' ? <p className="hint">The organizer turned off pointing at shared screens.</p>
            : point.closed === 'presenter' ? <p className="hint">{callName(presenter)} isn’t letting others point at their screen.</p>
              : pointing ? <Item key="point" icon="pointer" label={point.on ? 'Stop pointing' : 'Point and mark'} kb="L" keys="L" onPick={pick(point.toggle)} end={<Scope everyone>Everyone</Scope>} />
                : <p className="hint">{point.held ? 'Back to live to point at it: pointers and marks are about the picture now.' : 'Show it big to point at it.'}</p>}
        </>
      )}
    </Popover>
  );
}
