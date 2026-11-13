/*
 * What browsers send a document (docs: Data and storage › What gets into a document): each update, checked by the firewall,
 * weighed against the document's limits and sealed onto its log under the row's lock, and words rescued from a document that
 * couldn't take them, as a new one's first state.
 */
import { MAX_DOC_BYTES, MAX_DOC_UPDATE_BYTES } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { concat, equalBytes, mac, stateKey } from '../../../keys/crypto';
import { maybeOne, tx, type Db } from '../../../platform/db';
import { AppError, ConflictError, TooLargeError, ValidationError } from '../../../platform/errors';
import { DocFailure } from '../../../live/doc-pool';
import { runDoc } from './pool';
import { log } from '../../../platform/log';
import { change, editableBy, limitKey, requireDocument, workspaceFor, type Allowed, type Reader, type Who } from '../access';
import { bringsNew, browserCaps, inspect, isTooMuch, refusalGiven, type Inspected } from './firewall';
import {
  type Place, HOLDS, type Tending, INLINE_BYTES, BIG_DOC_BYTES, type Weighed, lockDocument, restoring, requireRoom, append, editorOf, tendingAfter, DocRow, working, sealedLog, jobFor, tend,
  documentRow, tooLong, kindOf, byLimits
} from './documents';
import { takeReceiving } from './traffic';
import { knownClients, tagsFor, nobody } from './clients';

const dlog = log.child({ component: 'documents' });
/** How long the tree's `editedAt` may lag what's been typed, so nobody rewrites the tree for every key. */
const TOUCH_EVERY_MS = 60_000;

/** A keyed hash of what an update deletes, so the same deletes arriving again are known without opening anything. */
const deletesTag = (o: Owner, documentId: string, update: Uint8Array, seen: Inspected): Uint8Array | null =>
  (seen.deletes.length ? mac(stateKey(o.root, o.ownerId, `document-deletes:${documentId}`), update.subarray(seen.dsFrom)) : null);
/** Whether the log since its snapshot has had these deletes already. */
const deletedBefore = async (c: Db, p: Place, documentId: string, tag: Uint8Array): Promise<boolean> =>
  (await maybeOne(c, z.object({ n: z.number() }), 'SELECT 1 AS n FROM document_updates WHERE owner_id = $1 AND document_id = $2 AND deletes_tag = $3 LIMIT 1', [p.owner.ownerId, documentId, tag])) !== undefined;
/** An update's deletes and nothing else, for one whose structs are all here already: the structs would only be counted again. */
function deletesOnly(update: Uint8Array, seen: Inspected): { update: Uint8Array; seen: Inspected } {
  return { update: concat(new Uint8Array([0]), update.subarray(seen.dsFrom)), seen: { ...seen, blocks: [], needs: [], items: 0, nesting: 0, content: 0, dsFrom: 1 } };
}

/** Why an update was refused goes in the logs, and nothing of what it said. A browser hears whether it's too much, which taking something out can change, or never to be. */
function refuseUpdate(workspaceId: string, documentId: string, why: string, bytes: number): AppError {
  dlog.info('update refused', { workspaceId, documentId, why, bytes });
  const context = { workspaceId, documentId, why };
  return isTooMuch(why) ? new TooLargeError('That’s too much to save in one go.', { context }) : new ValidationError('That isn’t an update Alcove can take.', { context });
}

/** What one update may hold: as much as a document can. */
const capsFor = (d: Deps) => browserCaps(d.cfg.DOC_ITEMS_MAX * HOLDS);
/** Where an update landed, and what that leaves to do. */
interface Landed { w: Allowed; seq: number; stale: boolean; tending: Tending | null }

/**
 * An update from a browser, sealed and appended in one transaction. Whoever can't write here hears so before anything of it is
 * read. It's checked in two steps: what can be told from the update alone, with nothing held, and what depends on the log,
 * under the workspace's lock, so nothing lands after someone loses access, and the document's, so `seq`s commit in order and
 * any reader who's seen one has seen all before it. `seq` is where it landed. `length`: what the request says it holds.
 */
