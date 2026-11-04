/*
 * Test participants for LiveKit rooms (@livekit/rtc-node). Tests join with the room tokens the API issues,
 * exactly as a browser would, encrypting media with the call's MLS-derived key as a browser does, and observe
 * media and data from the other side.
 */
import { CALL_TOPIC, CALL_VOID_KEY_INDEX, CallNudgeSchema, type CallCrypto, type LiveStore } from '@alcove/api';
import {
  AudioFrame, AudioSource, AudioStream, DisconnectReason, EncryptionType, KeyProvider, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, TrackKind,
  TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource, dispose, type RemoteTrack
} from '@livekit/rtc-node';
import { KeyDerivationFunction } from '@livekit/rtc-ffi-bindings';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config';
import { apiUrl } from '../livekit';

const RATE = 48_000;
const FRAME = 480; // 10 ms

export interface TestParticipant {
  identity: string;
  room: Room;
  remoteIdentities(): string[];
  /** Publishes a 440 Hz tone as this participant's microphone. Returns the track sid. */
  publishTone(): Promise<string>;
  /**
   * Shares a screen the way a browser does: a picture (ScreenShare) and, `withSound`, its sound (ScreenShareAudio), both
   * encrypted like everything this participant sends. Returns their track sids.
   */
  publishScreen(withSound: boolean): Promise<{ screen: string; sound: string | null }>;
  /** Publishes a small grey picture as this participant's camera. Returns the track sid. */
  publishCamera(): Promise<string>;
  /** Stops publishing one of this participant's tracks, as a browser does when a share ends. */
  unpublish(sid: string): Promise<void>;
  /** Mean absolute sample of `identity`'s audio over `ms` (a tone at our amplitude is about 7600; silence is 0). */
  meanLevelFrom(identity: string, ms?: number): Promise<number>;
  waitFor(pred: () => boolean, what: string, ms?: number): Promise<void>;
  /** Resolves on the next "the call changed" nudge the server sends to the room. */
  nextNudge(): Promise<void>;
  /** Resolves with the reason once LiveKit disconnects this participant. */
  disconnectReason(): Promise<DisconnectReason>;
  disconnect(): Promise<void>;
}

async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Where and how to connect: what `CallSession.room()` gives a browser (or a token minted directly). */
export interface RoomJoin { serverUrl: string; token: string; identity: string }
/**
 * Media keys. A browser holds every member's keys for the last few epochs and picks the one each frame needs by
 * the key index the frame carries. rtc-node 1.2.1 holds one key at a time (and its senders can't leave key
 * index 0), so a test participant either sends, with its own session's send key, or hears one sender, with
 * its own session's key for that sender in the epoch the sender is sending with (what the frame would say).
 * Or it holds one fixed key: someone who shouldn't have the group's keys.
 */
export type Keys =
  | { sending: LiveStore<CallCrypto> }
  | { hearing: LiveStore<CallCrypto>; from: string; senderSends: LiveStore<CallCrypto> }
  | { key: Uint8Array; index: number };
/**
 * The key a test participant uses now, or null to keep the one it has. A sender between two parts of the call has no
 * key to send with (`send` is null): like a browser, it then sends under a key nobody has.
 */
const keyFor = (k: Keys): { key: Uint8Array; index: number } | null => {
  if ('key' in k) return k;
  if ('sending' in k) {
    const media = k.sending.getSnapshot().media;
    if (!media) return null;
    return media.send ?? { key: new Uint8Array(randomBytes(32)), index: CALL_VOID_KEY_INDEX };
  }
  const at = k.senderSends.getSnapshot().media?.send?.index;
  const epoch = k.hearing.getSnapshot().media?.epochs.find((e) => e.index === at);
  const key = epoch?.keys[k.from];
  return epoch && key ? { key, index: epoch.index } : null;
};
const storesOf = (k: Keys): LiveStore<CallCrypto>[] => ('sending' in k ? [k.sending] : 'hearing' in k ? [k.hearing, k.senderSends] : []);

