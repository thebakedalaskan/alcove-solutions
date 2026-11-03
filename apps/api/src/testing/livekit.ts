/*
 * Test participants for LiveKit rooms (@livekit/rtc-node). Tests join with the tickets the API issues,
 * exactly as a browser would, and observe media, data and room metadata from the other side.
 */
import { CALL_TOPIC, CallNudgeSchema, RoomMetadataSchema, type CallTicket, type RoomMetadata } from '@alcove/api';
import {
  AudioFrame, AudioSource, AudioStream, DisconnectReason, LocalAudioTrack, Room, RoomEvent, TrackKind,
  TrackPublishOptions, TrackSource, dispose, type RemoteTrack
} from '@livekit/rtc-node';

const RATE = 48_000;
const FRAME = 480; // 10 ms

export interface TestParticipant {
  identity: string;
  room: Room;
  remoteIdentities(): string[];
  /** Room metadata as the API last set it, parsed; null if absent or malformed. */
  metadata(): RoomMetadata | null;
  /** Publishes a 440 Hz tone as this participant's microphone. Returns the track sid. */
  publishTone(): Promise<string>;
  /** Mean absolute sample of `identity`'s audio over `ms` (a tone at our amplitude is about 7600; silence is 0). */
  meanLevelFrom(identity: string, ms?: number): Promise<number>;
  waitFor(pred: () => boolean, what: string, ms?: number): Promise<void>;
  /** Resolves on the next "the call changed" nudge the server sends to the room. */
  nextNudge(): Promise<void>;
  /** Resolves with the reason once LiveKit disconnects this participant. */
  disconnectReason(): Promise<DisconnectReason>;
  disconnect(): Promise<void>;
}

function parseMetadata(raw: string | undefined): RoomMetadata | null {
  if (!raw) return null;
  try {
    const r = RoomMetadataSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function connect(ticket: CallTicket): Promise<TestParticipant> {
  const room = new Room();
  let pumps: ReturnType<typeof setInterval>[] = [];
  let reason: DisconnectReason | null = null;
  let nudges = 0;
  room.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
    if (topic !== CALL_TOPIC) return;
    try { if (CallNudgeSchema.safeParse(JSON.parse(new TextDecoder().decode(payload))).success) nudges++; } catch { /* not a nudge */ }
  });
  room.on(RoomEvent.Disconnected, (r) => { reason = r; });
  await room.connect(ticket.serverUrl, ticket.token, { autoSubscribe: true, dynacast: false });

  const audioFrom = (identity: string): RemoteTrack | undefined => {
    const p = room.remoteParticipants.get(identity);
    if (!p) return undefined;
    for (const pub of p.trackPublications.values()) if (pub.kind === TrackKind.KIND_AUDIO && pub.track) return pub.track;
    return undefined;
  };

  return {
    identity: ticket.identity,
    room,
    remoteIdentities: () => [...room.remoteParticipants.keys()],
    metadata: () => parseMetadata(room.metadata),
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
    async meanLevelFrom(identity, ms = 2000) {
      await waitFor(() => audioFrom(identity) !== undefined, `audio from ${identity}`);
      const track = audioFrom(identity);
      if (!track) return 0;
      const stream = new AudioStream(track, RATE, 1);
      let samples = 0;
      let energy = 0;
      const t0 = Date.now();
      for await (const f of stream) {
        for (const s of f.data) energy += Math.abs(s);
        samples += f.data.length;
        if (Date.now() - t0 > ms) break;
      }
      return samples ? energy / samples : 0;
    },
    waitFor,
    async nextNudge() { const seen = nudges; await waitFor(() => nudges > seen, 'a nudge from the server'); },
    async disconnectReason() {
      await waitFor(() => reason !== null, 'disconnect');
      return reason ?? DisconnectReason.UNKNOWN_REASON;
    },
    async disconnect() {
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
