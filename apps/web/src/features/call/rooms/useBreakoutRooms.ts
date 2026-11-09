import { MAIN_PLACE, notesAreOn, type BreakoutBoard, type CallSession, type CallState, type Person } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import type { BoardLanding } from '~/features/board/BoardSurface';
import { captureHere } from '~/lib/capture';
import { selfIn } from '~/lib/live';
import { callName, sameEmail } from '~/lib/people';
import type { CallRoom, RoomView } from '../media/livekit';
import type { SideView } from '../layout/side';
import type { StageRooms } from '../layout/Stage';
import type { RoomActivity, RoomCandidate } from './Rooms';

/** How long after rooms close a returned board is still the rooms' news. */
const CAME_BACK_MS = 8_000;

interface BreakoutRoomsInput {
  session: CallSession;
  state: CallState;
  room: CallRoom;
  roomView: RoomView;
  invited: Person[];
  /** Brings up a view in your side: Notes, as everyone comes back from rooms with notes on. */
  openSide: (view: SideView) => void;
}

/** Owns room membership playback, timed reminders and transitions back to the main room. */
export function useBreakoutRooms({ session, state, room, roomView, invited, openSide }: BreakoutRoomsInput) {
  const toast = useToast();
  const me = selfIn(state);
  const meId = me?.id ?? session.ticket.identity;
  const organizer = state.isOrganizer;
  const hosting = state.isHost;
  const mode = state.capture.mode;
  const on = notesAreOn(mode);
  const capHere = captureHere(state.capture);
  const byId = new Map(state.participants.map((p) => [p.id, p.person]));
  const others = state.participants.filter((p) => !p.isMe);
  /* ---------- breakout rooms: who is in which comes from the call, and each browser plays only its own room ---------- */
  const open = state.breakouts.open;
  const left = open ? Math.max(0, open.until - state.elapsed) : 0;
  // The room you're in (for the organizer, the one they're visiting), or -1 for the main room.
  const myRoom = open ? open.rooms.findIndex((r) => r.members.includes(meId)) : -1;
  const roomName = open && myRoom >= 0 ? open.rooms[myRoom]?.name ?? 'a room' : null;
  /** A part of the call by its ID, as chat names it: "Design", "the main room". */
  const placeName = (place: string) => place === MAIN_PLACE ? 'the main room'
    : [...(open?.rooms ?? []), ...state.breakouts.held.flatMap((h) => h.rooms)].find((r) => r.id === place)?.name ?? 'a room';
  const inARoom = (id: string) => !!open && open.rooms.some((r) => r.members.includes(id));
  const mainIds = open ? state.participants.filter((p) => !inARoom(p.id)).map((p) => p.id) : [];
  const unit = open ? (myRoom >= 0 ? open.rooms[myRoom]?.members ?? [] : mainIds) : null;
  const unitKey = unit ? [...unit].sort().join(' ') : null;
  useEffect(() => {
    if (unitKey === null) { room.playOnly(null); return; }
    const here = new Set(unitKey.split(' '));
    room.playOnly((id) => here.has(id));
  }, [room, unitKey]);
  /* A raised hand in a room is that room asking for help; who's talking in each comes from the room's media. */
  const helps = open ? open.rooms.map((r) => r.members.find((id) => id !== meId && state.participants.some((p) => p.id === id && p.hand)) ?? null) : [];
  const activity: RoomActivity | null = open ? {
    talking: open.rooms.map((r) => r.members.find((id) => id !== meId && roomView.people[id]?.speaking) ?? null),
    help: helps, joined: myRoom >= 0 ? myRoom : null
  } : null;
  const organizerPerson = state.participants.find((p) => p.isOrganizer)?.person;
  const message = open?.message && state.elapsed - open.message.at < 10 ? open.message : null;
  /**
   * The rooms are worked on boards: they opened with one each or one they all share, or a room started its own. Only then do
   * the rooms say things the board's way; rooms with no board say what they always have.
   */
  const roomsOnBoards = !!open && (open.board !== 'none' || open.rooms.some((r) => r.board));
  /* With boards, the organizer's message to every room reaches everyone else as a toast: nobody has to leave the board to read it. */
  const heardMessage = useRef<number | null>(null);
  const messageKey = !organizer && roomsOnBoards && message ? `${message.at}` : null;
  useEffect(() => {
    if (!messageKey || !message || heardMessage.current === message.at) return;
    heardMessage.current = message.at;
    toast(`${organizerPerson ? callName(organizerPerson) : 'The organizer'}, to every room: ${message.text}`, { icon: 'send', ms: 8000 });
  }, [messageKey]);
  /**
   * The rooms as the organizer oversees them on their stage. While there's a board the rooms are worked on, the one every room
   * shares or the board of the room they're visiting, that board takes their place whenever it's on the organizer's stage.
   */
  const roomsBoard = state.board.open !== null && (myRoom >= 0 || open?.board === 'shared');
  const roomsView: StageRooms | null = open && organizer ? {
    // Each room's notes: paused while the whole call is, or while the organizer has paused that room.
    rooms: open.rooms.map((r, k) => ({ name: r.name, ids: r.members.filter((id) => byId.has(id)), help: helps[k] ?? null, notes: mode === 'paused' || (on && r.paused) ? 'paused' : on ? 'on' : 'off', board: r.board })),
    main: mainIds, joined: myRoom >= 0 ? myRoom : null, left, boards: roomsOnBoards,
    message: message && me ? { from: me.person, text: message.text } : null
  } : null;
  const visit = (k: number | null) => {
    const r = k === null ? null : open?.rooms[k] ?? null;
    session.visitRoom(r ? r.id : null);
    toast(r ? `You joined ${r.name}. Everyone in it can see and hear you.` : 'You’re back in the main room', { icon: r ? 'door' : 'left' });
  };
  const visitRef = useRef(visit);
  visitRef.current = visit;

  const warned = useRef(false);
  const closing = useRef(false);
  useEffect(() => {
    if (!open) { warned.current = false; closing.current = false; return; }
    if (left <= 30 && !warned.current) { warned.current = true; toast('Rooms close in 30 seconds', { icon: 'timer' }); }
    if (left <= 0 && !closing.current && hosting) { closing.current = true; session.closeRooms(); }
  }, [open, left, hosting, session, toast]);
  const wasOpen = useRef(!!open);
  /** The rooms as they were last open: what came back with everyone when they closed, and when, and until when it lands. */
  const lastRooms = useRef(open);
  const backFromRooms = useRef(0);
  const [landing, setLanding] = useState<BoardLanding | null>(null);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const was = lastRooms.current;
      const boards = was?.rooms.filter((r) => r.board).length ?? 0;
      const came = was?.board === 'shared' ? 'Everyone’s back. The board stays as it is.' : boards > 0 ? `Everyone’s back. ${boards} ${boards === 1 ? 'board' : 'boards'} came with you.` : null;
      if (came) backFromRooms.current = Date.now();
      // Each room's board lands on the main board, frame by frame, as it arrives. One every room shared has nothing to land.
      if (came && was && was.board !== 'shared') setLanding({ until: Date.now() + CAME_BACK_MS, rooms: was.rooms.filter((r) => r.board).map((r) => r.id) });
      if (on) { if (innerWidth >= 1100) openSide('notes'); toast(came ?? 'Everyone is back in the main room, where notes are on. Each room’s talk goes into the call’s notes as its own section.', { icon: came ? 'door' : 'notesPen' }); }
      else toast(came ?? 'Everyone is back from the rooms', { icon: 'door' });
    } else if (!wasOpen.current && open && !organizer) {
      const minutes = Math.max(1, Math.round((open.until - open.from) / 60));
      // Said plainly when notes are on: a room's talk is transcribed, and goes into the call's notes as its section.
      const noted = on ? ' What’s said there is transcribed for the call’s notes, as the room’s own section.' : '';
      const opener = organizerPerson ? callName(organizerPerson) : 'The organizer';
      // Rooms with boards say it the board's way, and rooms without say it as they always have.
      const going = (room: string) => (roomsOnBoards ? `${opener} opened rooms. You’re going to ${room}.` : `You’re in ${room} for ${minutes} min.`);
      toast(roomName ? `${going(roomName)}${noted}` : `Rooms are open for ${minutes} min. You’re in the main room.`, { icon: 'door', ms: 6000 });
    }
    wasOpen.current = !!open;
  }, [open, on, organizer, roomName, toast]);
  useEffect(() => { if (open) lastRooms.current = open; });
  /* Sent to another room (or back) while the rooms are open: you're told where you are now. Your keys move with you. */
  const myRoomId = open && myRoom >= 0 ? open.rooms[myRoom]?.id ?? null : null;
  const lastRoomId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const was = lastRoomId.current;
    lastRoomId.current = open ? myRoomId : undefined;
    if (organizer || !open || was === undefined || was === myRoomId) return;
    toast(roomName ? `The organizer moved you to ${roomName}` : `The organizer moved you back to the main room${on ? ', where notes are on' : ''}`, { icon: 'door' });
  }, [open, myRoomId, roomName, organizer, on, toast]);
  /* Everyone else hears when the organizer comes into their part of the call, or goes: who can hear them changes. */
  const organizerId = state.participants.find((p) => p.isOrganizer)?.id ?? null;
  const organizerRoom = open && organizerId ? open.rooms.findIndex((r) => r.members.includes(organizerId)) : null;
  const lastOrganizerRoom = useRef<number | null>(null);
  useEffect(() => {
    const was = lastOrganizerRoom.current;
    lastOrganizerRoom.current = organizerRoom;
    if (organizer || was === null || organizerRoom === null || was === organizerRoom) return;
    const who = organizerPerson ? callName(organizerPerson) : 'The organizer';
    // Coming into a room whose notes are on starts what's said there being transcribed: they're told so.
    const went = state.breakouts.open?.rooms[organizerRoom]?.name ?? 'a room';
    if (organizerRoom === myRoom) toast(roomsOnBoards ? (myRoom >= 0 ? `${who} joined this room.` : `${who} is back in the main room.`) : (myRoom >= 0 ? `${who} joined your room` : `${who} is back in the main room`), { icon: 'door' });
    else if (was === myRoom) toast(roomsOnBoards ? (myRoom >= 0 ? `${who} left this room.` : `${who} went to ${went}.`) : (myRoom >= 0 ? `${who} left your room` : `${who} went to ${went}`), { icon: 'door' });
  }, [organizerRoom, myRoom, organizer, organizerPerson, state.breakouts.open, capHere.mode, toast]);
  /* The organizer hears once when a room asks for help, and can go straight there. */
  const helped = useRef(new Set<string>());
  const helpKey = open ? open.rooms.map((r, k) => `${r.id}:${helps[k] ?? ''}`).join(' ') : '';
  useEffect(() => {
    if (!organizer || !helpKey) { helped.current.clear(); return; }
    for (const entry of helpKey.split(' ')) {
      const [roomId, who] = entry.split(':');
      if (!who || helped.current.has(entry)) continue;
      helped.current.add(entry);
      const k = state.breakouts.open?.rooms.findIndex((r) => r.id === roomId) ?? -1;
      const r = state.breakouts.open?.rooms[k];
      if (!r || k === myRoom) continue;
      toast(`${r.name} asked for help`, { icon: 'hand', ms: 8000, action: { label: 'Join', onClick: () => visitRef.current(k) } });
    }
  }, [helpKey, organizer, myRoom, state.breakouts.open, toast]);
  /* Rooms for the organizer to fill: invited people in the call, once each, by their email address. */
  const invitedEmails = new Set(invited.map((g) => g.email.toLowerCase()));
  const candidates: RoomCandidate[] = [];
  for (const p of state.participants) {
    const email = p.person.email.toLowerCase();
    if (p.isMe || p.isOrganizer || !email || !invitedEmails.has(email) || candidates.some((c) => c.id === email)) continue;
    candidates.push({ id: email, person: p.person });
  }
  const guestsHere = others.filter((p) => !candidates.some((c) => sameEmail(c.person, p.person))).length;
  const renameRoom = (k: number, name: string) => {
    const r = open?.rooms[k];
    if (r) session.renameRoom(r.id, name);
  };
  const moveTo = (email: string, k: number | null) => {
    const r = k === null ? null : open?.rooms[k] ?? null;
    session.moveToRoom(email, r ? r.id : null);
    const who = candidates.find((c) => c.id === email.toLowerCase())?.person ?? open?.rooms.flatMap((x) => x.people).find((p) => sameEmail(p, { email }));
    toast(`${who ? callName(who) : 'They'} ${r ? `will be in ${r.name}` : 'will be back in the main room'}. Their keys move with them.`, { icon: 'door' });
  };
  const openRooms = (rooms: { name: string; ids: string[] }[], minutes: number, roomBoard: BreakoutBoard) => {
    session.openRooms({ rooms: rooms.map((r) => ({ name: r.name, emails: r.ids })), minutes, board: roomBoard });
    toast(roomBoard.mode === 'each' ? `${rooms.length} rooms are open. Each one has a board.` : `${rooms.length} rooms are open for ${minutes} min`, { icon: 'door' });
  };

  return {
    open, left, roomName, placeName, inARoom, unit, unitKey, activity, organizerPerson, message, roomsOnBoards, roomsView, roomsBoard, myRoomId,
    candidates, guestsHere, visit, renameRoom, moveTo, openRooms, landing, cameBack: () => Date.now() - backFromRooms.current < CAME_BACK_MS
  };
}
