/*
 * Uploads the room recordings kept on this device (offline.ts), the oldest first, whenever there's a connection: as the
 * app opens, when the connection comes back, when the page is looked at again, a while after a try that failed, and
 * as the stage recorder finishes one. Each goes up under its lock, so two tabs never upload the same one and none is
 * uploaded while a recorder still has it; one whose recorder's tab closed is finished as it is. In order:
 *
 *   1. ask Alcove afresh who's signed in here: only the account that recorded it may upload it (a browser can have
 *      changed hands since). Anyone else, or nobody, and uploading stops; the recording stays here.
 *   2. start it from its own startedAt, naming its account: if it reached Alcove before, that carries on with it;
 *   3. rename and resume it there if it needs it;
 *   4. send every kept piece, in order, then every kept clip, and anything kept meanwhile;
 *   5. stop it, but only with everything sent; then delete it here.
 *
 * Cut off anywhere (a closed tab, the connection gone again), the next try starts again from 1 and still makes one
 * note: a piece sent again is stored once, a clip heard before isn't transcribed again, and stopping finishes it once.
 * Nothing is left out because the server was having trouble: a piece or clip is given up on only when Alcove says it
 * can't take it, or when Alcove refuses it (a 409) in three runs while the ones after it get through. A 5xx never
 * counts: what the server fails stays here and waits, and the recordings behind it still go. A recording Alcove no
 * longer has (its note was deleted) isn't brought back, and one thrown away here is deleted there.
 */
import { MAX_RECORDING_AGE_DAYS, errorCode, errorMessage, type LiveStore, type RoomRecording } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { q, qk } from '~/lib/queries';
import {
  Unreadable, canKeep, dropKept, forgetKept, heldNow, keptClips, keptPieces, keptRecording, keptRecordings, onKeptChange, takeLock, updateKept,
  within, type KeptSummary, type Release
} from './offline';

const ulog = log.child({ component: 'uploads' });

/** A kept recording that was never named. */
export const UNNAMED = 'Notes from the room';

/**
 * recording: a recorder has it now, here or in another tab. uploading: it's on its way. waiting: for a connection, or
 * the next try. refused: Alcove said no last time (`problem` says why) and it's tried again. expired: refused for good
 * (more than MAX_RECORDING_AGE_DAYS old, and never on Alcove). unreadable: it won't open on this device. The last two
 * can only be deleted.
 */
export type KeptStatus = 'recording' | 'uploading' | 'waiting' | 'refused' | 'expired' | 'unreadable';
export interface KeptItem extends KeptSummary { status: KeptStatus }
/** The signed-in account's recordings kept here, as the side panel, Record and Settings show them. */
export interface KeptView { owner: string | null; list: KeptItem[]; read: boolean }
/** What the person hears about: one uploaded, or one whose note was deleted on Alcove so it's gone from here too. */
export type UploadNews = { kind: 'uploaded'; noteId: string; title: string } | { kind: 'deleted'; title: string };
/** Why uploads stopped: nobody is signed in here any more, or someone other than the recordings' account is. */
export type AccountTrouble = 'signed-out' | 'other';
/** What a recording that didn't upload just now waits for: the connection (or Alcove), or its own account signing in here. */
export type Waiting = 'connection' | AccountTrouble;

type Outcome = UploadNews | { kind: 'gone' | 'busy' | 'refused' | 'unreadable' | 'later' } | { kind: 'account'; why: AccountTrouble };

/** After a try that failed: 15 seconds, then twice as long each time, up to 5 minutes. */
const FIRST_WAIT = 15_000;
const MOST_WAIT = 5 * 60_000;
/** A piece or clip Alcove refuses (a 409) in three runs while later ones get through is left out: the refusal is its own. */
const GIVE_UP = 3;
/** Failures one after another in a run: the server is having trouble, not the items, so the run waits. */
const TROUBLE = 3;
/** How long a call to Alcove may take: asking who's signed in, starting, renaming, resuming, stopping, discarding. */
export const CALL_MS = 20_000;
const PIECE_MS = 20_000;
const CLIP_MS = 30_000;

/** Refused for good: Alcove can't take a recording this old, and it never reached Alcove to carry on with. */
const expired = (k: KeptSummary) => k.problem !== null && k.server === null && Date.now() - Date.parse(k.startedAt) > MAX_RECORDING_AGE_DAYS * 86_400_000;

