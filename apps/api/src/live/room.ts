/*
 * One workspace on this instance (docs: Data and storage › Live traffic): one subscription to the hub, one read of each
 * change for the streams behind it, and who's here now. A stream joins and is offered what it needs; it works out for
 * itself what its reader may see of it.
 *
 * Who's here is never stored. A browser says where it is, every few seconds; the instance that hears it seals it into a
 * notice, and every instance keeps what it hears in memory until it's said again or runs out. What someone may know of
 * someone else depends on both of them and on the tree as it stands, so that's worked out here.
 */
import { PersonSchema, type Person, type WorkspaceHere, type WorkspaceWhere } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, fromUtf8, openJson, sealJson, toJson, unb64u, utf8, type RecordHeader } from '../crypto';
import { bigintText, bytea, maybeOne } from '../db';
import { log } from '../log';
import {
  TREE_NOTICE, canOpen, holdersOf, openState, peopleIn, roleOf, standingIn, workspaceKey, type Holders, type Reader, type Standing, type Who, type WorkspaceState
} from '../modules/workspaceAccess';
import { portraitFor } from '../modules/portraits';
import { findOwner } from '../owners';
import { publish, type Hub, type HubEvent } from './hub';

const rlog = log.child({ component: 'rooms' });
/** The start of a notice carrying someone's presence, sealed. A document's notices start with its ID, which is longer. */
const PRESENCE = 'here:';
/** How often streams work out who's here, however often people move: everyone hears a change within this. */
const TELL_EVERY_MS = 200;

/** What one change comes to, read once for the streams that are behind it: null once the workspace is gone. */
export type Snapshot = (Holders & { workspaceId: string; version: number; state: WorkspaceState; people: number }) | null;

/** A stream in a room. */
export interface RoomMember {
  /** How far it's been shown: anything else, and a change is read for it. */
  version: number;
  principals: Uint8Array[];
  offer(s: Snapshot): void;
  /** Who's here changed: `seenBy` says what this stream's reader may know of it. */
  heard(): void;
  end(): void;
}

/* ---------- who's here, as it travels ---------- */

const HereNotice = z.object({
  person: PersonSchema,
  /** What access is worked out from: the same as a reader's. */
  email: z.string().nullable(),
  principals: z.array(z.string()),
  /** They're in the workspace, as opposed to having something in it. */
  member: z.boolean(),
  connection: z.string(),
  callId: z.string().nullable(),
  callIdentity: z.string().nullable(),
  document: z.string().nullable(),
  block: z.string().nullable(),
  typing: z.boolean(),
  gone: z.boolean()
});
type HereNotice = z.infer<typeof HereNotice>;
interface Here { who: Who; member: boolean; person: Person; connection: string; callId: string | null; callIdentity: string | null; document: string | null; block: string | null; typing: boolean; until: number }

const hereHeader = (o: Owner, workspaceId: string): RecordHeader => ({ v: 1, kind: 'workspace-presence', ownerId: o.ownerId, workspaceId });

/** Tells every instance where this reader's connection is, or that it's gone. Nothing of it is kept anywhere that lasts. */
export async function announce(w: { owner: Owner; workspaceId: string; role: Standing['role'] }, reader: Reader, person: Person, connection: string, where: WorkspaceWhere | 'gone'): Promise<void> {
  const place: WorkspaceWhere = where === 'gone' ? { document: null, block: null, typing: false } : where;
  const notice: HereNotice = {
    person, email: reader.email ?? null, principals: reader.principals.map(b64u), member: w.role !== null, connection, callId: reader.seat?.callId ?? null, callIdentity: reader.seat?.viewer.pass.identity ?? null,
    ...place, gone: where === 'gone'
  };
  await publish(w.owner.pool, w.workspaceId, `${PRESENCE}${fromUtf8(sealJson(workspaceKey(w.owner), hereHeader(w.owner, w.workspaceId), toJson(notice)))}`);
}

/** Whose eyes `seenBy` looks through. */
export interface Viewer { who: Who; callId: string | null; standing: Standing }
const samePerson = (a: Who, b: Who): boolean => a.principals.some((p) => b.principals.some((q) => Buffer.compare(p, q) === 0));

/* ---------- a room ---------- */

