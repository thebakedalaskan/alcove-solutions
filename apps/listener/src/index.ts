/*
 * The listener (docs/superpowers/specs/2026-11-05-call-listener-design.md): a server process that hears a part of a
 * call for its notes, instead of a browser. It's a member of the call's group like anyone in it, through its own call
 * session, so it holds everyone's media keys; it joins the call's LiveKit room, opens each person's microphone with
 * that person's own key (setParticipantKey), cuts each voice into clips (@alcove/speech) and hands them on, one at a time, in order. A
 * clip that can't be sent because the API or the speech model is busy is kept and tried again until it goes or the
 * listener stops; one the API refuses for good is dropped.
 */
import { CALL_TOPIC, CallNudgeSchema, errorCode, notesAreOn, type CallCrypto, type ListenerApi, type CallSession, type TranscriptClip } from '@alcove/api';
import { ClipCutter, SPEECH_RATE, wav } from '@alcove/speech';
import { JobType, ParticipantPermission, ServerMessage, WorkerMessage, WorkerStatus } from '@livekit/protocol';
import { E2eeRequest, FfiRequest, KeyDerivationFunction, SetKeyRequest, livekitFfiRequest } from '@livekit/rtc-ffi-bindings';
import { AccessToken } from 'livekit-server-sdk';
import WebSocket from 'ws';
import { z } from 'zod';
import { AudioStream, EncryptionType, RemoteAudioTrack, Room, RoomEvent, TrackSource, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from '@livekit/rtc-node';

/** Where a listener says what it did: IDs, counts and codes only, never what was said. */
export interface ListenerLog {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
}
const quiet: ListenerLog = { info: () => undefined, warn: () => undefined };

export interface ListenOptions {
  /** The listener's own session in the call: a member of its part's group. */
  session: CallSession;
  /** Hands a clip of `speaker`'s speech on to be transcribed. Throws as the API does; busy is tried again. */
  send: (clip: TranscriptClip, speaker: string) => Promise<void>;
  /**
   * Where an epoch's keys go in the key ring: by default the epoch's own index, as browsers send with. A sender that
   * can only send under key index 0 (rtc-node's own, in tests) is heard with its newest key there.
   */
  keyIndex?: ((epoch: number) => number) | undefined;
  /** The API refused what it sent for good (`forbidden`): this listener isn't the one hearing that part of the call. */
  onDismissed?: (() => void) | undefined;
  log?: ListenerLog | undefined;
}

export interface Listening {
  /** Clips sent so far. */
  sent(): number;
  /** Ends every voice's clip in progress, sends what's still waiting (for at most `ms`), and leaves the room. */
  stop(ms?: number): Promise<void>;
}

/**
 * Gives `room` the key that opens `identity`'s frames under `keyIndex`, as a browser holds each person's key.
 *
 * Why this isn't `KeyProvider.setKey`: in @livekit/rtc-node 1.2.1, `setKey(participantIdentity, keyIndex)` never sends
 * the key, so it can't install one (https://github.com/livekit/node-sdks/issues/741). This sends the same request to
 * LiveKit's engine itself, through @livekit/rtc-ffi-bindings, the library rtc-node is built on. It needs the room's
 * engine handle, which rtc-node keeps private (`ffiHandle`): if a release moves it, this throws instead of leaving the
 * listener deaf, and the listener's tests fail.
 *
 * Remove it once rtc-node's `setKey` takes the key (https://github.com/livekit/node-sdks/pull/768, in a release after
 * 1.2.1: check that `KeyProvider.setKey` has a `key` argument). Then this whole function becomes:
 *
 *   room.e2eeManager?.keyProvider.setKey(identity, key, keyIndex);
 *
 * (`keyProvider` is private in 1.2.1 too: read it as the release exposes it), and @livekit/rtc-node stops being pinned.
 */
export function setParticipantKey(room: Room, identity: string, key: Uint8Array, keyIndex: number): void {
  const ffi: unknown = Reflect.get(room, 'ffiHandle');
  const roomHandle: unknown = typeof ffi === 'object' && ffi !== null ? Reflect.get(ffi, 'handle') : undefined;
  if (typeof roomHandle !== 'bigint') throw new Error('@livekit/rtc-node no longer keeps the room’s engine handle where setParticipantKey reads it: see its comment.');
  const setKey = new SetKeyRequest({ participantIdentity: identity, key, keyIndex });
  livekitFfiRequest(new FfiRequest({ message: { case: 'e2ee', value: new E2eeRequest({ roomHandle, message: { case: 'setKey', value: setKey } }) } }).toBinary());
}

/** How long to wait before trying a clip again while the API or the speech model is busy: sooner at first. */
const RETRY_MS = [1000, 2000, 5000, 10_000];
/** Codes the API answers when trying again later can work. Anything else is a refusal that won't change. */
const BUSY = new Set(['unavailable', 'network', 'timeout']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function listen(o: ListenOptions): Promise<Listening> {
  const log = o.log ?? quiet;
  const { session } = o;
  const callId = session.ticket.callId;
  const join = await session.room();
  const room = new Room();
  // The same frame encryption as a browser's: AES-GCM, keys derived with HKDF, no ratchet, a ring of 256. No shared
  // key: each sender's frames are opened with that sender's own (setParticipantKey).
  await room.connect(join.serverUrl, join.token, {
    autoSubscribe: true, dynacast: false,
    encryption: { keyProviderOptions: { ratchetWindowSize: 0, failureTolerance: -1, keyRingSize: 256, keyDerivationFunction: KeyDerivationFunction.HKDF }, encryptionType: EncryptionType.GCM }
  });

  // Everyone's keys, as the group gives them, for every epoch it still holds.
  const set = new Map<string, Uint8Array>();
  const useKeys = (c: CallCrypto) => {
    if (!c.media) return;
    for (const e of c.media.epochs) {
      const index = o.keyIndex ? o.keyIndex(e.index) : e.index;
      for (const [identity, key] of Object.entries(e.keys)) {
        const k = `${identity}:${index}`;
        if (set.get(k) === key) continue;
        setParticipantKey(room, identity, key, index);
        set.set(k, key);
      }
    }
  };
  useKeys(session.crypto.getSnapshot());
  const unfollow = session.crypto.subscribe(() => useKeys(session.crypto.getSnapshot()));

  // Clips go one at a time, in the order they were heard.
  let queue: Promise<void> = Promise.resolve();
  let stopping = false;
  let sent = 0;
  /**
   * Whether notes are on (or on with the host's browser unable to capture), as the call says. While they're paused or
   * off nothing is cut or sent: the pause notice promises nothing is transcribed or sent until they resume, and what's
   * heard then is dropped here, never taken to the API to be refused there.
   */
  const notesOn = () => notesAreOn(session.getSnapshot().capture.mode);
  const deliver = async (clip: TranscriptClip, speaker: string) => {
    const ctx = { callId, segment: clip.segment, atMs: Math.round(clip.at * 1000), durationMs: Math.round(clip.durationMs) };
    for (let tried = 0; ; tried++) {
      if (!notesOn()) { log.info('clip dropped: notes are paused or off', ctx); return; }
      try {
        await o.send(clip, speaker);
        sent++;
        return;
      } catch (e) {
        const code = errorCode(e);
        if (code === 'forbidden') { log.info('the API takes nothing more from this listener', ctx); o.onDismissed?.(); return; }
        if (!BUSY.has(code)) { log.warn('clip refused; dropped', { ...ctx, code }); return; }
        if (stopping) { log.warn('clip still not sent when the listener stopped; dropped', { ...ctx, code, tried: tried + 1 }); return; }
        const wait = RETRY_MS[Math.min(tried, RETRY_MS.length - 1)] ?? 10_000;
        log.info('clip not sent yet; trying again', { ...ctx, code, retryInMs: wait });
        await sleep(wait);
      }
    }
  };

  /** Each voice heard, by identity: its cutter, and the segment it's counting in. */
  const voices = new Map<string, { sid: string; cutter: ClipCutter; reader: ReadableStreamDefaultReader<{ data: Int16Array }>; segment: number; origin: number }>();
  const segmentNow = () => session.getSnapshot().notes.recording.segment;
  // Where each segment began, by this process's clock: when the listener first saw it.
  const origins = new Map<number, number>();
  const originOf = (segment: number) => { const at = origins.get(segment) ?? performance.now(); origins.set(segment, at); return at; };

  const hear = (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (!(track instanceof RemoteAudioTrack) || pub.source !== TrackSource.SOURCE_MICROPHONE) return;
    const speaker = p.identity;
    const sid = pub.sid ?? '';
    if (voices.get(speaker)?.sid === sid) return;
    // A new microphone (another device, say) replaces the one heard before.
    unhear(speaker);
    const stream = new AudioStream(track, SPEECH_RATE, 1);
    const reader = stream.getReader();
    const cutter = new ClipCutter(({ pcm, start }) => {
      const v = voices.get(speaker);
      if (!v) return;
      const heardAt = v.origin + (start * 1000) / SPEECH_RATE;
      const clip: TranscriptClip = { data: new Blob([wav(pcm)], { type: 'audio/wav' }), segment: v.segment, at: start / SPEECH_RATE, durationMs: (pcm.length * 1000) / SPEECH_RATE, heardAt };
      queue = queue.then(() => deliver(clip, speaker));
    });
    const segment = segmentNow();
    voices.set(speaker, { sid, cutter, reader, segment, origin: originOf(segment) });
    log.info('hearing a voice', { callId, voices: voices.size });
    void (async () => {
      for (;;) {
        const next = await reader.read().catch(() => null);
        if (!next || next.done) break;
        const v = voices.get(speaker);
        if (!v) break;
        // A new segment counts from 0 again: what was heard in the last one is sent first.
        const now = segmentNow();
        if (now !== v.segment) { v.cutter.cut(); v.cutter.reset(); v.segment = now; v.origin = originOf(now); }
        // Paused or off: nothing heard is kept, so nothing said then is ever sent.
        if (!notesOn()) { v.cutter.reset(); continue; }
        const pcm = Float32Array.from(next.value.data, (s) => s / 0x8000);
        const at = Math.max(0, Math.round(((performance.now() - v.origin) * SPEECH_RATE) / 1000) - pcm.length);
        v.cutter.push(pcm, at);
      }
    })();
  };
  /** Stops hearing someone: all of them, or with `sid`, only if that's the microphone heard (their camera going is nothing to it). */
  function unhear(identity: string, sid?: string | undefined) {
    const v = voices.get(identity);
    if (!v || (sid !== undefined && v.sid !== sid)) return;
    voices.delete(identity);
    v.cutter.cut();
    void v.reader.cancel().catch(() => undefined);
  }
  // The server says when the call changed (notes going off, the call ending), as it tells browsers: from no participant,
  // so a participant's data never makes it look again.
  room.on(RoomEvent.DataReceived, (payload, from, _kind, topic) => {
    if (topic !== CALL_TOPIC || from) return;
    const nudge = CallNudgeSchema.safeParse(jsonOf(new TextDecoder().decode(payload)));
    if (nudge.success) session.refresh({ call: nudge.data.call, log: nudge.data.log }).catch((e: unknown) => log.warn('listener could not read the call again', { callId, code: errorCode(e) }));
  });
  room.on(RoomEvent.TrackSubscribed, hear);
  room.on(RoomEvent.TrackUnsubscribed, (_t, pub, p) => unhear(p.identity, pub.sid ?? ''));
  room.on(RoomEvent.ParticipantDisconnected, (p) => unhear(p.identity));
  for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.track) hear(pub.track, pub, p);
  log.info('listening', { callId });

  return {
    sent: () => sent,
    async stop(ms = 8000) {
      unfollow();
      for (const identity of [...voices.keys()]) unhear(identity);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), ms); });
      const done = await Promise.race([queue.then(() => 'done' as const), late]);
      clearTimeout(timer);
      stopping = true;
      if (done === 'late') log.warn('the last clips are slow; leaving without them', { callId, waitedMs: ms });
      await room.disconnect();
      log.info('stopped listening', { callId, sent });
    }
  };
}

