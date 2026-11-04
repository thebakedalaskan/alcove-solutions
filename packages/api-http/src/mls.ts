/*
 * One browser's MLS clients (RFC 9420) for one call (docs: Calls and recordings › End-to-end encryption). Their
 * keys are made and kept here and never sent anywhere: the API only orders and relays MLS messages. The keys
 * LiveKit encrypts media frames with come from a group's exporter secret, one per sender, so they change with
 * every epoch: whenever someone is added or removed, and every few minutes besides.
 *
 * A call has one group for each part of it: the main room, and while breakout rooms are open, one per room. So a
 * room's media keys and chat belong to the people in that room alone. Only the organizer's browser commits: it
 * creates every group, so its leaf is 0 in each, and every other browser takes commits from leaf 0 alone. It's
 * therefore in every group; anyone else is in one at a time. Each group's operations run one at a time, in order,
 * so nothing reads its state while something else is moving it on. Nothing a message carries can stop a group:
 * anything unreadable is reported as such and the next message is read as usual.
 */
import { CALL_CHAT_MAX } from '@alcove/api';
import { z } from 'zod';
import type { CiphersuiteImpl, ClientConfig, ClientState, IncomingMessageCallback, KeyPackage, MLSMessage, PrivateKeyPackage, PrivateMessage, Proposal, RatchetTree } from 'ts-mls';

const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const;
const MEDIA_LABEL = 'alcove/call-media/v1';
export const IDENTITY = /^p_[A-Za-z0-9_-]{22}$/;
/**
 * The leaf whose commits a group takes: the committer's. The organizer's browser creates every group, so that's
 * leaf 0. Kept in one place (MlsGroup.committerLeaf) so another connection could take over committing.
 */
const COMMITTER_LEAF = 0;
/** At most this many people go into one commit: a crowd arriving at once is let in over a few. */
export const MAX_ADDS = 50;
/** Key packages a browser keeps ready to join with: the newest few it has sent, until one is used. */
const KEEP_KEY_PACKAGES = 4;
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

/** A new random identity for a call connection: what LiveKit and the call's MLS groups know someone by. */
export const newIdentity = (): string => `p_${b64u(crypto.getRandomValues(new Uint8Array(16)))}`;
/**
 * The name of one part of a call's MLS group for one generation (a new set of groups whenever the organizer's
 * connection changes): `main`, or a breakout room's ID.
 */
export const groupName = (callId: string, generation: number, place: string): string => `alcove/call/${callId}/${generation}/${place}`;

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
function decode(l: Lib, body: string): MLSMessage {
  let d: ReturnType<Lib['m']['decodeMlsMessage']>;
  try { d = l.m.decodeMlsMessage(unb64u(body), 0); } catch { throw new MlsError('Not an MLS message.'); }
  if (!d) throw new MlsError('Not an MLS message.');
  return d[0];
}
/** Every member's credential is a call identity; anything else is refused. */
function config(l: Lib): ClientConfig {
  const m = l.m;
  return {
    keyRetentionConfig: m.defaultKeyRetentionConfig, lifetimeConfig: m.defaultLifetimeConfig,
    keyPackageEqualityConfig: m.defaultKeyPackageEqualityConfig, paddingConfig: m.defaultPaddingConfig,
    authService: { validateCredential: (credential) => Promise.resolve(identityOf(credential) !== undefined) }
  };
}

export class MlsError extends Error {}

interface KeyPair { publicPackage: KeyPackage; privatePackage: PrivateKeyPackage; body: string }

/**
 * A connection's way into groups: key packages made here (each joins one group at most, and its private init key
 * goes once it has), and new groups for the organizer's browser to start.
 */
export class MlsKeys {
  private unused: KeyPair[] = [];
  private constructor(private readonly l: Lib, readonly identity: string) {}

  static async make(identity: string): Promise<MlsKeys> {
    if (!IDENTITY.test(identity)) throw new MlsError('Not a call identity.');
    const k = new MlsKeys(await lib(), identity);
    await k.fresh();
    return k;
  }
  private async pair(): Promise<KeyPair> {
    const kp = await this.l.m.generateKeyPackage({ credentialType: 'basic', identity: enc.encode(this.identity) }, this.l.m.defaultCapabilities(), this.l.m.defaultLifetime, [], this.l.cs);
    return { ...kp, body: b64u(this.l.m.encodeMlsMessage({ keyPackage: kp.publicPackage, wireformat: 'mls_key_package', version: 'mls10' })) };
  }
  private forget(k: KeyPair) { this.l.m.zeroOutUint8Array(k.privatePackage.initPrivateKey); }

  /** The newest key package, to send with joining. */
  keyPackage(): string { return this.unused.at(-1)?.body ?? ''; }
  /** A new key package, to be added to another group with (a new generation, or another part of the call). The newest few stay ready to join with. */
  async fresh(): Promise<string> {
    const k = await this.pair();
    this.unused.push(k);
    for (const old of this.unused.splice(0, Math.max(0, this.unused.length - KEEP_KEY_PACKAGES))) this.forget(old);
    return k.body;
  }

