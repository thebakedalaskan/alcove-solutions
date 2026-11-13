/** A live call's sealed frame captures from the previous release survive saves, call end and new video captures. */
import type { AlcoveApi, CallSession, ScreenPiece } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { b64u, id128, mac, openJson, sealJson, sealRecord, sha, stateKey, toJson, utf8 } from '../../../keys/crypto';
import { openOwner } from '../../../keys/owners';
import { speechWav } from '../../../testing/fakes/near';
import { startHarness, type Harness } from '../../../testing/harness';
import { disposeLiveKit, presentScreen, stopPresenting } from '../../../testing/livekit';
import { cut, pictureJpeg, recordedWebm } from '../../../testing/video';
import { krecOf } from '../audio';
import { work } from '../../notes/writing/writer';

vi.setConfig({ testTimeout: 90_000 });
let h: Harness;
let video: Uint8Array<ArrayBuffer>[];
beforeAll(async () => { h = await startHarness(); video = cut(await recordedWebm(20), 4); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(async () => { await stopPresenting(); h.closeCalls(); });

let sequence = 0;
async function account() {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email: `upgrade.${Date.now()}.${sequence++}@tests.example` });
  return { ...b, ownerId: session.ownerId };
}
async function inGroup(call: CallSession): Promise<void> {
  const until = Date.now() + 15_000;
  while (call.crypto.getSnapshot().status !== 'in' || call.crypto.getSnapshot().media === null) {
    if (Date.now() > until) throw new Error('call did not join its group');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const RawCall = z.object({ notes: z.record(z.string(), z.unknown()) }).passthrough();
const Recording = z.object({ noteId: z.string(), recordingId: z.string() });

/** Write the exact old sealed call and frame shapes, without invoking a removed upload API or changing authentication. */
async function previousCapture(ownerId: string, call: CallSession) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const callId = call.ticket.callId;
  const callKey = stateKey(o.root, ownerId, `call:${callId}`);
  const callHeader = { v: 1, kind: 'call-state', ownerId, callId } as const;
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  const s = openJson(callKey, callHeader, row.state_ciphertext, RawCall);
  const { noteId, recordingId } = Recording.parse(s.notes);
  const notes = Object.fromEntries(Object.entries(s.notes).filter(([name]) => !['screenHistory', 'frameCapture', 'model'].includes(name)));
  const previous = {
    ...Object.fromEntries(Object.entries(s).filter(([name]) => name !== 'shares')),
    notes: {
      ...notes, history: [{ at: 0, status: 'on', by: 'schedule', segment: 0 }],
      screens: { on: false, history: [{ at: 0, on: true, segment: 0, by: 'organizer' }, { at: 8, on: false, segment: 0, by: 'organizer' }], ended: [{ share: 'old-share', presenter: call.ticket.identity, at: 8, segment: 0 }] }
    }
  };
  await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(callKey, callHeader, toJson(previous))]);
  const frameId = id128();
  const objectId = id128();
  const jpeg = pictureJpeg(640, 360, 'Before deployment');
  const infoKey = stateKey(o.root, ownerId, `screen:${noteId}`);
  const tag = mac(infoKey, utf8(`frame:old-share:${b64u(sha(jpeg))}`));
  const { krec } = await krecOf(o, recordingId);
  const image = sealRecord(krec, { v: 1, kind: 'screen-frame', ownerId, recordingId, frameId, objectId, keyVersion: '1' }, jpeg);
  krec.fill(0);
  await h.objects.put(objectId, image);
  const info = {
    presenter: call.ticket.identity, share: 'old-share', at: 2, segment: 0, width: 640, height: 360,
    reading: { legible: 'clear', title: 'Before deployment', text: 'The original chart', regions: [] }
  };
  await h.pool.query(`INSERT INTO screen_frames (owner_id, note_item_id, frame_id, frame_tag, object_id, cipher_sha256, cipher_bytes, info_ciphertext)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [ownerId, noteId, frameId, tag, objectId, sha(image), image.length, sealJson(infoKey, { v: 1, kind: 'screen-frame-info', ownerId, noteId, frameId }, toJson(info))]);
  await h.pool.query('UPDATE owners SET stored_bytes = stored_bytes + $2 WHERE owner_id = $1', [ownerId, image.length]);
  o.root.fill(0);
  o.wrapKey.fill(0);
  return { frameId, jpeg, noteId };
}

async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) if (p.ready) return;
}

describe('screen captures through a live-call upgrade', () => {
  it.each([false, true])("keeps a previous release's frames after a live call ends (new video: %s)", async (mixed) => {
      const org = await account();
      const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
      await inGroup(call);
      await call.appendAudio({ data: new Blob(['audio']), segment: 0, seq: 0, at: 0, durationMs: 30_000, mimeType: 'audio/webm' });
      await call.transcribe({ data: new Blob([speechWav('This chart shows our original plan.')]), segment: 0, at: 2, durationMs: 1000 }, call.ticket.identity);
      const before = await previousCapture(org.ownerId, call);
      // A normal API action reads and saves the old record before the call ends.
      expect((await org.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass },
        body: JSON.stringify({ type: 'hand', up: true, place: 'main' })
      })).status).toBe(200);
      if (mixed) {
        await presentScreen(call, h.deps.livekit);
        const { share } = await call.startShare({ notes: true });
        for (const [seq, bytes] of video.entries()) {
          const piece: ScreenPiece = { data: new Blob([bytes]), share, segment: 0, seq, at: 10 + seq * 5, durationMs: 5000, mimeType: 'video/webm;codecs=vp8' };
          await call.appendScreen(piece);
        }
        await call.transcribe({ data: new Blob([speechWav('As you can see this chart shows the new plan.')]), segment: 0, at: 12, durationMs: 1000 }, call.ticket.identity);
        await call.shareEnded(share);
      }
      await h.pool.query("UPDATE calls SET started_at = started_at - interval '30 seconds' WHERE owner_id = $1 AND call_id = $2", [org.ownerId, call.ticket.callId]);
      expect((await call.leave())?.pendingNoteId).toBe(before.noteId);
      if (mixed) {
        await h.pool.query("UPDATE recordings SET ended_at = ended_at - interval '30 seconds' WHERE owner_id = $1", [org.ownerId]);
        await h.pool.query("UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1", [org.ownerId]);
        await work(h.deps, { ownerId: org.ownerId });
      }
      await written(org.api, before.noteId);
      const note = await org.api.notes.get(before.noteId);
      expect(note.screens).toContainEqual(expect.objectContaining({ id: before.frameId, at: 2, until: 8, title: 'Before deployment' }));
      expect(note.screens.find((f) => f.id === before.frameId)?.line).toBe(note.transcript?.[0]?.id);
      expect(new Uint8Array(await (await org.fetch(org.api.notes.screenUrl(before.noteId, before.frameId))).arrayBuffer())).toEqual(before.jpeg);
      if (mixed) {
        expect(note.shares).toHaveLength(1);
        expect(note.screens.some((f) => f.id !== before.frameId && f.at >= 10)).toBe(true);
      }
  });
});