export async function connect(join: RoomJoin, keys?: Keys): Promise<TestParticipant> {
  const room = new Room();
  let pumps: ReturnType<typeof setInterval>[] = [];
  let reason: DisconnectReason | null = null;
  let nudges = 0;
  room.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
    if (topic !== CALL_TOPIC) return;
    try { if (CallNudgeSchema.safeParse(JSON.parse(new TextDecoder().decode(payload))).success) nudges++; } catch { /* not a nudge */ }
  });
  room.on(RoomEvent.Disconnected, (r) => { reason = r; });
  // The same frame encryption as a browser's: AES-GCM, keys derived with HKDF, no ratchet, a ring of 256. rtc-node
  // only uses shared keys if it connects with one, so a participant without its key yet connects with a stand-in
  // (which decrypts nothing) until the real one arrives.
  const first = keys ? keyFor(keys) : null;
  const encryption = {
    keyProviderOptions: { ratchetWindowSize: 0, failureTolerance: -1, keyRingSize: 256, keyDerivationFunction: KeyDerivationFunction.HKDF, sharedKey: first?.key ?? new Uint8Array(randomBytes(32)) },
    encryptionType: EncryptionType.GCM
  };
  await room.connect(join.serverUrl, join.token, { autoSubscribe: true, dynacast: false, ...(keys ? { encryption } : {}) });
  const useKey = (k: { key: Uint8Array; index: number } | null) => {
    const m = room.e2eeManager;
    if (!k || !m) return;
    // rtc-node 1.2.1 keeps the key provider out of its types (at runtime it's an ordinary property), and can't move
    // its senders off key index 0, so a test participant keeps the current key there too. Browsers use the ring.
    const provider: unknown = Reflect.get(m, 'keyProvider');
    if (provider instanceof KeyProvider) { provider.setSharedKey(k.key, k.index); provider.setSharedKey(k.key, 0); }
  };
  let unfollow: () => void = () => undefined;
  if (keys) {
    useKey(keyFor(keys));
    const stops = storesOf(keys).map((store) => store.subscribe(() => useKey(keyFor(keys))));
    unfollow = () => stops.forEach((stop) => stop());
  }

  const audioFrom = (identity: string): RemoteTrack | undefined => {
    const p = room.remoteParticipants.get(identity);
    if (!p) return undefined;
    for (const pub of p.trackPublications.values()) if (pub.kind === TrackKind.KIND_AUDIO && pub.track) return pub.track;
    return undefined;
  };

  return {
    identity: join.identity,
    room,
    remoteIdentities: () => [...room.remoteParticipants.keys()],
    async publishTone() {
      const source = new AudioSource(RATE, 1);
      const track = LocalAudioTrack.createAudioTrack('mic', source);
      const opts = new TrackPublishOptions();
      opts.source = TrackSource.SOURCE_MICROPHONE;
      const local = room.localParticipant;
      if (!local) throw new Error('not connected');
      const pub = await local.publishTrack(track, opts);
      let t = 0;
      pumps.push(setInterval(() => {
        const buf = new Int16Array(FRAME);
        for (let i = 0; i < FRAME; i++) buf[i] = Math.round(Math.sin((2 * Math.PI * 440 * t++) / RATE) * 12_000);
        void source.captureFrame(new AudioFrame(buf, RATE, 1, FRAME));
      }, 10));
      return pub.sid ?? '';
    },
    async publishScreen(withSound) {
      const local = room.localParticipant;
      if (!local) throw new Error('not connected');
      const [w, h] = [320, 180];
      const picture = new VideoSource(w, h);
      const screenOpts = new TrackPublishOptions();
      screenOpts.source = TrackSource.SOURCE_SCREENSHARE;
      const screen = await local.publishTrack(LocalVideoTrack.createVideoTrack('screen', picture), screenOpts);
      const frame = new VideoFrame(new Uint8Array(w * h * 4).fill(180), w, h, VideoBufferType.RGBA);
      pumps.push(setInterval(() => picture.captureFrame(frame), 100));
      if (!withSound) return { screen: screen.sid ?? '', sound: null };
      const source = new AudioSource(RATE, 1);
      const soundOpts = new TrackPublishOptions();
      soundOpts.source = TrackSource.SOURCE_SCREENSHARE_AUDIO;
      const sound = await local.publishTrack(LocalAudioTrack.createAudioTrack('screen-sound', source), soundOpts);
      pumps.push(setInterval(() => { void source.captureFrame(new AudioFrame(new Int16Array(FRAME).fill(2_000), RATE, 1, FRAME)); }, 10));
      return { screen: screen.sid ?? '', sound: sound.sid ?? null };
    },
    async publishCamera() {
      const source = new VideoSource(64, 64);
      const track = LocalVideoTrack.createVideoTrack('camera', source);
      const opts = new TrackPublishOptions();
      opts.source = TrackSource.SOURCE_CAMERA;
      const local = room.localParticipant;
      if (!local) throw new Error('not connected');
      const pub = await local.publishTrack(track, opts);
      const frame = new VideoFrame(new Uint8Array(64 * 64 * 4).fill(128), 64, 64, VideoBufferType.RGBA);
      pumps.push(setInterval(() => source.captureFrame(frame), 200));
      return pub.sid ?? '';
    },
    async unpublish(sid) {
      await room.localParticipant?.unpublishTrack(sid);
    },
    async meanLevelFrom(identity, ms = 2000) {
      await waitFor(() => audioFrom(identity) !== undefined, `audio from ${identity}`);
      const track = audioFrom(identity);
      if (!track) return 0;
      const stream = new AudioStream(track, RATE, 1);
      let samples = 0;
      let energy = 0;
      // Frames that can't be decrypted never arrive, so the window ends on time either way.
      const reader = stream.getReader();
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const next = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, until - Date.now())))]);
        if (!next || next.done) break;
        for (const s of next.value.data) energy += Math.abs(s);
        samples += next.value.data.length;
      }
      // Cancel rather than end an iterator: a read may still be waiting for a frame that never comes, and an
      // iterator's return() waits for it, which hung the test whenever no frame arrived after the window.
      await reader.cancel();
      return samples ? energy / samples : 0;
    },
    waitFor,
    async nextNudge() { const seen = nudges; await waitFor(() => nudges > seen, 'a nudge from the server'); },
    async disconnectReason() {
      await waitFor(() => reason !== null, 'disconnect');
      return reason ?? DisconnectReason.UNKNOWN_REASON;
    },
    async disconnect() {
      unfollow();
      for (const p of pumps) clearInterval(p);
      pumps = [];
      await room.disconnect();
    }
  };
}