  /** The organizer's browser starts one part of the call's group (`name`, from groupName), with a key package of its own that nobody else ever sees. */
  async create(name: string): Promise<MlsGroup> {
    const k = await this.pair();
    const st = await this.l.m.createGroup(enc.encode(name), k.publicPackage, k.privatePackage, [], this.l.cs, config(this.l));
    this.forget(k);
    return new MlsGroup(this.l, st, 0);
  }

  /**
   * Joins from the welcome the organizer's browser made for one of this connection's key packages: only into the
   * group named, with this browser in it, and the committer the API names at the committer's leaf. That key
   * package is used up.
   */
  async join(welcome: string, expect: { group: string; committer: string | null }): Promise<MlsGroup> {
    const m = decode(this.l, welcome);
    if (m.wireformat !== 'mls_welcome') throw new MlsError('Expected a welcome.');
    let joined: { st: ClientState; k: KeyPair } | null = null;
    for (const k of [...this.unused].reverse()) {
      // A welcome carries secrets only for the key packages it adds: any other doesn't open it.
      const st = await this.l.m.joinGroup(m.welcome, k.publicPackage, k.privatePackage, this.l.m.emptyPskIndex, this.l.cs, undefined, undefined, config(this.l)).catch(() => null);
      if (st) { joined = { st, k }; break; }
    }
    if (!joined) throw new MlsError('That welcome isn’t for this browser.');
    const { st, k } = joined;
    this.unused = this.unused.filter((x) => x !== k);
    this.forget(k);
    if (dec.decode(st.groupContext.groupId) !== expect.group) throw new MlsError('That welcome is for another group.');
    const ids = leaves(st.ratchetTree);
    if (![...ids.values()].includes(this.identity)) throw new MlsError('That welcome isn’t for this browser.');
    const committer = ids.get(COMMITTER_LEAF);
    if (!committer || (expect.committer !== null && committer !== expect.committer)) throw new MlsError('That group’s committer isn’t this call’s organizer.');
    return new MlsGroup(this.l, st, Number(st.groupContext.epoch));
  }

  /** The organizer's browser checks each key package before adding anyone with it: well formed, this suite, signed by its own key, naming the identity it came with. */
  async checked(a: { identity: string; keyPackage: string }): Promise<KeyPackage | null> {
    let m: MLSMessage;
    try { m = decode(this.l, a.keyPackage); } catch { return null; }
    if (m.wireformat !== 'mls_key_package') return null;
    const kp = m.keyPackage;
    if (kp.cipherSuite !== SUITE || identityOf(kp.leafNode.credential) !== a.identity) return null;
    return (await this.l.kps.verifyKeyPackage(kp, this.l.cs.signature).catch(() => false)) ? kp : null;
  }
}

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

/** One part of the call's MLS group, as this browser holds it. */
export class MlsGroup {
  private state: ClientState | null;
  private pending: { body: string; next: ClientState; consumed: Uint8Array[]; sent: PendingCommit } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** The leaf whose commits count here (see COMMITTER_LEAF). */
  private readonly committerLeaf = COMMITTER_LEAF;

  /** `joinedAt`: the epoch this browser came in at; chat from before it can't be read here. */
  constructor(private readonly l: Lib, state: ClientState, private readonly joinedAt: number) { this.state = state; }

  /** One operation at a time, in the order they were asked for, whether or not the one before worked. */
  private run<T>(f: () => Promise<T>): Promise<T> {
    const next = this.queue.then(f, f);
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** Commits only from the committer's leaf, and no standalone proposals from anyone. */
  private readonly policy: IncomingMessageCallback = (incoming) => (incoming.kind === 'commit' && incoming.senderLeafIndex === this.committerLeaf ? 'accept' : 'reject');

  get inGroup(): boolean { return this.state !== null; }
  epoch(): number { return this.state ? Number(this.state.groupContext.epoch) : -1; }
  members(): string[] { return this.state ? [...leaves(this.state.ratchetTree).values()] : []; }
  /** This browser is done with the group (it left, or the part of the call closed): nothing more is read or sent with it. */
  leave(): Promise<void> { return this.run(async () => { this.state = null; this.pending = null; }); }

  private privateOf(body: string): PrivateMessage {
    const m = decode(this.l, body);
    if (m.wireformat !== 'mls_private_message') throw new MlsError('Expected an encrypted message.');
    return m.privateMessage;
  }

  /**
   * The organizer's browser: one commit adding these checked key packages (up to MAX_ADDS) and removing these
   * identities, or only moving the keys on (`rekey`). It takes effect once the API has taken it (`settle`);
   * until then the same commit is sent again. Key packages that can't be used come back in `refused`.
   */
  commit(adds: { identity: string; kp: KeyPackage }[], removes: string[], opts: { rekey: boolean }): Promise<{ commit: PendingCommit | null; refused: string[] }> {
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
        add.push(a);
      }
      const removed = [...new Set(removes)].filter((id) => { const leaf = byId.get(id); return leaf !== undefined && leaf !== this.committerLeaf; });
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
      try { m = decode(this.l, body); } catch { return 'refused'; }
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
   * member can derive every sender's key to decrypt them. A key is never used by two senders (RFC 9605 §4.4.1),
   * and no two groups share one: each comes from its own group's exporter secret.
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
   * (malformed, replayed, not chat) is `unreadable`, and leaves the group as it was.
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
