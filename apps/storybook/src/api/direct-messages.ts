import { AlcoveApiError, type CallChatThread, type CallCrypto, type CallState, type CallTicket, type DirectMessagesApi, type DirectMessagesState, type LiveStore } from '@alcove/api';
import { Pushed } from './live';
import { nextId } from './state';

/** The call's stand-in keeps private words out of shared chat, scripts and notes. */
export class ScriptedDirectMessages extends Pushed<DirectMessagesState> implements DirectMessagesApi {
  private stops: (() => void)[] = [];
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private fail: boolean;
  constructor(private readonly call: LiveStore<CallState>, private readonly crypto: LiveStore<CallCrypto>, private readonly ticket: CallTicket, fail = false) {
    super({ ready: false, peers: [], messages: [], unread: [] });
    this.fail = fail;
    this.stops = [call.subscribe(() => this.follow()), crypto.subscribe(() => this.follow())];
    this.follow();
  }
  private follow() {
    const c = this.crypto.getSnapshot();
    const s = this.call.getSnapshot();
    if (s.phase !== 'in-call' || c.status === 'removed' || c.status === 'denied' || c.status === 'away') { this.close(); return; }
    this.update((now) => ({ ...now, ready: c.status === 'in', peers: c.status === 'in' ? c.members.filter((id) => id !== this.ticket.identity) : [] }));
  }
  private later(fn: () => void) {
    const timer = setTimeout(() => { this.pendingTimers.delete(timer); fn(); }, 500);
    this.pendingTimers.add(timer);
  }
  private hasParent(thread: CallChatThread, peer: string): boolean {
    const parent = this.getSnapshot().messages.find((m) => m.id === thread.replyTo && m.place === this.crypto.getSnapshot().place && m.generation === this.call.getSnapshot().generation
      && ((m.from === peer && m.to === this.ticket.identity) || (m.to === peer && m.from === this.ticket.identity)) && (m.state === 'sent' || m.state === 'delivered'));
    return !!parent && (parent.thread?.root ?? parent.id) === thread.root;
  }
  send = async (to: string, text: string, thread: CallChatThread | null = null): Promise<void> => {
    if (!this.getSnapshot().peers.includes(to)) throw new AlcoveApiError('conflict', 'This person is unavailable in this room.');
    const id = nextId('private');
    const c = this.crypto.getSnapshot();
    if (thread && !this.hasParent(thread, to)) throw new AlcoveApiError('not-found', 'That private conversation isn’t available in this room.');
    this.update((s) => ({ ...s, messages: [...s.messages, { id, from: this.ticket.identity, to, text, thread, place: c.place, generation: this.call.getSnapshot().generation, at: this.call.getSnapshot().elapsed, order: s.messages.length + 1, state: 'sending', error: null }] }));
    await this.retry(id);
  };
  retry = async (id: string): Promise<void> => {
    const m = this.getSnapshot().messages.find((m) => m.id === id);
    if (!m) return;
    const failed = this.fail || m.place !== this.crypto.getSnapshot().place || m.generation !== this.call.getSnapshot().generation || !this.getSnapshot().peers.includes(m.to);
    this.fail = false;
    this.update((s) => ({ ...s, messages: s.messages.map((m) => m.id === id ? { ...m, state: 'sending', error: null } : m) }));
    this.later(() => this.update((s) => ({ ...s, messages: s.messages.map((m) => m.id === id ? { ...m, state: failed ? 'failed' : 'delivered', error: failed ? 'This message wasn’t confirmed. Retry sends it only to the same person.' : null } : m) })));
  };
  receive(from: string, text: string, thread: CallChatThread | null = null): void {
    if (!this.getSnapshot().peers.includes(from)) return;
    if (thread && !this.hasParent(thread, from)) return;
    const id = nextId('private');
    this.update((s) => ({ ...s, messages: [...s.messages, { id, from, to: this.ticket.identity, text, thread, place: this.crypto.getSnapshot().place, generation: this.call.getSnapshot().generation, at: this.call.getSnapshot().elapsed, order: s.messages.length + 1, state: 'delivered', error: null }], unread: [...s.unread, id] }));
  }
  read = (ids: readonly string[]): void => { this.update((s) => ({ ...s, unread: s.unread.filter((id) => !ids.includes(id)) })); };
  override close(): void {
    this.stops.splice(0).forEach((stop) => stop());
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.set({ ready: false, peers: [], messages: [], unread: [] });
    super.close();
  }
}
