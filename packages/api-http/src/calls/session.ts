import { b64u, randomBytes } from '../transport/ids';
import { Box, Live, unref } from '../transport/live';
import { type ClientEvent } from '../transport/options';
import { type ChatPayload, groupName, MlsError, MlsGroup, MlsKeys } from './mls';
import { HttpMoveOut } from './moves';
import { AlcoveApiError, type AudioPiece, type BoardCheck, type BoardOpen, type BoardTimerMinutes, type BoardVotesEach, type BreakoutPlan, CALL_CHAT_MAX, CALL_DATA_OVERHEAD, CALL_VOID_KEY_INDEX, type CallAction, type CallAnswer, type CallCrypto, CallEndResultSchema, type CallFollowUps, type CallMediaKeys, type CallMls, type CallMoment, type CallMoveOut, type CallReaction, type CallSession, type CallState, type CallTicket, type CallWorkspaceSwitch, type CaptionLanguage, type CaptionTranslation, type CaptureDevicePart, type CatchUp, type CatchUpRange, type CatchUpWindow, type DocFollowUpTick, type DocumentRole, errorCode, isTimeZone, type LineAudio, LIVE_TRANSCRIPT_LINES, MAIN_PLACE, type MoveMedia, type MoveOut, type PersonalApi, type PresentStart, reactionTarget, type ScreenFrame, type ScreenFrameReceipt, type SeriesAnswerPart, type TranscriptClip, withReaction } from '@alcove/api';
import { type KeyPackage } from 'ts-mls';
import { z } from 'zod';

/** Where this browser is, as an IANA name, when it knows and the API would too: the day a call's new home and folder are named after. */
function hereZone(): { timeZone?: string } {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone && isTimeZone(timeZone) ? { timeZone } : {};
  } catch {
    return {};
  }
}

/* ---------- live call: server is the source of truth; the client keeps the clock ticking ---------- */
interface CallTransport {
  get(id: string): Promise<CallState>;
  act(id: string, a: CallAction): Promise<CallState>;
  audio(id: string, p: AudioPiece): Promise<CallState>;
  transcribe(id: string, c: TranscriptClip, speaker: string): Promise<CallState>;
  frame(id: string, f: ScreenFrame): Promise<ScreenFrameReceipt>;
  shareEnded(id: string, share: string): Promise<void>;
  /** Says this browser is looking at the live notes. True when that refreshed them. */
  watchNotes(id: string): Promise<boolean>;
  watchIdeas(id: string): Promise<boolean>;
  followUps(id: string): Promise<CallFollowUps>;
  tickDocument(id: string, t: DocFollowUpTick): Promise<CallFollowUps>;
  previewWorkspace(id: string, workspaceId: string): Promise<CallWorkspaceSwitch>;
  boardCheck(id: string, workspaceId: string, documentId: string): Promise<BoardCheck>;
  catchUp(id: string, range: CatchUpRange): Promise<CatchUp>;
  askSoFar(id: string, question: string, range: CatchUpRange): Promise<CallAnswer>;
  catchUpWindow(id: string): Promise<CatchUpWindow>;
  moment(id: string, lineId: string): Promise<CallMoment>;
  hear(id: string, note: string, line: string): Promise<LineAudio>;
  personal(id: string): PersonalApi;
  askEarlier(id: string, question: string, timeZone: string): Promise<SeriesAnswerPart[]>;
  translate(id: string, lines: string[], language: CaptionLanguage): Promise<CaptionTranslation[]>;
  /** `end`: whoever hosts ends the call for everyone; otherwise this connection just leaves (refused for whoever hosts). */
  leave(id: string, o: { end: boolean; onPurpose?: boolean | undefined; keepalive?: boolean | undefined }): Promise<z.infer<typeof CallEndResultSchema> | null>;
  handOff(id: string, to: string): Promise<void>;
  mls(id: string, after: number): Promise<CallMls>;
  commit(id: string, c: { generation: number; group: string; epoch: number; commit: string; welcome?: string; added: string[]; removed: string[] }): Promise<{ epoch: number }>;
  message(id: string, m: { generation: number; group: string; epoch: number; message: string }): Promise<void>;
  keyPackage(id: string, k: { generation: number; keyPackage: string }): Promise<void>;
  back(id: string, k: { generation: number }): Promise<void>;
  room(id: string): Promise<{ token: string }>;
  moveStart(id: string, media: MoveMedia): Promise<{ code: string; expiresAt: string }>;
  moveCurrent(id: string): Promise<MoveOut | null>;
  moveConfirm(id: string, media: MoveMedia): Promise<void>;
  moveCancel(id: string): Promise<void>;
}


/**
 * How a call keeps up: how often it checks while nothing nudges it, how often it says it's showing the live notes, how
 * long a new send key waits, how often the keys move on anyway, and how often a move to another device is checked on.
 */
interface CallTiming { pollMs: number; notesMs: number; ideasMs: number; switchMs: number; rekeyMs: number; movePollMs: number }

/** Epoch keys use 127 indices in each half of LiveKit's ring, all below the void index, which stays free for sending between two parts of the call. */
const RING_HALF = Math.floor(CALL_VOID_KEY_INDEX / 2);

/** Asking to come back in after being taken out waits at least this long between tries (the keys move on first). */
const BACK_WAIT_MS = 3000;

/**
 * Where an epoch's keys sit in LiveKit's key ring. Consecutive generations use different halves, so the keys
 * of a group being left (when the connection that hosts changes) stay put while people still send with them.
 * Each part of the call has its own group, but a browser only ever holds one part's keys for any sender, so the
 * parts can share the indices.
 */
export const keyIndex = (generation: number, epoch: number): number => (generation % 2) * RING_HALF + (epoch % RING_HALF);

/** How many epochs' keys a browser keeps to decrypt with: frames still under a slightly older key play. */
const KEEP_EPOCHS = 4;

/*
 * Data browsers send each other through LiveKit (pointers and marks on shared screens), sealed here: AES-GCM under a key
 * derived with HKDF from the sender's media key for its epoch (so a key never serves media and data both), bound to the
 * topic and the sender. A sealed message is a version byte, the key's ring index, a 12-byte nonce and the ciphertext.
 * LiveKit's own data encryption runs underneath, but a browser can't tell on arrival whether a packet came through it.
 */
const DATA_VERSION = 1;

const DATA_HEAD = 14;

const DATA_LABEL = 'alcove/call-data/v1';

const utf8 = new TextEncoder();

const dataBound = (topic: string, identity: string) => utf8.encode(`${DATA_LABEL}\n${topic}\n${identity}`);