/** Releases the native LiveKit runtime. Call once, after every room has disconnected. */
export async function disposeLiveKit(): Promise<void> {
  await dispose();
}

/** Signs a webhook body the way LiveKit does: a JWT from the API key whose sha256 claim is the body's digest. */
export async function signWebhook(cfg: Config, body: string): Promise<string> {
  const t = new AccessToken(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);
  t.sha256 = createHash('sha256').update(body).digest('base64');
  return t.toJwt();
}

/** A join token minted with the API key itself, as LiveKit (which holds the key) could: no API, no MLS group. */
export async function tokenDirectly(cfg: Config, roomName: string, identity: string): Promise<string> {
  const t = new AccessToken(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET, { identity, ttl: 120 });
  t.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  return t.toJwt();
}

/** Who LiveKit itself has in a room, and what it knows them as. */
export async function participantsDirectly(cfg: Config, roomName: string): Promise<{ identity: string; name: string; metadata: string }[]> {
  return (await new RoomServiceClient(apiUrl(cfg), cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET).listParticipants(roomName)).map((p) => ({ identity: p.identity, name: p.name, metadata: p.metadata }));
}

/** Deletes a room behind the API's back, as LiveKit does when a room empties out. */
export async function deleteRoomDirectly(cfg: Config, roomName: string): Promise<void> {
  await new RoomServiceClient(apiUrl(cfg), cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET).deleteRoom(roomName);
}
