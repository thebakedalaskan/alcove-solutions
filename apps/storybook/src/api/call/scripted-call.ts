/*
 * A call, played from its script (script.ts). LiveKit can't run in Storybook, so this is the server's side of the
 * script: who's in the call, what it captures, the transcript and the live notes, who's asking to join and who's being
 * rung, breakout rooms, and who hosts. LiveKit's side (everyone else's microphones, who's speaking, what they share and
 * your own connection) is `livekit`, which the scripted room (src/media/livekit.ts) plays to the call screen. Every control
 * does to the snapshot what the server would; leaving ends the call for whoever hosts and leaves its note being written.
 * The call's workspace is played here too, and so is a board in the call.
 *
 * Each of those is a file of its own, which adds it to the call (base.ts says how they stack). Here is the call as it
 * starts, the clock, and the script's beats, each played by the part it's about.
 */
import { withReaction, type CallChatMention, type CallMoveOut, type CallParticipant, type CallRole, type CallSession, type Meeting, type MoveMedia, type Person } from '@alcove/api';
import { talking } from '../../browser';
import { current, me as you, nextId } from '../state';
import { NUDGE_WINDOW, ranOut } from './attention';
import { firstOf, identity } from './base';
import { goingOnIn, type GoingOn } from './going-on';
import { CallWithHosting } from './hosting';
import { MoveOut } from './move-out';
import { captureOf, defaultScript, linkState, scriptFor, type Beat, type Present } from './script';

/** The longest a call runs: it ends by itself then, everyone told 5 minutes before (docs: Plans and usage). */
const LONGEST_CALL_MS = 10 * 3_600_000;

/** How you came to the call: what the call says you are, and whether you ask to be let in first. */
export interface Arrival { role: CallRole; asking: boolean; name?: string | undefined }

