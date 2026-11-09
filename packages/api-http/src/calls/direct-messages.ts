import {
  AlcoveApiError, DirectPayloadSchema, DirectTextSchema, type DirectEnvelope, type DirectKeyAnnouncement, type DirectMessage,
  type DirectMessagesApi, type DirectMessagesState, type DirectSend, type DirectSync, type CallChatThread, type CallChatMention, type CallReaction, errorCode, fromBase64Url, toggledReaction
} from '@alcove/api';
import { b64u, randomBytes } from '../transport/ids';
import { Box } from '../transport/live';

export interface DirectTransport { sync(ids: string[], after: number): Promise<DirectSync>; send(body: DirectSend): Promise<DirectEnvelope> }
interface Context { generation: number; place: string; members: string[]; ready: boolean }
const EMPTY: DirectMessagesState = { ready: false, peers: [], messages: [], unread: [], unreadMentions: [] };
const utf8 = new TextEncoder();
/** The two original connections and both authenticated public keys are part of the AEAD domain. */
const bound = (call: string, m: Pick<DirectEnvelope, 'id' | 'from' | 'to' | 'generation' | 'place' | 'fromKey' | 'toKey'>) =>
  utf8.encode(JSON.stringify(['alcove/private-message/v1', call, m.generation, m.place, m.id, m.from, m.to, m.fromKey, m.toKey]));

type Audience = Pick<DirectMessage, 'from' | 'to' | 'place' | 'generation'>;
/**
 * A message confirmed (sent or delivered) between the same two connections, in the same room and generation, either way round:
 * the only kind a reply or a reaction may be on. Pending and failed messages have no stable target.
 */
const confirmedIn = (m: DirectMessage, a: Audience): boolean => m.place === a.place && m.generation === a.generation
  && ((m.from === a.from && m.to === a.to) || (m.from === a.to && m.to === a.from)) && (m.state === 'sent' || m.state === 'delivered');

/** A parent never grants access to another audience, room or generation. */
function availableParent(messages: readonly DirectMessage[], thread: CallChatThread, audience: Audience): boolean {
  const parent = messages.find((message) => message.id === thread.replyTo && confirmedIn(message, audience));
  return !!parent && (parent.thread?.root ?? parent.id) === thread.root;
}

