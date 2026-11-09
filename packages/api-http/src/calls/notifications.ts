import {
  CallNotificationSchema, notesAreOn, type CallCrypto, type CallNotification, type CallNotificationCategory,
  type CallNotificationState, type CallNotificationTarget, type CallState, type LiveStore
} from '@alcove/api';
import { Box } from '../transport/live';

const EMPTY: CallNotificationState = { ready: false, candidates: [] };
const FRESH_MS = 120_000;
/** Owns only a projection and its subscriptions; original authorized snapshots retain every decision and receipt. */
export class CallNotifications extends Box<CallNotificationState> {
  private stops: (() => void)[];
  private closed = false;
  private authorized: { generation: number; place: string } | null = null;
  private firstSeen = new Map<string, number>();
  constructor(private readonly identity: string, private readonly call: LiveStore<CallState>, private readonly crypto: LiveStore<CallCrypto>) {
    super(EMPTY);
    const changed = () => this.project();
    this.stops = [call.subscribe(changed), crypto.subscribe(changed)];
  }
  /** A successful current call/MLS round trip, never a stale UI render, restores eligibility. */
  resume(): void {
    if (this.closed) return;
    const state = this.call.getSnapshot();
    const crypt = this.crypto.getSnapshot();
    this.authorized = { generation: state.generation, place: crypt.place };
    this.project();
  }
  suspend(): void { this.authorized = null; if (!this.closed) this.set(EMPTY); }
  private project(): void {
    if (this.closed) return;
    const state = this.call.getSnapshot();
    const crypt = this.crypto.getSnapshot();
    const scope = this.authorized;
    if (!scope || state.phase !== 'in-call' || crypt.status !== 'in' || !crypt.members.includes(this.identity)
      || scope.generation !== state.generation || scope.place !== crypt.place || state.attention.place !== crypt.place) { this.set(EMPTY); return; }
    const now = Date.parse(state.startedAt) + state.elapsed * 1000;
    const candidates: CallNotification[] = [];
    const put = (category: CallNotificationCategory, target: CallNotificationTarget, id: string, raisedAt: number, expiresAt = raisedAt + FRESH_MS) => {
      const eventId = `${state.callId}:${state.generation}:${crypt.place}:${id}`;
      if (raisedAt > now + 1000 || expiresAt <= now) return;
      candidates.push(CallNotificationSchema.parse({ category, raisedAt, expiresAt, destination: {
        eventId, callId: state.callId, connection: this.identity, generation: state.generation, place: crypt.place, target
      } }));
    };
    if (state.isHost) for (const asker of state.waiting) {
      const key = `admission:${asker.id}`;
      const at = this.firstSeen.get(key) ?? now;
      this.firstSeen.set(key, at);
      // An unresolved request is still actionable; it disappears as soon as the authoritative queue handles it.
      put('admissions', { type: 'admission', identity: asker.id }, key, at, at + 30 * 60_000);
    }
    for (const hand of state.attention.hands) if (hand.participantId !== this.identity) {
      put('hands', { type: 'attention', section: 'hands', id: hand.id }, `hand:${hand.id}`, Date.parse(hand.raisedAt));
    }
    for (const question of state.attention.questions) if (!question.own && question.status === 'open') {
      put('questions', { type: 'attention', section: 'questions', id: question.id }, `question:${question.id}`, Date.parse(question.createdAt));
    }
    if (state.isOrganizer && !notesAreOn(state.capture.mode)) for (const request of state.capture.requests) {
      put('notesRequested', { type: 'capture', id: request.id }, `notes-request:${request.id}`, Date.parse(request.at));
    }
    const unread = new Set(state.chatRead);
    for (const message of crypt.chat) if (!message.sending && !message.isMe && message.place === crypt.place && !unread.has(message.id) && message.mentions.some((m) => m.identity === this.identity)) {
      put('chatMentions', { type: 'chat', message: message.id, root: null }, `chat:${message.id}`, Date.parse(state.startedAt) + message.at * 1000);
    }
    const timer = state.timerSequence;
    const segment = timer?.segments[timer.activeIndex];
    if (timer?.status === 'running' && timer.startedAt !== null && segment) {
      const deadline = timer.startedAt + (segment.durationSeconds + timer.addedSeconds) * 1000 - timer.elapsedMs;
      const stage = now >= deadline ? 'end' : 'warning';
      const at = stage === 'end' ? deadline : deadline - 30_000;
      put('timers', { type: 'timer', timer: 'presenter', id: `${segment.id}:${timer.revision}` }, `timer:${segment.id}:${timer.revision}:${stage}`, Math.max(0, at), deadline + (stage === 'end' ? 30_000 : 0));
    }
    const board = state.board.timer;
    if (board) {
      const deadline = Date.parse(state.startedAt) + board.until * 1000;
      const stage = now >= deadline ? 'end' : 'warning';
      put('timers', { type: 'timer', timer: 'board', id: `${board.until}` }, `board-timer:${board.until}:${stage}`, Math.max(0, deadline - (stage === 'warning' ? 30_000 : 0)), deadline + (stage === 'end' ? 30_000 : 0));
    }
    const waitingKeys = new Set(state.waiting.map((asker) => `admission:${asker.id}`));
    for (const key of this.firstSeen.keys()) if (!waitingKeys.has(key)) this.firstSeen.delete(key);
    this.set({ ready: true, candidates });
  }
  close(): void {
    this.closed = true;
    for (const stop of this.stops) stop();
    this.stops = []; this.firstSeen.clear(); this.authorized = null; this.set(EMPTY);
  }
}
