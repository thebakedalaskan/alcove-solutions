/*
 * One browser's MLS client (RFC 9420) for one call (docs: Calls and recordings › End-to-end encryption). Its
 * keys are made and kept here and never sent anywhere: the API only orders and relays MLS messages. The keys
 * LiveKit encrypts media frames with come from the group's exporter secret, one per sender, so they change
 * with every epoch: whenever someone is added or removed, and every few minutes besides.
 *
 * Only the organizer's browser commits. It created the group, so its leaf is 0, and every other browser takes
 * commits from leaf 0 alone. Operations run one at a time, in order, so nothing reads the group's state while
 * something else is moving it on. Nothing a message carries can stop this client: anything unreadable is
 * reported as such and the next message is read as usual.
 */
import { CALL_CHAT_MAX } from '@alcove/api';
import { z } from 'zod';
import type { CiphersuiteImpl, ClientConfig, ClientState, IncomingMessageCallback, KeyPackage, MLSMessage, PrivateKeyPackage, PrivateMessage, Proposal, RatchetTree, Welcome } from 'ts-mls';

const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const;
const MEDIA_LABEL = 'alcove/call-media/v1';
export const IDENTITY = /^p_[A-Za-z0-9_-]{22}$/;
const ORGANIZER_LEAF = 0;
/** At most this many people go into one commit: a crowd arriving at once is let in over a few. */
export const MAX_ADDS = 50;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64u = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A new random identity for a call connection: what LiveKit and the call's MLS group know someone by. */
export const newIdentity = (): string => `p_${b64u(crypto.getRandomValues(new Uint8Array(16)))}`;
/** The name of a call's MLS group for one generation (a new group whenever the organizer's connection changes). */
export const groupName = (callId: string, generation: number): string => `alcove/call/${callId}/${generation}`;

/* The library loads on first use, so it stays out of the app's first page load. */
interface Lib { m: typeof import('ts-mls'); sender: typeof import('ts-mls/privateMessage.js'); kps: typeof import('ts-mls/keyPackage.js'); cs: CiphersuiteImpl }
let loading: Promise<Lib> | null = null;
function lib(): Promise<Lib> {
  loading ??= (async () => {
    const m = await import('ts-mls');
    const [sender, kps] = await Promise.all([import('ts-mls/privateMessage.js'), import('ts-mls/keyPackage.js')]);
    return { m, sender, kps, cs: await m.getCiphersuiteImpl(m.getCiphersuiteFromName(SUITE)) };
  })();
  return loading;
}

const ChatPayloadSchema = z.object({ text: z.string().min(1).max(CALL_CHAT_MAX), at: z.number() });

function identityOf(cred: { credentialType: string; identity?: Uint8Array }): string | undefined {
  if (cred.credentialType !== 'basic' || !cred.identity) return undefined;
  const id = dec.decode(cred.identity);
  return IDENTITY.test(id) ? id : undefined;
}
/** The identity at each leaf of a ratchet tree (leaves sit at even node positions). */
function leaves(tree: RatchetTree): Map<number, string> {
  const out = new Map<number, string>();
  tree.forEach((node, i) => {
    if (i % 2 !== 0 || node?.nodeType !== 'leaf') return;
    const id = identityOf(node.leaf.credential);
    if (id) out.set(i / 2, id);
  });
  return out;
}
/** The epoch a commit or chat message says it belongs to (it's authenticated along with the rest). */
function epochOf(m: MLSMessage): number | undefined {
  if (m.wireformat === 'mls_private_message') return Number(m.privateMessage.epoch);
  if (m.wireformat === 'mls_public_message') return Number(m.publicMessage.content.epoch);
  return undefined;
}

export class MlsError extends Error {}

export interface PendingCommit {
  commit: string;
  welcome: string | undefined;
  /** The epoch the commit was made in. */
  epoch: number;
  /** Who it really adds and removes. */
  added: string[];
  removed: string[];
}
/** What a commit from the log did here. `behind`: it's for a later epoch, so one before it never arrived. */
export type Applied = 'applied' | 'skipped' | 'refused' | 'removed' | 'behind';
/** Chat from the log, read: who sent it as MLS vouches for it, or why it can't be read here. */
export type Read = { kind: 'chat'; from: string; text: string; at: number } | { kind: 'before' } | { kind: 'unreadable' };