export interface ServeOptions {
  /** Where LiveKit is (ws:// or wss://), and the key and secret this process registers with it under. */
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  /** The name it registers under: the one the API dispatches to (its LISTENER_AGENT). */
  agentName: string;
  /** The API, as the listener service reaches it with its key (createListenerApi in @alcove/api-http). */
  api: ListenerApi;
  /** How many parts of calls this process hears at once. */
  seats?: number | undefined;
  keyIndex?: ((epoch: number) => number) | undefined;
  log?: ListenerLog | undefined;
}

export interface Serving {
  /** The parts of calls it hears now. */
  hearing(): number;
  /** Takes no more, and leaves every call it hears once what's still waiting is sent. */
  stop(): Promise<void>;
}

/** How long a listener waits for the host's browser to let it in before it gives the call up (the API sends another). */
const LET_IN_MS = 20_000;
/** Resolves true once the session is in its part of the call's group, false if that takes longer than `ms`. */
function letIn(session: CallSession, ms: number): Promise<boolean> {
  const isIn = () => session.crypto.getSnapshot().status === 'in' && session.crypto.getSnapshot().media !== null;
  if (isIn()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { stop(); resolve(false); }, ms);
    const stop = session.crypto.subscribe(() => { if (isIn()) { clearTimeout(timer); stop(); resolve(true); } });
  });
}
/** Ways a session can be out of its call for good: turned away, taken out, or its keys out of step (it must join again). */
const OUT = new Set(['denied', 'removed', 'away', 'failed']);
/**
 * Whether this listener still has a call to hear: it's on, so are its notes (paused counts), and the listener is still
 * in it (the API takes out a listener it replaced).
 */