async function dataKeyFrom(raw: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(raw), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(DATA_LABEL) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * After someone is only added, the wait before sending with the new key is short: whoever was just let in is
 * still connecting, and can't hear anyone until everyone does. After someone leaves, or the keys move on by
 * themselves, it's the full wait, so nobody still on the old keys misses a beat.
 */
const ADDED_SWITCH_MS = 500;

/**
 * The first wait between checks after asking to join; each wait doubles up to the usual pace. An invited person is
 * let in by the host's browser within moments, so they're in after one or two quick checks instead of a full one.
 */
const WAIT_FIRST_MS = 150;

type MediaEpoch = CallMediaKeys['epochs'][number];

type SendKey = NonNullable<CallMediaKeys['send']>;


/** One part of the call's MLS group as this browser keeps it: the group, its media keys, and when the host's browser last moved its keys on. */
interface Held {
  group: MlsGroup;
  /** The latest few epochs' keys, to decrypt with. */
  epochs: { tag: string; entry: MediaEpoch }[];
  /** This browser's own key to send with in this group (the same object until it changes). */
  send: { tag: string; key: SendKey } | null;
  switchTimer: ReturnType<typeof setTimeout> | null;
  switchFirst: number | null;
  lastCommit: number;
  /** Where in the log the welcome this browser joined it from was (-1 for a group it started): a newer one means it was taken out and put back. */
  welcome: number;
}

const held = (group: MlsGroup, welcome = -1): Held => ({ group, epochs: [], send: null, switchTimer: null, switchFirst: null, lastCommit: Date.now(), welcome });


export class HttpCall extends Live<CallState> implements CallSession {
  readonly crypto = new Box<CallCrypto>({ status: 'joining', place: MAIN_PLACE, members: [], everyone: [], media: null, chat: [], missedChat: false });
  private hidden = new Set<string>();
  /** How far this browser has read the call's MLS log. */
  private after = 0;
  private generation: number;
  /** The groups this browser keeps, by part of the call: the host's browser every part's, anyone else's the one they're in. */
  private groups = new Map<string, Held>();
  /** The part of the call this browser is in (for the organizer, the room it's visiting): its media and chat use that part's group. */
  private place: string = MAIN_PLACE;
  /** The part of the call this browser was last in, in this generation: when it changes, this browser is moving. */
  private lastIn: string | null = null;
  /** Chat sent in this part of the call before this browser got there, which it can't read. */
  private missedHere = false;
  /** The host's browser: whom it may add now and how, whom the host let in, key packages it couldn't use (by their bytes), and asks already shown. */
  private pending = new Map<string, 'auto' | 'ask'>();
  private approved = new Set<string>();
  private refused = new Set<string>();
  private shownAsks = new Set<string>();
  /** A refused commit waits before the next one, longer each time, so a refusal can never turn into a loop. */
  private commitAfter = 0;
  private refusals = 0;
  /**
   * Chat and reactions waiting to go out (encrypted in the sync loop, so nothing else touches the keys meanwhile), and
   * what was sent, by body, until it shows up in the log. Each goes to the part of the call it was written in, or not at all.
   */
  private outbox: { local: string; payload: ChatPayload; place: string; tries: number; sealed: { message: string; epoch: number; generation: number } | null }[] = [];
  private sent = new Map<string, string>();
  private media: CallMediaKeys | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private fetching: Promise<void> | null = null;
  private fetchAgain = false;
  /** A monotonic deadline: log-only chat activity must not postpone recovery of a lost call-state nudge. */
  private nextStateRead = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Checks in a row while not in the call's group, so the first come quickly and the rest settle to the usual pace. */
  private waits = 0;
  private closed = false;
  /** A deliberate departure must follow any return already sent, and never start another meanwhile. */
  private departures = 0;
  private returning: Promise<void> | null = null;
  /** When this connection may next ask to come back in, after being taken out while it was away. */
  private backAfter = 0;
  /** How many things here are showing the live notes, the next time this browser says so, and whether it's saying so now. */
  private notesWatchers = 0;
  private notesTimer: ReturnType<typeof setTimeout> | null = null;
  private notesLook: Promise<void> | null = null;
  private ideasWatchers = 0;
  private ideasTimer: ReturnType<typeof setTimeout> | null = null;
  private ideasLook: Promise<void> | null = null;
  /** How many things here are showing the call's follow-ups, and when this browser next reads them. */
  private followUpWatchers = 0;
  private followUpsTimer: ReturnType<typeof setTimeout> | null = null;
  readonly followUps = new Box<CallFollowUps | null>(null);
  /**
   * This connection hosts the call (the organizer's, or standing in for them), as the log last said: its browser makes
   * and commits for every part of the call's group in this generation (CallMls.committer). Anyone else is in one group.
   */
  private hosting: boolean;
  readonly personal: PersonalApi;

  constructor(initial: CallState, readonly ticket: CallTicket, private readonly mls: MlsKeys, private readonly timing: CallTiming, private readonly t: CallTransport,
    private readonly emit: (level: ClientEvent['level'], msg: string, context: ClientEvent['context']) => void) {
    super(initial, (s) => s.phase === 'in-call');
    this.generation = initial.generation;
    this.hosting = initial.isHost;
    this.personal = t.personal(initial.callId);
  }
  /** In the group of the part of the call this browser is in. */
  private get inPlace() { return this.groups.get(this.place)?.group.inGroup ?? false; }

  /** A browser joining as the host starts the call's main group; anyone else starts asking to be let in. */
  async start(): Promise<void> {
    if (this.hosting) await this.open(MAIN_PLACE);
    await this.sync();
  }
  /** The host's browser: one part of the call's group, with only itself in it. Its first commit lets people in. */
  private async open(place: string): Promise<void> {
    this.groups.set(place, held(await this.mls.create(groupName(this.state.callId, this.generation, place))));
    await this.keysMoved(place, true);
  }
  /** Done with a group: this browser left that part of the call, the part closed, or the call moved to a new generation. */
  private async drop(place: string, why: string): Promise<void> {
    const h = this.groups.get(place);
    if (!h) return;
    if (h.switchTimer) clearTimeout(h.switchTimer);
    this.groups.delete(place);
    await h.group.leave();
    this.publishMedia();
    this.emit('debug', 'left a part of the call’s group', { why, room: place !== MAIN_PLACE });
  }

  /** The server's state, minus notices this screen has dismissed. */
  private take(s: CallState) {
    // Mutation replies and background reads can cross. A late reply never restores an older queue, vote or room.
    if (s.revision < this.state.revision) return;
    if (s.revision === this.state.revision && Date.parse(s.attention.serverNow) < Date.parse(this.state.attention.serverNow)) return;
    this.apply({ ...s, notices: s.notices.filter((n) => !this.hidden.has(n.id)) });
  }
  private notify(text: string) { this.set({ ...this.state, notices: [...this.state.notices, { id: b64u(randomBytes(8)), kind: 'info', text }] }); }
  private patch(p: Partial<CallCrypto>) { this.crypto.set({ ...this.crypto.getSnapshot(), ...p }); }
  refresh = async (what?: { call: boolean; log: boolean } | undefined) => {
    await Promise.all([(what?.call ?? true) ? this.fetchState() : undefined, (what?.log ?? true) ? this.sync() : undefined]);
  };
  /** One state fetch at a time, and one more straight after if a nudge came meanwhile. */
  private fetchState(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.fetching) { this.fetchAgain = true; return this.fetching; }
    this.nextStateRead = performance.now() + this.timing.pollMs * 4;
    this.fetching = (async () => {
      try {
        do {
          this.fetchAgain = false;
          this.take(await this.t.get(this.state.callId));
          this.nextStateRead = performance.now() + this.timing.pollMs * 4;
        } while (this.fetchAgain && !this.closed);
      } finally { this.fetching = null; }
    })();
    return this.fetching;
  }

  /**
   * Says this browser is showing the live notes, and goes on saying so while anything here is. It's what keeps them up
   * to date; when a look refreshed them, the call is fetched straight away, as a nudge would have it.
   */
  watchNotes = () => {
    if (++this.notesWatchers === 1) this.lookAtNotes();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.notesWatchers === 0 && this.notesTimer) { clearTimeout(this.notesTimer); this.notesTimer = null; }
    };
  };
  private lookAtNotes() {
    if (this.closed || this.notesLook) return;
    this.notesLook = this.t.watchNotes(this.state.callId).then((refreshed) => (refreshed ? this.fetchState() : undefined))
      // Notes that don't refresh say so in the call. A look that doesn't arrive is only one look.
      .catch((e: unknown) => this.emit('debug', 'live notes not looked at', { code: errorCode(e) }))
      .finally(() => {
        this.notesLook = null;
        if (this.closed || !this.notesWatchers) return;
        this.notesTimer = setTimeout(() => this.lookAtNotes(), this.timing.notesMs);
        unref(this.notesTimer);
      });
  }

  /**
   * Says this browser has the board open, and goes on saying so while anything here does. It's what has ideas from the call
   * looked for; when a look found some, the call is fetched straight away, as a nudge would have it.
   */
  watchIdeas = () => {
    if (++this.ideasWatchers === 1) this.lookForIdeas();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.ideasWatchers === 0 && this.ideasTimer) { clearTimeout(this.ideasTimer); this.ideasTimer = null; }
    };
  };
  private lookForIdeas() {
    if (this.closed || this.ideasLook) return;
    this.ideasLook = this.t.watchIdeas(this.state.callId).then((found) => (found ? this.fetchState() : undefined))
      // A look that doesn't arrive is only one look: the next one is a moment away.
      .catch((e: unknown) => this.emit('debug', 'ideas not looked for', { code: errorCode(e) }))
      .finally(() => {
        this.ideasLook = null;
        if (this.closed || !this.ideasWatchers) return;
        this.ideasTimer = setTimeout(() => this.lookForIdeas(), this.timing.ideasMs);
        unref(this.ideasTimer);
      });
  }
  ideasDone = (ids: string[]) => this.space({ type: 'board-ideas-done', ids });

  /** Says this browser is showing the follow-ups: they're read now and every few seconds until nothing here is. */
  watchFollowUps = () => {
    if (++this.followUpWatchers === 1) void this.readFollowUps();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.followUpWatchers === 0 && this.followUpsTimer) { clearTimeout(this.followUpsTimer); this.followUpsTimer = null; }
    };
  };
  private async readFollowUps(): Promise<void> {
    if (this.closed) return;
    // A read that doesn't arrive is only one read, and what it would have said is still here.
    await this.t.followUps(this.state.callId).then((f) => this.followUps.set(f), (e: unknown) => this.emit('debug', 'follow-ups not read', { code: errorCode(e) }));
    if (this.closed || !this.followUpWatchers) return;
    this.followUpsTimer = setTimeout(() => { void this.readFollowUps(); }, this.timing.notesMs);
    unref(this.followUpsTimer);
  }

  /** Keeps up with the call's MLS log: one run at a time, and another straight after if something asked meanwhile. */
  private sync(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.step();
          const status = this.crypto.getSnapshot().status;
          if (!this.closed && status !== 'denied' && status !== 'removed' && status !== 'away' && status !== 'failed' && performance.now() >= this.nextStateRead) await this.fetchState();
        } while (this.again && !this.closed);
      } catch (e) {
        this.emit('warn', 'call keys not in step', { code: e instanceof MlsError ? 'mls' : errorCode(e) });
      } finally {
        this.running = null;
        this.schedule();
      }
    })();
    return this.running;
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (this.closed) return;
    const st = this.crypto.getSnapshot().status;
    if (st === 'denied' || st === 'removed' || st === 'away' || st === 'failed') return;
    // While waiting (or moving) there's no group to be nudged through, so this is how the welcome arrives; after that it's a backstop.
    // Soon after asking it checks often, since the host's browser lets invited people in within moments; a little
    // apart, so many browsers asking at once don't check in step. Rejoining a new group keeps the usual pace.
    this.waits = st === 'waiting' ? this.waits + 1 : 0;
    const quick = Math.min(this.timing.pollMs, WAIT_FIRST_MS * 2 ** (this.waits - 1)) * (0.8 + Math.random() * 0.4);
    this.timer = setTimeout(() => {
      void this.sync();
      // sync checks the independent state deadline even if chat keeps restarting this keys timer.
    }, st === 'in' ? this.timing.pollMs * 4 : st === 'waiting' ? quick : this.timing.pollMs);
    unref(this.timer);
  }
  /** Out of the call (turned away, removed, this call went on elsewhere, or someone else hosts while this organizer's connection was away) or out of step: stop keeping up. */
  private out(status: 'denied' | 'removed' | 'away' | 'failed', why: string) {
    for (const h of this.groups.values()) if (h.switchTimer) clearTimeout(h.switchTimer);
    this.media = null;
    this.patch({ status, media: null });
    this.emit(status === 'failed' ? 'warn' : 'info', 'call keys stopped', { status, why });
  }

  private async step(): Promise<void> {
    const id = this.state.callId;
    let log: CallMls;
    try {
      log = await this.t.mls(id, this.after);
    } catch (e) {
      const code = errorCode(e);
      // Removed (or the pass is over): this browser is out of the call. Ended: there's nothing left to keep up with.
      if (code === 'forbidden' || code === 'unauthenticated') { this.out('removed', code); return; }
      if (code === 'conflict' || code === 'not-found') { this.close(); return; }
      throw e;
    }
    const was = this.crypto.getSnapshot().status;
    if (log.admission === 'denied') { this.out(was === 'waiting' || was === 'joining' ? 'denied' : 'removed', 'admission'); return; }
    if (log.admission === 'out') { await this.comeBack(log); return; }
    if (log.admission === 'away') { this.out('away', 'admission'); return; }
    // Hosting (or not) is the log's to say: a hand-off, or the organizer coming back, moves it, always with a new generation.
    this.hosting = log.admission === 'in' && log.committer === this.ticket.identity;
    if (log.generation !== this.generation) {
      // The connection that hosts changed: every part of the call starts over in new groups, which the new host's browser
      // makes, and everyone already let in rejoins. A browser that hosts now makes them below (commitAll).
      this.generation = log.generation;
      for (const place of [...this.groups.keys()]) await this.drop(place, 'generation');
      this.pending.clear(); this.approved.clear(); this.refused.clear();
      this.lastIn = null;
    }
    // Sent to another part of the call, or the organizer went there. The screen hears of it only along with the keys that
    // go with it (below), so nothing heard in one part is ever taken for something said in the other.
    // What was said in the part it's leaving goes off the screen at once: the call's state for the new part follows.
    const moved = log.place !== this.place;
    if (moved) {
      this.place = log.place;
      this.missedHere = false;
      this.set({ ...this.state, transcript: [], attention: { ...this.state.attention, place: log.place, hands: [], questions: [], signals: [], cues: [] } });
    }
    // Anyone but whoever hosts is in one group at a time: one the API no longer counts them in (they were sent elsewhere, or its room closed) is done with.
    if (!this.hosting) for (const place of [...this.groups.keys()]) if (place !== log.group) await this.drop(place, 'moved');
    // To be added to a group (a new generation, or another part of the call) without a key package left: a fresh one.
    if (log.keys && !this.hosting) {
      try {
        await this.t.keyPackage(id, { generation: log.generation, keyPackage: await this.mls.fresh() });
        this.emit('info', 'sent keys to join another group', { generation: log.generation, room: log.place !== MAIN_PLACE });
      } catch (e) {
        if (errorCode(e) !== 'conflict') throw e;
      }
    }
    let ended: 'failed' | null = null;
    for (const item of log.items) {
      try {
        if (item.kind === 'welcome') {
          // Only into the group the API counts this browser in now: a welcome from before a move is spent. A newer one into the
          // group it holds means it was taken out and put back before it noticed: that group is the one it's in now.
          const h = this.groups.get(item.group);
          if (!this.hosting && item.group === log.group && (!h || h.welcome < item.seq)) {
            for (const place of [...this.groups.keys()]) await this.drop(place, 'moved');
            this.groups.set(item.group, held(await this.mls.join(item.body, { group: groupName(id, this.generation, item.group), committer: log.committer }), item.seq));
            await this.keysMoved(item.group, true);
          }
        } else if (item.kind === 'commit') {
          const h = this.groups.get(item.group);
          if (h) {
            const before = h.group.members();
            const r = await h.group.process(item.body);
            if (r === 'applied') { const now = h.group.members(); await this.keysMoved(item.group, false, before.every((x) => now.includes(x)) && now.length > before.length); }
            // Taken out of that group: whether that's out of the call too is the API's to say (admission), next time round.
            else if (r === 'removed') { await this.drop(item.group, 'removed'); this.again = true; }
            else if (r === 'behind') ended = 'failed';
            else if (r === 'refused') this.emit('warn', 'a commit in the call’s log was refused', { seq: item.seq });
          }
        } else await this.read(item.seq, item.group, item.body, log.generation);
      } catch (e) {
        // One entry that can't be used doesn't hold up the rest. A welcome that can't be opened leaves this browser outside the group.
        this.emit('warn', 'an entry in the call’s log couldn’t be used', { kind: item.kind, seq: item.seq, code: e instanceof MlsError ? 'mls' : errorCode(e) });
        if (item.kind === 'welcome') ended = 'failed';
      }
      this.after = Math.max(this.after, item.seq);
      if (ended) break;
    }
    if (ended) { this.out(ended, 'log'); return; }
    this.after = Math.max(this.after, log.latest);
    if (log.more) { this.again = true; return; }
    // Everything up to the server's epoch has been read; still behind it means a commit couldn't be applied here.
    if (!this.hosting) {
      for (const g of log.groups) {
        const h = this.groups.get(g.id);
        if (h && h.group.epoch() < g.epoch) { this.out('failed', 'behind'); return; }
      }
    }
    let newAsk = false;
    if (this.hosting) {
      this.pending = new Map(log.groups.flatMap((g) => g.pending.map((p): [string, 'auto' | 'ask'] => [p.id, p.admit])));
      for (const p of this.pending) if (p[1] === 'ask' && !this.shownAsks.has(p[0])) { this.shownAsks.add(p[0]); newAsk = true; }
      await this.commitAll(log.groups);
    }
    const inPlace = this.inPlace;
    if (inPlace) {
      this.lastIn = this.place;
      if (log.earlierChat) this.missedHere = true;
    }
    await this.flushChat();
    const status: CallCrypto['status'] = inPlace ? 'in' : log.admission === 'waiting' ? 'waiting' : this.lastIn !== null && this.lastIn !== this.place ? 'moving' : 'joining';
    const everyone = [...new Set([...this.groups.values()].flatMap((h) => h.group.members()))];
    this.publish({ status, members: inPlace ? this.groups.get(this.place)?.group.members() ?? [] : [], everyone, missedChat: this.missedHere });
    // Let in (or into a new part of the call): who's in it and what's been said there is this browser's to see now. Someone new asking: the host sees them.
    if ((status === 'in' && was !== 'in') || newAsk || moved) await this.fetchState();
  }

  /**
   * Taken out while this connection was away (it dropped for longer than LiveKit waits, or its tab slept), by nobody's
   * choice: back in as it is, the same connection and person. Whatever groups it held are no use now. The organizer's
   * browser takes it out of its group first, so until then the API says to wait; once back, the API asks for keys
   * (`keys`) as for anyone on their way into a group, and it joins its part of the call's group again.
   */
  private async comeBack(log: CallMls): Promise<void> {
    // A closed call never comes back by itself, whatever a check it sent before closing says: its page let go (left,
    // moved or went away), and a slow answer mustn't bring it back in with nobody there.
    if (this.closed || this.departures > 0) return;
    const now = Date.now();
    if (now < this.backAfter) return;
    this.backAfter = now + BACK_WAIT_MS;
    for (const place of [...this.groups.keys()]) await this.drop(place, 'removed');
    if (this.closed || this.departures > 0) return;
    this.patch({ status: 'joining' });
    const returning = this.t.back(this.state.callId, { generation: log.generation });
    this.returning = returning;
    try {
      await returning;
      this.emit('info', 'back in the call after its connection dropped', { generation: log.generation });
    } catch (e) {
      if (errorCode(e) !== 'conflict') throw e;
      this.emit('debug', 'not back in yet', { code: 'conflict' });
    } finally {
      this.returning = null;
    }
  }

  /** Chat from the log, in order, from the part of the call this browser is in. The sender's own message takes its place there, so everyone sees chat in the same order. */
  private async read(seq: number, place: string, body: string, generation: number): Promise<void> {
    const id = `${generation}:${seq}`;
    const local = this.sent.get(body);
    if (local !== undefined) {
      this.sent.delete(body);
      const s = this.crypto.getSnapshot();
      const mine = s.chat.find((m) => m.id === local);
      if (mine) this.patch({ chat: [...s.chat.filter((m) => m.id !== local), { ...mine, id, sending: false }] });
      // A reaction of this browser's own is already shown.
      return;
    }
    const h = this.groups.get(place);
    if (!h || place !== this.place) return;
    const m = await h.group.decrypt(body);
    if (m.kind === 'chat') {
      const s = this.crypto.getSnapshot();
      this.patch({ chat: [...s.chat, { id, from: m.from, isMe: m.from === this.ticket.identity, text: m.text, at: m.at, place, sending: false, reactions: [] }] });
    } else if (m.kind === 'react') {
      // Only to a message of the part of the call it was sent in: one this browser never had (sent before it came in), or
      // one from another part, changes nothing here.
      this.patch({ chat: withReaction(this.crypto.getSnapshot().chat, m.target, place, m.reaction, m.from, m.on) });
    } else if (m.kind === 'before') {
      this.missedHere = true;
    } else this.emit('debug', 'a chat message couldn’t be read', { seq });
  }

  /**
   * The host's browser: a group for every part of the call that's open (and none for a part that's closed), made here
   * the first time (a browser that just started hosting makes them all), then for each, one commit that lets in whoever
   * may come in now (up to 50 at a time), takes out whoever left or was sent elsewhere, and otherwise moves the keys on
   * every few minutes. The API takes each in order or refuses it.
   */
  private async commitAll(groups: CallMls['groups']): Promise<void> {
    for (const place of [...this.groups.keys()]) if (!groups.some((g) => g.id === place)) await this.drop(place, 'closed');
    for (const g of groups) if (!this.groups.has(g.id)) await this.open(g.id);
    // Groups people are leaving go first, so whoever is moving is out of the old part's keys before they're in the new part's.
    for (const g of [...groups].sort((a, b) => Number(b.departed.length > 0) - Number(a.departed.length > 0))) {
      if (Date.now() < this.commitAfter) return;
      if (!(await this.commit(g))) return;
    }
  }
  /** One group's commit. False when it was refused, so the others wait too. */
  private async commit(g: CallMls['groups'][number]): Promise<boolean> {
    const id = this.state.callId;
    const h = this.groups.get(g.id);
    if (!h) return true;
    const refused: string[] = [];
    const adds: { identity: string; kp: KeyPackage }[] = [];
    const bodies = new Map(g.pending.map((p) => [p.id, p.keyPackage]));
    for (const p of g.pending) {
      if (this.refused.has(p.keyPackage) || (p.admit === 'ask' && !this.approved.has(p.id))) continue;
      const kp = await this.mls.checked({ identity: p.id, keyPackage: p.keyPackage });
      if (kp) adds.push({ identity: p.id, kp });
      else refused.push(p.id);
    }
    const rekey = Date.now() - h.lastCommit >= this.timing.rekeyMs;
    const made = await h.group.commit(adds, g.departed.filter((who) => who !== this.ticket.identity), { rekey });
    for (const who of [...refused, ...made.refused]) {
      // A key package nobody can be added with: someone asking is told they weren't let in, rather than waiting for ever.
      this.refused.add(bodies.get(who) ?? '');
      this.emit('warn', 'a key package couldn’t be used', { pending: this.pending.get(who) ?? null });
      await this.t.act(id, { type: 'deny', identity: who }).catch((e: unknown) => this.emit('info', 'couldn’t turn away a broken key package', { code: errorCode(e) }));
    }
    const c = made.commit;
    if (!c) return true;
    try {
      await this.t.commit(id, { generation: this.generation, group: g.id, epoch: c.epoch, commit: c.commit, ...(c.welcome ? { welcome: c.welcome } : {}), added: c.added, removed: c.removed });
    } catch (e) {
      const code = errorCode(e);
      if (code === 'conflict' || code === 'invalid') {
        // Refused: the call moved on, or someone in it isn't waiting any more. It's dropped, the log is read again, and the next commit waits a little.
        await h.group.drop();
        this.refusals += 1;
        this.commitAfter = Date.now() + Math.min(30_000, 250 * 2 ** this.refusals);
        this.emit('info', 'a commit was refused', { code, refusals: this.refusals });
        this.again = true;
        return false;
      }
      // Lost on the way: it's sent again, exactly as it was, next time (or found in the log, if it arrived).
      throw e;
    }
    await h.group.settle();
    this.refusals = 0;
    h.lastCommit = Date.now();
    for (const who of c.added) this.approved.delete(who);
    await this.keysMoved(g.id, false, c.added.length > 0 && c.removed.length === 0);
    this.emit('info', 'call keys moved on', { added: c.added.length, removed: c.removed.length, epoch: c.epoch + 1, rekey: !c.added.length && !c.removed.length, room: g.id !== MAIN_PLACE });
    this.again = true;
    return true;
  }

  /** Chat waiting to go out, in order. A message that can't go after a few tries, or whose part of the call this browser has left, is taken back, and the sender is told. */
  private async flushChat(): Promise<void> {
    const id = this.state.callId;
    while (this.outbox[0]) {
      const m = this.outbox[0];
      const h = this.groups.get(m.place);
      if (m.place !== this.place || !h || !this.inPlace) {
        // Still on the way into the part of the call it was written in: it waits. Moved on since: it's taken back.
        if (m.place === this.place && this.crypto.getSnapshot().status !== 'failed') return;
        this.unsend(m.local);
        continue;
      }
      if (!m.sealed || m.sealed.generation !== this.generation) {
        try { m.sealed = { ...(await h.group.encrypt(m.payload)), generation: this.generation }; }
        catch { this.unsend(m.local); continue; }
      }
      this.sent.set(m.sealed.message, m.local);
      try {
        await this.t.message(id, { generation: m.sealed.generation, group: m.place, epoch: m.sealed.epoch, message: m.sealed.message });
        this.outbox.shift();
        // Read the log again straight away: the message takes its place there, among everyone else's.
        this.again = true;
      } catch (e) {
        const code = errorCode(e);
        m.tries += 1;
        // The keys moved on under it: encrypted again next time. Lost on the way: the same message is sent again (others read it once).
        if (code === 'conflict') { this.sent.delete(m.sealed.message); m.sealed = null; }
        if (m.tries >= 3 || code === 'invalid' || code === 'forbidden') { if (m.sealed) this.sent.delete(m.sealed.message); this.unsend(m.local); continue; }
        return;
      }
    }
  }
  private unsend(local: string) {
    const m = this.outbox.find((o) => o.local === local);
    this.outbox = this.outbox.filter((o) => o.local !== local);
    const s = this.crypto.getSnapshot();
    if (m && 'react' in m.payload) {
      const r = m.payload.react;
      this.patch({ chat: withReaction(s.chat, r.target, m.place, r.reaction, this.ticket.identity, !r.on) });
      this.notify('Your reaction wasn’t sent. Try again.');
      return;
    }
    this.patch({ chat: s.chat.filter((c) => c.id !== local) });
    this.notify('Your message wasn’t sent. Try again.');
  }

  /**
   * One group moved to a new epoch (or this browser just joined or started it): every member's media keys for it,
   * kept with the last few. This browser's own key to send with in it moves to the new one a moment later, so
   * everyone has the new keys before anyone sends with them; straight away if it's only just come in.
   */
  private async keysMoved(place: string, letIn: boolean, onlyAdded = false): Promise<void> {
    const h = this.groups.get(place);
    if (!h) return;
    const epoch = h.group.epoch();
    const tag = `${this.generation}:${epoch}`;
    if (h.epochs.at(-1)?.tag === tag) return;
    const entry: MediaEpoch = { index: keyIndex(this.generation, epoch), keys: await h.group.mediaKeys() };
    h.epochs = [...h.epochs.filter((e) => e.tag !== tag), { tag, entry }].slice(-KEEP_EPOCHS);
    const own = entry.keys[this.ticket.identity];
    if (own && (letIn || !h.send)) {
      if (h.switchTimer) clearTimeout(h.switchTimer);
      h.switchTimer = null;
      h.switchFirst = null;
      h.send = { tag, key: { index: entry.index, key: own } };
    } else if (own) this.switchSoon(h, onlyAdded ? Math.min(ADDED_SWITCH_MS, this.timing.switchMs) : this.timing.switchMs);
    this.publishMedia();
  }
  private switchSoon(h: Held, wait: number) {
    const now = Date.now();
    h.switchFirst ??= now;
    // A burst of changes doesn't keep the old key in use for long: at most twice the full wait after the first one.
    const at = Math.min(now + wait, h.switchFirst + this.timing.switchMs * 2);
    if (h.switchTimer) clearTimeout(h.switchTimer);
    h.switchTimer = setTimeout(() => this.switchNow(h), Math.max(0, at - now));
    unref(h.switchTimer);
  }
  private switchNow(h: Held) {
    h.switchTimer = null;
    h.switchFirst = null;
    const latest = h.epochs.at(-1);
    const own = latest?.entry.keys[this.ticket.identity];
    if (this.closed || !latest || !own || h.send?.tag === latest.tag || !h.group.inGroup) return;
    h.send = { tag: latest.tag, key: { index: latest.entry.index, key: own } };
    this.publish();
  }
  /** The media keys go out with the part of the call they're for, always together. */
  private publish(p: Partial<CallCrypto> = {}) {
    this.publishMedia();
    this.patch({ ...p, place: this.place, media: this.media });
  }
  /**
   * The media keys LiveKit uses: those of the part of the call this browser is in. Between two parts (let in, but
   * not in the new part's group yet), none to decrypt with and none to send with, so nothing it sends can be heard
   * or seen anywhere until it's there.
   */
  private publishMedia() {
    const h = this.groups.get(this.place);
    if (h?.group.inGroup && h.send) this.media = { epochs: h.epochs.map((e) => e.entry), send: h.send.key };
    else this.media = this.lastIn !== null ? { epochs: [], send: null } : null;
  }

  room = async () => {
    const r = await this.t.room(this.state.callId);
    return { serverUrl: this.ticket.serverUrl, roomName: this.ticket.roomName, identity: this.ticket.identity, token: r.token };
  };
  private act(a: CallAction, then?: () => void) {
    void this.t.act(this.state.callId, a).then((s) => { this.take(s); then?.(); }, (e: unknown) => this.notify(e instanceof Error ? e.message : 'That didn’t work.'));
  }
  /** Room changes move people's keys: this browser reads the log straight away rather than waiting to be nudged. */
  private actAndSync(a: CallAction) { this.act(a, () => { void this.sync(); }); }
  sendChat = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (t.length > CALL_CHAT_MAX) throw new AlcoveApiError('invalid', `Messages can be up to ${CALL_CHAT_MAX} characters.`);
    const status = this.crypto.getSnapshot().status;
    if (status === 'moving') throw new AlcoveApiError('conflict', 'You’re moving to another room. Send it once you’re there.');
    if (status !== 'in') throw new AlcoveApiError('forbidden', 'Wait until the host lets you in.');
    const local = `me:${b64u(randomBytes(6))}`;
    const s = this.crypto.getSnapshot();
    this.patch({ chat: [...s.chat, { id: local, from: this.ticket.identity, isMe: true, text: t, at: this.state.elapsed, place: this.place, sending: true, reactions: [] }] });
    this.outbox.push({ local, payload: { text: t, at: this.state.elapsed }, place: this.place, tries: 0, sealed: null });
    await this.sync();
  };
  react = async (messageId: string, reaction: CallReaction, on: boolean) => {
    const s = this.crypto.getSnapshot();
    const target = reactionTarget(s, this.place, messageId);
    const mine = target.reactions.find((r) => r.reaction === reaction)?.by.includes(this.ticket.identity) ?? false;
    if (mine === on) return;
    this.patch({ chat: withReaction(s.chat, messageId, this.place, reaction, this.ticket.identity, on) });
    this.outbox.push({ local: `react:${b64u(randomBytes(6))}`, payload: { react: { target: messageId, reaction, on }, at: this.state.elapsed }, place: this.place, tries: 0, sealed: null });
    await this.sync();
  };
  /** Data keys, one per media key (each sender's, each epoch), made once. */
  private dataKeys = new WeakMap<Uint8Array, Promise<CryptoKey>>();
  private dataKey(raw: Uint8Array): Promise<CryptoKey> {
    let k = this.dataKeys.get(raw);
    if (!k) { k = dataKeyFrom(raw); this.dataKeys.set(raw, k); }
    return k;
  }
  sealData = async (topic: string, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> => {
    const send = this.media?.send;
    if (!send) return null;
    const iv = randomBytes(12);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: dataBound(topic, this.ticket.identity) }, await this.dataKey(send.key), new Uint8Array(payload)));
    const out = new Uint8Array(DATA_HEAD + sealed.length);
    out[0] = DATA_VERSION;
    out[1] = send.index;
    out.set(iv, 2);
    out.set(sealed, DATA_HEAD);
    return out;
  };
  openData = async (topic: string, from: string, sealed: Uint8Array): Promise<Uint8Array | null> => {
    if (sealed.length < CALL_DATA_OVERHEAD || sealed[0] !== DATA_VERSION) return null;
    const raw = this.media?.epochs.find((e) => e.index === sealed[1])?.keys[from];
    if (!raw) return null;
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(2, DATA_HEAD), additionalData: dataBound(topic, from) }, await this.dataKey(raw), sealed.slice(DATA_HEAD)));
    } catch {
      return null;
    }
  };
  admit = async (identity: string) => {
    await this.fetchState();
    if (!this.state.isHost) throw new AlcoveApiError('forbidden', 'Only the person hosting can let someone in.');
    // An old notification is harmless: its identity is never re-used for a new request.
    if (!this.state.waiting.some((w) => w.id === identity)) return;
    this.approved.add(identity);
    try {
      await this.sync();
      await this.fetchState();
      if (this.state.waiting.some((w) => w.id === identity)) throw new AlcoveApiError('unavailable', 'They haven’t been let in yet. Try again.');
    } finally {
      // A failed press must not silently approve a future retry of the keys loop.
      this.approved.delete(identity);
    }
  };
  deny = async (identity: string) => { this.take(await this.t.act(this.state.callId, { type: 'deny', identity })); };
  ring = async (emails: string[]) => { this.take(await this.t.act(this.state.callId, { type: 'ring', emails })); };
  setNotes = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'notes', on })); };
  /* What the call captures: pause and resume are the organizer's; anyone else asks for notes. Each resolves once the server has done it. */
  pause = async () => { this.take(await this.t.act(this.state.callId, { type: 'pause' })); };
  resume = async () => { this.take(await this.t.act(this.state.callId, { type: 'resume' })); };
  requestNotes = async (up: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'request-notes', up })); };
  declineNotes = async (requestId: string) => { this.take(await this.t.act(this.state.callId, { type: 'decline-notes', requestId })); };
  setUnavailable = async (parts: CaptureDevicePart[]) => { this.take(await this.t.act(this.state.callId, { type: 'unavailable', parts })); };
  setScreens = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'screens', on })); };
  tickFollowUp = async (id: string, done: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'follow-up', id, done })); };
  addFollowUp = async (text: string) => { this.take(await this.t.act(this.state.callId, { type: 'follow-up-add', text })); };
  private space = async (a: CallAction) => { this.take(await this.t.act(this.state.callId, a)); };
  openWorkspace = () => this.space({ type: 'workspace-open', ...hereZone() });
  previewWorkspace = (workspaceId: string) => this.t.previewWorkspace(this.state.callId, workspaceId);
  setWorkspace = (workspaceId: string) => this.space({ type: 'workspace-set', workspaceId });
  newWorkspace = (name?: string | undefined) => this.space({ type: 'workspace-new', ...(name ? { name } : {}) });
  bringDocument = (documentId: string, brought: boolean) => this.space({ type: 'workspace-bring', documentId, brought });
  askForWorkspace = (up: boolean) => this.space({ type: 'workspace-ask', up });
  grantWorkspaceAsk = (askId: string, documentId: string, role: DocumentRole) => this.space({ type: 'workspace-grant', askId, documentId, role });
  declineWorkspaceAsk = (askId: string) => this.space({ type: 'workspace-decline', askId });
  startPresenting = (what: PresentStart) => this.space({ type: 'present-start', what: what.kind === 'board' ? { kind: 'board', id: what.id, section: what.section ?? 0 } : { kind: 'workspace' } });
  movePresenting = (section: number) => this.space({ type: 'present-move', section });
  stopPresenting = (close: boolean) => this.space({ type: 'present-stop', close });
  startPlaying = (documentId: string, mediaId: string, positionMs = 0) => this.space({ type: 'play-start', documentId, mediaId, positionMs });
  pausePlaying = (positionMs: number) => this.space({ type: 'play-pause', positionMs });
  resumePlaying = () => this.space({ type: 'play-resume' });
  seekPlaying = (positionMs: number) => this.space({ type: 'play-seek', positionMs });
  stopPlaying = () => this.space({ type: 'play-stop' });
  openBoard = (from: BoardOpen) => this.space({ type: 'board-open', ...from });
  closeBoard = () => this.space({ type: 'board-close' });
  boardCheck = (workspaceId: string, documentId: string) => this.t.boardCheck(this.state.callId, workspaceId, documentId);
  startTimer = (minutes: BoardTimerMinutes) => this.space({ type: 'board-timer', minutes });
  stopTimer = () => this.space({ type: 'board-timer', minutes: null });
  startVote = (frame: string | null, per: BoardVotesEach) => this.space({ type: 'board-vote', step: 'start', frame, per });
  castVote = (sticky: string) => this.space({ type: 'board-vote', step: 'cast', sticky });
  takeBackVote = (sticky: string) => this.space({ type: 'board-vote', step: 'take-back', sticky });
  endVote = () => this.space({ type: 'board-vote', step: 'end' });
  clearVote = () => this.space({ type: 'board-vote', step: 'done' });
  tickDocumentFollowUp = async (tick: DocFollowUpTick) => { this.followUps.set(await this.t.tickDocument(this.state.callId, tick)); };
  shareFrame = (f: ScreenFrame) => this.t.frame(this.state.callId, f);
  shareEnded = (share: string) => this.t.shareEnded(this.state.callId, share);
  mute = async (identity: string, trackSid: string) => { this.take(await this.t.act(this.state.callId, { type: 'mute', identity, trackSid })); };
  stopShare = async (seat: string) => { this.take(await this.t.act(this.state.callId, { type: 'share-stop', seat })); };
  /** They're disconnected at once; the host's browser then takes them out of their group, so the keys move on without them. */
  remove = async (identity: string) => { this.take(await this.t.act(this.state.callId, { type: 'remove', identity })); await this.sync(); };
  lock = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'lock', on })); };
  stopRing = async (ringId: string) => { this.take(await this.t.act(this.state.callId, { type: 'stop-ring', ringId })); };
  setHand = (up: boolean) => this.space({ type: 'hand', up, place: this.state.attention.place });
  lowerHand = (entryId: string) => this.space({ type: 'hand-lower', entryId, place: this.state.attention.place });
  clearHands = () => this.space({ type: 'hands-clear', place: this.state.attention.place });
  postQuestion = (id: string, text: string) => this.space({ type: 'question-post', id, text, place: this.state.attention.place });
  voteQuestion = (id: string, on: boolean) => this.space({ type: 'question-vote', id, on, place: this.state.attention.place });
  resolveQuestion: CallSession['resolveQuestion'] = (id, status) => this.space({ type: 'question-resolve', id, status, place: this.state.attention.place });
  pinQuestion = (id: string | null) => this.space({ type: 'question-pin', id, place: this.state.attention.place });
  setFeedback: CallSession['setFeedback'] = (kind) => this.space({ type: 'feedback', kind, place: this.state.attention.place });
  letOthersPoint = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'others-point', on })); };
  setPointing = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'pointing', on })); };
  setSpotlight = (participantId: string | null) => this.act({ type: 'spotlight', participantId });
  openRooms = (plan: BreakoutPlan) => this.actAndSync({ type: 'rooms-open', rooms: plan.rooms, minutes: plan.minutes, board: plan.board });
  closeRooms = () => this.actAndSync({ type: 'rooms-close' });
  messageRooms = (text: string) => { if (text.trim()) this.act({ type: 'rooms-message', text }); };
  visitRoom = (roomId: string | null) => this.actAndSync({ type: 'rooms-visit', roomId });
  renameRoom = (roomId: string, name: string) => { if (name.trim()) this.act({ type: 'rooms-rename', roomId, name }); };
  moveToRoom = (email: string, roomId: string | null) => this.actAndSync({ type: 'rooms-move', email, roomId });
  pauseRoom = async (roomId: string, paused: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'rooms-pause', roomId, paused })); };
  translate = (lineIds: string[], language: CaptionLanguage) => this.t.translate(this.state.callId, lineIds, language);
  dismissNotice = (id: string) => { this.hidden.add(id); this.set({ ...this.state, notices: this.state.notices.filter((n) => n.id !== id) }); };
  startMove = async (media: MoveMedia): Promise<CallMoveOut> => {
    const id = this.state.callId;
    const move = new HttpMoveOut({
      start: (m) => this.t.moveStart(id, m), current: () => this.t.moveCurrent(id), confirm: (m) => this.t.moveConfirm(id, m), cancel: () => this.t.moveCancel(id)
    }, { pollMs: this.timing.movePollMs }, this.emit, media);
    await move.begin();
    return move;
  };
  appendAudio = async (p: AudioPiece) => { this.take(await this.t.audio(this.state.callId, p)); };
  /** Takes only the transcript from the answer, so a slow clip can't undo a newer mic or notes change. */
  /**
   * Several voices upload at once, so an answer computed before another voice's line was kept can arrive last: the
   * lines are merged by ID, newest 200 kept, rather than replaced.
   */
  transcribe = async (c: TranscriptClip, speaker: string) => {
    const place = this.place;
    const s = await this.t.transcribe(this.state.callId, c, speaker);
    // Merged only within one part of the call: an answer from before this browser moved adds nothing.
    if (place !== this.place) return;
    const byId = new Map([...this.state.transcript, ...s.transcript].map((l) => [l.id, l]));
    this.set({ ...this.state, transcript: [...byId.values()].sort((a, b) => a.at - b.at).slice(-LIVE_TRANSCRIPT_LINES) });
  };
  catchUp = (range: CatchUpRange) => this.t.catchUp(this.state.callId, range);
  askSoFar = (question: string, range: CatchUpRange) => this.t.askSoFar(this.state.callId, question, range);
  catchUpWindow = () => this.t.catchUpWindow(this.state.callId);
  moment = (lineId: string) => this.t.moment(this.state.callId, lineId);
  hear = (note: string, line: string) => this.t.hear(this.state.callId, note, line);
  askEarlier = (question: string, timeZone: string) => this.t.askEarlier(this.state.callId, question, timeZone);
  close = () => {
    this.closed = true;
    this.stopTicking();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = null;
    if (this.ideasTimer) clearTimeout(this.ideasTimer);
    this.ideasTimer = null;
    if (this.followUpsTimer) clearTimeout(this.followUpsTimer);
    this.followUpsTimer = null;
    for (const h of this.groups.values()) { if (h.switchTimer) clearTimeout(h.switchTimer); h.switchTimer = null; }
  };
  /**
   * The page is going away: everyone but whoever hosts says they've gone, in a request that outlives the page. It never
   * ends the call: the server refuses it from whoever hosts, should this browser not have heard yet that it does.
   */
  closing = () => {
    if (this.closed) return;
    this.close();
    // A failure has already been reported by the request itself, and a page going away can do nothing more.
    if (!this.hosting) this.t.leave(this.state.callId, { end: false, keepalive: true }).catch(() => undefined);
  };
  /**
   * Whoever hosts leaving ends the call for everyone; anyone else just goes (and is taken out of the group). Ending
   * takes this browser hosting as the call last said and the server agreeing: one that has only just been made host
   * is refused instead (it said "leave", not "end"), and one that has just stopped hosting simply leaves.
   */
  leave = () => {
    const end = this.state.isHost;
    return this.depart(() => this.t.leave(this.state.callId, { end, onPurpose: true }));
  };
  /** Whoever hosts leaves, and the call goes on with `to` hosting until the organizer is back. */
  handOff = (to: string) => this.depart(() => this.t.handOff(this.state.callId, to));
  /** Keep ordinary polling alive until departure succeeds, without mistaking the deliberate exit for a dropped connection. */
  private async depart<T>(send: () => Promise<T>): Promise<T> {
    this.departures++;
    try {
      // A return already on the wire finishes first: it must not arrive after the departure and put us back in.
      await this.returning?.catch((e: unknown) => this.emit('debug', 'return finished before leaving', { code: errorCode(e) }));
      const result = await send();
      this.close();
      this.set({ ...this.state, phase: 'ended' });
      return result;
    } finally {
      // A refused or failed departure is still a live call: keys, chat and recovery carry on until a retry.
      this.departures--;
    }
  }
}
