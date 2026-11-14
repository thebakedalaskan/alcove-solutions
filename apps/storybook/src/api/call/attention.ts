/* Hands, questions, nudges and statuses, the sounds they make (cues), and the call's one timer, as the server keeps them. */
import { AlcoveApiError, CALL_TIMER_MAX_SECONDS, CallTimerControlSchema, type CallAttention, type CallNudgeKind, type CallParticipant, type CallQuestionStatus, type CallStatusKind, type CallStatusMinutes, type CallTimer, type CallTimerControl } from '@alcove/api';
import { nextId } from '../state';
import { CallBase } from './base';

/** The call's timer after one of the host's controls, as the API works it out (features/calls/timers/timers.ts), or why not. */
function timerAfter(was: CallTimer | null, input: CallTimerControl, now: number): CallTimer | null {
  if (input.action === 'start') {
    if (was) throw new AlcoveApiError('conflict', 'A timer is running already. Stop it to start another.');
    return { id: nextId('timer'), revision: 0, durationSeconds: input.durationSeconds, status: 'running', elapsedMs: 0, startedAt: now };
  }
  if (!was || was.revision !== input.expectedRevision) throw new AlcoveApiError('conflict', 'The timer has changed. Look at it again and try once more.');
  const elapsedMs = was.elapsedMs + (was.startedAt === null ? 0 : Math.max(0, now - was.startedAt));
  const changed = { ...was, revision: was.revision + 1 };
  if (input.action === 'stop') return null;
  if (input.action === 'pause' && was.status === 'running') return { ...changed, status: 'paused', elapsedMs, startedAt: null };
  if (input.action === 'resume' && was.status === 'paused') return { ...changed, status: 'running', startedAt: now };
  if (input.action === 'add-time') {
    const durationSeconds = Math.max(was.durationSeconds, Math.floor(elapsedMs / 1000)) + input.seconds;
    if (durationSeconds > CALL_TIMER_MAX_SECONDS) throw new AlcoveApiError('conflict', 'A timer runs for a day at most.');
    return { ...changed, durationSeconds };
  }
  throw new AlcoveApiError('conflict', 'That isn’t something the timer can do right now.');
}
/** Nudges of one kind within a minute of the first are one note, and a note stays a minute, as the server keeps them. */
export const NUDGE_WINDOW = 60_000;
/** A status whose time has run out. */
export const ranOut = (status: CallParticipant['status']) => status !== null && status.until !== null && Date.parse(status.until) <= Date.now();

export abstract class CallWithAttention extends CallBase {
  protected attentionRooms = new Map<string, CallAttention>();

