/*
 * How loud each person in the call is for you: your own playback only. A level goes on the element that plays them,
 * never on their track, which stays exactly as it arrived: so nobody else's sound changes, the person isn't told,
 * and what's recorded or transcribed is the same whatever you set. From 0 (muted for you) to 100%.
 *
 * What's kept: the levels for this call, in this tab's sessionStorage, by the random identity each connection has in
 * the call (never a name or an address). A reload of the tab keeps them; leaving the call or closing the tab forgets
 * them. Someone with an account who comes back on a new connection keeps their level, matched in memory only.
 */
import { CallVolumesSchema, type CallSession, type LiveStore } from '@alcove/api';
import { log } from '~/lib/log';

const vlog = log.child({ component: 'call-volume' });
const KEY = 'alcove.callVolumes';

/** Each person's level for you, by their identity in the call. Anyone not listed plays at full volume. */
export type Levels = Readonly<Record<string, number>>;
const NONE: Levels = {};

/** Whether a page can set how loud an element plays. iPhones can't (the side buttons decide), so they get no slider. */
export function canSetVolume(): boolean {
  try {
    const a = new Audio();
    a.volume = 0.5;
    return Math.abs(a.volume - 0.5) < 0.01;
  } catch {
    return false;
  }
}

function read(callId: string): Levels {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return NONE;
    const r = CallVolumesSchema.safeParse(JSON.parse(raw));
    return r.success && r.data.callId === callId ? r.data.levels : NONE;
  } catch {
    return NONE;
  }
}

export class CallVolumes implements LiveStore<Levels> {
  private levels: Levels;
  private listeners = new Set<() => void>();
  /** Who each connection is, for people with an account, so a level follows them to a new connection. Memory only. */
  private people = new Map<string, string>();
  /** Each person's level before a quick mute, so unmuting brings them back where they were. Memory only. */
  private before = new Map<string, number>();

  constructor(private readonly callId: string) { this.levels = read(callId); }

  getSnapshot = (): Levels => this.levels;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  level(identity: string): number { return this.levels[identity] ?? 1; }

  /** Sets how loud `identity` plays for you, 0 to 1, in steps of 1%. Full volume is the same as never having set it. */
  set(identity: string, level: number) {
    const v = Math.round(Math.max(0, Math.min(1, level)) * 100) / 100;
    if (v > 0) this.before.delete(identity);
    if ((this.levels[identity] ?? 1) === v) return;
    const next: Record<string, number> = { ...this.levels };
    if (v === 1) delete next[identity];
    else next[identity] = v;
    this.update(next);
  }

  /** The quick mute: off for you, or back to the level they had before it. */
  toggle(identity: string) {
    const now = this.level(identity);
    if (now === 0) { this.set(identity, this.before.get(identity) ?? 1); return; }
    this.before.set(identity, now);
    this.set(identity, 0);
  }

  /**
   * Who's in the call now. Someone with an account who comes back on a new connection (after a reload, say) keeps
   * the level you gave them; guests have no account to match, so a guest who reloads starts at full volume again.
   */
  follow(participants: readonly { id: string; person: { id: string; email: string } }[]) {
    const here = new Set(participants.map((p) => p.id));
    let next: Record<string, number> | null = null;
    for (const p of participants) {
      if (!p.person.email) continue;
      const earlier = [...this.people].find(([id, who]) => who === p.person.id && id !== p.id && !here.has(id))?.[0];
      this.people.set(p.id, p.person.id);
      if (earlier === undefined) continue;
      this.people.delete(earlier);
      const level = (next ?? this.levels)[earlier];
      if (level === undefined || this.levels[p.id] !== undefined) continue;
      next ??= { ...this.levels };
      next[p.id] = level;
      delete next[earlier];
      const was = this.before.get(earlier);
      if (was !== undefined) { this.before.set(p.id, was); this.before.delete(earlier); }
    }
    if (next) this.update(next);
  }

  /** Leaving the call: every level is forgotten. */
  clear() {
    this.people.clear();
    this.before.clear();
    this.update(NONE);
    try { sessionStorage.removeItem(KEY); } catch (e) { vlog.debug('volumes not cleared', { err: e }); }
  }

  private update(next: Levels) {
    this.levels = next;
    try {
      if (Object.keys(next).length) sessionStorage.setItem(KEY, JSON.stringify({ callId: this.callId, levels: next }));
      else sessionStorage.removeItem(KEY);
    } catch (e) {
      vlog.debug('volumes not kept for a reload', { err: e });
    }
    this.listeners.forEach((l) => l());
  }
}

/** What the call screen's controls can do to a person's level. */
export type VolumeActions = Pick<CallVolumes, 'set' | 'toggle'>;

/** One store per call session: the room plays by it, and the call screen sets it. */
const stores = new WeakMap<CallSession, CallVolumes>();
export function volumesFor(session: CallSession): CallVolumes {
  let v = stores.get(session);
  if (!v) { v = new CallVolumes(session.ticket.callId); stores.set(session, v); }
  return v;
}
