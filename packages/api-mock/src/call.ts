import type { CallEndResult, CallParticipant, CallSession, CallState, Meeting, NotesAudience, NotesKeep, NotesMode, Person } from '@alcove/api';
import { CALL_SCRIPT, LIVE_ITEMS, PEOPLE, SCREEN_LINES } from './fixtures';
import { Store, uid } from './emitter';
import { firstName } from '@alcove/api';

const TICK = 1000;
const LINE_EVERY = 2700;
const SPEAK_EVERY = 3100;

export interface CallOptions {
  meeting: Meeting;
  me: Person;
  isGuest: boolean;
  mic: boolean;
  cam: boolean;
  notes: NotesMode;
  audience: NotesAudience;
  instant: boolean;
  onLeave: (s: CallState) => Promise<CallEndResult>;
}

const part = (person: Person, o: Partial<CallParticipant> = {}): CallParticipant => ({
  id: person.id, person, isMe: false, isHost: false, isGuest: false, mic: true, cam: !!person.portrait?.room, hand: false, speaking: false, ...o
});

export class MockCallSession extends Store<CallState> implements CallSession {
  private timers: ReturnType<typeof setInterval>[] = [];
  private scriptAt = 0;
  private screenAt = 0;
  private lastWasScreen = false;
  private others: CallParticipant[];

  constructor(private o: CallOptions) {
    const me = part(o.me, { isMe: true, isHost: o.meeting.isHost && !o.isGuest, isGuest: o.isGuest, mic: o.mic, cam: o.cam });
    const others = o.meeting.guests.flatMap((g) => (g.person ? [g.person] : []))
      .filter((p) => p.id !== o.me.id)
      .concat(o.meeting.isHost ? [] : [o.meeting.host])
      .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
      .slice(0, 5)
      .map((p) => part(p, { isHost: !o.meeting.isHost && p.id === o.meeting.host.id, mic: p.id !== PEOPLE.jon.id }));
    const fallback = [PEOPLE.ben, PEOPLE.priya, PEOPLE.jon].map((p) => part(p, { mic: p.id !== PEOPLE.jon.id }));
    const on = o.notes !== 'off';
    super({
      callId: uid('call'), code: o.meeting.code, title: o.meeting.title, elapsed: 0, phase: 'in-call',
      participants: o.instant ? [me] : [me, ...(others.length ? others : fallback)],
      sharing: null,
      notes: { status: on ? 'on' : 'off', mode: o.notes === 'off' ? 'full' : o.notes, audience: o.audience, everOn: on },
      transcript: [], live: { summary: null, decisions: [], actions: [] },
      chat: o.instant ? [] : [
        { id: uid('c'), from: PEOPLE.priya, isMe: false, text: 'Deck is attached to the invite if anyone needs it.', at: 0 },
        { id: uid('c'), from: PEOPLE.ben, isMe: false, text: 'Thanks. Can everyone hear me ok?', at: 0 }
      ],
      notices: on ? [{ id: uid('n'), kind: 'notes', text: me.isHost ? 'You started notes. Everyone in the call can see they’re on.' : `${o.meeting.host.name.split(' ')[0]} turned on notes for this call. Everyone gets a copy.` }] : [],
      canControlNotes: me.isHost
    });
    this.others = others.length ? others : fallback;
    this.timers.push(setInterval(() => this.set((s) => ({ elapsed: s.elapsed + 1 })), TICK));
    this.timers.push(setInterval(() => this.rotateSpeaker(), SPEAK_EVERY));
    this.timers.push(setInterval(() => this.feed(), LINE_EVERY));
    if (o.instant) {
      setTimeout(() => {
        if (this.state.phase !== 'in-call') return;
        this.set((s) => ({
          participants: [...s.participants, ...this.others.slice(0, 3)],
          notices: [...s.notices, { id: uid('n'), kind: 'people', text: `${this.others.slice(0, 3).map((p) => p.person.name.split(' ')[0]).join(', ')} joined` }]
        }));
      }, 7000);
    }
  }

  private me(): CallParticipant {
    const me = this.state.participants.find((p) => p.isMe);
    if (!me) throw new Error('Call state lost its own participant');
    return me;
  }
  private patchMe(p: Partial<CallParticipant>) {
    this.set((s) => ({ participants: s.participants.map((x) => (x.isMe ? { ...x, ...p } : x)) }));
  }
  private notice(text: string, kind: 'notes' | 'people' | 'info' = 'notes') {
    const id = uid('n');
    this.set((s) => ({ notices: [...s.notices.slice(-2), { id, text, kind }] }));
    setTimeout(() => this.dismissNotice(id), 5000);
  }

