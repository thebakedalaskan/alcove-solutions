/*
 * A person's ⋯ menu, on their tile and in People: what you can do about them, kept short. On your own: your status, Pin for me,
 * where you see yourself, and for whoever hosts, Spotlight for everyone. On someone else's: Pin for me, a private message, a
 * nudge only they see, how loud they are for you, and for whoever hosts, spotlighting, lowering their hand, muting them and
 * taking them out of the call. Each row has an id: what a menu offers can change while it's open (someone joins you on the
 * board, a status takes its place), and for a moment after its rows move a press does nothing, so it never lands on a row that
 * moved under it.
 */
import type { CallNudgeKind, CallSession, CallState, CallStatus, CallStatusKind, CallStatusMinutes, Person, SelfView } from '@alcove/api';
import { Avatar, CallMenuChips, Icon, Popover, VolumeControl, cn, useSettledPress, type IconName, type useToast } from '@alcove/ui';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { callName } from '~/lib/people';
import { handOf } from '../attention/attention';
import { NUDGES, NUDGE_KINDS } from '../attention/nudges';
import { STATUS, STATUS_KINDS, STATUS_MINUTES, statusMinutes } from '../attention/status';
import type { HostControls } from '../layout/Panel';
import { PHONE_W } from '../layout/panels';
import { useWidth } from '../layout/useWidth';
import type { VolumeActions } from '../media/volume';
import type { StageParticipant } from './Stage';

/** What a person's menu offers. A choice left out isn't offered there. */
export interface PersonMenu {
  privateMessage?: (() => void) | undefined;
  pinned?: { on: boolean; toggle: () => void } | undefined;
  /** Your own: your status, and changing it (null clears it; `minutes` sets when it goes, and none keeps a time already set). */
  status?: { now: CallStatus | null; set: (kind: CallStatusKind | null, minutes?: CallStatusMinutes | undefined) => void } | undefined;
  /** Your own tile: where you see yourself. */
  self?: { where: SelfView; set: (w: SelfView) => void } | undefined;
  /** Someone else in your room: a nudge only they see. */
  nudge?: ((kind: CallNudgeKind) => void) | undefined;
  /** Someone else's: how loud they are for you (your playback only), where the browser can set it. */
  volume?: { level: number; set: (level: number) => void; toggle: () => void } | undefined;
  /** Someone in the workspace with you: going where they go. An arch has no room for the button a tile has. */
  following?: { on: boolean; toggle: () => void } | undefined;
  /** Someone on the board with you: going once to where they're looking, or keeping with them until you stop. */
  board?: { goTo: () => void; follow: { on: boolean; toggle: () => void } } | undefined;
  /** Whoever hosts: everyone's main stage. */
  spotlight?: { on: boolean; toggle: () => void } | undefined;
  /** Whoever hosts, on someone else: lower their raised hand, mute them for everyone while their microphone is on, take them out of the call. */
  host?: { lowerHand: (() => void) | null; mute: (() => void) | null; remove: () => void } | undefined;
}

/**
 * What someone's ⋯ offers beyond your own view, the same on their tile and on their row in People: your status on your own; on
 * anyone else's, writing to them privately and a nudge while they're in your room's group (`nudging`, `members`), how loud they
 * are for you, and whoever hosts' controls (`host`). Each says what it did, or why it didn't.
 */
export function personMenus({ session, state, status, peers, nudging, members, volumes, host, toast, failed, openPrivate }: {
  session: CallSession;
  state: CallState;
  /** Your own status, as everyone sees it, until it runs out. */
  status: CallStatus | null;
  /** Who you can write to privately. */
  peers: readonly string[];
  /** Nudges reach your room's group now. */
  nudging: boolean;
  /** Who's in your room's group. */
  members: readonly string[];
  volumes: VolumeActions;
  host: HostControls | undefined;
  toast: ReturnType<typeof useToast>;
  failed: (e: unknown) => void;
  openPrivate: (identity: string) => void;
}): (p: StageParticipant) => PersonMenu {
  const setStatus = (kind: CallStatusKind | null, minutes?: CallStatusMinutes | undefined) => { session.setStatus(kind, minutes).catch(failed); };
  /** Only they see it, and they're told who sent it while it's one person. */
  const sendNudge = (to: { id: string; person: Person }, kind: CallNudgeKind) => {
    session.nudge(to.id, kind).then(() => toast(`${callName(to.person)} got your nudge: ${NUDGES[kind].label}`, { icon: 'nudge' }), failed);
  };
  const lowerHand = (id: string, who: Person) => { session.lowerHand(id).then(() => toast(`${callName(who)}’s hand is lowered`, { icon: 'hand' }), failed); };
  const muteFor = (who: { id: string; person: Person }) => { host?.mute(who.id).then(() => toast(`${callName(who.person)} is muted. Only they can unmute.`, { icon: 'micOff' }), failed); };
  const removeFrom = (who: { id: string; person: Person }) => {
    const name = callName(who.person);
    host?.remove(who.id).then(() => toast(state.locked ? `${name} is out of the call.` : `${name} is out of the call. They can join again with the link unless the call is locked.`, { icon: 'leave' }), failed);
  };
  return (p) => {
    if (p.isMe) return { status: { now: status, set: setStatus } };
    const handId = handOf(state, p.id);
    return {
      privateMessage: peers.includes(p.id) ? () => openPrivate(p.id) : undefined,
      nudge: nudging && members.includes(p.id) ? (kind) => sendNudge(p, kind) : undefined,
      volume: p.volume === null ? undefined : { level: p.volume, set: (level) => volumes.set(p.id, level), toggle: () => volumes.toggle(p.id) },
      host: host ? { lowerHand: handId ? () => lowerHand(handId, p.person) : null, mute: p.mic ? () => muteFor(p) : null, remove: () => removeFrom(p) } : undefined
    };
  };
}