export class ScriptedCall extends CallWithHosting implements CallSession {
  /** `back`: a call you left that went on, which joining again picks up where it's got to (`GoingOn`). */
  constructor(meeting: Meeting, arrival: Arrival, back: GoingOn | null = null) {
    const script = scriptFor(meeting.code) ?? defaultScript(meeting);
    const callId = back?.callId ?? script.notificationId ?? `${nextId('call')}-${crypto.randomUUID()}`;
    const noteId = back?.noteId ?? nextId('note');
    const since = back ? Math.max(0, Math.round((Date.now() - Date.parse(back.startedAt)) / 1000)) : script.since ?? 0;
    const startedAt = back?.startedAt ?? new Date(Date.now() - since * 1000).toISOString();
    const organizes = arrival.role === 'host';
    const person: Person = arrival.name ? { id: `guest-${callId}`, name: arrival.name, email: '' } : you();
    // Every connection is new, as LiveKit's are: coming back is another, in the same seat.
    const me: CallParticipant = { id: identity(`me${callId}${back ? nextId('back') : ''}`), seat: 'seat-me', person, isMe: true, isOrganizer: organizes, hand: false, status: null, othersPoint: true };
    const mode = script.notes ?? meeting.notes;
    super({
      revision: 0, timer: script.timer ? { ...script.timer, startedAt: script.timer.status === 'running' ? Date.now() : null } : null, attention: { place: 'main', hands: [], questions: [], nudges: [], cues: [], latest: 0, serverNow: new Date().toISOString() },
      callId, meetingId: meeting.id, code: meeting.code, title: meeting.title, startedAt, elapsed: since, endsAt: new Date(Date.parse(startedAt) + LONGEST_CALL_MS).toISOString(), phase: 'in-call', participants: organizes ? [me] : [], locked: false, pointing: true,
      spotlight: null, breakouts: { open: null, held: [] }, capture: back?.capture ?? captureOf(mode, mode === 'off' ? null : startedAt, meeting.organizer.name, script.model ?? null),
      notes: back?.notes ?? { everOn: mode !== 'off', noteId: mode !== 'off' ? noteId : null, segmentStartedAt: mode !== 'off' ? startedAt : null, recording: { segment: 0, pieces: 0, seconds: mode === 'on' ? since : 0 }, keepsRecording: meeting.choices.keepRecording }, waiting: [], ringing: [], leaving: [], chatRead: [],
      host: { id: organizes ? me.id : null, standIn: false, organizer: meeting.organizer, next: [] }, generation: 1, transcript: back?.transcript ?? [],
      liveNotes: { notes: null, added: [], suggestions: [], writing: false, error: null }, notices: !back && mode === 'on' && !since ? [{ id: nextId('notice'), text: 'Notes are on. Everyone here can see that.', kind: 'notes' }] : [],
      isOrganizer: organizes, isHost: organizes, role: arrival.role,
      workspace: { id: null, home: null, name: null, chosenBy: meeting.organizer, canOpen: false, role: null, everyone: false, documents: [], agenda: null, present: null, ended: null, play: null, asks: [], asked: 'no' },
      board: { open: null, timer: null, vote: null, ideas: [] }, shares: []
    }, {
      meeting, script, me, noteId, began: back?.began ?? Date.now(), asking: arrival.asking,
      ticket: { callId, serverUrl: 'wss://livekit.storybook.invalid', roomName: `room-${callId}`, identity: me.id, role: arrival.role, pass: `${callId}.storybook` }
    });
    for (const followUp of script.followUps ?? []) this.inferred.set(followUp.id, structuredClone(followUp));

    // Whoever's here already, the organizer first when it isn't you; coming back, whoever was still in it as you left.
    const here: Present[] = back ? [...back.here] : [...(script.here ?? [])];
    if (!back && !organizes && !here.some((p) => p.organizer)) here.unshift({ who: meeting.organizer, organizer: true });
    for (const p of here) this.join(p.who, { organizer: p.organizer, guest: p.guest, mic: p.mic, hand: p.hand, sharing: p.sharing, status: p.status });
    // Coming back, what's in the script from here on happens as it would have: what's past has happened.
    const gone = back ? Date.now() - back.began : 0;
    const later = (ms: number, step: () => void) => { if (ms >= gone) this.after(ms - gone, step); };
    for (const message of script.privateMessages ?? []) later((message.after ?? 2) * 1000, () => {
      const from = this.find(message.from);
      const parent = message.replyTo ? this.direct.getSnapshot().messages.find((m) => m.text === message.replyTo) : null;
      if (message.replyTo && !parent) return;
      const mentions = (message.tagged ?? []).flatMap((who): CallChatMention[] => {
        const target = who === 'me' ? this.me : this.find(who);
        if (!target) return [];
        const name = `@${target.person.name}`; const start = message.text.indexOf(name);
        return start < 0 ? [] : [{ identity: target.id, start, end: start + name.length }];
      });
      if (from) this.direct.receive(from.id, message.text, mentions, parent ? { root: parent.thread?.root ?? parent.id, replyTo: parent.id } : null);
    });
    // You come in after them, unless you organized it (or you're asking to be let in).
    if (!organizes && !arrival.asking) this.change((s) => ({ ...s, participants: [...s.participants, me] }));
    // What was said before you came, spread over the time the call has been going; coming back, what was said while you were in it.
    if (back) this.heard = [...back.heard];
    const earlier = back ? [] : script.earlier ?? [];
    earlier.forEach((l, i) => this.heardLine(l, Math.round(((i + 1) / (earlier.length + 1)) * since)));
    // Joining late, the call's notes have been written already.
    if (this.heard.length || script.followUps?.length) {
      this.notesFor = this.heard.length;
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes: this.notesNow(), suggestions: this.suggestionsNow(), writing: false, error: this.notesError() } }));
    }
    // The organizer back after someone hosted in their place hosts again at once, and hears who did.
    const stoodIn = back ? back.standIn : script.door?.standIn;
    if (organizes && stoodIn) this.change((s) => ({ ...s, notices: [...s.notices, { id: nextId('notice'), text: `You’re hosting again. ${firstOf(stoodIn)} hosted while you were away.`, kind: 'people' }] }));
    // Anyone else coming back finds whoever you left hosting in the organizer's place still hosting: only the organizer takes it back.
    const standing = !organizes && back?.standIn ? this.find(back.standIn) : undefined;
    if (standing) this.change((s) => ({ ...s, host: { ...s.host, id: standing.id, standIn: true } }));
    this.hosting();
    linkState(meeting.code, () => ({ hostHere: true, standIn: standing ? standing.person : null, locked: false, capture: this.getSnapshot().capture, ended: false }));
    talking(false);

    this.every(1000, () => this.tick());
    const talk = script.talk;
    if (talk) talk.lines.forEach((l, i) => later(((talk.from ?? 2) + i * (talk.every ?? 4.5)) * 1000, () => this.say(l)));
    for (const cue of script.cues ?? []) later(cue.at * 1000, () => this.play(cue.beat));
  }

  /* ---------- the script ---------- */

  private tick(): void {
    this.change((s) => ({
      ...s, attention: { ...s.attention, serverNow: new Date().toISOString(), nudges: s.attention.nudges.filter((n) => Date.parse(n.at) > Date.now() - NUDGE_WINDOW) },
      participants: s.participants.some((p) => ranOut(p.status)) ? s.participants.map((p) => (ranOut(p.status) ? { ...p, status: null } : p)) : s.participants, elapsed: s.elapsed + 1, workspace: s.workspace.play ? { ...s.workspace, play: { ...s.workspace.play, nowMs: Date.now() } } : s.workspace,
      notes: { ...s.notes, recording: s.capture.mode === 'on' ? { ...s.notes.recording, seconds: s.notes.recording.seconds + 1, pieces: Math.floor((s.notes.recording.seconds + 1) / 5) } : s.notes.recording }
    }));
    // The organizer's browser brings everyone back when the rooms' time is up; in the script, the organizer's isn't yours.
    const open = this.getSnapshot().breakouts.open;
    if (open && !this.getSnapshot().isHost && this.getSnapshot().elapsed >= open.until) this.closeRooms();
  }

  private play(b: Beat): void {
    switch (b.do) {
      case 'join': this.join(b.who, { guest: b.guest, mic: b.mic }); this.hosting(); return;
      case 'leave': this.goes(b.who); return;
      case 'say': this.say(b.line); return;
      case 'mic': this.them(b.who, (t) => ({ ...t, mic: b.on, speaking: b.on && t.speaking })); return;
      case 'hand': { const p = this.find(b.who); if (p) this.handFor(p, b.up); return; }
      case 'question': { const p = this.find(b.who); if (p) this.questionFor(p, b.text, b.votes ?? 0, nextId('question'), b.anonymous ?? false); return; }
      case 'question-vote': this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => (q.text === b.text && q.status === 'open' ? { ...q, votes: q.votes + b.votes } : q)) } })); return;
      case 'nudge': { const p = this.find(b.who); if (p) this.nudgeFrom(p, b.kind); return; }
      case 'status': { const p = this.find(b.who); if (p) this.statusFor(p, b.status, b.minutes); return; }
      case 'share': this.them(b.who, (t) => ({ ...t, screen: b.screen })); return;
      case 'stop-sharing': this.them(b.who, (t) => ({ ...t, screen: null })); return;
      case 'unavailable-chat': this.crypto.update((c) => ({ ...c, chat: c.chat.filter((m) => m.text !== b.text) })); return;
      case 'chat':
      case 'reply': {
        const p = this.find(b.who);
        const parent = b.do === 'reply' ? this.crypto.getSnapshot().chat.findLast((m) => m.text === b.to && m.place === this.crypto.getSnapshot().place) : null;
        if (b.do === 'reply' && !parent) return;
        const thread = parent ? { root: parent.thread?.root ?? parent.id, replyTo: parent.id } : null;
        const mentions = b.tagged.flatMap((who): CallChatMention[] => {
          const target = who === 'me' ? this.me : this.find(who);
          if (!target || !this.crypto.getSnapshot().members.includes(target.id)) return [];
          const name = `@${target.person.name}`;
          const start = b.text.indexOf(name);
          return start < 0 ? [] : [{ identity: target.id, start, end: start + name.length }];
        });
        const broadcast = b.do === 'reply' && thread !== null && (b.broadcast ?? false);
        if (p) this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: p.id, isMe: false, text: b.text, mentions, thread, broadcast, at: this.getSnapshot().elapsed, place: c.place, sending: false, failed: false, reactions: [] }] }));
        return;
      }
      case 'react': {
        const p = this.find(b.who);
        const message = this.crypto.getSnapshot().chat.findLast((m) => m.text === b.text);
        if (p && message) this.crypto.update((c) => ({ ...c, chat: withReaction(c.chat, message.id, message.place, b.reaction, p.id, true) }));
        return;
      }
      case 'react-privately': { const p = this.find(b.who); if (p) this.direct.receiveReaction(p.id, b.text, b.reaction); return; }
      case 'knock': {
        const person: Person = b.byName ? { id: `guest-${b.who.name}`, name: firstOf(b.who), email: '' } : b.who;
        this.change((s) => ({ ...s, waiting: [...s.waiting, { id: identity(`ask${person.name}${this.ticket.callId}`), person }] }));
        if (this.getSnapshot().isHost) this.cue('admission');
        return;
      }
      case 'ask-for-notes': {
        const p = this.find(b.who);
        if (p) this.change((s) => ({ ...s, capture: { ...s.capture, requests: [...s.capture.requests, { id: nextId('ask'), participantId: p.id, at: new Date().toISOString() }] } }));
        return;
      }
      case 'notes': this.capture(b.mode); return;
      case 'notes-running-out': {
        // Only the organizer is told their notes are running out.
        if (this.getSnapshot().isOrganizer) this.change((s) => ({ ...s, capture: { ...s.capture, runningOut: { at: new Date().toISOString() } } }));
        return;
      }
      case 'notes-stop': this.capture('off', b.reason); return;
      case 'host-cant-hear': this.cantHear(b.records); return;
      case 'not-now': this.change((s) => ({ ...s, capture: { ...s.capture, requests: s.capture.requests.filter((r) => r.participantId !== this.me.id), asked: s.capture.asked ? { state: 'declined', at: new Date().toISOString() } : null } })); return;
      case 'rooms': this.opensRooms(b.rooms, b.minutes, b.board); return;
      case 'message-rooms': this.messageRooms(b.text); return;
      case 'close-rooms': this.closeRooms(); return;
      case 'let-in': this.letMeIn(); return;
      case 'turn-away': this.crypto.update((c) => ({ ...c, status: 'denied' })); return;
      case 'mute-you': this.livekit.update((r) => ({ ...r, mutedYou: r.mutedYou + 1 })); return;
      case 'remove-you': this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'removed' })); this.halt(); return;
      case 'end': this.ends(); return;
      case 'reconnect':
        this.livekit.update((r) => ({ ...r, connection: 'reconnecting' }));
        this.after(b.seconds * 1000, () => this.livekit.update((r) => ({ ...r, connection: 'connected' })));
        return;
      case 'drop': this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'error' })); return;
      case 'host-drops': this.hostDrops(); return;
      case 'host-back': this.hostBack(); return;
      case 'goes-to': {
        const p = this.find(b.who);
        if (p) { this.where.set(p.id, { document: b.document, typing: b.typing ?? false, page: b.page ?? null }); this.sayWhere(); }
        return;
      }
      case 'present': {
        // The board open in the main room, from a frame.
        const p = this.find(b.who);
        const open = this.boards.get('main')?.at;
        if (p && open) this.startsHere('main', { kind: 'board', by: this.seatOf(p), key: nextId('present'), id: open.documentId, section: b.section ?? 0 });
        this.showBoard();
        return;
      }
      case 'present-workspace': {
        // Whoever presents the workspace has opened it, so the home is settled by then.
        this.settleHome();
        const p = this.find(b.who);
        if (p) this.startsHere('main', { kind: 'workspace', by: this.seatOf(p), key: nextId('present') });
        this.showBoard();
        return;
      }
      case 'move-presenting': {
        const now = this.presented.get('main');
        if (now?.kind === 'board') { this.presented.set('main', { ...now, section: b.section }); this.showBoard(); }
        return;
      }
      case 'stop-presenting': {
        // Whoever's presenting stops it.
        const now = this.presented.get('main');
        this.endsHere('main', b.close ?? false, now ? this.presenterOf(now) : undefined);
        return;
      }
      case 'close-presenting': this.endsHere('main', true, this.getSnapshot().participants.find((p) => p.isOrganizer)); return;
      case 'trash-board': this.boardToTrash(b.folder ?? false); return;
      case 'delete-board-workspace': this.boardWorkspaceGoes(); return;
      case 'reload': this.reloads(b.who, b.seconds); return;
      case 'move-to-room': this.movesToRoom(b.who, b.room); return;
      case 'stop-share': this.theyStopShare(b.who); return;
      case 'play': this.theyPlay(b.who, b.document, b.media); return;
      case 'stop-playing': this.space((w) => ({ ...w, play: null })); return;
      case 'tag-you': this.tagsYou(b.who, b.document, b.block ?? null); return;
      case 'open-board': this.theyOpenBoard(b.who, b.template, b.closedToYou ?? false, b.draw, b.standing); return;
      case 'add-sticky': this.theyAddSticky(b.who, b.frame, b.text); return;
      case 'close-board': {
        // Whoever opened the board where you are closes it, as the server lets them.
        const opened = this.boards.get(this.shownAt(this.crypto.getSnapshot().place));
        this.boardGoes(this.getSnapshot().participants.find((p) => p.id === opened?.openedBy));
        return;
      }
      case 'start-vote': this.theyStartVote(b.who, b.frame, b.per); return;
      case 'end-vote': this.voteEnds(b.votes, b.voters); return;
      case 'clear-vote': void this.session((x) => ({ ...x, vote: null })); return;
      case 'data': {
        const from = this.find(b.who)?.id;
        if (from) for (const take of this.dataTakers) take(b.topic, b.payload, from);
        return;
      }
      case 'heard': this.theyAreHeard(b.ideas); return;
      case 'run': b.what(); return;
    }
  }

  /* ---------- the session ---------- */

  room(): Promise<{ serverUrl: string; roomName: string; identity: string; token: string }> {
    return Promise.resolve({ serverUrl: this.ticket.serverUrl, roomName: this.ticket.roomName, identity: this.ticket.identity, token: 'storybook' });
  }
  refresh(): Promise<void> { return Promise.resolve(); }
  letOthersPoint(on: boolean): Promise<void> { this.change((s) => ({ ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, othersPoint: on } : p)) })); return Promise.resolve(); }
  setPointing(on: boolean): Promise<void> { this.change((s) => ({ ...s, pointing: on })); return Promise.resolve(); }
  setSpotlight(participantId: string | null): void { this.change((s) => ({ ...s, spotlight: participantId })); }
  dismissNotice(id: string): void { this.change((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) })); }
  startMove(_media: MoveMedia): Promise<CallMoveOut> { return Promise.resolve(new MoveOut()); }
}

/**
 * The CallSession the stand-in's `calls.join` hands back: you, as the world and the call's invite have you. A call you left
 * that's still going is picked up where it's got to, and the pass you left with (`previous`) lets you straight back in.
 */
export function joinCall(m: Meeting, opts: { name?: string | undefined; previous?: string | undefined }): ScriptedCall {
  const w = current();
  const signedIn = w.session !== null;
  const organizes = signedIn && m.organizer.email === you().email;
  const invited = organizes || (signedIn && m.guests.some((g) => g.email === you().email));
  const kept = goingOnIn(w).get(m.code);
  if (kept?.ends) clearTimeout(kept.ends);
  goingOnIn(w).delete(m.code);
  const back = kept?.call ?? null;
  const known = back !== null && opts.previous === back.pass;
  return new ScriptedCall(m, { role: organizes ? 'host' : invited ? 'invited' : 'guest', asking: !invited && !known, ...(signedIn ? {} : { name: opts.name?.trim() || 'Guest' }) }, back);
}