const needed = (session: CallSession) => { const s = session.getSnapshot(); return s.phase === 'in-call' && s.capture.mode !== 'off' && !OUT.has(session.crypto.getSnapshot().status); };

/** How often a worker tells LiveKit whether it can take more, and how long it waits before connecting again. */
const STATUS_EVERY_MS = 2500;
const RECONNECT_MS = [500, 1000, 2000, 5000];
/** The job's metadata, as the API dispatches it. */
const JobMetadata = z.object({ invite: z.string() });
/** Parsed JSON, or null for text that isn't. */
function jsonOf(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * A listener process. It registers with LiveKit as `agentName` and takes the jobs LiveKit pushes to it while it has a
 * free seat (and tells LiveKit it's full when it hasn't, so LiveKit sends them elsewhere). Each job is a part of a call:
 * it joins the call through the API with the invite the job carried, waits to be let in, hears it (`listen`), and
 * leaves once the call no longer needs hearing. A connection to LiveKit that drops is made again.
 */
export function serveDispatch(o: ServeOptions): Serving {
  const log = o.log ?? quiet;
  const seats = o.seats ?? 40;
  const held = new Set<{ stop: () => Promise<void> }>();
  let running = true;
  let socket: WebSocket | null = null;
  let status: ReturnType<typeof setInterval> | undefined;

  const hear = async (invite: string) => {
    const { session } = await o.api.join(invite);
    const callId = session.ticket.callId;
    // Out of the call at once if anything goes wrong before it hears: the API then sends another listener.
    const giveUp = async (why: string, ctx: Record<string, unknown> = {}) => {
      log.warn(why, { callId, ...ctx });
      await session.leave().catch(() => null);
    };
    if (!(await letIn(session, LET_IN_MS))) { await giveUp('listener was not let into the call in time; leaving', { waitedMs: LET_IN_MS }); return; }
    let heard: Listening;
    // Told it isn't the one hearing this any more (notes went off and on, or another was sent): it leaves.
    let dismissed: () => void = () => undefined;
    try {
      heard = await listen({ session, send: (clip, speaker) => session.transcribe(clip, speaker), keyIndex: o.keyIndex, onDismissed: () => dismissed(), log });
    } catch (e) {
      await giveUp('listener could not hear the call; leaving', { code: errorCode(e) });
      return;
    }
    let leaving: Promise<void> | null = null;
    const seat = {
      stop: () => {
        leaving ??= (async () => {
          unwatch();
          held.delete(seat);
          await heard.stop();
          await session.leave().catch((e: unknown) => log.warn('listener could not leave the call', { callId, code: errorCode(e) }));
        })();
        return leaving;
      }
    };
    held.add(seat);
    dismissed = () => { void seat.stop(); };
    const check = () => { if (!needed(session)) { log.info('the call no longer needs this listener; leaving', { callId }); void seat.stop(); } };
    const unwatchCall = session.subscribe(check);
    const unwatchKeys = session.crypto.subscribe(check);
    const unwatch = () => { unwatchCall(); unwatchKeys(); };
    if (!needed(session)) void seat.stop();
  };

  const connect = async (tried: number): Promise<void> => {
    if (!running) return;
    const token = new AccessToken(o.apiKey, o.apiSecret);
    token.addGrant({ agent: true });
    const ws = new WebSocket(new URL('/agent', o.livekitUrl.replace(/^http/, 'ws')), { headers: { authorization: `Bearer ${await token.toJwt()}` } });
    socket = ws;
    const send = (m: WorkerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(m.toBinary()); };
    ws.on('open', () => {
      send(new WorkerMessage({ message: { case: 'register', value: { type: JobType.JT_ROOM, agentName: o.agentName, allowedPermissions: new ParticipantPermission({ canSubscribe: true, canPublish: false, canPublishData: false, agent: true }), version: 'alcove-listener' } } }));
    });
    ws.on('message', (data: Buffer) => {
      const m = ServerMessage.fromBinary(new Uint8Array(data));
      const msg = m.message;
      if (msg.case === 'register') {
        log.info('listener registered with LiveKit', { agent: o.agentName, seats });
        clearInterval(status);
        status = setInterval(() => send(new WorkerMessage({ message: { case: 'updateWorker', value: { load: held.size / seats, jobCount: held.size, status: held.size < seats ? WorkerStatus.WS_AVAILABLE : WorkerStatus.WS_FULL } } })), STATUS_EVERY_MS);
      } else if (msg.case === 'availability' && msg.value.job) {
        // A seat for it, or LiveKit offers it to another worker.
        send(new WorkerMessage({ message: { case: 'availability', value: { jobId: msg.value.job.id, available: running && held.size < seats } } }));
      } else if (msg.case === 'assignment' && msg.value.job) {
        const meta = JobMetadata.safeParse(jsonOf(msg.value.job.metadata));
        if (!meta.success) { log.warn('job without an invite; ignored', {}); return; }
        hear(meta.data.invite).catch((e: unknown) => log.warn('listener could not join the call it was sent to', { code: errorCode(e) }));
      }
    });
    ws.on('close', () => {
      clearInterval(status);
      if (!running) return;
      const wait = RECONNECT_MS[Math.min(tried, RECONNECT_MS.length - 1)] ?? 5000;
      log.warn('listener lost its connection to LiveKit; connecting again', { retryInMs: wait });
      setTimeout(() => { void connect(tried + 1); }, wait);
    });
    // A failed connection closes too: 'close' connects again.
    ws.on('error', (e: Error) => log.warn('listener connection to LiveKit failed', { err: e.message }));
  };
  void connect(0);

  return {
    hearing: () => held.size,
    async stop() {
      running = false;
      clearInterval(status);
      socket?.close();
      await Promise.all([...held].map((s) => s.stop()));
    }
  };
}
