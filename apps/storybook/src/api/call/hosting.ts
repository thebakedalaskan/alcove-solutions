/*
 * Who hosts: the organizer's connection dropping, someone invited standing in, the organizer back, and locking the call;
 * and the end, for everyone, writing the call's note, or the call going on without you.
 */
import { notesAreOn, type CallEndResult, type CallState, type CapturePart, type LiveFollowUp, type Person } from '@alcove/api';
import { writeNote } from '../../world/build';
import { current, nextId } from '../state';
import { firstOf } from './base';
import { goingOnIn, type GoingOn } from './going-on';
import { CallWithRooms } from './rooms';
import { linkState } from './script';

/** How long after the organizer's connection drops someone invited hosts in their place. */
const TAKE_OVER_MS = 10_000;
/** A moment of the call as the notes write it, '04:12'. */
const clockOf = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export abstract class CallWithHosting extends CallWithRooms {
  /** The organizer's connection drops: notes can't be captured, and ten seconds later someone invited hosts in their place. */
  protected hostDrops(): void {
    const s = this.getSnapshot();
    const organizer = s.participants.find((p) => p.isOrganizer && !p.isMe);
    if (!organizer) return;
    const at = new Date().toISOString();
    this.away = { from: at, at: s.elapsed, organizer: organizer.person, seat: organizer.seat };
    // Their connection dropped, which isn't leaving: what they present is hidden until they're back, and nothing ended.
    this.drops(organizer);
    const unavailable = (p: CapturePart): CapturePart => (p.mode === 'on' ? { ...p, mode: 'unavailable' } : p);
    this.change((x) => ({
      ...x, host: { ...x.host, id: null },
      capture: notesAreOn(x.capture.mode) ? { ...x.capture, mode: 'unavailable', recording: unavailable(x.capture.recording), transcript: unavailable(x.capture.transcript), away: true } : { ...x.capture, away: true }
    }));
    this.after(TAKE_OVER_MS, () => this.standIn());
  }
  /** Someone invited who's in the main room hosts while the organizer is away: you, unless someone came before you. */
  private standIn(): void {
    const s = this.getSnapshot();
    const away = this.away;
    if (!away || s.host.id) return;
    const inRoom = (id: string) => !!s.breakouts.open?.rooms.some((r) => r.members.includes(id));
    const host = s.participants.find((p) => !this.guests.has(p.id) && (p.isMe ? s.role === 'invited' : p.person.email !== '') && !inRoom(p.id));
    if (!host) return;
    const org = firstOf(away.organizer);
    const at = new Date().toISOString();
    const on = (p: CapturePart): CapturePart => (p.mode === 'unavailable' ? { ...p, mode: 'on' } : p);
    this.push({
      ...s, isHost: host.isMe,
      host: { id: host.id, standIn: true, organizer: away.organizer, next: [] },
      capture: { ...s.capture, mode: s.capture.mode === 'unavailable' ? 'on' : s.capture.mode, recording: on(s.capture.recording), transcript: on(s.capture.transcript), away: false, gaps: [...s.capture.gaps, { kind: 'offline', from: away.from, to: at, at: away.at }] },
      notices: [...s.notices, { id: nextId('notice'), text: host.isMe ? `${org}’s connection dropped, so you’re hosting until ${org} is back.` : `${org}’s connection dropped, so ${firstOf(host.person)} is hosting until ${org} is back.`, kind: 'people' }]
    });
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: host.person }));
    this.hosting();
  }
  /** The organizer joins again, and hosts again at once. */
  protected hostBack(): void {
    const away = this.away;
    if (!away) return;
    this.away = null;
    const was = this.getSnapshot().host;
    this.join(away.organizer, { organizer: true });
    const back = this.find(away.organizer);
    const s = this.getSnapshot();
    const org = firstOf(away.organizer);
    this.push({
      ...s, isHost: false, host: { id: back?.id ?? was.id, standIn: false, organizer: away.organizer, next: [] },
      capture: { ...s.capture, mode: s.capture.mode === 'unavailable' ? 'on' : s.capture.mode, away: false },
      notices: [...s.notices, { id: nextId('notice'), text: `${org} is back and hosting again.`, kind: 'people' }]
    });
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: null }));
    // What they were presenting shows again, as it was.
    this.showBoard();
    this.hosting();
  }
  /** Whoever hosts (not you) ends the call: it's over for everyone, and everyone invited can follow its notes being written. */
  protected ends(): void {
    this.endsWith(this.getSnapshot());
    this.change((s) => ({ ...s, phase: 'ended' }));
    this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'ended-by-host' }));
    this.halt();
  }
  /**
   * The call ends for everyone, as the server ends it: it's over in the world and its link says so, and its note, if notes
   * were ever on, is written as everyone invited is given it, before anyone's out of the call.
   */
  private endsWith(s: CallState): string | null {
    const w = current();
    const noteId = s.notes.everOn ? s.notes.noteId : null;
    w.meetings = w.meetings.map((m) => (m.id === this.meeting.id ? { ...m, status: 'ended', duration: s.elapsed, ...(noteId ? { noteId } : {}) } : m));
    linkState(this.meeting.code, (l) => ({ hostHere: false, standIn: null, locked: false, capture: null, ...l, ended: true }));
    if (noteId) {
      const decided = this.heard.flatMap((h) => (h.line.decides ? [{ id: `${noteId}-d${h.id}`, text: h.line.decides, at: clockOf(h.at), state: 'proposed' as const }] : []));
      const actionSpec = (row: LiveFollowUp) => ({
        id: row.id, text: row.text, revision: row.revision, reviewed: row.reviewed, ...(row.ownerPerson ? { owner: row.ownerPerson } : {}), ...(row.due ? { due: row.due } : {}),
        ...(row.evidence[0] ? { at: clockOf(row.evidence[0].said) } : {}), done: row.done, ...(row.target ? { target: row.target } : {})
      });
      const actions = [...(s.liveNotes.notes?.next ?? []), ...s.liveNotes.added].map(actionSpec);
      const suggestions = s.liveNotes.suggestions.map(actionSpec);
      const spec = {
        id: noteId, title: s.title, startedAt: s.startedAt, minutes: Math.max(1, Math.round(s.elapsed / 60)), organizer: this.meeting.organizer, invited: this.meeting.guests,
        excerpt: this.script.summary ?? 'Notes from the call.', summary: this.script.summary, meetingId: this.meeting.id, decisions: decided, actions, suggestions,
        said: s.transcript.map((l) => ({ at: clockOf(l.at), who: l.speaker?.person, text: l.text }))
      };
      w.notes.unshift(writeNote({ ...spec, status: 'pending' }));
      w.writing = { id: noteId, seconds: 8, written: () => writeNote(spec) };
    }
    return noteId;
  }
  /**
   * You left, and the call goes on without you, as the server keeps it: where it had got to, for joining it again, and its
   * script's end, which can still come while you're on its page. `standIn`: whoever you left hosting in the organizer's place.
   */
  private goesOn(standIn: Person | null): void {
    const s = this.getSnapshot();
    const lk = this.livekit.getSnapshot();
    const call: GoingOn = {
      callId: this.ticket.callId, noteId: this.noteId, startedAt: s.startedAt, began: this.began, standIn, pass: this.ticket.pass,
      here: s.participants.filter((p) => !p.isMe).map((p) => ({ who: p.person, organizer: p.isOrganizer, guest: this.guests.has(p.id), mic: lk.people[p.id]?.mic ?? true })),
      heard: [...this.heard], transcript: s.transcript, capture: s.capture, notes: s.notes
    };
    const w = current();
    const end = (this.script.cues ?? []).find((c) => c.beat.do === 'end' && c.at * 1000 >= Date.now() - this.began);
    const ends = end ? setTimeout(() => {
      if (current() !== w || goingOnIn(w).get(this.meeting.code)?.call !== call) return;
      goingOnIn(w).delete(this.meeting.code);
      this.endsWith({ ...s, elapsed: Math.round((Date.now() - Date.parse(s.startedAt)) / 1000) });
    }, end.at * 1000 - (Date.now() - this.began)) : null;
    goingOnIn(w).set(this.meeting.code, { call, ends });
  }
  lock(on: boolean): Promise<void> {
    this.change((s) => ({ ...s, locked: on }));
    linkState(this.meeting.code, (l) => ({ hostHere: true, standIn: null, capture: null, ended: false, ...l, locked: on }));
    return Promise.resolve();
  }
  /** Whoever hosts ends the call for everyone and its note starts being written; anyone else just leaves, and it goes on. */
  leave(): Promise<CallEndResult | null> {
    const s = this.getSnapshot();
    if (s.isHost) this.push({ ...s, phase: 'ended' });
    this.close();
    if (!s.isHost) { this.goesOn(null); return Promise.resolve(null); }
    const noteId = this.endsWith(s);
    return Promise.resolve({ meetingId: this.meeting.id, pendingNoteId: noteId, duration: s.elapsed });
  }
  /** Whoever hosts leaves it to someone invited, who hosts until the organizer is back, and it goes on. */
  handOff(to: string): Promise<void> {
    const person = this.getSnapshot().participants.find((p) => p.id === to)?.person ?? null;
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: person }));
    this.close();
    this.goesOn(person);
    return Promise.resolve();
  }
}
