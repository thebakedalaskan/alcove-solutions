/*
 * Recordings kept on this device that haven't uploaded, put in place for a story through the app's own way of keeping
 * them (features/record/offline.ts): sealed in this browser's IndexedDB under its device key, as recording without a
 * connection leaves them. Each says how it stands: waiting, refused by Alcove for now (and why), too old to upload, or
 * unreadable here. One can be recording now in another tab, which holds its lock until the next story opens.
 */
import { keepPiece, keepRecording, takeLock, updateKept, type Release } from '~/features/record/offline';
import { uploads } from '~/features/record/uploads';
import { quietAudio } from '../media';

export interface KeptSpec {
  id: string;
  title: string;
  startedAt: string;
  /** How long it is, pauses not counted. */
  seconds: number;
  /** Alcove refused it the last time it was tried, and why. */
  problem?: string | undefined;
  /** This device can't open it any more. */
  unreadable?: boolean | undefined;
  /** Another tab is recording it now. */
  recording?: boolean | undefined;
}

/** The locks held for recordings another tab is recording now. */
let held: Release[] = [];

/** The next story opens: no tab is recording any more, and what Record lists here is read again, for whoever is signed in then. */
export function forgetKeptHere(): void {
  for (const release of held) release();
  held = [];
  uploads.follow(null);
}

/** Waits until this browser's kept recordings are gone: the scenario deletes them as it starts. */
const cleared = () => new Promise<void>((resolve) => {
  const r = indexedDB.deleteDatabase('alcove-offline');
  r.onsuccess = () => resolve();
  r.onerror = () => resolve();
});

/** Keeps these recordings on this device for `owner`, as recording them here without a connection would have. */
export async function keepHere(owner: string, specs: readonly KeptSpec[]): Promise<void> {
  await cleared();
  for (const k of specs) {
    await keepRecording({ id: k.id, owner, startedAt: k.startedAt, title: k.title, tried: k.problem !== undefined });
    const pieces = Math.max(1, Math.min(6, Math.ceil(k.seconds / 5)));
    for (let seq = 0; seq < pieces; seq++) await keepPiece(k.id, { data: quietAudio(1), segment: 0, seq, at: seq * 5, durationMs: 5000, mimeType: 'audio/wav' });
    await updateKept(k.id, {
      state: k.recording ? 'recording' : 'finished', seconds: k.seconds,
      ...(k.problem !== undefined ? { problem: k.problem } : {}), ...(k.unreadable ? { unreadable: true } : {})
    });
    if (k.recording) {
      const release = await takeLock(k.id, false);
      if (release) held.push(release);
    }
  }
}