  private rotateSpeaker() {
    const pool = this.state.participants.filter((p) => p.mic && (!p.isMe || Math.random() < 0.3));
    if (this.state.participants.length < 2 || !pool.length) return;
    const cur = this.state.participants.find((p) => p.speaking);
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (next && cur && next.id === cur.id && pool.length > 1) next = pool[(pool.indexOf(next) + 1) % pool.length];
    if (!next) return;
    const speaker = next;
    this.set((s) => ({ participants: s.participants.map((p) => ({ ...p, speaking: p.id === speaker.id })) }));
  }

  private feed() {
    const s = this.state;
    if (s.notes.status !== 'on' || s.participants.length < 2) return;
    const sc = s.sharing && !this.lastWasScreen ? SCREEN_LINES[this.screenAt] : undefined;
    if (sc) {
      this.screenAt++;
      this.lastWasScreen = true;
      this.set({ transcript: [...s.transcript, { id: uid('l'), kind: 'screen', at: s.elapsed, by: firstName(this.me().person.name), title: sc.title, text: sc.text }] });
      return;
    }
    this.lastWasScreen = false;
    const step = CALL_SCRIPT[this.scriptAt % CALL_SCRIPT.length];
    this.scriptAt++;
    if (!step) return;
    const who = step.who === 'maya' ? this.me().person : PEOPLE[step.who];
    const live = { ...s.live };
    if (step.tag === 'dec' && !live.decisions.includes(LIVE_ITEMS.dec)) live.decisions = [...live.decisions, LIVE_ITEMS.dec];
    if (step.tag === 'act0' || step.tag === 'act1' || step.tag === 'act2') {
      const text = LIVE_ITEMS[step.tag];
      if (!live.actions.some((a) => a.text === text)) live.actions = [...live.actions, { id: uid('a'), text }];
    }
    const transcript = [...s.transcript, { id: uid('l'), kind: 'speech' as const, at: s.elapsed, speaker: { name: who.name, person: who }, text: step.text }];
    if (transcript.length >= 3) live.summary = 'Harbor signed the data agreement. The open question was where pilot data lives; the team agreed it stays in Harbor’s region.';
    this.set({ transcript, live });
  }

  setMic = (on: boolean) => this.patchMe({ mic: on, speaking: on ? this.me().speaking : false });
  setCam = (on: boolean) => this.patchMe({ cam: on });
  setHand = (up: boolean) => this.patchMe({ hand: up });
  setSharing = (on: boolean) => {
    this.set({ sharing: on ? { by: this.me().id, title: 'Pilot timeline' } : null });
    if (on && this.state.notes.status === 'on') this.notice('Notes will include what’s on your screen', 'info');
  };
  sendChat = (text: string) => {
    const t = text.trim(); if (!t) return;
    this.set((s) => ({ chat: [...s.chat, { id: uid('c'), from: this.me().person, isMe: true, text: t, at: s.elapsed }] }));
    if (this.state.participants.length > 1) {
      setTimeout(() => this.set((s) => ({ chat: [...s.chat, { id: uid('c'), from: PEOPLE.priya, isMe: false, text: 'Got it, thanks.', at: s.elapsed }] })), 2400);
    }
  };
  startNotes = (mode: NotesKeep) => {
    this.set((s) => ({ notes: { ...s.notes, status: 'on', mode, everOn: true } }));
    this.notice('You started notes. Everyone in the call can see they’re on.');
  };
  pauseNotes = () => { this.set((s) => ({ notes: { ...s.notes, status: 'paused' } })); this.notice('Notes paused. Nothing is transcribed until someone resumes.'); };
  resumeNotes = () => { this.set((s) => ({ notes: { ...s.notes, status: 'on' } })); this.notice('Notes resumed.'); };
  stopNotes = () => { this.set((s) => ({ notes: { ...s.notes, status: 'off' } })); this.notice('Notes stopped. What was captured so far is kept.'); };
  invite = async (email: string) => { this.notice(`Invite sent to ${email}`, 'people'); };
  dismissNotice = (id: string) => this.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  leave = async (): Promise<CallEndResult> => {
    this.timers.forEach(clearInterval);
    this.set({ phase: 'ended' });
    return this.o.onLeave(this.state);
  };
}