class Uploads implements LiveStore<KeptView> {
  private state: KeptView = { owner: null, list: [], read: false };
  private listeners = new Set<() => void>();
  /** Uploading in this tab now. */
  private mine = new Set<string>();
  private looping = false;
  private again = false;
  /** The session here isn't the recordings' account: nothing is tried until follow() is called again. */
  private halted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wait = FIRST_WAIT;
  private reads = 0;
  /** Pieces and clips this tab knows Alcove has (or won't take), by recording: not sent again until the page reloads. */
  private sent = new Map<string, Set<string>>();
  /** Runs in which Alcove refused a piece or clip (a 409) while a later one got through. */
  private strikes = new Map<string, number>();
  private told = new Set<(n: UploadNews) => void>();
  private trouble = new Set<(why: AccountTrouble) => void>();
  private unwatch: (() => void) | null = null;

  getSnapshot = (): KeptView => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(s: KeptView) { this.state = s; for (const l of this.listeners) l(); }

  /** What's kept here, once it's been read: the first read may still be on its way. */
  listed(): Promise<KeptView> {
    if (this.state.read) return Promise.resolve(this.state);
    return new Promise((resolve) => {
      const off = this.subscribe(() => { if (this.state.read) { off(); resolve(this.state); } });
    });
  }

  /** Follows the account signed in here (null: nobody): lists its kept recordings, and uploads them when it can. */
  follow(owner: string | null) {
    if (owner === this.state.owner && !this.halted) return;
    this.halted = false;
    this.set({ owner, list: [], read: !owner || !canKeep() });
    if (!owner || !canKeep()) return;
    this.unwatch ??= onKeptChange(() => { void this.read(); });
    void this.read();
    this.kick();
  }

  /** Tries now: the app opened, the connection came back, the page was looked at again, or someone asked. */
  kick() {
    if (this.halted) return;
    this.wait = FIRST_WAIT;
    this.schedule(0);
  }

  /** Hears each recording that finished uploading here, or was found deleted on Alcove. */
  onNews(f: (n: UploadNews) => void): () => void {
    this.told.add(f);
    return () => { this.told.delete(f); };
  }

  /** Hears that uploading stopped because the session here isn't the recordings' account any more. */
  onAccountTrouble(f: (why: AccountTrouble) => void): () => void {
    this.trouble.add(f);
    return () => { this.trouble.delete(f); };
  }

  /**
   * Uploads one now: the stage recorder has just finished it. Waits a moment for its lock, which the recorder has just
   * let go of. The note it became, or what it waits for.
   */
  async run(id: string, owner: string): Promise<{ noteId: string } | { waiting: Waiting }> {
    const r = await this.one(id, owner, 5000);
    if (r.kind === 'uploaded' || r.kind === 'deleted') this.tell(r);
    if (r.kind === 'account') this.halt(r.why);
    if (r.kind === 'later') this.retry();
    if (r.kind === 'uploaded') return { noteId: r.noteId };
    return { waiting: r.kind === 'account' ? r.why : 'connection' };
  }

  /** Deletes one from this device without uploading it; whatever reached Alcove of it is deleted there too, when it can be. */
  async discard(id: string): Promise<void> {
    const release = await takeLock(id, false);
    if (!release) return;
    try {
      const k = await keptRecording(id);
      // Started on Alcove, or asked to (the answer may have been lost): a note saying so stays until it's deleted there.
      if (k && (k.server !== null || k.tried)) await dropKept(id);
      else await forgetKept(id);
    } finally { release(); }
    this.kick();
  }

  private tell(n: UploadNews) {
    for (const f of this.told) f(n);
  }