const WorkspaceRow = z.object({ owner_id: z.string(), version: bigintText, state_ciphertext: bytea });
async function readSnapshot(d: Deps, workspaceId: string, principals: Uint8Array[]): Promise<Snapshot> {
  const row = await maybeOne(d.pool, WorkspaceRow, 'SELECT state_ciphertext, owner_id, version FROM workspaces WHERE workspace_id = $1', [workspaceId]);
  const owner = row && await findOwner(d, row.owner_id, undefined);
  if (!row || !owner) return null;
  return { ...await holdersOf(d.pool, row.owner_id, principals), workspaceId, version: row.version, state: openState(owner, workspaceId, row.state_ciphertext), people: await peopleIn(d.pool, row.owner_id) };
}

/** Every stream of one workspace on this instance. */
export class Room {
  private readonly members = new Set<RoomMember>();
  private readonly here = new Map<string, Here>();
  /** Reading now: everything below happens one at a time. */
  private reading: Promise<void> | null = null;
  private again = false;
  /** Presence heard and not opened yet. */
  private heardHere: string[] = [];
  /** What was read last, for where people are. Only while anyone's here: a tree is big, and people are said to be in its items. */
  private latest: Snapshot | undefined;
  private off: (() => void) | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private telling: ReturnType<typeof setTimeout> | undefined;
  private told = 0;
  /** Done once the hub is listening for this workspace. */
  readonly ready: Promise<void>;

  constructor(private readonly d: Deps, readonly workspaceId: string, private readonly rooms: Map<string, Room>) {
    this.ready = d.hub.subscribe(workspaceId, (e) => this.listen(e)).then((off) => {
      if (this.members.size) this.off = off;
      else off();
    });
  }
  private listen(e: HubEvent): void {
    if (e.kind === 'closing') { for (const m of this.members) m.end(); return; }
    if (e.kind === 'notice' && e.notice.startsWith(PRESENCE)) { this.heardHere.push(e.notice.slice(PRESENCE.length)); void this.read(); return; }
    if (e.kind === 'missed' || e.notice === TREE_NOTICE) void this.read();
  }
  join(m: RoomMember): void { this.members.add(m); }
  leave(m: RoomMember): void {
    this.members.delete(m);
    if (this.members.size) return;
    this.off?.();
    clearTimeout(this.expiry);
    clearTimeout(this.telling);
    if (this.rooms.get(this.workspaceId) === this) this.rooms.delete(this.workspaceId);
  }
  /**
   * Reads what changed for the streams behind it, one read at a time, and one more if something changed meanwhile. Nothing
   * behind: it stops at the version, so a stream joining, or a notice nobody missed, costs one small query.
   */
  read(): Promise<void> {
    if (this.reading) { this.again = true; return this.reading; }
    this.reading = this.work().finally(() => { this.reading = null; });
    return this.reading;
  }
  /** Done once everything heard so far is read and offered, so what's heard next can't overtake it. */
  settled(): Promise<void> { return this.reading ?? Promise.resolve(); }

  private async work(): Promise<void> {
    do {
      this.again = false;
      try {
        const version = (await maybeOne(this.d.pool, z.object({ version: bigintText }), 'SELECT version FROM workspaces WHERE workspace_id = $1', [this.workspaceId]))?.version ?? null;
        const behind = [...this.members].filter((m) => m.version !== version);
        const placing = this.here.size > 0 || this.heardHere.length > 0;
        const stale = placing && (this.latest === undefined || (this.latest?.version ?? null) !== version);
        if (behind.length || stale) {
          const s = await readSnapshot(this.d, this.workspaceId, [...behind.flatMap((m) => m.principals), ...[...this.here.values()].flatMap((e) => e.who.principals)]);
          this.settle(s);
          this.latest = placing ? s : undefined;
          for (const m of behind) m.offer(s);
        }
        if ((await this.openHere()) || behind.length || stale) this.tell();
      } catch (e) {
        rlog.warn('workspace not read for its streams', { workspaceId: this.workspaceId, err: e });
      }
    } while (this.again);
  }

