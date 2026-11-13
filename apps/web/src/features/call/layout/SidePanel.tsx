/*
 * Your side's views, one at a time (side.ts): Notes (NotesSide.tsx), Chat, People, Breakout rooms for the organizer, and a
 * presenter's own notes beside the board. Each but Notes has its head with × and its body, which a change of view brings in as the
 * last one goes (SideBody): the head and the body stay, and only what's in the body changes.
 */
import { notesAreOn, type CallParticipant, type CallSession, type CallState, type Person, type Rung } from '@alcove/api';
import { volumeTag } from '@alcove/ui';
import type { ReactNode } from 'react';
import { handOf } from '../attention/attention';
import { statusNow } from '../attention/status';
import type { ReplyJump } from '../chat/replyAlerts';
import type { RoomView } from '../media/livekit';
import type { MediaSnapshot } from '../media/media';
import { NotesAsks, askedTag, type CaptureControls } from '../notes/Capture';
import { organizerFirst } from '../rooms/Hosting';
import { RoomsLive, RoomsSetup } from '../rooms/Rooms';
import type { useBreakoutRooms } from '../rooms/useBreakoutRooms';
import { SOMEONE } from '../session/participants';
import type { StageParticipant, StageTogether } from '../stage/Stage';
import type { PersonMenu } from '../stage/TileMenu';
import { PeopleView, SideBody, SideHead, type HostControls, type PanelPerson } from './Panel';
import type { SideView } from './side';

type Rooms = ReturnType<typeof useBreakoutRooms>;

/** What your side is called, for the side itself and for putting it away. */
export const sideLabel = (view: SideView, roomsOpen: boolean): string =>
  ({ notes: 'Notes', chat: 'Chat', people: 'People', rooms: roomsOpen ? 'Rooms are open' : 'Breakout rooms', mine: 'Your notes' })[view];

export function SidePanel({ view, roomsOpen, onClose, notes, chat, people, rooms, mine }: {
  view: SideView;
  roomsOpen: boolean;
  onClose: () => void;
  /** Notes, whole, with its own head. */
  notes: ReactNode;
  chat: ReactNode;
  people: ReactNode;
  rooms: ReactNode;
  /** Whoever presents the board has their notes beside each frame here. */
  mine: ReactNode;
}) {
  switch (view) {
    case 'notes': return notes;
    case 'chat': return (
      <>
        <SideHead title="Chat" onClose={onClose} />
        <SideBody view="chat">{chat}</SideBody>
      </>
    );
    case 'people': return (
      <>
        <SideHead title="People" onClose={onClose} />
        <SideBody view="people">{people}</SideBody>
      </>
    );
    case 'rooms': return (
      <>
        <SideHead title={roomsOpen ? 'Rooms are open' : 'Breakout rooms'} onClose={onClose} />
        <SideBody view="rooms">{rooms}</SideBody>
      </>
    );
    case 'mine': return (
      <>
        <SideHead title="Your notes" onClose={onClose} />
        <SideBody view="mine">
          <div className="ic-scroll ic-pad">{mine}</div>
        </SideBody>
      </>
    );
  }
}

/**
 * People, on your side: everyone here, hands raised first in the order they went up and everyone else in their place, each with
 * how they're in the call, where, and what's true of them for you, and their ⋯ (`menuOf`); for whoever hosts, who's asking to join;
 * for the organizer, who's invited, who was rung, asks for notes and Breakout rooms (`onRooms`); and how the call is kept private.
 */
