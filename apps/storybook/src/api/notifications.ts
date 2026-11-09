/** The scripted call projects the same content-free destinations from its authorized stand-in snapshots. */
import { notesAreOn, type CallCrypto, type CallNotification, type CallNotificationCategory, type CallNotificationState, type CallNotificationTarget, type CallState, type DirectMessagesState, type LiveStore, type NotificationPrefs } from '@alcove/api';
import { Pushed } from './live';

export class ScriptedNotifications extends Pushed<CallNotificationState> {
  private stops: (() => void)[];
  private observed = new Set<string>();
  private fresh = new Set<string>();
  private first = new Map<string, number>();
  private scope = '';
  private started = false;
  private signature = '';
  constructor(private readonly identity: string, private readonly call: LiveStore<CallState>, private readonly crypto: LiveStore<CallCrypto>, private readonly direct: LiveStore<DirectMessagesState>) {
    super({ ready: false, candidates: [] });
    const project = () => this.project();
    this.stops = [call.subscribe(project), crypto.subscribe(project), direct.subscribe(project)];
    this.project();
  }
  private project(): void {
    const state = this.call.getSnapshot(), crypt = this.crypto.getSnapshot(), direct = this.direct.getSnapshot();
    const scope = `${state.generation}:${crypt.place}`;
    const ready = state.phase === 'in-call' && crypt.status === 'in' && crypt.members.includes(this.identity) && state.attention.place === crypt.place;
    if (scope !== this.scope || !ready) { this.scope = scope; this.started = false; this.observed.clear(); this.fresh.clear(); this.first.clear(); }
    const candidates: CallNotification[] = [];
    const now = Date.parse(state.startedAt) + state.elapsed * 1000;
    const roots = new Set(crypt.chat.filter((message) => message.isMe && !message.failed && !message.sending).map((message) => message.thread?.root ?? message.id));
    const put = (category: CallNotificationCategory, target: CallNotificationTarget, id: string, at: number, until = at + 120_000, fresh = true) => {
      if (at > now + 1000) return;
      candidates.push({ category, fresh, raisedAt: at, expiresAt: until, destination: { eventId: `${state.callId}:${state.generation}:${crypt.place}:${id}`, callId: state.callId, connection: this.identity, generation: state.generation, place: crypt.place, target } });
    };
    if (ready) {
      for (const message of crypt.chat) {
        if (message.isMe || message.failed || message.sending || message.place !== crypt.place) continue;
        const key = `chat:${message.id}`;
        const mentioned = message.mentions.some((mention) => mention.identity === this.identity);
        const reply = message.thread !== null && roots.has(message.thread.root);
        if (!this.observed.has(key)) { this.observed.add(key); if (this.started && (mentioned || reply)) this.fresh.add(key); }
        if (state.chatRead.includes(message.id) || !crypt.members.includes(message.from)) { this.fresh.delete(key); continue; }
        const at = Date.parse(state.startedAt) + message.at * 1000;
        if (mentioned) put('chatMentions', { type: 'chat', message: message.id, root: message.thread?.root ?? null }, key, at, at + 120_000, this.fresh.has(key));
        else if (message.thread && reply) put('replies', { type: 'thread', message: message.id, root: message.thread.root }, key, at, at + 120_000, this.fresh.has(key));
      }
      if (direct.ready) for (const message of direct.messages) {
        if (message.to !== this.identity || message.from === this.identity || message.place !== crypt.place || message.generation !== state.generation) continue;
        const key = `private:${message.id}`;
        if (!this.observed.has(key)) { this.observed.add(key); if (this.started) this.fresh.add(key); }
        if (!direct.unread.includes(message.id) || !direct.peers.includes(message.from)) { this.fresh.delete(key); continue; }
        const at = Date.parse(state.startedAt) + message.at * 1000;
        put('privateMessages', { type: 'private', peer: message.from, message: message.id, root: message.thread?.root ?? null }, key, at, at + 120_000, this.fresh.has(key));
      }
      for (const hand of state.attention.hands) if (hand.participantId !== this.identity) put('hands', { type: 'attention', section: 'hands', id: hand.id }, `hand:${hand.id}`, Date.parse(hand.raisedAt));
      for (const question of state.attention.questions) if (!question.own && question.status === 'open') put('questions', { type: 'attention', section: 'questions', id: question.id }, `question:${question.id}`, Date.parse(question.createdAt));
      if (state.isOrganizer && !notesAreOn(state.capture.mode)) for (const request of state.capture.requests) put('notesRequested', { type: 'capture', id: request.id }, `notes-request:${request.id}`, Date.parse(request.at));
      if (state.isHost) for (const asker of state.waiting) { const key = `admission:${asker.id}`; const at = this.first.get(key) ?? now; this.first.set(key, at); put('admissions', { type: 'admission', identity: asker.id }, key, at, at + 1_800_000); }
      const timer = state.timer;
      if (timer?.status === 'running' && timer.startedAt !== null) {
        const deadline = timer.startedAt + timer.durationSeconds * 1000 - timer.elapsedMs;
        const phase = now >= deadline ? 'end' : 'warning';
        put('timers', { type: 'timer', timer: 'call', id: `${timer.id}:${timer.revision}` }, `timer:${timer.id}:${timer.revision}:${phase}`, deadline - (phase === 'warning' ? 30_000 : 0), deadline + (phase === 'end' ? 30_000 : 0));
      }
      if (state.board.timer) { const deadline = Date.parse(state.startedAt) + state.board.timer.until * 1000; const phase = now >= deadline ? 'end' : 'warning'; put('timers', { type: 'timer', timer: 'board', id: `${state.board.timer.until}` }, `board-timer:${state.board.timer.until}:${phase}`, deadline - (phase === 'warning' ? 30_000 : 0), deadline + (phase === 'end' ? 30_000 : 0)); }
    }
    this.started = ready;
    const next = { ready, candidates };
    const signature = JSON.stringify(next);
    if (signature !== this.signature) { this.signature = signature; this.set(next); }
  }
  eligible(prefs: NotificationPrefs): readonly CallNotification[] { return this.getSnapshot().ready && prefs.enabled ? this.getSnapshot().candidates.filter((candidate) => candidate.fresh && candidate.expiresAt > Date.now() && prefs[candidate.category]) : []; }
  override close(): void { for (const stop of this.stops) stop(); this.stops = []; this.set({ ready: false, candidates: [] }); super.close(); }
}
