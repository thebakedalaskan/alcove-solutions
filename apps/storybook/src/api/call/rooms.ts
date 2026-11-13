/*
 * Breakout rooms: opened by the organizer (you, or the script), visited, renamed, people moved between them, paused, and
 * closed, with what's open in them.
 */
import { notesAreOn, type BreakoutBoard, type BreakoutPlan, type CallParticipant, type CaptureMode, type Person, type RoomCapture, type RoomPerson } from '@alcove/api';
import { personAt } from '../../world/people';
import { CallWithPeople } from './people';
import { part, type RoomPlan } from './script';

export abstract class CallWithRooms extends CallWithPeople {
  private roomId = (k: number) => `room_${this.ticket.callId.replace(/[^A-Za-z0-9]/g, '')}_${k}`.padEnd(20, '0');

  /** What's captured in a room: never recorded, transcribed by one browser there while the call's notes are on. */
  private roomCapture(id: string, scribe: string | null, paused = false): RoomCapture {
    const s = this.getSnapshot();
    const mode: CaptureMode = paused ? 'paused' : s.capture.mode === 'unavailable' ? 'on' : s.capture.mode;
    const at = new Date().toISOString();
    const by = { kind: 'organizer' as const, name: s.host.organizer.name };
    return { id, mode, recording: part('off', null, null), transcript: part(mode, at, by), ai: part(mode, at, by), screen: part('off', null, null), gaps: [], scribe };
  }
  /** Your part of the call changes: a moment between the two (nothing heard or sent), then the new part's keys. */
  private moveTo(place: string, members: string[]): void {
    const attention = this.getSnapshot().attention;
    this.attentionRooms.set(attention.place, { ...attention, hands: attention.hands.filter((h) => h.seat !== this.me.seat), nudges: [] });
    const nextAttention = this.attentionRooms.get(place) ?? { place, hands: [], questions: [], nudges: [], cues: [], latest: 0, serverNow: new Date().toISOString() };
    this.change((s) => ({ ...s, attention: nextAttention }));
    this.crypto.update((c) => ({ ...c, status: 'moving', place }));
    this.showBoard();
    this.after(1200, () => this.crypto.update((c) => ({ ...c, status: 'in', members })));
  }
  /** The organizer (not you) opens rooms: you're sent to yours, if you're in one. */
  protected opensRooms(plans: readonly RoomPlan[], minutes: number, board?: BreakoutBoard | undefined): void {
    const s = this.getSnapshot();
    const idOf = (p: Person | 'me') => (p === 'me' ? this.me.id : this.find(p)?.id);
    // Guests (anyone who came in with the link) go by seat, by name only; everyone else by address.
    const guest = (p: Person | 'me') => { const id = idOf(p); return id !== undefined && this.guests.has(id); };
    const rooms = plans.map((plan, k) => {
      const members = plan.people.flatMap((p) => { const id = idOf(p); return id ? [id] : []; });
      return {
        id: this.roomId(k), name: plan.name, people: plan.people.flatMap((p) => (guest(p) ? [] : [p === 'me' ? this.me.person : p])),
        guests: plan.people.flatMap((p) => { const x = p === 'me' ? this.me : this.find(p); return x && guest(p) ? [this.asGuest(x)] : []; }), members, paused: false, board: false
      };
    });
    this.boardsForRooms(board, rooms.map((r, k) => ({ ...r, work: plans[k]?.work })));
    const mine = rooms.find((r) => r.members.includes(this.me.id));
    const scribe = mine ? mine.members.find((id) => id !== this.me.id && !this.guests.has(id)) ?? this.me.id : null;
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, board: this.boardMode, from: s.elapsed, until: s.elapsed + minutes * 60, message: null } }, capture: { ...s.capture, room: mine && notesAreOn(s.capture.mode) ? this.roomCapture(mine.id, scribe) : null } });
    // Whoever was presenting in the main room and goes to a room leaves it: it ends there, said at once.
    this.endsMoved();
    const main = s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id);
    if (mine) this.moveTo(mine.id, mine.members);
    else { this.crypto.update((c) => ({ ...c, members: main })); this.showBoard(); }
    this.hosting();
  }
  openRooms(plan: BreakoutPlan): void {
    const s = this.getSnapshot();
    const rooms = plan.rooms.map((r, k) => {
      const guests = s.participants.filter((p) => !p.isMe && (r.seats ?? []).includes(p.seat));
      const invited = s.participants.filter((p) => !p.isMe && r.emails.some((e) => e.toLowerCase() === p.person.email.toLowerCase()));
      return {
        id: this.roomId(k), name: r.name, people: r.emails.map(personAt), guests: guests.map((p) => this.asGuest(p)), paused: false, board: false,
        members: [...invited, ...guests].map((p) => p.id)
      };
    });
    this.boardsForRooms(plan.board, rooms);
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, board: this.boardMode, from: s.elapsed, until: s.elapsed + plan.minutes * 60, message: null } } });
    this.endsMoved();
    this.showBoard();
    // The organizer starts in the main room, keeping every room's keys, unless they chose a room to start in: then they visit it.
    const visiting = plan.visit === undefined ? undefined : rooms[plan.visit];
    if (visiting) this.visitRoom(visiting.id);
    else this.crypto.update((c) => ({ ...c, members: s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id) }));
    this.hosting();
  }
  /** Someone in the call as a room names a guest: by seat, by name only. */
  private asGuest(p: CallParticipant): { seat: string; person: Person } {
    return { seat: p.seat, person: { id: p.id, name: p.person.name, email: '', ...(p.person.portrait ? { portrait: p.person.portrait } : {}) } };
  }
  closeRooms(): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    if (!open) return;
    this.push({ ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms.map(({ paused: _p, board: _b, ...r }) => r), from: open.from, to: s.elapsed }] }, capture: { ...s.capture, room: null } });
    for (const place of this.presented.keys()) if (place !== 'main') this.presented.delete(place);
    for (const place of this.ended.keys()) if (place !== 'main') this.ended.delete(place);
    this.boardsBack();
    this.showBoard();
    const everyone = s.participants.map((p) => p.id);
    if (this.crypto.getSnapshot().place !== 'main') this.moveTo('main', everyone);
    else this.crypto.update((c) => ({ ...c, members: everyone }));
    this.hosting();
  }
  messageRooms(text: string): void {
    this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, message: { text, at: s.elapsed } } } } : s));
  }
  visitRoom(roomId: string | null): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    if (!open) return;
    const rooms = open.rooms.map((r) => ({ ...r, members: r.id === roomId ? [...r.members.filter((m) => m !== this.me.id), this.me.id] : r.members.filter((m) => m !== this.me.id) }));
    const room = rooms.find((r) => r.id === roomId);
    this.push({ ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } }, capture: { ...s.capture, room: room && notesAreOn(s.capture.mode) ? this.roomCapture(room.id, room.members.find((m) => m !== this.me.id) ?? null, room.paused) : null } });
    // What you were presenting where you were ends there.
    this.endsMoved();
    this.moveTo(roomId ?? 'main', room ? room.members : s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id));
  }
  renameRoom(roomId: string, name: string): void {
    this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => (r.id === roomId ? { ...r, name } : r)) } } } : s));
  }
  moveToRoom(person: RoomPerson, roomId: string | null): void {
    this.change((s) => {
      const open = s.breakouts.open;
      const who = s.participants.find((p) => (person.email !== undefined ? p.person.email.toLowerCase() === person.email.toLowerCase() : p.seat === person.seat));
      if (!open || !who) return s;
      // A guest goes by seat, so the rooms name them; someone invited by address.
      const rooms = open.rooms.map((r) => {
        const to = r.id === roomId;
        const guests = person.seat === undefined ? r.guests : [...r.guests.filter((g) => g.seat !== person.seat), ...(to ? [this.asGuest(who)] : [])];
        const people = person.email === undefined ? r.people : [...r.people.filter((p) => p.email.toLowerCase() !== person.email.toLowerCase()), ...(to ? [who.person] : [])];
        return { ...r, people, guests, members: to ? [...r.members.filter((m) => m !== who.id), who.id] : r.members.filter((m) => m !== who.id) };
      });
      return { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } } };
    });
    // What they were presenting where they were ends there.
    this.endsMoved();
    this.showBoard();
  }
  /**
   * The organizer (not you) moves someone, or you, to the open room with this name, or back to the main room (null): what they
   * were presenting where they were ends there, said at once, and you, moved, go to your new part of the call.
   */
  protected movesToRoom(who: Person | 'me', name: string | null): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    const x = who === 'me' ? this.me : this.find(who);
    const to = name === null ? null : open?.rooms.find((r) => r.name === name);
    if (!open || !x || to === undefined) return;
    const rooms = open.rooms.map((r) => ({ ...r, members: r.id === to?.id ? [...r.members.filter((m) => m !== x.id), x.id] : r.members.filter((m) => m !== x.id) }));
    const room = rooms.find((r) => r.id === to?.id);
    const capture = x.isMe ? { ...s.capture, room: room && notesAreOn(s.capture.mode) ? this.roomCapture(room.id, room.members.find((m) => m !== this.me.id) ?? null, room.paused) : null } : s.capture;
    this.push({ ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } }, capture });
    this.endsMoved();
    if (x.isMe) this.moveTo(room?.id ?? 'main', room ? room.members : s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id));
    else this.showBoard();
    this.hosting();
  }
  pauseRoom(roomId: string, paused: boolean): Promise<void> {
    this.change((s) => {
      const open = s.breakouts.open;
      if (!open) return s;
      const room = s.capture.room;
      return {
        ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === roomId ? { ...r, paused } : r)) } },
        capture: { ...s.capture, room: room && room.id === roomId ? this.roomCapture(roomId, room.scribe, paused) : room }
      };
    });
    return Promise.resolve();
  }
}