  /** Stops following: the session here belongs to nobody, or to another account. Nothing of the recordings is shown or sent. */
  private halt(why: AccountTrouble) {
    const first = !this.halted;
    this.halted = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.set({ owner: null, list: [], read: true });
    if (!first) return;
    ulog.info('uploads stopped: the session here isn’t the account that recorded them', { why });
    for (const f of this.trouble) f(why);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.loop(); }, ms);
  }
  private retry() {
    if (this.halted) return;
    this.schedule(this.wait);
    this.wait = Math.min(this.wait * 2, MOST_WAIT);
  }

  private async loop(): Promise<void> {
    if (this.looping) { this.again = true; return; }
    const owner = this.state.owner;
    if (this.halted || !owner || !canKeep() || !navigator.onLine) return;
    this.looping = true;
    let later = false;
    try {
      for (const k of await keptRecordings(owner)) {
        if (this.halted || this.state.owner !== owner || !navigator.onLine) { later = !this.halted; break; }
        const r = await this.one(k.id, owner, false);
        if (r.kind === 'uploaded' || r.kind === 'deleted') this.tell(r);
        if (r.kind === 'account') { this.halt(r.why); break; }
        // This one waits for the next try; the ones behind it still go, so one that keeps failing holds nothing up.
        if (r.kind === 'later') later = true;
      }
    } catch (e) {
      ulog.error('couldn’t go through the recordings kept here', { err: e });
      later = true;
    } finally {
      this.looping = false;
    }
    if (later) this.retry();
    else this.wait = FIRST_WAIT;
    if (this.again) { this.again = false; void this.loop(); }
  }

  /** Uploads kept recording `id` under its lock (taken at once, or waiting `wait` ms for it). */
  private async one(id: string, owner: string, wait: number | false): Promise<Outcome> {
    if (!navigator.onLine) return { kind: 'later' };
    let release: Release | null;
    try { release = await takeLock(id, wait); } catch (e) { ulog.warn('couldn’t take a kept recording’s lock', { id, err: e }); return { kind: 'later' }; }
    if (!release) return { kind: 'busy' };
    this.mine.add(id);
    void this.read();
    try {
      return await this.upload(id, owner);
    } catch (e) {
      if (e instanceof Unreadable) {
        // Never stopped, never deleted: it stays, said to be unreadable, until it's deleted (which deletes on Alcove too
        // whatever came before the item that won't open).
        await updateKept(id, { unreadable: true }).catch((x: unknown) => ulog.warn('couldn’t mark a kept recording unreadable', { id, err: x }));
        return { kind: 'unreadable' };
      }
      const code = errorCode(e);
      if (code === 'unauthenticated') return { kind: 'account', why: 'signed-out' };
      if (code === 'forbidden') return { kind: 'account', why: 'other' };
      ulog.at(code === 'network' ? 'info' : 'warn', 'a kept recording will upload later', { id, code, err: e });
      return { kind: 'later' };
    } finally {
      this.mine.delete(id);
      release();
      void this.read();
    }
  }

  private async upload(id: string, owner: string): Promise<Outcome> {
    const k = await keptRecording(id);
    if (!k || k.owner !== owner) return { kind: 'gone' };
    if (k.state !== 'discarded' && k.unreadable) return { kind: 'unreadable' };
    if (k.state !== 'discarded' && expired(k)) return { kind: 'refused' };
    if (k.state === 'discarded' && k.server === null && !k.tried) {
      // Thrown away before Alcove ever heard of it: nothing there to delete.
      await forgetKept(id);
      return { kind: 'gone' };
    }
    // Who's signed in here, asked afresh: the page may have been signed out, or into someone else, since it opened.
    const session = await within(CALL_MS, api.auth.getSession());
    if (!session) return { kind: 'account', why: 'signed-out' };
    if (session.ownerId !== k.owner) return { kind: 'account', why: 'other' };
    if (k.state === 'recording') {
      // Nobody holds it, so whoever was recording it has gone (its tab closed): it's finished as it is.
      await updateKept(id, { state: 'finished' });
      ulog.info('a recording whose tab closed is finished as it is', { id });
    }
    if (!k.tried) await updateKept(id, { tried: true });
    const title = k.title.trim().slice(0, 160) || UNNAMED;
    let rec: RoomRecording;
    try {
      rec = await within(CALL_MS, api.recordings.start({ title, startedAt: k.startedAt, owner: k.owner }));
    } catch (e) {
      if (errorCode(e) !== 'invalid') throw e;
      // Refused: no recording from this moment is there, and none can be made, so nothing is left to delete.
      if (k.state === 'discarded') { await forgetKept(id); this.sent.delete(id); return { kind: 'gone' }; }
      // Too old to upload, or starting in the future by this device's clock: said on Record; the second passes in time.
      await updateKept(id, { problem: errorMessage(e) });
      ulog.warn('Alcove refused a kept recording', { id, err: e });
      return { kind: 'refused' };
    }
    const there = rec.getSnapshot();
    const where = { id, recordingId: there.id };
    if (k.state === 'discarded') {
      await within(CALL_MS, rec.discard());
      await forgetKept(id);
      this.sent.delete(id);
      ulog.info('a discarded recording is deleted on Alcove too', where);
      return { kind: 'gone' };
    }
    if (k.server !== null && k.server !== there.id) {
      // Its recording on Alcove is gone (its note was deleted there), so the start above made a new one: that's thrown
      // away, and what was left of it here is deleted too.
      await within(CALL_MS, rec.discard());
      await forgetKept(id);
      this.sent.delete(id);
      ulog.info('a recording deleted on Alcove isn’t uploaded again', { ...where, was: k.server });
      return { kind: 'deleted', title };
    }
    if (k.server === null || k.problem !== null) await updateKept(id, { server: there.id, problem: null });
    let stopped = there.status === 'stopped';
    if (!stopped && title !== there.title) await within(CALL_MS, rec.rename(title));
    if (there.status === 'paused') await within(CALL_MS, rec.resume());

    const sent = this.sent.get(id) ?? new Set<string>();
    this.sent.set(id, sent);
    /** Failed in this run: not tried again until the next, and it doesn't stop while any did. */
    const failed = new Set<string>();
    /** Of those, refused (a 409, not a 5xx): a later one getting through gives each its one strike of this run. */
    const refused = new Set<string>();
    const tally = { pieces: 0, clips: 0, left: 0 };
    let inARow = 0;
    let resumed = false;
    const leave = (key: string, why: string, w: Record<string, string | number>, e?: unknown) => {
      sent.add(key);
      tally.left++;
      ulog.warn('part of a kept recording left out', { ...w, why, ...(e === undefined ? {} : { err: e }) });
    };
    /** Sends one piece or clip; what can't go now waits for the next run, and only what Alcove can't take is left out. */
    const attempt = async (key: string, send: () => Promise<void>, ms: number, w: Record<string, string | number>): Promise<boolean> => {
      if ((this.strikes.get(`${id}:${key}`) ?? 0) >= GIVE_UP) { leave(key, `refused in ${GIVE_UP} runs while later ones got through`, w); return false; }
      for (let again = false; ; again = true) {
        try {
          await within(ms, send());
          sent.add(key);
          for (const f of refused) this.strikes.set(`${id}:${f}`, (this.strikes.get(`${id}:${f}`) ?? 0) + 1);
          refused.clear();
          inARow = 0;
          return true;
        } catch (e) {
          const code = errorCode(e);
          if (code === 'conflict') {
            if (stopped) { leave(key, 'the recording had already stopped on Alcove', w, e); return false; }
            // Paused there (a pause still on its way when this started): resumed once, and this one sent again.
            if (!resumed && !again) {
              resumed = true;
              try { await within(CALL_MS, rec.resume()); } catch (r) {
                if (errorCode(r) !== 'conflict') throw r;
                stopped = true;
                leave(key, 'the recording had already stopped on Alcove', w, e);
                return false;
              }
              continue;
            }
          }
          if (code === 'invalid') { leave(key, 'Alcove can’t take it', w, e); return false; }
          if (code !== 'conflict' && code !== 'unknown') throw e;
          failed.add(key);
          if (code === 'conflict') refused.add(key);
          ulog.info('part of a kept recording didn’t go; it’s tried again later', { ...w, code, err: e });
          if (++inARow >= TROUBLE) throw e;
          return false;
        }
      }
    };
    // Again until a pass finds nothing new, so anything kept while this ran goes too before it stops.
    for (let fresh = 1; fresh > 0;) {
      fresh = 0;
      for await (const p of keptPieces(id)) {
        const key = `p${p.seq}`;
        if (sent.has(key) || failed.has(key)) continue;
        fresh++;
        if (await attempt(key, () => rec.appendAudio(p), PIECE_MS, { ...where, seq: p.seq, atMs: Math.round(p.at * 1000), bytes: p.data.size })) tally.pieces++;
      }
      for await (const c of keptClips(id)) {
        const atMs = Math.round(c.at * 1000);
        const key = `c${atMs}`;
        if (sent.has(key) || failed.has(key)) continue;
        fresh++;
        if (await attempt(key, () => rec.transcribe(c), CLIP_MS, { ...where, atMs, bytes: c.data.size })) tally.clips++;
      }
    }
    if (failed.size) {
      // Never stopped with something not sent: once stopped, nothing can be added.
      ulog.info('a kept recording waits: some of it didn’t go', { ...where, waiting: failed.size, ...tally });
      return { kind: 'later' };
    }
    const r = await within(CALL_MS, rec.stop());
    await forgetKept(id);
    this.sent.delete(id);
    ulog.info('kept recording uploaded', { ...where, noteId: r.pendingNoteId, ...tally, seconds: r.duration });
    return { kind: 'uploaded', noteId: r.pendingNoteId, title };
  }

  private async read() {
    const owner = this.state.owner;
    if (!owner || !canKeep()) return;
    const n = ++this.reads;
    try {
      const [list, held] = await Promise.all([keptRecordings(owner), heldNow()]);
      if (n !== this.reads || owner !== this.state.owner) return;
      this.set({ owner, read: true, list: list.flatMap((k) => { const status = this.status(k, held); return status ? [{ ...k, status }] : []; }) });
    } catch (e) {
      ulog.warn('couldn’t read the recordings kept here', { err: e });
      if (n === this.reads) this.set({ ...this.state, read: true });
    }
  }

  /** How a kept recording stands, or null when it isn't one to show: thrown away, or recording with nothing kept yet. */
  private status(k: KeptSummary, held: Set<string>): KeptStatus | null {
    if (k.state === 'discarded') return null;
    if (k.unreadable) return 'unreadable';
    if (this.mine.has(k.id)) return 'uploading';
    if (held.has(k.id)) return k.state !== 'recording' ? 'uploading' : k.bytes > 0 ? 'recording' : null;
    if (expired(k)) return 'expired';
    return k.problem ? 'refused' : 'waiting';
  }
}