  protected cue(kind: CallAttention['cues'][number]['kind']): void {
    this.change((s) => { const seq = s.attention.latest + 1; return { ...s, attention: { ...s.attention, latest: seq, cues: [...s.attention.cues, { id: nextId('cue'), seq, kind, at: new Date().toISOString() }].slice(-64) } }; });
  }
  /** A hand goes with its seat, as the API's does: someone back on a new connection keeps their place, under that connection. */
  protected handFor(p: CallParticipant, up: boolean): void {
    this.change((s) => ({ ...s, participants: s.participants.map((x) => x.seat === p.seat ? { ...x, hand: up } : x), attention: { ...s.attention, hands: up ? s.attention.hands.some((h) => h.seat === p.seat) ? s.attention.hands.map((h) => (h.seat === p.seat ? { ...h, participantId: p.id } : h)) : [...s.attention.hands, { id: nextId('hand'), participantId: p.id, seat: p.seat, raisedAt: new Date().toISOString() }] : s.attention.hands.filter((h) => h.seat !== p.seat) } }));
    if (up) this.cue('hand');
  }
  /** The call's timer, as the API keeps it: only whoever hosts changes it, each change but a start against its revision. */
  controlTimer(input: CallTimerControl): Promise<void> {
    return Promise.resolve().then(() => {
      const parsed = CallTimerControlSchema.parse(input);
      const s = this.getSnapshot();
      if (!s.isHost) throw new AlcoveApiError('forbidden', 'Only the host can change the timer.');
      const timer = timerAfter(s.timer, parsed, Date.now());
      this.change((state) => ({ ...state, timer }));
    });
  }
  setHand(up: boolean): Promise<void> { this.handFor(this.me, up); return Promise.resolve(); }
  lowerHand(entryId: string): Promise<void> {
    const s = this.getSnapshot(); const h = s.attention.hands.find((h) => h.id === entryId);
    if (!h) return Promise.resolve();
    if (!s.isHost && h.seat !== this.me.seat) return Promise.reject(new AlcoveApiError('forbidden', 'Only the host can lower someone else’s hand.'));
    const p = s.participants.find((p) => p.seat === h.seat); if (p) this.handFor(p, false); return Promise.resolve();
  }
  /** As the server says it: an anonymous question names nobody, and only its asker is told it's theirs. */
  protected questionFor(p: CallParticipant, text: string, votes = 0, id = nextId('question'), anonymous = false): void {
    if (this.getSnapshot().attention.questions.some((q) => q.id === id)) return;
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: [...s.attention.questions, { id, author: anonymous ? null : p.person, text, createdAt: new Date().toISOString(), status: 'open', votes, voted: false, own: p.isMe, pinned: false }] } }));
    this.cue('question');
  }
  postQuestion(id: string, text: string, anonymous = false): Promise<void> { this.questionFor(this.me, text, 0, id, anonymous); return Promise.resolve(); }
  withdrawQuestion(id: string): Promise<void> {
    if (!this.getSnapshot().attention.questions.some((q) => q.id === id && q.own)) return Promise.reject(new AlcoveApiError('forbidden', 'Only whoever asked a question can take it back.'));
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.filter((q) => q.id !== id) } })); return Promise.resolve();
  }
  voteQuestion(id: string, on: boolean): Promise<void> {
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => q.id === id && q.status === 'open' ? { ...q, voted: on, votes: q.votes + (q.voted === on ? 0 : on ? 1 : -1) } : q) } })); return Promise.resolve();
  }
  resolveQuestion(id: string, status: CallQuestionStatus): Promise<void> {
    if (!this.getSnapshot().isHost) return Promise.reject(new AlcoveApiError('forbidden', 'Only the host can resolve questions.'));
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => q.id === id ? { ...q, status, pinned: false } : q) } })); return Promise.resolve();
  }
  pinQuestion(id: string | null): Promise<void> {
    if (!this.getSnapshot().isHost) return Promise.reject(new AlcoveApiError('forbidden', 'Only the host can pin questions.'));
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => ({ ...q, pinned: q.id === id && q.status === 'open' })) } })); return Promise.resolve();
  }
  /** Who sent each nudge note you got (by seat), and when its minute began: the same nudge again from them changes nothing. */
  private nudgeNotes = new Map<string, { first: number; from: string[] }>();
  /** Someone in the script nudges you: a note of its own, or one more on the same nudge's note within its minute. */
  protected nudgeFrom(p: CallParticipant, kind: CallNudgeKind): void {
    const now = Date.now();
    const open = this.getSnapshot().attention.nudges.find((n) => n.kind === kind && (this.nudgeNotes.get(n.id)?.first ?? 0) > now - NUDGE_WINDOW);
    const kept = open ? this.nudgeNotes.get(open.id) : undefined;
    if (open && kept) {
      if (kept.from.includes(p.seat)) return;
      kept.from.push(p.seat);
      this.change((s) => ({ ...s, attention: { ...s.attention, nudges: s.attention.nudges.map((n) => (n.id === open.id ? { ...n, count: kept.from.length, from: null, at: new Date(now).toISOString() } : n)) } }));
      return;
    }
    const id = nextId('nudge');
    this.nudgeNotes.set(id, { first: now, from: [p.seat] });
    this.change((s) => ({ ...s, attention: { ...s.attention, nudges: [...s.attention.nudges, { id, kind, count: 1, from: p.person, at: new Date(now).toISOString() }] } }));
  }
  /** Your nudge goes to someone in your room, and nobody else in the script hears of it. */
  nudge(to: string, _kind: CallNudgeKind): Promise<void> {
    if (to === this.me.id || !this.getSnapshot().participants.some((p) => p.id === to) || !this.crypto.getSnapshot().members.includes(to)) {
      return Promise.reject(new AlcoveApiError('conflict', 'They aren’t in this room any more.'));
    }
    return Promise.resolve();
  }
  /** Someone's status, as the server keeps it: a new time from now, or the time already set, or none. */
  protected statusFor(p: CallParticipant, kind: CallStatusKind | null, minutes?: CallStatusMinutes | undefined): void {
    const now = Date.now();
    this.change((s) => ({
      ...s, participants: s.participants.map((x) => {
        if (x.seat !== p.seat) return x;
        if (!kind) return { ...x, status: null };
        const was = x.status && !ranOut(x.status) ? x.status : null;
        const time = minutes !== undefined ? { since: new Date(now).toISOString(), until: new Date(now + minutes * 60_000).toISOString() } : was ? { since: was.since, until: was.until } : { since: new Date(now).toISOString(), until: null };
        return { ...x, status: { kind, ...time } };
      })
    }));
  }
  setStatus(status: CallStatusKind | null, minutes?: CallStatusMinutes | undefined): Promise<void> { this.statusFor(this.me, status, minutes); return Promise.resolve(); }
}