  /** Opens the presence heard: with keys opened for this and not kept, however many notices that is. */
  private async openHere(): Promise<boolean> {
    const heard = this.heardHere.splice(0);
    if (!heard.length) return false;
    const ownerId = (await maybeOne(this.d.pool, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM workspaces WHERE workspace_id = $1', [this.workspaceId]))?.owner_id;
    const owner = ownerId === undefined ? undefined : await findOwner(this.d, ownerId, undefined);
    if (!owner) return false;
    const until = Date.now() + this.d.cfg.LIVE_PRESENCE_MS;
    for (const text of heard) {
      const n = openJson(workspaceKey(owner), hereHeader(owner, this.workspaceId), utf8(text), HereNotice);
      const key = `${n.person.id}:${n.connection}`;
      if (n.gone) { this.here.delete(key); continue; }
      const { email, principals, gone: _, ...rest } = n;
      this.here.set(key, { ...rest, who: { email: email ?? undefined, principals: principals.map((p) => unb64u(p)) }, until });
    }
    this.expire();
    return true;
  }
  /** Someone who can't open a thing any more isn't said to be in it, and someone with nothing left here isn't here. */
  private settle(s: Snapshot): void {
    if (!s) { this.here.clear(); return; }
    for (const [key, e] of this.here) {
      const standing = standingIn(s, e.who);
      if (!canOpen(standing)) { this.here.delete(key); continue; }
      const item = e.document === null ? undefined : s.state.items[e.document];
      const opens = e.document !== null && item !== undefined && roleOf(e.who, standing, e.document, item) !== undefined;
      this.here.set(key, { ...e, member: standing.role !== null, ...(opens ? {} : { document: null, block: null, typing: false }) });
    }
  }
  /** Connections that stopped saying they're here go when their time runs out. */
  private expire(): void {
    clearTimeout(this.expiry);
    const next = [...this.here.values()].reduce((soonest, e) => Math.min(soonest, e.until), Infinity);
    if (next === Infinity) return;
    this.expiry = setTimeout(() => {
      const now = Date.now();
      for (const [key, e] of this.here) if (e.until <= now) this.here.delete(key);
      this.expire();
      this.tell();
    }, Math.max(next - Date.now(), 0));
    this.expiry.unref();
  }
  /** Every stream works out what its reader sees of this, so a room full of people moving says so a few times a second at most. */
  private tell(): void {
    if (this.telling !== undefined) return;
    this.telling = setTimeout(() => {
      this.telling = undefined;
      this.told = Date.now();
      for (const m of this.members) m.heard();
    }, Math.max(this.told + TELL_EVERY_MS - Date.now(), 0));
    this.telling.unref();
  }

  /**
   * Who's here, as one reader may know it. They're told where someone is if they can open it, and otherwise only that it's
   * somewhere else. Someone they have no business knowing about isn't mentioned: a person who isn't in the workspace with
   * them, in a call with them, or in something they can open. An address goes only between people in the workspace, and a
   * connection to a call only between people in it.
   */
  seenBy(viewer: Viewer): WorkspaceHere[] {
    const s = this.latest;
    if (!s) return [];
    return [...this.here.values()].flatMap((e) => {
      const isMe = samePerson(e.who, viewer.who);
      const item = e.document === null ? undefined : s.state.items[e.document];
      const opens = e.document !== null && item !== undefined && roleOf(viewer.who, viewer.standing, e.document, item) !== undefined;
      const inCall = viewer.callId !== null && viewer.callId === e.callId;
      const colleagues = viewer.standing.role !== null && e.member;
      if (!isMe && !opens && !inCall && !colleagues) return [];
      return [{
        // A face comes from an address, so whoever isn't told the address gets one from the keyed ID, which tells them nothing.
        person: isMe || colleagues ? e.person : { ...e.person, email: '', portrait: portraitFor(e.person.id) }, connection: e.connection, callIdentity: inCall ? e.callIdentity : null,
        document: opens ? e.document : null, block: opens ? e.block : null, typing: opens && e.typing, elsewhere: e.document !== null && !opens, isMe
      }];
    });
  }
}

/** Rooms are per hub, so two API instances in one process (as in tests) keep to their own. */
const roomsByHub = new WeakMap<Hub, Map<string, Room>>();
export function roomFor(d: Deps, workspaceId: string): Room {
  const rooms = roomsByHub.get(d.hub) ?? new Map<string, Room>();
  roomsByHub.set(d.hub, rooms);
  const here = rooms.get(workspaceId);
  if (here) return here;
  const room = new Room(d, workspaceId, rooms);
  rooms.set(workspaceId, room);
  return room;
}