export function PeopleSide({ state, named, people, roomView, m, micLabel, pins, rooms, now, menuOf, jump, invited, host, together, rung, canRing, ringing, copyLink, controls, onRooms }: {
  state: CallState;
  /** Everyone the call names, as it last said: anyone else here is someone it hasn't named yet. */
  named: readonly CallParticipant[];
  people: readonly StageParticipant[];
  roomView: RoomView;
  m: MediaSnapshot;
  micLabel: string | undefined;
  /** Who you pinned, by seat. */
  pins: readonly string[];
  rooms: Pick<Rooms, 'open' | 'inARoom'>;
  /** The call's clock, which says when someone's status has run out. */
  now: number;
  menuOf: (p: StageParticipant) => PersonMenu;
  jump: ReplyJump | undefined;
  invited: Person[];
  host: HostControls | undefined;
  together: StageTogether;
  rung: Rung[];
  canRing: (p: Person) => boolean;
  /** Ringing someone, and stopping, while the organizer's call is on. */
  ringing: { ring: (p: Person) => void; stop: (id: string) => void } | null;
  copyLink: () => void;
  controls: CaptureControls;
  onRooms: (() => void) | null;
}) {
  const { open, inARoom } = rooms;
  const organizer = state.isOrganizer;
  const on = notesAreOn(state.capture.mode);
  const mode = state.capture.mode;
  const knownIds = new Set(named.map((p) => p.id));
  const roleOf = (p: CallParticipant) => (p.isOrganizer ? 'Organizer' : !knownIds.has(p.id) || state.role === 'guest' ? 'In the call' : p.person.email ? 'Invited' : 'Guest');
  const roomOf = (id: string) => open?.rooms.find((r) => r.members.includes(id))?.name;
  /* Hands raised come first in People, in the order they went up; everyone else keeps their place. */
  const handOrder = new Map(state.attention.hands.map((h, i) => [h.participantId, i]));
  const raisedAt = (id: string) => handOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  const stagedBy = new Map(people.map((x) => [x.id, x]));
  const here: PanelPerson[] = state.participants.flatMap((p): PanelPerson[] => {
    const sp = stagedBy.get(p.id);
    if (!sp) return [];
    const r = roomView.people[p.id];
    const where = roomOf(p.id);
    const detail = p.isMe
      ? [organizer ? 'Organizer' : state.role === 'invited' ? 'Invited' : 'Guest', where ? `in ${where}` : '', micLabel, m.screen ? 'sharing' : '', !m.cam ? 'camera off' : '']
      : [roleOf(p), where ? `in ${where}` : '', r?.screenSid ? 'sharing' : ''];
    const handId = handOf(state, p.id);
    return [{
      id: p.id, person: p.person, isMe: p.isMe, organizer: p.isOrganizer, mic: sp.mic, handId, speaking: sp.speaking, volume: sp.volume,
      detail: detail.filter(Boolean).join(' · '),
      tags: [state.host.standIn && state.host.id === p.id ? `Hosting while ${organizerFirst(state)} is away` : '', !open && state.spotlight === p.id ? 'Spotlight · everyone' : '', pins.includes(p.seat) ? 'Pinned for you' : '',
        handId ? (inARoom(p.id) ? `Asked for help in ${where ?? 'a room'}` : 'Hand raised') : '', volumeTag(sp.volume ?? 1) ?? '', askedTag(state, p.id)].filter(Boolean),
      status: statusNow(p.status, now),
      menu: menuOf(sp)
    }];
  }).sort((a, b) => raisedAt(a.id) - raisedAt(b.id));
  const privacyLine = [
    open ? 'Each room has its own encryption keys, so video, audio and chat reach only the people in the same room.'
      : on || mode === 'paused' ? 'Video, audio and chat are encrypted end to end.' : 'Video, audio and chat are encrypted end to end between the people here.',
    on ? `While notes are on, ${state.capture.screen.mode === 'on' ? 'what everyone says and what anyone shares on screen go' : 'what everyone says also goes'} to the notes, ${state.capture.modelPrivate ? 'written in confidential compute' : 'written by an AI model outside a secure enclave, so Alcove can’t guarantee it stays private'}.${open ? ' What’s said in each breakout room goes into them as that room’s own section; what’s shared there doesn’t.' : ''}`
      : mode === 'paused' ? 'Notes are paused, so nothing goes to the notes.' : ''
  ].filter(Boolean).join(' ');
  return (
    <PeopleView jump={jump} here={here} invited={invited} asking={state.isHost ? state.waiting : []} invites={organizer} ringing={rung} host={host} foot={privacyLine} together={together}
      link={{ copy: copyLink, locked: state.locked }}
      canRing={canRing} onRing={ringing?.ring} onStopRing={ringing?.stop}
      notesAsks={organizer && !on && state.capture.requests.length > 0 ? <NotesAsks state={state} controls={controls} after={state.waiting.length > 0} /> : undefined}
      rooms={onRooms ? { open: !!open, onOpen: onRooms } : undefined} />
  );
}

/** Breakout rooms, on the organizer's side: setting them up, and once they're open, watching them. */
export function RoomsSide({ rooms, session, state, byId, me, notesOn }: {
  rooms: Rooms;
  session: CallSession;
  state: CallState;
  /** Everyone here by their connection. */
  byId: Map<string, Person>;
  me: CallParticipant | undefined;
  notesOn: boolean;
}) {
  const { open, activity } = rooms;
  return open && me && activity
    ? <RoomsLive open={open} elapsed={state.elapsed} members={open.rooms.map((r) => r.members.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; }))}
      chips={rooms.roomChips} main={rooms.mainPeople} people={byId} activity={activity} onJoin={rooms.visit} onRename={rooms.renameRoom} onMove={rooms.moveTo} onMessage={(t) => session.messageRooms(t)} onClose={() => session.closeRooms()} />
    : <RoomsSetup people={rooms.candidates} me={me?.person ?? SOMEONE} notes={notesOn} boardName={state.board.open?.name ?? null} onOpen={rooms.openRooms} />;
}