export async function appendUpdate(d: Deps, reader: Reader, workspaceId: string, documentId: string, length: number, body: () => Promise<ArrayBuffer>): Promise<{ seq: number }> {
  const asked = await editableBy(d, reader, workspaceId, documentId);
  const received = takeReceiving(d, length);
  try {
    const update = new Uint8Array(await body());
    if (!update.length) throw new ValidationError('That update is empty.', { context: { workspaceId, documentId } });
    if (update.length > MAX_DOC_UPDATE_BYTES) throw new TooLargeError('That’s too much to save in one go.', { context: { workspaceId, documentId, bytes: update.length } });
    const { seen, why } = update.length <= INLINE_BYTES ? inspect(update, capsFor(d)) : await runDoc(d.docs, 'inspect', { update, items: capsFor(d).items }, { big: update.length > BIG_DOC_BYTES, bytes: update.length, who: limitKey(reader) });
    if (!seen) throw refuseUpdate(workspaceId, documentId, why ?? 'unknown', update.length);

    const write = (weighed: Weighed | null) => tx(d.pool, async (c) => {
      const w = await editableBy(d, reader, workspaceId, documentId, c, 'hold');
      const row = await lockDocument(c, w, documentId);
      if (row.held) throw restoring(w, documentId);
      const known = await knownClients(c, w, documentId, seen);
      const why2 = refusalGiven(seen, known, (client, people) => tagsFor(w.owner, documentId, client, reader).some((t) => people.some((q) => equalBytes(t, q))));
      if (why2) throw refuseUpdate(workspaceId, documentId, why2, update.length);
      // Every struct in it is here already, as with a retry, or something rebuilt: what's left is its deletes, if they're new. The same deletes again are nothing, and cost nothing: no row, no version.
      const fresh = bringsNew(seen, known);
      const deletes = deletesTag(w.owner, documentId, update, seen);
      if (!fresh && (!deletes || (await deletedBefore(c, w, documentId, deletes)))) return { landed: { w, seq: row.next_seq - 1, stale: false, tending: null } };
      const what = fresh ? { update, seen } : deletesOnly(update, seen);
      if (requireRoom(w, documentId, row, what.update.length, what.seen, weighed) === 'weigh') return { weigh: row };
      // Whoever's writing is who a client belongs to by now, which refusalGiven has made sure of: what it went by still counts, and so does anything new, such as an account for a client from before accounts were counted.
      const tags = (client: number) => {
        const had = known.get(client)?.people ?? [];
        return concat(...had, ...tagsFor(w.owner, documentId, client, reader).filter((t) => !had.some((q) => equalBytes(t, q))));
      };
      const seq = await append(c, w, documentId, row, what.update, editorOf(w.owner, reader), what.seen, tags, deletes);
      return { landed: { w, seq, stale: Date.now() - Date.parse(w.editedAt) >= TOUCH_EVERY_MS, tending: tendingAfter(w, row, seq, what.update.length, reader.seat?.callId ?? null) } };
    });
    /** A document at its limit, where the figures can't say: a worker weighs what this update would bring it to. */
    const weigh = async (row: DocRow): Promise<Weighed> => working(asked, documentId, row, async () => runDoc(d.docs, 'weigh', { ...(await sealedLog(asked, documentId)), update }, jobFor(asked, documentId, row, limitKey(reader))));
    const settle = async (weighed: Weighed | null, folded: boolean): Promise<Landed> => {
      try {
        const done = await write(weighed);
        if ('landed' in done) return done.landed;
        return settle(await weigh(done.weigh), folded);
      } catch (e) {
        if (!(e instanceof TooLargeError) || folded) throw e;
        // What's counted is what could be there: much of it may be what's been deleted, or overwritten, which only a compaction shows, and nothing else may come along to start one. So this one reaches all the way: a stream reading the last row starts again, which is rare and safe. Then it's judged again by what's there.
        if (!(await tend(asked, documentId, { through: (await documentRow(asked, documentId)).next_seq - 1, keep: undefined, full: true }))) throw e;
        return settle(weighed, true);
      }
    };
    const landed = await settle(null, false);
    if (landed.tending) await tend(landed.w, documentId, landed.tending);
    if (landed.stale) await touch(d, reader, workspaceId, documentId);
    if (reader.seat) await reader.seat.call.workedOn({ workspaceId, documentId }, editorOf(landed.w.owner, reader));
    return { seq: landed.seq };
  } finally {
    received();
  }
}
/**
 * What a browser couldn't get into the document it was written in, as a new one's first state (`saveCopy`): only ever a document
 * nobody's written to, as the state doesn't merge with anything. It's judged like anything from a browser, and it's the server's
 * from then on, so nobody writes as one of its clients: whoever carries on is someone new.
 */
export async function adoptState(d: Deps, reader: Reader, workspaceId: string, documentId: string, length: number, body: () => Promise<ArrayBuffer>): Promise<{ seq: number }> {
  const asked = await workspaceFor(d, reader, workspaceId);
  const { item } = requireDocument(reader, asked, documentId, 'edit');
  const taken = () => new ConflictError('Something’s been written to this document already.', { context: { workspaceId, documentId } });
  if ((await documentRow(asked, documentId)).next_seq !== 1) throw taken();
  const received = takeReceiving(d, length);
  try {
    const state = new Uint8Array(await body());
    if (!state.length) throw new ValidationError('That update is empty.', { context: { workspaceId, documentId } });
    if (state.length > MAX_DOC_BYTES) throw tooLong(asked, documentId, state.length, 0);
    const { made, why } = await runDoc(d.docs, 'adopt', { state, items: capsFor(d).items, kind: kindOf(item), name: item.kind === 'document' && item.name ? item.name : null }, { big: state.length > BIG_DOC_BYTES, bytes: state.length, who: limitKey(reader) }).catch((e: unknown) => {
      throw e instanceof DocFailure && e.reason === 'failed' ? refuseUpdate(workspaceId, documentId, 'unreadable', state.length) : e;
    });
    if (!made) throw refuseUpdate(workspaceId, documentId, why ?? 'unknown', state.length);
    if (byLimits(asked, made.shape.bytes, made.shape.items - made.shape.retired)) throw tooLong(asked, documentId, made.shape.bytes, made.shape.items);
    const seq = await tx(d.pool, async (c) => {
      const w = await editableBy(d, reader, workspaceId, documentId, c, 'hold');
      const row = await lockDocument(c, w, documentId);
      if (row.next_seq !== 1) throw taken();
      return append(c, w, documentId, row, made.state, editorOf(w.owner, reader), made.seen, nobody);
    });
    return { seq };
  } finally {
    received();
  }
}
/** The tree follows what's written, about a minute behind. The update is safe by now, so this can't fail it. */
async function touch(d: Deps, who: Who, workspaceId: string, documentId: string): Promise<void> {
  try {
    await change(d, who, workspaceId, (w) => {
      const item = w.state.items[documentId];
      if (item && Date.now() - Date.parse(item.editedAt) >= TOUCH_EVERY_MS) w.state = { ...w.state, items: { ...w.state.items, [documentId]: { ...item, editedAt: new Date().toISOString() } } };
    });
  } catch (e) {
    dlog.at(e instanceof AppError && e.status < 500 ? 'info' : 'warn', 'the tree’s edited time wasn’t moved on', { workspaceId, documentId, err: e });
  }
}
