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

/**
 * The menu of something presented that isn't on your stage, from its tile: go to it, put it beside what's on your stage
 * (Show beside), or mute its sound, for you.
 */
export function ThingMenu({ name, by, open, onOpenChange, go, onJoin, beside, sound }: {
  name: string; by: Person; open: boolean; onOpenChange: (o: boolean) => void;
  go: 'Join' | 'Open'; onJoin: () => void;
  /** Puts it beside what's on your stage, when there's room for two. */
  beside: (() => void) | null;
  sound: { muted: boolean; toggle: () => void } | null;
}) {
  const press = useSettledPress(['join', ...(beside ? ['beside'] : []), ...(sound ? ['sound'] : [])].join('\n'), open);
  const pick = (f: () => void) => press(() => { onOpenChange(false); f(); });
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${name}`} className="ic-menu ic-tmenu"
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${name}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={by} size={22} /><b>{name}</b></div>
      <p className="scope">Only your view changes</p>
      <Item key="join" icon="grow" label={go === 'Open' ? 'Go back to it' : 'Show it'} kb="P" keys="P" onPick={pick(onJoin)} />
      {beside && <Item key="beside" icon="panelRight" label="Show beside" onPick={pick(beside)} />}
      {sound && <Item key="sound" icon={sound.muted ? 'speaker' : 'speakerOff'} label={sound.muted ? 'Play its sound for you' : 'Mute its sound for you'} onPick={pick(sound.toggle)} />}
    </Popover>
  );
}