export class MlsClient {
  private state: ClientState | null = null;
  private pending: { body: string; next: ClientState; consumed: Uint8Array[]; sent: PendingCommit } | null = null;
  /** The epoch this browser joined at: chat from before it can't be read here. */
  private joinedAt = -1;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly l: Lib, readonly identity: string, private kp: { publicPackage: KeyPackage; privatePackage: PrivateKeyPackage }) {}

  static async make(identity: string): Promise<MlsClient> {
    if (!IDENTITY.test(identity)) throw new MlsError('Not a call identity.');
    const l = await lib();
    return new MlsClient(l, identity, await MlsClient.keys(l, identity));
  }
  private static keys(l: Lib, identity: string) {
    return l.m.generateKeyPackage({ credentialType: 'basic', identity: enc.encode(identity) }, l.m.defaultCapabilities(), l.m.defaultLifetime, [], l.cs);
  }
  /** One operation at a time, in the order they were asked for, whether or not the one before worked. */
  private run<T>(f: () => Promise<T>): Promise<T> {
    const next = this.queue.then(f, f);
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** The key package's private init key is only for opening a welcome: once in a group, it's gone. */
  private forgetInitKey() { this.l.m.zeroOutUint8Array(this.kp.privatePackage.initPrivateKey); }

  /** Fresh keys for a new group (the organizer's connection changed, or this browser lost its place): the old group is over here. */
  renew(): Promise<void> {
    return this.run(async () => {
      this.kp = await MlsClient.keys(this.l, this.identity);
      this.state = null;
      this.pending = null;
      this.joinedAt = -1;
    });
  }

  /** Every member's credential is a call identity; anything else is refused. */
  private config(): ClientConfig {
    const m = this.l.m;
    return {
      keyRetentionConfig: m.defaultKeyRetentionConfig, lifetimeConfig: m.defaultLifetimeConfig,
      keyPackageEqualityConfig: m.defaultKeyPackageEqualityConfig, paddingConfig: m.defaultPaddingConfig,
      authService: { validateCredential: (credential) => Promise.resolve(identityOf(credential) !== undefined) }
    };
  }
  /** Commits only from the organizer's leaf, and no standalone proposals from anyone. */
  private readonly policy: IncomingMessageCallback = (incoming) => (incoming.kind === 'commit' && incoming.senderLeafIndex === ORGANIZER_LEAF ? 'accept' : 'reject');

  keyPackage(): string {
    return b64u(this.l.m.encodeMlsMessage({ keyPackage: this.kp.publicPackage, wireformat: 'mls_key_package', version: 'mls10' }));
  }
  get inGroup(): boolean { return this.state !== null; }
  epoch(): number { return this.state ? Number(this.state.groupContext.epoch) : -1; }
  members(): string[] { return this.state ? [...leaves(this.state.ratchetTree).values()] : []; }

  /** The organizer's browser starts the call's group (for this generation). */
  create(callId: string, generation: number): Promise<void> {
    return this.run(async () => {
      this.state = await this.l.m.createGroup(enc.encode(groupName(callId, generation)), this.kp.publicPackage, this.kp.privatePackage, [], this.l.cs, this.config());
      this.pending = null;
      this.joinedAt = 0;
      this.forgetInitKey();
    });
  }

  private decode(body: string): MLSMessage {
    let d: ReturnType<Lib['m']['decodeMlsMessage']>;
    try { d = this.l.m.decodeMlsMessage(unb64u(body), 0); } catch { throw new MlsError('Not an MLS message.'); }
    if (!d) throw new MlsError('Not an MLS message.');
    return d[0];
  }
  private welcomeOf(body: string): Welcome {
    const m = this.decode(body);
    if (m.wireformat !== 'mls_welcome') throw new MlsError('Expected a welcome.');
    return m.welcome;
  }
  private privateOf(body: string): PrivateMessage {
    const m = this.decode(body);
    if (m.wireformat !== 'mls_private_message') throw new MlsError('Expected an encrypted message.');
    return m.privateMessage;
  }

  /**
   * Joins from the welcome the organizer's browser made for this one: only into this call's group for this
   * generation, with this browser in it, and the call's organizer at leaf 0.
   */
  join(welcome: string, expect: { group: string; organizer: string | null }): Promise<void> {
    return this.run(async () => {
      const st = await this.l.m.joinGroup(this.welcomeOf(welcome), this.kp.publicPackage, this.kp.privatePackage, this.l.m.emptyPskIndex, this.l.cs, undefined, undefined, this.config());
      if (dec.decode(st.groupContext.groupId) !== expect.group) throw new MlsError('That welcome is for another group.');
      const ids = leaves(st.ratchetTree);
      if (![...ids.values()].includes(this.identity)) throw new MlsError('That welcome isn’t for this browser.');
      const organizer = ids.get(ORGANIZER_LEAF);
      if (!organizer || (expect.organizer !== null && organizer !== expect.organizer)) throw new MlsError('That group’s organizer isn’t this call’s organizer.');
      this.state = st;
      this.pending = null;
      this.joinedAt = Number(st.groupContext.epoch);
      this.forgetInitKey();
    });
  }

  /** A key package that's well formed, for this suite, signed by its own key, and naming the identity it came with; otherwise null. */
  private async checked(a: { identity: string; keyPackage: string }): Promise<KeyPackage | null> {
    let m: MLSMessage;
    try { m = this.decode(a.keyPackage); } catch { return null; }
    if (m.wireformat !== 'mls_key_package') return null;
    const kp = m.keyPackage;
    if (kp.cipherSuite !== this.kp.publicPackage.cipherSuite || identityOf(kp.leafNode.credential) !== a.identity) return null;
    return (await this.l.kps.verifyKeyPackage(kp, this.l.cs.signature).catch(() => false)) ? kp : null;
  }

  /**
   * The organizer's browser: one commit adding these key packages (up to MAX_ADDS) and removing these
   * identities, or only moving the keys on (`rekey`). It takes effect once the API has taken it (`settle`);
   * until then the same commit is sent again. Key packages that can't be used come back in `refused`.
   */
  commit(adds: { identity: string; keyPackage: string }[], removes: string[], opts: { rekey: boolean }): Promise<{ commit: PendingCommit | null; refused: string[] }> {
    return this.run(async () => {
      const st = this.state;
      if (!st) throw new MlsError('Not in the group.');
      if (this.pending) return { commit: this.pending.sent, refused: [] };
      const byId = new Map([...leaves(st.ratchetTree)].map(([leaf, id]) => [id, leaf]));
      const refused: string[] = [];
      let add: { identity: string; kp: KeyPackage }[] = [];
      for (const a of adds) {
        if (add.length >= MAX_ADDS) break;
        if (byId.has(a.identity) || add.some((x) => x.identity === a.identity)) continue;
        const kp = await this.checked(a);
        if (kp) add.push({ identity: a.identity, kp });
        else refused.push(a.identity);
      }
      const removed = [...new Set(removes)].filter((id) => { const leaf = byId.get(id); return leaf !== undefined && leaf !== ORGANIZER_LEAF; });
      if (!add.length && !removed.length && !opts.rekey) return { commit: null, refused };
      const removals: Proposal[] = removed.flatMap((id) => { const leaf = byId.get(id); return leaf === undefined ? [] : [{ proposalType: 'remove' as const, remove: { removed: leaf } }]; });
      const make = (xs: { kp: KeyPackage }[]) => this.l.m.createCommit({ state: st, cipherSuite: this.l.cs },
        { extraProposals: [...xs.map((x): Proposal => ({ proposalType: 'add', add: { keyPackage: x.kp } })), ...removals], ratchetTreeExtension: true });
      let r: Awaited<ReturnType<typeof make>>;
      try {
        r = await make(add);
      } catch (e) {
        // One key package the library won't take mustn't keep everyone else out: find which, and leave it out.
        if (!add.length) throw e;
        const good: typeof add = [];
        for (const x of add) {
          try { await make([x]); good.push(x); } catch { refused.push(x.identity); }
        }
        add = good;
        if (!add.length && !removed.length && !opts.rekey) return { commit: null, refused };
        r = await make(add);
      }
      const commit = b64u(this.l.m.encodeMlsMessage(r.commit));
      const welcome = r.welcome ? b64u(this.l.m.encodeMlsMessage({ welcome: r.welcome, wireformat: 'mls_welcome', version: 'mls10' })) : undefined;
      const sent: PendingCommit = { commit, welcome, epoch: Number(st.groupContext.epoch), added: add.map((x) => x.identity), removed };
      this.pending = { body: commit, next: r.newState, consumed: r.consumed, sent };
      return { commit: sent, refused };
    });
  }
  /** A commit made but not yet taken by the API (its answer was lost): sent again as it was. */
  unsettled(): PendingCommit | null { return this.pending?.sent ?? null; }
  private adopt() {
    if (!this.pending) return;
    this.state = this.pending.next;
    this.pending.consumed.forEach((b) => this.l.m.zeroOutUint8Array(b));
    this.pending = null;
  }
  /** The API took the pending commit: the group moves to its next epoch. */
  settle(): Promise<void> { return this.run(async () => { this.adopt(); }); }
  /** The API refused the pending commit (the call moved on, or it wasn't taken): it's dropped. */
  drop(): Promise<void> { return this.run(async () => { this.pending = null; }); }

  /**
   * A commit from the log. One for an earlier epoch is already in this state; one for this epoch moves the
   * group on (or settles this browser's own); one for a later epoch means one before it was missed.
   */
  process(body: string): Promise<Applied> {
    return this.run(async (): Promise<Applied> => {
      const st = this.state;
      if (!st) return 'skipped';
      let m: MLSMessage;
      try { m = this.decode(body); } catch { return 'refused'; }
      if (m.wireformat !== 'mls_private_message' && m.wireformat !== 'mls_public_message') return 'refused';
      const epoch = epochOf(m);
      if (epoch === undefined) return 'refused';
      if (epoch < Number(st.groupContext.epoch)) return 'skipped';
      if (epoch > Number(st.groupContext.epoch)) return 'behind';
      if (this.pending?.body === body) { this.adopt(); return 'applied'; }
      try {
        const r = await this.l.m.processMessage(m, st, this.l.m.emptyPskIndex, this.policy, this.l.cs);
        if (r.kind !== 'newState' || r.actionTaken !== 'accept') return 'refused';
        r.consumed.forEach((b) => this.l.m.zeroOutUint8Array(b));
        this.pending = null;
        if (r.newState.groupActiveState.kind === 'removedFromGroup') { this.state = null; return 'removed'; }
        this.state = r.newState;
        return 'applied';
      } catch {
        return 'refused';
      }
    });
  }

  /**
   * The media keys for this epoch, one per member: each sender encrypts its frames with its own key, and every
   * member can derive every sender's key to decrypt them. A key is never used by two senders (RFC 9605 §4.4.1).
   */
  mediaKeys(): Promise<Record<string, Uint8Array>> {
    return this.run(async () => {
      const st = this.state;
      if (!st) throw new MlsError('Not in the group.');
      const out: Record<string, Uint8Array> = {};
      for (const id of leaves(st.ratchetTree).values()) out[id] = await this.l.m.mlsExporter(st.keySchedule.exporterSecret, MEDIA_LABEL, enc.encode(id), 32, this.l.cs);
      return out;
    });
  }

  /** Chat, encrypted for everyone in the group now. */
  encrypt(text: string, at: number): Promise<{ message: string; epoch: number }> {
    return this.run(async () => {
      const st = this.state;
      if (!st) throw new MlsError('Not in the group.');
      if (this.pending) throw new MlsError('The keys are moving on; try again.');
      if (text.length > CALL_CHAT_MAX) throw new MlsError('That message is too long.');
      const r = await this.l.m.createApplicationMessage(st, enc.encode(JSON.stringify({ text, at })), this.l.cs);
      this.state = r.newState;
      r.consumed.forEach((b) => this.l.m.zeroOutUint8Array(b));
      return { message: b64u(this.l.m.encodeMlsMessage({ privateMessage: r.privateMessage, wireformat: 'mls_private_message', version: 'mls10' })), epoch: Number(st.groupContext.epoch) };
    });
  }

  /**
   * Chat from the log: its text, and who sent it as MLS vouches for it (the sender's leaf, whose signature the
   * message must carry). `before`: sent before this browser was in the group. Anything else that can't be read
   * (malformed, replayed, not chat) is `unreadable`, and leaves this client as it was.
   */
  decrypt(body: string): Promise<Read> {
    return this.run(async (): Promise<Read> => {
      const st = this.state;
      if (!st) return { kind: 'unreadable' };
      let pm: PrivateMessage;
      try { pm = this.privateOf(body); } catch { return { kind: 'unreadable' }; }
      if (pm.contentType !== 'application') return { kind: 'unreadable' };
      const epoch = Number(pm.epoch);
      if (epoch < this.joinedAt) return { kind: 'before' };
      try {
        const current = Number(st.groupContext.epoch) === epoch;
        const past = current ? undefined : st.historicalReceiverData.get(BigInt(epoch));
        if (!current && !past) return { kind: 'unreadable' };
        const sd = await this.l.sender.decryptSenderData(pm, current ? st.keySchedule.senderDataSecret : past?.senderDataSecret ?? new Uint8Array(0), this.l.cs);
        const from = sd ? leaves(current ? st.ratchetTree : past?.ratchetTree ?? []).get(sd.leafIndex) : undefined;
        if (!from) return { kind: 'unreadable' };
        const r = await this.l.m.processPrivateMessage(st, pm, this.l.m.emptyPskIndex, this.l.cs, this.policy);
        if (r.kind !== 'applicationMessage') return { kind: 'unreadable' };
        this.state = r.newState;
        r.consumed.forEach((b) => this.l.m.zeroOutUint8Array(b));
        let payload: unknown;
        try { payload = JSON.parse(dec.decode(r.message)); } catch { return { kind: 'unreadable' }; }
        const p = ChatPayloadSchema.safeParse(payload);
        return p.success ? { kind: 'chat', from, text: p.data.text, at: p.data.at } : { kind: 'unreadable' };
      } catch {
        return { kind: 'unreadable' };
      }
    });
  }
}