export const uploads = new Uploads();

/**
 * Keeps this account's kept recordings uploading while the app is open: now, when the connection comes back and when
 * the page is looked at again. Each one that finishes, or turns out deleted on Alcove, is said, and the notes are read
 * again. If the session here turns out not to be this account's, uploading stops: signed out, it's off to sign in;
 * someone else signed in, the app catches up with who that is.
 */
export function useKeptUploads(owner: string | null) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const router = useRouter();
  useEffect(() => { uploads.follow(owner); }, [owner]);
  useEffect(() => {
    const kick = () => uploads.kick();
    const seen = () => { if (document.visibilityState === 'visible') uploads.kick(); };
    addEventListener('online', kick);
    document.addEventListener('visibilitychange', seen);
    return () => { removeEventListener('online', kick); document.removeEventListener('visibilitychange', seen); };
  }, []);
  useEffect(() => uploads.onNews((n) => {
    void qc.invalidateQueries({ queryKey: qk.notes });
    if (n.kind === 'uploaded') toast(`“${n.title}” uploaded. Its notes are being written.`, { icon: 'check' });
    else toast(`“${n.title}” was deleted on Alcove, so what was left of it on this device is deleted too.`, { icon: 'trash' });
  }), [qc, toast]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Who's signed in now, for the app (and what it lists here) to follow. Until that's known it's asked again, a while
    // after each try, so uploads don't stay stopped until the page reloads.
    const readWho = (wait: number) => {
      void qc.fetchQuery({ ...q.session(), staleTime: 0 }).then((s) => { uploads.follow(s?.ownerId ?? null); return router.invalidate(); }, (e: unknown) => {
        ulog.info('couldn’t read who’s signed in here; asking again later', { wait, err: e });
        timer = setTimeout(() => readWho(Math.min(wait * 2, MOST_WAIT)), wait);
      });
    };
    const off = uploads.onAccountTrouble((why) => {
      clearTimeout(timer);
      if (why === 'other') { readWho(FIRST_WAIT); return; }
      qc.setQueryData(qk.session, null);
      void navigate({ to: '/welcome' });
    });
    return () => { off(); clearTimeout(timer); };
  }, [qc, navigate, router]);
}
