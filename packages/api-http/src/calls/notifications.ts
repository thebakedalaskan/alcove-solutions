import {
  CallNotificationSchema, notesAreOn, type CallCrypto, type CallNotification, type CallNotificationCategory,
  type CallNotificationState, type CallNotificationTarget, type CallState, type DirectMessagesState, type LiveStore, type NotificationPrefs
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
  private messageScope = '';
  private baseline = false;
  private observed = new Map<string, number>();
  private freshChat = new Set<string>();
  private freshPrivate = new Set<string>();
  private privateAuthorized = false;
  private signature = '';
  private commit(state: CallNotificationState): void {
    const signature = JSON.stringify(state);
    if (signature === this.signature) return;
    this.signature = signature;
    this.set(Object.freeze({ ready: state.ready, candidates: Object.freeze([...state.candidates]) }));
  }
  constructor(private readonly identity: string, private readonly call: LiveStore<CallState>, private readonly crypto: LiveStore<CallCrypto>, private readonly direct: LiveStore<DirectMessagesState>) {
    super(EMPTY);
    const changed = () => this.project();
    this.stops = [call.subscribe(changed), crypto.subscribe(changed), direct.subscribe(changed)];
  }
  /** A successful current call/MLS round trip, never a stale UI render, restores eligibility. */
  resume(): void {
    if (this.closed) return;
    const state = this.call.getSnapshot();
    const crypt = this.crypto.getSnapshot();
    this.authorized = { generation: state.generation, place: crypt.place };
    const direct = this.direct.getSnapshot();
    if (!this.privateAuthorized && direct.ready) {
      for (const message of direct.messages) if (message.to === this.identity && message.place === crypt.place && message.generation === state.generation) this.observed.set(`private:${message.id}`, Date.parse(state.startedAt) + message.at * 1000);
      this.privateAuthorized = true;
    }
    this.project();
  }
  suspend(): void { this.authorized = null; this.privateAuthorized = false; this.baseline = false; this.observed.clear(); this.freshChat.clear(); this.freshPrivate.clear(); if (!this.closed) this.commit(EMPTY); }
  private project(): void {
    if (this.closed) return;
    const state = this.call.getSnapshot();
    const crypt = this.crypto.getSnapshot();
    const scope = this.authorized;
    if (!scope || state.phase !== 'in-call' || crypt.status !== 'in' || !crypt.members.includes(this.identity)
      || scope.generation !== state.generation || scope.place !== crypt.place || state.attention.place !== crypt.place) { this.baseline = false; this.freshChat.clear(); this.freshPrivate.clear(); this.commit(EMPTY); return; }
    const now = Date.parse(state.startedAt) + state.elapsed * 1000;
    const messageScope = `${state.generation}:${crypt.place}`;
    if (this.messageScope !== messageScope) {
      this.messageScope = messageScope; this.baseline = false; this.observed.clear(); this.freshChat.clear(); this.freshPrivate.clear();
    }
    const following = new Set(crypt.chat.filter((message) => message.from === this.identity && !message.sending && !message.failed && message.place === crypt.place).map((message) => message.thread?.root ?? message.id));
    const direct = this.direct.getSnapshot();
    const unreadPrivate = new Set(direct.unread);
    const privatePeers = new Set(direct.peers);
    if (!direct.ready) { this.privateAuthorized = false; this.freshPrivate.clear(); }
    // Observe every confirmed incoming ID before relevance/preferences can change. Joining a thread cannot create a fresh reply.
    for (const message of crypt.chat) if (!message.sending && !message.failed && !message.isMe && message.place === crypt.place) {
      const id = `room:${message.id}`;
      if (!this.observed.has(id)) {
        const at = Date.parse(state.startedAt) + message.at * 1000;
        this.observed.set(id, at);
        if (this.baseline && now - at <= FRESH_MS && crypt.members.includes(message.from)
          && (message.mentions.some((mention) => mention.identity === this.identity) || (message.thread !== null && following.has(message.thread.root)))) this.freshChat.add(message.id);
      }
    }
    if (direct.ready) for (const message of direct.messages) if (message.to === this.identity && message.from !== this.identity && message.place === crypt.place && message.generation === state.generation) {
      const id = `private:${message.id}`;
      if (!this.observed.has(id)) {
        const at = Date.parse(state.startedAt) + message.at * 1000;
        this.observed.set(id, at);
        if (this.baseline && this.privateAuthorized && now - at <= FRESH_MS && unreadPrivate.has(message.id) && privatePeers.has(message.from)) this.freshPrivate.add(message.id);
      }
    }
    this.baseline = true;
    for (const [id, at] of this.observed) if (now - at > FRESH_MS) { this.observed.delete(id); if (id.startsWith('room:')) this.freshChat.delete(id.slice(5)); else this.freshPrivate.delete(id.slice(8)); }
    const candidates: CallNotification[] = [];
    const put = (category: CallNotificationCategory, target: CallNotificationTarget, id: string, raisedAt: number, expiresAt = raisedAt + FRESH_MS, fresh = true) => {
      const eventId = `${state.callId}:${state.generation}:${crypt.place}:${id}`;
      if (raisedAt > now + 1000) return;
      candidates.push(CallNotificationSchema.parse({ fresh, category, raisedAt, expiresAt, destination: {
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
    if (direct.ready) for (const message of direct.messages) {
      if (message.to !== this.identity || message.from === this.identity || message.place !== crypt.place || message.generation !== state.generation
        || !unreadPrivate.has(message.id) || !privatePeers.has(message.from)) { this.freshPrivate.delete(message.id); continue; }
      put('privateMessages', { type: 'private', peer: message.from, message: message.id, root: message.thread?.root ?? null }, `private:${message.id}`, Date.parse(state.startedAt) + message.at * 1000, Date.parse(state.startedAt) + message.at * 1000 + FRESH_MS, this.freshPrivate.has(message.id));
    }
    const unread = new Set(state.chatRead);
    for (const message of crypt.chat) {
      if (message.sending || message.failed || message.isMe || message.place !== crypt.place || unread.has(message.id) || !crypt.members.includes(message.from)) { this.freshChat.delete(message.id); continue; }
      if (message.mentions.some((mention) => mention.identity === this.identity)) {
        put('chatMentions', { type: 'chat', message: message.id, root: message.thread?.root ?? null }, `chat:${message.id}`, Date.parse(state.startedAt) + message.at * 1000, Date.parse(state.startedAt) + message.at * 1000 + FRESH_MS, this.freshChat.has(message.id));
      } else if (message.thread && following.has(message.thread.root)) {
        put('replies', { type: 'thread', root: message.thread.root, message: message.id }, `chat:${message.id}`, Date.parse(state.startedAt) + message.at * 1000, Date.parse(state.startedAt) + message.at * 1000 + FRESH_MS, this.freshChat.has(message.id));
      }
    }
    const timer = state.timer;
    if (timer?.status === 'running' && timer.startedAt !== null) {
      const deadline = timer.startedAt + timer.durationSeconds * 1000 - timer.elapsedMs;
      const stage = now >= deadline ? 'end' : 'warning';
      const at = stage === 'end' ? deadline : deadline - 30_000;
      put('timers', { type: 'timer', id: `${timer.id}:${timer.revision}` }, `timer:${timer.id}:${timer.revision}:${stage}`, Math.max(0, at), deadline + (stage === 'end' ? 30_000 : 0));
    }
    const waitingKeys = new Set(state.waiting.map((asker) => `admission:${asker.id}`));
    for (const key of this.firstSeen.keys()) if (!waitingKeys.has(key)) this.firstSeen.delete(key);
    this.commit({ ready: true, candidates });
  }
  eligible(prefs: NotificationPrefs): readonly CallNotification[] {
    const snapshot = this.getSnapshot();
    return snapshot.ready && prefs.enabled ? snapshot.candidates.filter((candidate) => candidate.fresh && candidate.expiresAt > Date.now() && prefs[candidate.category]) : [];
  }
  close(): void {
    this.closed = true;
    for (const stop of this.stops) stop();
    this.stops = []; this.firstSeen.clear(); this.authorized = null; this.observed.clear(); this.freshChat.clear(); this.freshPrivate.clear(); this.commit(EMPTY);
  }
}