const SELF: { where: SelfView; label: string }[] = [
  { where: 'grid', label: 'Grid' },
  { where: 'corner', label: 'Corner' },
  { where: 'hidden', label: 'Hidden' }
];

function Item({ icon, label, onPick, end, disabled = false }: { icon: IconName; label: string; onPick: () => void; end?: ReactNode; disabled?: boolean }) {
  return <button type="button" className="mi" disabled={disabled} onClick={onPick}><Icon name={icon} size={17} /><span className="t">{label}</span>{end}</button>;
}

export function TileMenu({ who, me, open, onOpenChange, menu, row = false }: {
  who: Person; me: boolean; open: boolean; onOpenChange: (o: boolean) => void; menu: PersonMenu;
  /** In People: the row's ⋯, a tab stop with a tooltip, rather than the tile's, which the tile's keys open. */
  row?: boolean;
}) {
  const name = callName(who);
  const label = `Options for ${who.name}${me ? ' (you)' : ''}`;
  const phone = useWidth() < PHONE_W;
  const { pinned, status, self, nudge, volume, following, board, spotlight, host } = menu;
  /** The menu, or its nudge step: "Only Kofi sees it". */
  const [step, setStep] = useState<'menu' | 'nudge'>('menu');
  const body = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const press = useSettledPress([
    step, ...(status ? ['status'] : []), ...(pinned ? ['pin'] : []), ...(self ? ['self'] : []),
    ...(menu.privateMessage ? ['private-message'] : []), ...(nudge ? ['nudge'] : []), ...(volume ? ['volume'] : []), ...(board ? ['go-to', 'follow-on-board'] : []),
    ...(following ? ['follow'] : []), ...(spotlight ? ['spotlight'] : []), ...(host ? ['host', ...(host.lowerHand ? ['lower'] : []), ...(host.mute ? ['mute'] : [])] : [])
  ].join('\n'), open);
  const pick = (f: () => void) => press(() => { onOpenChange(false); f(); });
  const stay = (f: () => void) => press(f);
  const go = (to: 'menu' | 'nudge') => { moved.current = true; setStep(to); };
  // Each step starts on its first choice, as the menu does when it opens; going back lands on Nudge again.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    body.current?.querySelector<HTMLElement>(step === 'nudge' ? '.mi' : '[data-row="nudge"]')?.focus();
  }, [step]);
  // However it closes (Escape, a press away, a choice, whoever opened it), it opens again on the menu, not a step into it.
  useEffect(() => { if (!open) { moved.current = false; setStep('menu'); } }, [open]);
  const timed = statusMinutes(status?.now ?? null);
  /** The menu's parts, each only where it has something, with a hairline between them. */
  const groups: { key: string; node: ReactNode }[] = [];
  if (status) groups.push({ key: 'status', node: (
    <div role="group" aria-label="Set a status">
      {/* I'm back sits in the heading, so having a status moves no row under a press. */}
      <div className="ic-mhead"><span className="ac-eyebrow">Set a status</span>{status.now && <button type="button" onClick={pick(() => status.set(null))}>I’m back</button>}</div>
      {STATUS_KINDS.map((k) => (
        <button key={k} type="button" className="mi" role="menuitemradio" aria-checked={status.now?.kind === k} onClick={stay(() => status.set(k))}>
          <Icon name={STATUS[k].icon} size={17} /><span className="t">{STATUS[k].label}</span><Icon name="check" size={16} className="tick" />
        </button>
      ))}
      <div className="ac-eyebrow">Back in</div>
      <CallMenuChips label="Back in" options={STATUS_MINUTES.map((m) => ({ value: m, label: `${m} min` }))} chosen={timed}
        onPick={(m) => pick(() => status.set(status.now?.kind ?? 'away', m))()} />
    </div>
  ) });
  if (pinned || self || menu.privateMessage || nudge || volume) groups.push({ key: 'yours', node: (
    <>
      {pinned && <Item icon={pinned.on ? 'pinOff' : 'pin'} label={pinned.on ? 'Unpin for me' : 'Pin for me'} onPick={pick(pinned.toggle)} />}
      {self && (
        <>
          <div className="ac-eyebrow">See yourself</div>
          <CallMenuChips label="See yourself" options={SELF.map((x) => ({ value: x.where, label: x.label }))} chosen={self.where} onPick={(w) => pick(() => self.set(w))()} />
        </>
      )}
      {menu.privateMessage && <Item icon="lock" label={`Message ${name} privately`} onPick={pick(menu.privateMessage)} />}
      {nudge && (
        <button type="button" className="mi" data-row="nudge" aria-haspopup="menu" onClick={stay(() => go('nudge'))}>
          <Icon name="nudge" size={17} /><span className="t">Nudge {name}</span><Icon name="chevron" size={15} className="end" />
        </button>
      )}
      {volume && <VolumeControl name={name} level={volume.level} onChange={volume.set} onToggle={volume.toggle} />}
    </>
  ) });
  if (board || following) groups.push({ key: 'find', node: (
    <>
      {board && <Item icon="locate" label={`Go to ${name}`} onPick={pick(board.goTo)} />}
      {board && <Item icon="eye" label={board.follow.on ? `Stop following ${name}` : `Follow ${name}`} onPick={pick(board.follow.toggle)} />}
      {following && <Item icon="navigate" label={following.on ? 'Stop following' : `Follow ${name}`} onPick={pick(following.toggle)} />}
    </>
  ) });
  if (spotlight || host) groups.push({ key: 'host', node: (
    <>
      {spotlight && <Item icon="spotlight" label={spotlight.on ? 'Stop spotlight' : 'Spotlight for everyone'} onPick={pick(spotlight.toggle)} />}
      {host?.lowerHand && <Item icon="hand" label="Lower hand" onPick={pick(host.lowerHand)} />}
      {host?.mute && <Item icon="micOff" label="Mute for everyone" onPick={pick(host.mute)} />}
      {host && <Item icon="leave" label="Remove from the call" onPick={pick(host.remove)} />}
    </>
  ) });
  const anchor = row
    ? <button type="button" className="ac-icon-btn ic-pmore" aria-label={label} title={label} aria-haspopup="menu"><Icon name="more" size={18} /></button>
    : <button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={label} aria-haspopup="menu"><Icon name="more" size={16} /></button>;
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={label} className={cn('ic-menu ic-tmenu', phone && 'is-sheet')} anchor={anchor}>
      <div ref={body}>
        {step === 'nudge' && nudge ? (
          <>
            <div className="ic-mstep">
              <button type="button" className="b" aria-label="Back" onClick={() => go('menu')}><Icon name="chevronLeft" size={16} /></button>
              <span>Only {name} sees it</span>
            </div>
            {NUDGE_KINDS.map((k) => <Item key={k} icon={NUDGES[k].icon} label={NUDGES[k].label} onPick={pick(() => nudge(k))} />)}
          </>
        ) : groups.map((g, i) => <Fragment key={g.key}>{i > 0 && <div className="ic-msep" />}{g.node}</Fragment>)}
      </div>
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
  const phone = useWidth() < PHONE_W;
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="bottom" align="end" label={`Options for ${name}`} className={cn('ic-menu ic-tmenu', phone && 'is-sheet')}
      anchor={<button type="button" tabIndex={-1} className={cn('ic-more', open && 'is-on')} aria-label={`Options for ${name}`} aria-haspopup="menu"><Icon name="more" size={16} /></button>}>
      <div className="mh"><Avatar person={by} size={22} /><b>{name}</b></div>
      <Item icon="grow" label={go === 'Open' ? 'Go back to it' : 'Show it'} onPick={pick(onJoin)} />
      {beside && <Item icon="panelRight" label="Show beside" onPick={pick(beside)} />}
      {sound && <Item icon={sound.muted ? 'speaker' : 'speakerOff'} label={sound.muted ? 'Play its sound for you' : 'Mute its sound for you'} onPick={pick(sound.toggle)} />}
    </Popover>
  );
}