/** Owns one ephemeral private key, authenticated peers, original encrypted retries and only this session's history. */
export class DirectMessages extends Box<DirectMessagesState> implements DirectMessagesApi {
  private keys: Promise<CryptoKeyPair> | null;
  private publicKey: Promise<string>;
  private context: Context = { generation: -1, place: '', members: [], ready: false };
  private trusted = new Map<string, string>();
  private mismatched = new Set<string>();
  private authorized: string[] = [];
  private authorizedScope: string | null = null;
  private envelopes = new Map<string, DirectSend>();
  private acknowledged = new Set<string>();
  private readIds = new Set<string>();
  private inFlight: Promise<void> | null = null;
  private closed = false;
  private reannounce = true;
  private after = 0;
  private scopeRevision = 0;
  private peerRevisions = new Map<string, number>();
  private sendScopes = new Map<string, { scope: number; peer: number }>();
  private deferred = new Map<string, DirectEnvelope>();
  constructor(private readonly callId: string, private readonly identity: string, private readonly transport: DirectTransport, private readonly refused: (why: 'binding' | 'ciphertext') => void) {
    super(EMPTY);
    this.keys = crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    this.publicKey = this.keys.then(async (keys) => b64u(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))));
  }
  override set(next: DirectMessagesState): void {
    const unread = new Set(next.unread);
    // Already decrypted history belongs to this original connection for the active call. Fresh alerts apply
    // stricter current-room/peer checks; retained unread counts remain readable after a departure or room move.
    const unreadMentions = next.ready ? next.messages.filter((message) => message.to === this.identity && message.state === 'delivered' && unread.has(message.id)
      && message.mentions.some((mention) => mention.identity === this.identity)).map((message) => message.id) : [];
    super.set({ ...next, unreadMentions });
  }
  contextChanged(next: Context): void {
    const changed = next.generation !== this.context.generation || next.place !== this.context.place;
    if (changed || (this.context.ready && !next.ready)) this.scopeRevision++;
    for (const id of new Set([...next.members, ...this.context.members])) if (next.members.includes(id) !== this.context.members.includes(id)) this.peerRevisions.set(id, (this.peerRevisions.get(id) ?? 0) + 1);
    const members = [...next.members].sort().join(',');
    if (changed) { this.trusted.clear(); this.mismatched.clear(); this.authorized = []; this.authorizedScope = null; this.deferred.clear(); }
    if (!next.ready) this.authorizedScope = null;
    if (changed || members !== [...this.context.members].sort().join(',') || (!this.context.ready && next.ready)) this.reannounce = true;
    this.context = next;
    this.publish();
  }
  /** Called exclusively after MLS authenticated the sender and the current group/generation. */
  acceptKey(from: string, announcement: DirectKeyAnnouncement): void {
    if (this.closed || this.mismatched.has(from) || announcement.generation !== this.context.generation || announcement.place !== this.context.place || !this.context.members.includes(from)) return;
    const previous = this.trusted.get(from);
    // One connection cannot silently replace its key. A different key needs a fresh call connection.
    if (previous && previous !== announcement.key) { this.mismatched.add(from); this.trusted.delete(from); this.authorized = this.authorized.filter((id) => id !== from); this.publish(); return; }
    this.trusted.set(from, announcement.key);
    this.publish();
  }
  async announcement(): Promise<DirectKeyAnnouncement | null> {
    if (this.closed || !this.context.ready || !this.reannounce) return null;
    return { key: await this.publicKey, generation: this.context.generation, place: this.context.place };
  }
  announced(a: DirectKeyAnnouncement): void {
    if (a.generation === this.context.generation && a.place === this.context.place) this.reannounce = false;
  }
  private publish(): void {
    if (this.closed) return;
    const peers = this.authorized.filter((id) => this.context.members.includes(id) && this.trusted.has(id));
    this.set({ ...this.getSnapshot(), ready: this.context.ready && this.authorizedScope === `${this.context.generation}:${this.context.place}`, peers });
  }
  /** Uncertain transport authorization is recoverable without changing the original audience. */
  authorizationLost(): void {
    this.authorizedScope = null;
    if (!this.closed) this.set({ ...this.getSnapshot(), ready: false, peers: [] });
  }
  private async key(peerKey: string, aad: Uint8Array): Promise<CryptoKey> {
    const keys = await this.keys;
    if (!keys || this.closed) throw new AlcoveApiError('conflict', 'This private conversation has ended.');
    const peer = await crypto.subtle.importKey('raw', new Uint8Array(fromBase64Url(peerKey)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, keys.privateKey, 256));
    try {
      const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
      return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new Uint8Array(aad) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } finally { secret.fill(0); }
  }
  /**
   * Seals a payload (a message or a reaction) for one other connection under a new ID, bound to both connections, both keys, the
   * room and the generation it's sealed in.
   */
  private async seal(to: string, toKey: string, at: Pick<Context, 'place' | 'generation'>, payload: unknown): Promise<DirectSend> {
    const base = { id: b64u(randomBytes(16)), to, place: at.place, generation: at.generation, fromKey: await this.publicKey, toKey };
    const aad = bound(this.callId, { ...base, from: this.identity });
    const nonce = randomBytes(12);
    const ciphertext = b64u(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, await this.key(toKey, aad), utf8.encode(JSON.stringify(payload)))));
    return { ...base, nonce: b64u(nonce), ciphertext };
  }
  send = async (to: string, text: string, mentions: readonly CallChatMention[] = [], thread: CallChatThread | null = null): Promise<void> => {
    const leading = text.length - text.trimStart().length;
    const parsed = DirectTextSchema.safeParse({ text: text.trim(), thread, mentions: mentions.map((mention) => ({ ...mention, start: mention.start - leading, end: mention.end - leading })) });
    if (!parsed.success) throw new AlcoveApiError('invalid', 'Write a message of up to 4,000 characters.');
    if (parsed.data.mentions.some((mention) => mention.identity !== this.identity && mention.identity !== to)) throw new AlcoveApiError('invalid', 'Only the two people in this private conversation can be mentioned.');
    const toKey = this.trusted.get(to);
    if (!this.getSnapshot().ready || !this.getSnapshot().peers.includes(to) || !toKey) throw new AlcoveApiError('conflict', 'This person is unavailable in this room.');
    const sendScope = { scope: this.scopeRevision, peer: this.peerRevisions.get(to) ?? 0 };
    const { place, generation } = this.context;
    if (parsed.data.thread && !availableParent(this.getSnapshot().messages, parsed.data.thread, { from: this.identity, to, place, generation })) throw new AlcoveApiError('not-found', 'That private conversation isn’t available in this room.');
    const sealed = await this.seal(to, toKey, { place, generation }, parsed.data);
    if (this.closed) return;
    this.envelopes.set(sealed.id, sealed);
    this.sendScopes.set(sealed.id, sendScope);
    this.set({ ...this.getSnapshot(), messages: [...this.getSnapshot().messages, { id: sealed.id, from: this.identity, to, place, generation, text: parsed.data.text, thread: parsed.data.thread, mentions: parsed.data.mentions, reactions: [], at: 0, order: 0, state: 'sending', error: null }] });
    await this.retry(sealed.id);
  };
  /**
   * Sealed for the same two connections, room and generation as the message it's on, exactly as a message is. It shows at once
   * and is taken back if the relay doesn't take it; it's never retried, so it can't reach anyone else later.
   */
  react = async (id: string, reaction: CallReaction, on: boolean): Promise<void> => {
    const target = this.getSnapshot().messages.find((m) => m.id === id && (m.state === 'sent' || m.state === 'delivered'));
    if (!target) throw new AlcoveApiError('not-found', 'That message isn’t here any more.');
    if ((target.reactions.find((r) => r.reaction === reaction)?.by.includes(this.identity) ?? false) === on) return;
    const to = target.from === this.identity ? target.to : target.from;
    const toKey = this.trusted.get(to);
    const { place, generation } = this.context;
    if (!this.getSnapshot().ready || !this.getSnapshot().peers.includes(to) || !toKey || !confirmedIn(target, { from: this.identity, to, place, generation })) throw new AlcoveApiError('conflict', 'This person is unavailable in this room.');
    const sealed = await this.seal(to, toKey, { place, generation }, { react: { target: id, reaction, on } });
    if (this.closed) return;
    this.reacted(id, reaction, this.identity, on);
    try {
      await this.transport.send(sealed);
    } catch (error) {
      this.reacted(id, reaction, this.identity, !on);
      throw error instanceof AlcoveApiError ? error : new AlcoveApiError('unavailable', 'Your reaction wasn’t sent.');
    }
  };
  private reacted(id: string, reaction: CallReaction, who: string, on: boolean): void {
    if (!this.closed) this.set({ ...this.getSnapshot(), messages: this.getSnapshot().messages.map((m) => m.id === id ? { ...m, reactions: toggledReaction(m.reactions, reaction, who, on) } : m) });
  }
  retry = async (id: string): Promise<void> => {
    const b = this.envelopes.get(id);
    if (!b || this.closed) return;
    this.update(id, { state: 'sending', error: null });
    try {
      const original = this.sendScopes.get(id);
      if (!this.context.ready || original?.scope !== this.scopeRevision || original.peer !== (this.peerRevisions.get(b.to) ?? 0) || b.generation !== this.context.generation || b.place !== this.context.place || !this.getSnapshot().peers.includes(b.to) || this.trusted.get(b.to) !== b.toKey) {
        throw new AlcoveApiError('conflict', 'This person is unavailable in the original room. Your message wasn’t sent.');
      }
      const sent = await this.transport.send(b);
      if (this.closed) return;
      this.update(id, { state: sent.delivered ? 'delivered' : 'sent', at: sent.at, order: sent.order, error: null });
    } catch (error) {
      this.update(id, { state: 'failed', error: error instanceof AlcoveApiError ? error.message : 'This message wasn’t confirmed. Retry sends it only to the same person.' });
    }
  };
  private update(id: string, patch: Partial<DirectMessage>): void {
    if (!this.closed) this.set({ ...this.getSnapshot(), messages: this.getSnapshot().messages.map((m) => m.id === id ? { ...m, ...patch, ...(m.state === 'delivered' ? { state: 'delivered' as const, error: null } : {}) } : m).sort((a, b) => a.order && b.order ? a.order - b.order : a.order ? -1 : b.order ? 1 : a.at - b.at) });
  }
  sync(): Promise<void> {
    if (this.closed || !this.context.ready) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.receive().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async receive(page = 0): Promise<void> {
    const scope = this.context;
    const ack = [...this.acknowledged].slice(0, 100);
    try {
      const result = await this.transport.sync(ack, this.after);
      if (this.closed || scope !== this.context) return;
      ack.forEach((id) => this.acknowledged.delete(id));
      this.authorized = result.peers;
      this.authorizedScope = `${scope.generation}:${scope.place}`;
      this.publish();
      const ownKey = await this.publicKey;
      const pending = new Map([...this.deferred, ...result.messages.map((envelope) => [envelope.id, envelope] as const)]);
      this.deferred.clear();
      for (const envelope of pending.values()) {
        if (this.closed || scope !== this.context) return;
        const known = this.getSnapshot().messages.find((m) => m.id === envelope.id);
        if (envelope.from === this.identity) {
          if (known) this.update(envelope.id, { state: envelope.delivered ? 'delivered' : 'sent', at: envelope.at, order: envelope.order, error: null });
          continue;
        }
        if (envelope.to !== this.identity || envelope.generation !== scope.generation || envelope.place !== scope.place || !scope.members.includes(envelope.from) || !result.peers.includes(envelope.from) || envelope.toKey !== ownKey || this.mismatched.has(envelope.from)) { this.refused('binding'); continue; }
        const authenticated = this.trusted.get(envelope.from);
        if (!authenticated) {
          // The MLS announcement may arrive later. Bound encrypted deferral by the relay's entire-call cap.
          if (this.deferred.size < 2000) this.deferred.set(envelope.id, envelope);
          else this.refused('binding');
          continue;
        }
        if (authenticated !== envelope.fromKey) { this.refused('binding'); continue; }
        if (!known) {
          try {
            const aad = bound(this.callId, envelope);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromBase64Url(envelope.nonce)), additionalData: aad }, await this.key(envelope.fromKey, aad), new Uint8Array(fromBase64Url(envelope.ciphertext)));
            const raw: unknown = JSON.parse(new TextDecoder().decode(plain));
            const opened = DirectPayloadSchema.safeParse(raw);
            if (this.closed || scope !== this.context) return;
            if (!opened.success) { this.refused('ciphertext'); continue; }
            const payload = opened.data;
            if ('react' in payload) {
              // Only on a confirmed message between these same two connections, in this room and generation.
              const { target, reaction, on } = payload.react;
              const reactedTo = this.getSnapshot().messages.find((m) => m.id === target && confirmedIn(m, envelope));
              if (reactedTo) this.reacted(reactedTo.id, reaction, envelope.from, on);
              continue;
            }
            if (payload.mentions.some((mention) => mention.identity !== envelope.from && mention.identity !== envelope.to)) { this.refused('binding'); continue; }
            if (payload.thread && !availableParent(this.getSnapshot().messages, payload.thread, envelope)) { this.refused('binding'); continue; }
            const message: DirectMessage = { id: envelope.id, from: envelope.from, to: envelope.to, place: envelope.place, generation: envelope.generation, text: payload.text, thread: payload.thread, mentions: payload.mentions, reactions: [], at: envelope.at, order: envelope.order, state: 'delivered', error: null };
            this.set({ ...this.getSnapshot(), messages: [...this.getSnapshot().messages, message].sort((a, b) => a.order - b.order), unread: this.readIds.has(message.id) ? this.getSnapshot().unread : [...this.getSnapshot().unread, message.id] });
          } catch { this.refused('ciphertext'); }
        }
        if (this.getSnapshot().messages.some((m) => m.id === envelope.id) && !envelope.delivered) this.acknowledged.add(envelope.id);
      }
      result.delivered.forEach((id) => this.update(id, { state: 'delivered', error: null }));
      this.after = Math.max(this.after, result.after);
      if (result.more && page < 20) await this.receive(page + 1);
    } catch (error) {
      if (this.closed) return;
      this.authorizationLost();
      if (errorCode(error) === 'forbidden' || errorCode(error) === 'unauthenticated' || errorCode(error) === 'not-found' || errorCode(error) === 'conflict') {
        this.authorized = []; this.set({ ...this.getSnapshot(), ready: false, peers: [] });
      }
      // Temporary transport failures retain original history and envelopes, awaiting reauthorization.
    }
  }
  read = (ids: readonly string[]): void => {
    ids.forEach((id) => this.readIds.add(id));
    this.set({ ...this.getSnapshot(), unread: this.getSnapshot().unread.filter((id) => !this.readIds.has(id)) });
  };
  close(): void {
    this.closed = true; this.keys = null; this.trusted.clear(); this.mismatched.clear(); this.envelopes.clear(); this.sendScopes.clear(); this.peerRevisions.clear(); this.deferred.clear(); this.acknowledged.clear(); this.readIds.clear(); this.authorized = []; this.authorizedScope = null;
    this.set(EMPTY);
  }
}
