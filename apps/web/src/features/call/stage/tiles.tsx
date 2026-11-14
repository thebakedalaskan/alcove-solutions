/*
 * What the stage's tiles are made of (Stage.tsx draws them): everyone in the call with their media from the room, the people the
 * organizer rang while they're worth watching, and what's presented that isn't on your stage, as a tile with the people.
 */
import { MAIN_PLACE, type CallCrypto, type CallState, type Person } from '@alcove/api';
import { RingAgain, RingReply, WaitTile } from '@alcove/ui';
import type { ReactNode } from 'react';
import { rungWords, waitingOnStage } from '~/features/calls/ringing/ringWords';
import { tileStatus, type CallClock } from '../attention/status';
import type { CallRoom, RoomView } from '../media/livekit';
import type { MediaSnapshot } from '../media/media';
import { FeedVideo, type Feed } from '../media/Video';
import type { Levels } from '../media/volume';
import { isScreen, screenOf, type useOnStage } from './onStage';
import type { StageParticipant, StagePresented, StageShare, StageWaiter } from './Stage';

/**
 * Who is on the stage: everyone in the call, with their media from the room. With breakout rooms open, this browser's group is its
 * own part of the call: someone in another part is never in it, and someone in this part by the server's word who isn't in this
 * browser's group yet (back with fresh keys after a reload, say) is connecting. You're played from your own camera, and how loud
 * everyone else is is yours to set (`levels`), where the browser can.
 */
export function stagePeopleOf({ state, roomView, room, m, crypto, meId, speaking, clock, levels, canVolume }: {
  state: CallState;
  roomView: RoomView;
  room: CallRoom;
  m: MediaSnapshot;
  crypto: CallCrypto;
  meId: string;
  /** You're talking, as your own microphone says. */
  speaking: boolean;
  clock: CallClock;
  levels: Levels;
  canVolume: boolean;
}): StageParticipant[] {
  const partRooms = state.breakouts.open?.rooms ?? null;
  const partOf = (id: string) => partRooms?.find((r) => r.members.includes(id))?.id ?? MAIN_PLACE;
  return state.participants.map((p) => {
    const r = roomView.people[p.id];
    const video: Feed | null = p.isMe ? (m.cam && m.camera ? { stream: m.camera } : null) : r?.camSid ? { room, sid: r.camSid } : null;
    // In this part of the call by the server's word, but not in this browser's group yet (back with fresh keys after a reload, say).
    const connecting = !p.isMe && crypto.status === 'in' && partOf(p.id) === partOf(meId) && !crypto.members.includes(p.id);
    return { status: tileStatus(p.status, clock), id: p.id, seat: p.seat, person: p.person, isMe: p.isMe, hand: p.hand, mic: p.isMe ? m.mic : r?.mic ?? false, speaking: p.isMe ? speaking : r?.speaking ?? false, video, volume: p.isMe || !canVolume ? null : levels[p.id] ?? 1, connecting };
  });
}

/**
 * People the organizer rang: each waits on the stage while it's worth watching (ringWords.ts), saying what they answered, with
 * Ring again once it's worth asking again. `answers` remembers when each answer came. None while rooms are open.
 */
export function ringWaiters({ rung, answers, now, rooms, ring }: { rung: CallState['ringing']; answers: Map<string, number>; now: number; rooms: boolean; ring: (p: Person) => void }): StageWaiter[] {
  return rooms ? [] : waitingOnStage(rung, answers, now).map((r) => {
    const said = rungWords(r, now);
    return {
      id: r.id, person: r.person,
      tile: <WaitTile person={r.person} title={said.title} detail={said.detail} ringing={r.state === 'ringing'}
        reply={said.reply && <RingReply icon={said.reply.icon}>{said.reply.text}</RingReply>} action={said.again ? <RingAgain onClick={() => ring(r.person)} /> : undefined} />
    };
  });
}

/**
 * What's presented and isn't on your stage: a tile with the people, which takes you back to it (`onJoin`), or puts it beside what's
 * on your stage while that holds one (not on a phone). A screen's tile plays the screen; the call's board's draws the board small
 * (`boardMini`); the workspace's says where its presenter is (`wsWhere`).
 */
export function presentedTiles({ stage, shares, phone, wsWhere, boardMini, onJoin }: {
  stage: ReturnType<typeof useOnStage>;
  shares: readonly StageShare[];
  phone: boolean;
  wsWhere: string | null;
  boardMini: ((w: number, h: number) => ReactNode) | null;
  onJoin: (tile: ReturnType<typeof useOnStage>['tiles'][number]) => void;
}): StagePresented[] {
  return stage.tiles.map((t) => {
    const s = isScreen(t.id) ? shares.find((x) => screenOf(x.id) === t.id) : undefined;
    return {
      id: t.id, name: t.name, icon: isScreen(t.id) ? 'screen' : t.id === 'ws' ? 'folderOpen' : 'presentation', sub: t.mine ? 'You’re presenting' : `${t.first} is presenting`,
      by: t.by, go: t.mine ? 'Open' : 'Join', label: `${t.mine ? 'Go back to' : 'Join'} ${t.name}`, where: t.id === 'ws' ? wsWhere ?? undefined : undefined,
      mini: s ? () => <FeedVideo feed={s.feed} className="screen" /> : t.id === 'board' ? boardMini : null,
      onJoin: () => onJoin(t),
      beside: !phone && stage.on.length === 1 ? () => stage.beside(t.id) : null,
      sound: s?.sound ?? null,
      fresh: stage.fresh(t.key)
    };
  });
}
